package apiproxy

import (
	"bytes"
	"golang.org/x/crypto/bcrypt"
	"io"
	"log"
	"net/http"
	db "openai-api-proxy/db"
	"os"
	"strings"
	"testing"
	"time"
)

// Reproduce case where SSE events use nested response.usage in response.completed
// and ensure our NewResponse parsing finds and logs the usage.
func TestNewResponse_SSENestedUsage(t *testing.T) {
	// Build SSE stream: a few events and a final response.completed with nested usage
	sseEvents := []string{
		"event: response.created\n",
		"data: {\"type\":\"response.created\",\"sequence_number\":0,\"response\":{\"id\":\"r1\",\"object\":\"response\"}}\n\n",
		"event: response.in_progress\n",
		"data: {\"type\":\"response.in_progress\",\"sequence_number\":1,\"response\":{\"id\":\"r1\",\"status\":\"in_progress\"}}\n\n",
		// final completed event contains nested usage
		"event: response.completed\n",
		`data: {"type":"response.completed","sequence_number":2,"response":{"id":"r1","object":"response","usage":{"prompt_tokens":11,"completion_tokens":22}}}` + "\n\n",
	}
	sse := strings.Join(sseEvents, "")

	// Prepare a fake request with Authorization header so the code can lookup api key uuid
	req, _ := http.NewRequest("POST", "https://example.local/openai/responses", nil)
	req.Header.Set(authHeader, "Bearer TESTTOKEN")

	resp := &http.Response{
		Request: req,
		Header:  http.Header{"Content-Type": []string{"text/event-stream; charset=utf-8"}},
		Body:    io.NopCloser(strings.NewReader(sse)),
	}

	// capture logs
	var buf bytes.Buffer
	oldOut := log.Writer()
	log.SetOutput(&buf)
	defer func() { log.SetOutput(oldOut) }()

	// set env to enable dev logging
	os.Setenv("DEV_LOG_TOKEN_COUNT", "1")
	defer os.Unsetenv("DEV_LOG_TOKEN_COUNT")
	os.Setenv("DEV_LOG_TOKEN_DEBUG", "1")
	defer os.Unsetenv("DEV_LOG_TOKEN_DEBUG")

	// Set up a fake DB that will provide a hashed token and capture writes.
	fb := &fakeDBForTest{}
	// generate bcrypt hash for TESTTOKEN so CompareToken can match it
	hash, _ := bcrypt.GenerateFromPassword([]byte("TESTTOKEN"), 5)
	fb.apiKeys = []db.ApiKey{{UUID: "uid-1", ApiKey: string(hash), Owner: "owner1"}}

	rc := &ResponseConf{db: fb}
	if err := rc.NewResponse(resp); err != nil {
		t.Fatalf("NewResponse error: %v", err)
	}

	// Drain the body to trigger the TeeReader and SSE parsing
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	out := buf.String()
	// Wait a bit for goroutine to process
	for i := 0; i < 10; i++ {
		if strings.Contains(out, "wrote SSE completed request") {
			break
		}
		time.Sleep(50 * time.Millisecond)
		out = buf.String()
	}

	if !strings.Contains(out, "SSE event") {
		t.Fatalf("expected SSE usage logs but none found. Logs:\n%s", out)
	}

	// ensure DB write occurred with expected counts
	if len(fb.writes) != 1 {
		t.Fatalf("expected 1 DB write, got %d; logs:\n%s", len(fb.writes), out)
	}
	w := fb.writes[0]
	if w.ID != "r1" || w.TokenCountPrompt != 11 || w.TokenCountComplete != 22 {
		t.Fatalf("unexpected DB write: %+v; logs:\n%s", w, out)
	}
}

