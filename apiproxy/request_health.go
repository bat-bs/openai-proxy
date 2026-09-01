package apiproxy

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	db "openai-api-proxy/db"
)

const (
	requestHealthQueueSize       = 1024
	requestHealthWorkers         = 2
	requestHealthRetries         = 5
	requestHealthRetryWait       = 250 * time.Millisecond
	requestHealthWriteTimeout    = 5 * time.Second
	requestHealthShutdownTimeout = 30 * time.Second
)

type requestHealthStore interface {
	WriteRequestHealthAttemptContext(context.Context, *db.RequestHealthAttempt) error
	RequestHealthRetention() (time.Duration, error)
	DeleteExpiredRequestHealthAttempts(time.Time) (int64, error)
}

type requestHealthRecorder struct {
	store        requestHealthStore
	queue        chan *db.RequestHealthAttempt
	stop         chan struct{}
	wg           sync.WaitGroup
	mu           sync.Mutex
	open         bool
	once         sync.Once
	closed       chan struct{}
	workerCtx    context.Context
	workerCancel context.CancelFunc
	dropped      atomic.Uint64
}

func newRequestHealthRecorder(store requestHealthStore) *requestHealthRecorder {
	if store == nil {
		return nil
	}
	r := &requestHealthRecorder{
		store:  store,
		queue:  make(chan *db.RequestHealthAttempt, requestHealthQueueSize),
		stop:   make(chan struct{}),
		closed: make(chan struct{}),
		open:   true,
	}
	r.workerCtx, r.workerCancel = context.WithCancel(context.Background())
	for i := 0; i < requestHealthWorkers; i++ {
		r.wg.Add(1)
		go r.runWorker()
	}
	r.wg.Add(1)
	go r.runCleanup()
	return r
}

func (r *requestHealthRecorder) record(attempt *db.RequestHealthAttempt) {
	if r == nil || attempt == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.open {
		return
	}
	select {
	case r.queue <- attempt:
	default:
		r.logDrop("queue is full")
	}
}

func (r *requestHealthRecorder) logDrop(reason string) {
	total := r.dropped.Add(1)
	log.Printf("request health telemetry dropped: %s (total=%d)", reason, total)
}

func (r *requestHealthRecorder) runWorker() {
	defer r.wg.Done()
	for {
		select {
		case attempt, ok := <-r.queue:
			if !ok {
				return
			}
			r.writeAttempt(attempt)
		case <-r.workerCtx.Done():
			r.discardQueued()
			return
		}
	}
}

func (r *requestHealthRecorder) writeAttempt(attempt *db.RequestHealthAttempt) {
	var err error
	for retry := 0; retry <= requestHealthRetries; retry++ {
		if r.workerCtx.Err() != nil {
			r.logDrop("shutdown canceled queued write")
			return
		}
		writeCtx, cancel := context.WithTimeout(r.workerCtx, requestHealthWriteTimeout)
		err = r.store.WriteRequestHealthAttemptContext(writeCtx, attempt)
		cancel()
		if err == nil {
			break
		}
		if retry < requestHealthRetries {
			wait := time.NewTimer(requestHealthRetryWait << retry)
			select {
			case <-wait.C:
			case <-r.workerCtx.Done():
				if !wait.Stop() {
					<-wait.C
				}
				r.logDrop("shutdown canceled retry")
				return
			}
		}
	}
	if err != nil {
		r.logDrop(fmt.Sprintf("after retries: %v", err))
	}
}

func (r *requestHealthRecorder) runCleanup() {
	defer r.wg.Done()
	cleanup := func() {
		retention, err := r.store.RequestHealthRetention()
		if err != nil {
			log.Printf("request health retention lookup failed: %v", err)
			return
		}
		if _, err := r.store.DeleteExpiredRequestHealthAttempts(time.Now().Add(-retention)); err != nil {
			log.Printf("request health retention cleanup failed: %v", err)
		}
	}
	cleanup()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			cleanup()
		case <-r.stop:
			return
		}
	}
}

