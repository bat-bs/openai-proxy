package apiproxy

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	db "openai-api-proxy/db"
)

type healthStoreTest struct {
	mu               sync.Mutex
	attempts         []*db.RequestHealthAttempt
	blockWrites      bool
	writeStarted     chan struct{}
	writeStartedOnce sync.Once
}

func (s *healthStoreTest) RequestHealthRetention() (time.Duration, error) {
	return 30 * 24 * time.Hour, nil
}

func (s *healthStoreTest) DeleteExpiredRequestHealthAttempts(time.Time) (int64, error) {
	return 0, nil
}

func (s *healthStoreTest) WriteRequestHealthAttempt(a *db.RequestHealthAttempt) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.attempts = append(s.attempts, a)
	return nil
}

func (s *healthStoreTest) WriteRequestHealthAttemptContext(ctx context.Context, a *db.RequestHealthAttempt) error {
	if s.blockWrites {
		s.writeStartedOnce.Do(func() { close(s.writeStarted) })
		<-ctx.Done()
		return ctx.Err()
	}
	return s.WriteRequestHealthAttempt(a)
}

func waitForHealthAttempt(t *testing.T, store *healthStoreTest) *db.RequestHealthAttempt {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		store.mu.Lock()
		if len(store.attempts) > 0 {
			attempt := store.attempts[0]
			store.mu.Unlock()
			return attempt
		}
		store.mu.Unlock()
		time.Sleep(time.Millisecond)
	}
	t.Fatal("expected one attempt")
	return nil
}

func newTestRecorder(store *healthStoreTest) *requestHealthRecorder {
	return newRequestHealthRecorder(store)
}

func TestRequestHealthBodyRecordsStatusAndFirstByte(t *testing.T) {
	store := &healthStoreTest{}
	recorder := newTestRecorder(store)
	defer recorder.Close()
	started := time.Now().Add(-time.Millisecond)
	attempt := &db.RequestHealthAttempt{AttemptID: "attempt-1", StatusCode: http.StatusOK, StartedAt: started}
	body := &requestHealthBody{
		ReadCloser: io.NopCloser(strings.NewReader("ok")),
		attempt:    attempt,
		recorder:   recorder,
		started:    started,
		ctx:        context.Background(),
	}
	if _, err := io.ReadAll(body); err != nil {
		t.Fatal(err)
	}
	if err := body.Close(); err != nil {
		t.Fatal(err)
	}
	recorded := waitForHealthAttempt(t, store)
	if recorded.Outcome != "success_2xx" || recorded.FirstByteDuration == nil || recorded.CompletedAt.IsZero() {
		t.Fatalf("unexpected attempt: %+v", recorded)
	}
}

func TestRequestHealthStatusOutcomes(t *testing.T) {
	tests := []struct {
		status int
		want   string
	}{
		{http.StatusOK, "success_2xx"},
		{http.StatusMultipleChoices, "redirect_3xx"},
		{http.StatusBadRequest, "client_error_4xx"},
		{http.StatusInternalServerError, "server_error_5xx"},
	}
	for _, test := range tests {
		if got := requestHealthStatusOutcome(test.status); got != test.want {
			t.Errorf("status %d: got %q, want %q", test.status, got, test.want)
		}
	}
}

func TestRequestHealthErrorOutcomes(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := requestHealthErrorOutcome(context.Canceled, ctx); got != "caller_canceled" {
		t.Fatalf("caller cancellation classified as %q", got)
	}
	if got := requestHealthErrorOutcome(context.DeadlineExceeded, context.Background()); got != "timeout" {
		t.Fatalf("timeout classified as %q", got)
	}
	if got := requestHealthErrorOutcome(errors.New("connection reset"), context.Background()); got != "transport_error" {
		t.Fatalf("transport error classified as %q", got)
	}
}

func TestRequestHealthBodyRecordsCallerCancellation(t *testing.T) {
	store := &healthStoreTest{}
	recorder := newTestRecorder(store)
	defer recorder.Close()
	ctx, cancel := context.WithCancel(context.Background())
	attempt := &db.RequestHealthAttempt{AttemptID: "attempt-2", StatusCode: http.StatusOK}
	body := &requestHealthBody{
		ReadCloser: io.NopCloser(strings.NewReader("ok")),
		attempt:    attempt,
		recorder:   recorder,
		started:    time.Now(),
		ctx:        ctx,
	}
	cancel()
	_, _ = body.Read(make([]byte, 2))
	_ = body.Close()
	recorded := waitForHealthAttempt(t, store)
	if recorded.Outcome != "success_2xx" || !recorded.ClientCancelled {
		t.Fatalf("unexpected cancellation record: %+v", recorded)
	}
}

func TestRequestHealthRecorderCloseDrainsAndIsIdempotent(t *testing.T) {
	store := &healthStoreTest{}
	recorder := newTestRecorder(store)
	for i := 0; i < 10; i++ {
		recorder.record(&db.RequestHealthAttempt{AttemptID: string(rune('a' + i))})
	}

	recorder.Close()
	recorder.Close()

	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.attempts) != 10 {
		t.Fatalf("got %d persisted attempts, want 10", len(store.attempts))
	}
}

