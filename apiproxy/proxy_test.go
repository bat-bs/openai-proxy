package apiproxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"
)

func TestForwarding_V1Responses(t *testing.T) {
	// Start a test upstream server to observe what the proxy would send.
	var gotPath string
	var gotBody string
	var gotAuth string
	var gotApiKey string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		gotAuth = r.Header.Get("Authorization")
		gotApiKey = r.Header.Get("Api-Key")
		w.WriteHeader(200)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer ts.Close()

	// Build a proxy target with base path /openai
	target, _ := url.Parse(ts.URL + "/openai")
	proxy := httputil.NewSingleHostReverseProxy(target)

	// Create a request that the proxy would receive
	body := `{"model":"gpt-5-mini","input":"hello"}`
	req := httptest.NewRequest("POST", "http://localhost/api/v1/responses", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer userkey")
	// Simulate that the proxy has set the Azure key header prior to forwarding
	req.Header.Set("Api-Key", "azurekey")

	// Apply same path trimming as the proxy does
	req.URL.Path = strings.TrimPrefix(req.URL.Path, "/api")

	// Perform the proxying
	rr := httptest.NewRecorder()
	proxy.ServeHTTP(rr, req)

	// Validate upstream received the correct combined path and headers/body
	if gotPath != "/openai/v1/responses" {
		t.Fatalf("expected path /openai/v1/responses, got %s", gotPath)
	}
	if !strings.Contains(gotBody, `"input":"hello"`) {
		t.Fatalf("unexpected body forwarded: %s", gotBody)
	}
	if gotAuth != "Bearer userkey" {
		t.Fatalf("authorization header not forwarded, got: %s", gotAuth)
	}
	if gotApiKey != "azurekey" {
		t.Fatalf("api-key header not forwarded, got: %s", gotApiKey)
	}
}

func TestForwarding_V1ChatCompletions(t *testing.T) {
	var gotPath string
	var gotBody string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(200)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer ts.Close()

	target, _ := url.Parse(ts.URL + "/openai")
	proxy := httputil.NewSingleHostReverseProxy(target)

	body := `{"model":"gpt-5-mini","messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}`
	req := httptest.NewRequest("POST", "http://localhost/api/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	req.URL.Path = strings.TrimPrefix(req.URL.Path, "/api")

	rr := httptest.NewRecorder()
	proxy.ServeHTTP(rr, req)

	if gotPath != "/openai/v1/chat/completions" {
		t.Fatalf("expected path /openai/v1/chat/completions, got %s", gotPath)
	}
	if !strings.Contains(gotBody, `"messages"`) {
		t.Fatalf("unexpected body forwarded: %s", gotBody)
	}
}