func (r *requestHealthRecorder) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), requestHealthShutdownTimeout)
	defer cancel()
	r.CloseContext(ctx)
}

func (r *requestHealthRecorder) CloseContext(ctx context.Context) {
	if r == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r.once.Do(func() {
		r.mu.Lock()
		r.open = false
		close(r.queue)
		close(r.stop)
		r.mu.Unlock()
		go func() {
			select {
			case <-ctx.Done():
				r.workerCancel()
			case <-r.closed:
			}
		}()
		go func() {
			r.wg.Wait()
			close(r.closed)
		}()
	})
	select {
	case <-r.closed:
		log.Printf("request health telemetry shutdown: dropped=%d", r.dropped.Load())
	case <-ctx.Done():
		r.workerCancel()
		r.discardQueued()
		log.Printf("request health telemetry shutdown timed out: dropped=%d", r.dropped.Load())
	}
}

func (r *requestHealthRecorder) discardQueued() {
	discarded := 0
	for {
		select {
		case _, ok := <-r.queue:
			if !ok {
				if discarded > 0 {
					r.dropped.Add(uint64(discarded))
					log.Printf("request health telemetry discarded queued records: count=%d", discarded)
				}
				return
			}
			discarded++
		default:
			if discarded > 0 {
				r.dropped.Add(uint64(discarded))
				log.Printf("request health telemetry discarded queued records: count=%d", discarded)
			}
			return
		}
	}
}

func (r *requestHealthRecorder) close() {
	r.Close()
}

type requestHealthTransport struct {
	base     http.RoundTripper
	recorder *requestHealthRecorder
}

type requestHealthMetadataKey struct{}

type requestHealthMetadata struct {
	Endpoint  string
	Model     string
	RequestID string
	Streaming bool
}

func withRequestHealthMetadata(req *http.Request, metadata requestHealthMetadata) *http.Request {
	return req.WithContext(context.WithValue(req.Context(), requestHealthMetadataKey{}, metadata))
}

func requestHealthMetadataFromRequest(req *http.Request) requestHealthMetadata {
	if req == nil {
		return requestHealthMetadata{}
	}
	metadata, _ := req.Context().Value(requestHealthMetadataKey{}).(requestHealthMetadata)
	return metadata
}

func (t *requestHealthTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	started := time.Now()
	metadata := requestHealthMetadataFromRequest(req)
	endpoint := metadata.Endpoint
	if endpoint == "" {
		endpoint = req.URL.Path
	}
	requestID := metadata.RequestID
	if requestID == "" {
		requestID = req.Header.Get("X-Request-ID")
	}
	attempt := &db.RequestHealthAttempt{
		AttemptID: newRequestHealthID(),
		RequestID: requestID,
		Endpoint:  endpoint,
		Upstream:  req.URL.Host,
		Model:     normalizeTelemetryModel(metadata.Model),
		Method:    req.Method,
		StartedAt: started,
		Streaming: metadata.Streaming || requestAcceptsEventStream(req),
	}
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	response, err := base.RoundTrip(req)
	if err != nil {
		attempt.Duration = time.Since(started)
		attempt.CompletedAt = time.Now()
		attempt.Outcome = requestHealthErrorOutcome(err, req.Context())
		attempt.ClientCancelled = attempt.Outcome == "caller_canceled"
		t.recorder.record(attempt)
		return nil, err
	}
	attempt.StatusCode = response.StatusCode
	attempt.Streaming = attempt.Streaming || strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/event")
	response.Body = &requestHealthBody{
		ReadCloser: response.Body,
		attempt:    attempt,
		recorder:   t.recorder,
		started:    started,
		ctx:        req.Context(),
	}
	return response, nil
}

const requestHealthModelCaptureLimit = 3 * 1024 * 1024

func requestHealthModelCaptureLimitFromEnv() int64 {
	return positiveInt64Env("REQUEST_HEALTH_MODEL_CAPTURE_LIMIT_BYTES", requestHealthModelCaptureLimit)
}

func normalizeTelemetryModel(model string) string {
	return strings.ToLower(strings.TrimSpace(model))
}

