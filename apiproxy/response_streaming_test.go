package apiproxy

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

// Test that NewResponse ignores streaming responses (SSE) and does not
// consume the response body. The Responses API may send multiple streaming
// parts (events) which should not be read by NewResponse so the proxy can
// relay the stream to the client.
func TestNewResponse_SkipsStreamingBody(t *testing.T) {
	// Build a fake SSE body with multiple events (each event separated by a blank line).
	sse := strings.Join([]string{
		"event: message",
		"data: {\"id\": \"part-1\", \"usage\": {\"prompt_tokens\": 1}}",
		"",
		"event: message",
		"data: {\"id\": \"part-2\", \"usage\": {\"completion_tokens\": 2}}",
		"",
	}, "\n")

	body := io.NopCloser(strings.NewReader(sse))
	resp := &http.Response{
		Header: http.Header{
			"Content-Type": []string{"text/event-stream; charset=utf-8"},
		},
		Body: body,
	}

	rc := &ResponseConf{db: nil}
	// NewResponse should simply return nil and not read/consume the body.
	if err := rc.NewResponse(resp); err != nil {
		t.Fatalf("NewResponse returned unexpected error: %v", err)
	}

	// After NewResponse returns, the body should still be readable and equal to the original SSE.
	remaining, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading remaining body failed: %v", err)
	}
	if string(remaining) != sse {
		t.Fatalf("expected body to remain unchanged, got: %q", string(remaining))
	}
}

// Test that a non-streaming JSON response with a usage block is parsed and
// that token counts are extracted correctly.
func TestReadValues_ParsesUsageTokens(t *testing.T) {
	jsonBody := `{"id":"resp-1","model":"gpt-test","usage":{"prompt_tokens":5,"completion_tokens":7}}`
	body := io.NopCloser(strings.NewReader(jsonBody))
	resp := &http.Response{
		Header: http.Header{
			"Content-Type": []string{"application/json"},
		},
		Body: body,
	}

	r := Response{rs: resp, rc: &ResponseConf{db: nil}}
	if err := r.ReadValues(); err != nil {
		t.Fatalf("ReadValues returned unexpected error: %v", err)
	}

	if r.content.ID != "resp-1" {
		t.Fatalf("expected ID 'resp-1', got '%s'", r.content.ID)
	}

	prompt := getUsageInt(r.content.Usage, "prompt_tokens")
	complete := getUsageInt(r.content.Usage, "completion_tokens")

	if prompt != 5 {
		t.Fatalf("expected prompt_tokens 5, got %d", prompt)
	}
	if complete != 7 {
		t.Fatalf("expected completion_tokens 7, got %d", complete)
	}
}