func TestRequestHealthRecorderConcurrentRecordAndClose(t *testing.T) {
	store := &healthStoreTest{}
	recorder := newTestRecorder(store)
	var records sync.WaitGroup
	for i := 0; i < 100; i++ {
		records.Add(1)
		go func(i int) {
			defer records.Done()
			recorder.record(&db.RequestHealthAttempt{AttemptID: string(rune(i))})
		}(i)
	}
	recorder.Close()
	records.Wait()
	recorder.Close()
}

func TestRequestHealthRecorderCloseContextIsBounded(t *testing.T) {
	store := &healthStoreTest{blockWrites: true, writeStarted: make(chan struct{})}
	recorder := newTestRecorder(store)
	recorder.record(&db.RequestHealthAttempt{AttemptID: "blocked"})
	select {
	case <-store.writeStarted:
	case <-time.After(time.Second):
		t.Fatal("worker did not start the blocked write")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	started := time.Now()
	recorder.CloseContext(ctx)
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("bounded close took %s", elapsed)
	}
	recorder.Close()
}

type closeUnblocksReader struct {
	readStarted chan struct{}
	closed      chan struct{}
	closeOnce   sync.Once
}

func (r *closeUnblocksReader) Read([]byte) (int, error) {
	close(r.readStarted)
	<-r.closed
	return 1, nil
}

func (r *closeUnblocksReader) Close() error {
	r.closeOnce.Do(func() { close(r.closed) })
	return nil
}

func TestRequestHealthBodyConcurrentReadAndCloseDoesNotMutateAfterFinalize(t *testing.T) {
	store := &healthStoreTest{}
	recorder := newTestRecorder(store)
	defer recorder.Close()
	reader := &closeUnblocksReader{readStarted: make(chan struct{}), closed: make(chan struct{})}
	attempt := &db.RequestHealthAttempt{AttemptID: "concurrent", StatusCode: http.StatusOK}
	body := &requestHealthBody{
		ReadCloser: reader,
		attempt:    attempt,
		recorder:   recorder,
		started:    time.Now(),
		ctx:        context.Background(),
	}
	readDone := make(chan struct{})
	go func() {
		_, _ = body.Read(make([]byte, 1))
		close(readDone)
	}()
	<-reader.readStarted
	if err := body.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-readDone:
	case <-time.After(time.Second):
		t.Fatal("concurrent read did not finish")
	}
	recorded := waitForHealthAttempt(t, store)
	if recorded.FirstByteDuration != nil || recorded.Outcome != "success_2xx" {
		t.Fatalf("read mutated finalized attempt: %+v", recorded)
	}
}

func TestCaptureRequestHealthModelPreservesOversizedBody(t *testing.T) {
	payload := strings.Repeat("x", requestHealthModelCaptureLimit+1)
	req, err := http.NewRequest(http.MethodPost, "https://example.test", strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}

	if model := captureRequestHealthModel(req); model != "" {
		t.Fatalf("expected no model for oversized body, got %q", model)
	}
	restored, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(restored) != payload {
		t.Fatalf("request body was not preserved")
	}
}

func TestCaptureRequestHealthRequestUsesStreamField(t *testing.T) {
	for _, test := range []struct {
		name      string
		body      string
		streaming bool
	}{
		{name: "non-streaming", body: `{"model":"gpt-5-mini","stream":false}`, streaming: false},
		{name: "streaming", body: `{"model":"gpt-5-mini","stream":true}`, streaming: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodPost, "https://example.test", strings.NewReader(test.body))
			if err != nil {
				t.Fatal(err)
			}
			model, streaming := captureRequestHealthRequest(req)
			if model != "gpt-5-mini" || streaming != test.streaming {
				t.Fatalf("got model=%q streaming=%t", model, streaming)
			}
		})
	}
}

func TestCaptureRequestHealthRequestNormalizesModel(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "https://example.test", strings.NewReader(`{"model":"  GPT-5-Mini  "}`))

	model, _ := captureRequestHealthRequest(req)
	if model != "gpt-5-mini" {
		t.Fatalf("got model %q, want %q", model, "gpt-5-mini")
	}
}

func TestRequestHealthModelCaptureLimitFromEnv(t *testing.T) {
	t.Setenv("REQUEST_HEALTH_MODEL_CAPTURE_LIMIT_BYTES", "1234")
	if got := requestHealthModelCaptureLimitFromEnv(); got != 1234 {
		t.Fatalf("got limit %d, want 1234", got)
	}

	t.Setenv("REQUEST_HEALTH_MODEL_CAPTURE_LIMIT_BYTES", "0")
	if got := requestHealthModelCaptureLimitFromEnv(); got != requestHealthModelCaptureLimit {
		t.Fatalf("got invalid-value fallback %d, want %d", got, requestHealthModelCaptureLimit)
	}
}