func captureRequestHealthModel(req *http.Request) string {
	model, _ := captureRequestHealthRequest(req)
	return model
}

func captureRequestHealthRequest(req *http.Request) (string, bool) {
	return captureRequestHealthRequestWithLimit(req, requestHealthModelCaptureLimit)
}

func captureRequestHealthRequestWithLimit(req *http.Request, limit int64) (string, bool) {
	if limit <= 0 || req == nil || req.Body == nil || (req.ContentLength >= 0 && req.ContentLength > limit) {
		return "", false
	}
	body, err := io.ReadAll(io.LimitReader(req.Body, limit+1))
	if err != nil || int64(len(body)) > limit {
		req.Body = io.NopCloser(io.MultiReader(bytes.NewReader(body), req.Body))
		return "", false
	}
	req.Body = io.NopCloser(bytes.NewReader(body))
	var payload struct {
		Model  string `json:"model"`
		Stream *bool  `json:"stream"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", false
	}
	return normalizeTelemetryModel(payload.Model), payload.Stream != nil && *payload.Stream
}

type requestHealthBody struct {
	io.ReadCloser
	attempt   *db.RequestHealthAttempt
	recorder  *requestHealthRecorder
	started   time.Time
	ctx       context.Context
	mu        sync.Mutex
	finalized bool
	firstByte time.Time
	readErr   error
}

func (b *requestHealthBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.mu.Lock()
	if !b.finalized {
		if n > 0 && b.firstByte.IsZero() {
			b.firstByte = time.Now()
			d := b.firstByte.Sub(b.started)
			b.attempt.FirstByteDuration = &d
		}
		if err != nil && err != io.EOF {
			b.readErr = err
		}
	}
	b.mu.Unlock()
	return n, err
}

func (b *requestHealthBody) Close() error {
	err := b.ReadCloser.Close()
	b.mu.Lock()
	if b.finalized {
		b.mu.Unlock()
		return err
	}
	b.finalized = true
	b.attempt.Duration = time.Since(b.started)
	b.attempt.CompletedAt = time.Now()
	if b.ctx.Err() != nil {
		b.attempt.ClientCancelled = true
		if b.attempt.StatusCode > 0 {
			b.attempt.Outcome = requestHealthStatusOutcome(b.attempt.StatusCode)
		} else {
			b.attempt.Outcome = "caller_canceled"
		}
	} else if b.readErr != nil {
		b.attempt.Outcome = requestHealthErrorOutcome(b.readErr, b.ctx)
	} else if err != nil {
		b.attempt.Outcome = requestHealthErrorOutcome(err, b.ctx)
	} else {
		b.attempt.Outcome = requestHealthStatusOutcome(b.attempt.StatusCode)
	}
	attempt := b.attempt
	b.mu.Unlock()
	// Finalization precedes queueing, so a concurrent Read cannot mutate the
	// attempt after the worker can observe it.
	b.recorder.record(attempt)
	return err
}

func requestHealthStatusOutcome(status int) string {
	switch {
	case status >= http.StatusOK && status < http.StatusMultipleChoices:
		return "success_2xx"
	case status >= http.StatusMultipleChoices && status < http.StatusBadRequest:
		return "redirect_3xx"
	case status >= http.StatusBadRequest && status < http.StatusInternalServerError:
		return "client_error_4xx"
	case status >= http.StatusInternalServerError && status <= 599:
		return "server_error_5xx"
	default:
		return "transport_error"
	}
}

func requestHealthErrorOutcome(err error, ctx context.Context) string {
	if ctx != nil && ctx.Err() == context.Canceled {
		return "caller_canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "timeout"
	}
	if errors.Is(err, context.Canceled) {
		return "upstream_canceled"
	}
	return "transport_error"
}

func requestAcceptsEventStream(req *http.Request) bool {
	return req != nil && strings.Contains(strings.ToLower(req.Header.Get("Accept")), "text/event")
}

func newRequestHealthID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("attempt-%d", time.Now().UnixNano())
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(raw[:])
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:]
}