func TestNewResponse_SSEOverlongLineDoesNotAbortStream(t *testing.T) {
	os.Setenv("SSE_MAX_LINE_BYTES", "256")
	defer os.Unsetenv("SSE_MAX_LINE_BYTES")

	longChunk := strings.Repeat("x", 512)
	sse := strings.Join([]string{
		"event: response.output_text.delta\n",
		`data: {"type":"response.output_text.delta","text":"` + longChunk + `"}` + "\n\n",
		"event: response.completed\n",
		`data: {"type":"response.completed","response":{"id":"r-long","object":"response","usage":{"prompt_tokens":3,"completion_tokens":4}}}` + "\n\n",
	}, "")

	req, _ := http.NewRequest("POST", "https://example.local/openai/responses", nil)
	req.Header.Set(authHeader, "Bearer TESTTOKEN")
	resp := &http.Response{
		Request: req,
		Header:  http.Header{"Content-Type": []string{"text/event-stream; charset=utf-8"}},
		Body:    io.NopCloser(strings.NewReader(sse)),
	}

	fb := &fakeDBForTest{}
	hash, _ := bcrypt.GenerateFromPassword([]byte("TESTTOKEN"), 5)
	fb.apiKeys = []db.ApiKey{{UUID: "uid-1", ApiKey: string(hash), Owner: "owner1"}}

	rc := &ResponseConf{db: fb}
	if err := rc.NewResponse(resp); err != nil {
		t.Fatalf("NewResponse error: %v", err)
	}

	if _, err := io.Copy(io.Discard, resp.Body); err != nil {
		t.Fatalf("stream relay failed: %v", err)
	}
	resp.Body.Close()

	for i := 0; i < 10 && len(fb.writes) == 0; i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if len(fb.writes) != 1 {
		t.Fatalf("expected 1 DB write, got %d", len(fb.writes))
	}
	w := fb.writes[0]
	if w.ID != "r-long" || w.TokenCountPrompt != 3 || w.TokenCountComplete != 4 {
		t.Fatalf("unexpected DB write: %+v", w)
	}
}

func TestNewResponse_SSEOverCapEventApproximatesCompletionTokens(t *testing.T) {
	os.Setenv("SSE_EVENT_MAX_BYTES", "256")
	defer os.Unsetenv("SSE_EVENT_MAX_BYTES")
	os.Setenv("SSE_MAX_LINE_BYTES", "4096")
	defer os.Unsetenv("SSE_MAX_LINE_BYTES")

	longChunk := strings.Repeat("z", 1200)
	sse := strings.Join([]string{
		"event: response.output_text.delta\n",
		`data: {"type":"response.output_text.delta","id":"too-big-1","text":"` + longChunk + `","usage":{"completion_tokens":999}}` + "\n\n",
		"event: response.completed\n",
		`data: {"type":"response.completed","response":{"id":"r-approx","object":"response","model":"gpt-4o-2025-01-01"}}` + "\n\n",
	}, "")

	req, _ := http.NewRequest("POST", "https://example.local/openai/responses", nil)
	req.Header.Set(authHeader, "Bearer TESTTOKEN")
	resp := &http.Response{
		Request: req,
		Header:  http.Header{"Content-Type": []string{"text/event-stream; charset=utf-8"}},
		Body:    io.NopCloser(strings.NewReader(sse)),
	}

	fb := &fakeDBForTest{}
	hash, _ := bcrypt.GenerateFromPassword([]byte("TESTTOKEN"), 5)
	fb.apiKeys = []db.ApiKey{{UUID: "uid-1", ApiKey: string(hash), Owner: "owner1"}}

	rc := &ResponseConf{db: fb}
	if err := rc.NewResponse(resp); err != nil {
		t.Fatalf("NewResponse error: %v", err)
	}

	if _, err := io.Copy(io.Discard, resp.Body); err != nil {
		t.Fatalf("stream relay failed: %v", err)
	}
	resp.Body.Close()

	for i := 0; i < 10 && len(fb.writes) == 0; i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if len(fb.writes) != 1 {
		t.Fatalf("expected 1 DB write, got %d", len(fb.writes))
	}
	w := fb.writes[0]
	if w.ID != "r-approx" {
		t.Fatalf("unexpected ID: %+v", w)
	}
	if !w.IsApproximated {
		t.Fatalf("expected approximated request, got %+v", w)
	}
	if w.TokenCountComplete <= 0 {
		t.Fatalf("expected approximated completion tokens > 0, got %+v", w)
	}
	if w.TokenCountComplete == 999 {
		t.Fatalf("expected oversized event usage to be ignored under cap, got %+v", w)
	}
}

// fake DB implementation for test
type fakeDBForTest struct {
	apiKeys []db.ApiKey
	writes  []*db.Request
}

func (f *fakeDBForTest) LookupApiKeys(uid string) ([]db.ApiKey, error) {
	return f.apiKeys, nil
}
func (f *fakeDBForTest) WriteRequest(r *db.Request) error {
	f.writes = append(f.writes, r)
	return nil
}
