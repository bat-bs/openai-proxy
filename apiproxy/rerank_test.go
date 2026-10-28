package apiproxy

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	db "openai-api-proxy/db"
	"strings"
	"testing"
)

type rerankTestDB struct {
	writeErr  error
	request   *db.Request
	modelType string
}

func (d *rerankTestDB) LookupApiKeys(string) ([]db.ApiKey, error) { return nil, nil }
func (d *rerankTestDB) ListConfiguredModels() ([]string, error)   { return nil, nil }
func (d *rerankTestDB) LookupConfiguredModelType(string) (string, bool, error) {
	modelType := d.modelType
	if modelType == "" {
		modelType = db.ModelTypeRerank
	}
	return modelType, true, nil
}
func (d *rerankTestDB) WriteRequest(request *db.Request) error {
	d.request = request
	return d.writeErr
}
func (d *rerankTestDB) WriteRerankRequest(request *db.Request) error {
	d.request = request
	return d.writeErr
}

func TestAzureServiceHost_SupportsSharedBaseURL(t *testing.T) {
	tests := []struct {
		name   string
		prefix string
		base   string
		want   string
	}{
		{name: "normalized base", prefix: "openai", base: "azure.com", want: "resource.openai.azure.com"},
		{name: "legacy OpenAI base", prefix: "openai", base: "openai.azure.com", want: "resource.openai.azure.com"},
		{name: "Foundry prefix", prefix: "services.ai", base: "azure.com", want: "resource.services.ai.azure.com"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := azureServiceHost(test.prefix, "resource", test.base); got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}
}

func TestHandleRerank_ForwardsV2RequestAndResponse(t *testing.T) {
	var gotAuthorization string
	var gotRequestBody string
	var gotRequest RerankRequest
	upstreamResponse := []byte(`{
	  "id": "rerank-test",
	  "results": [
		{"index": 1, "relevance_score": 0.91, "relevant_spans": [{"start": 0, "end": 12, "score": 0.8}]},
		{"index": 0, "relevance_score": 0.12}
	  ],
	  "meta": {
		"api_version": {"version": "2"},
		"billed_units": {"search_units": 1},
		"tokens": {"input_tokens": 42}
	  }
	}`)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuthorization = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		gotRequestBody = string(body)
		if err := json.Unmarshal(body, &gotRequest); err != nil {
			t.Fatalf("failed to decode upstream request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(upstreamResponse)
	}))
	defer upstream.Close()

	h := &baseHandle{
		az: &AzureConfig{
			ApiKey: "azure-key",
		},
		rerankClient:           upstream.Client(),
		rerankEndpointOverride: upstream.URL,
		clientTokenValidator: func(http.ResponseWriter, *http.Request) bool {
			return true
		},
	}
	requestBody := `{"model":"Cohere-rerank-v4.0-fast","query":"green tea benefits","documents":["first document","second document"],"top_n":2,"max_tokens_per_doc":4096,"priority":0,"relevant_spans":{"mode":"enabled","threshold":0.1,"max_spans":2}}`
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v2/rerank", strings.NewReader(requestBody))
	req.Header.Set("Authorization", "Bearer proxy-key")
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	h.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if gotAuthorization != "Bearer azure-key" {
		t.Fatalf("expected Azure bearer authorization, got %q", gotAuthorization)
	}
	if gotRequest.Model != "Cohere-rerank-v4.0-fast" || gotRequest.Query != "green tea benefits" {
		t.Fatalf("unexpected upstream request: %+v", gotRequest)
	}
	if gotRequest.TopN == nil || *gotRequest.TopN != 2 {
		t.Fatalf("expected top_n=2, got %v", gotRequest.TopN)
	}
	if gotRequestBody != requestBody {
		t.Fatalf("expected the original v2 JSON body to be forwarded unchanged; got %s", gotRequestBody)
	}

	if !bytes.Equal(recorder.Body.Bytes(), upstreamResponse) {
		t.Fatalf("expected the original Cohere v2 response to be returned unchanged; got %s", recorder.Body.String())
	}
}

func TestServeHTTP_UnversionedRerankAliasUsesV2Handler(t *testing.T) {
	called := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		_, _ = w.Write([]byte(`{"id":"rerank-test","results":[{"index":0,"relevance_score":0.5}],"meta":{"billed_units":{"search_units":1}}}`))
	}))
	defer upstream.Close()

	h := &baseHandle{
		az:                     &AzureConfig{ApiKey: "azure-key"},
		rerankClient:           upstream.Client(),
		rerankEndpointOverride: upstream.URL,
		clientTokenValidator: func(http.ResponseWriter, *http.Request) bool {
			return true
		},
	}
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
	recorder := httptest.NewRecorder()

	h.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK || !called {
		t.Fatalf("expected unversioned alias to use rerank handler, got status=%d called=%v", recorder.Code, called)
	}
}

func TestServeHTTP_RetiredV1RerankRoutesReturnNotFound(t *testing.T) {
	for _, path := range []string{"/api/v1/rerank", "/api/v1/rerank/"} {
		t.Run(path, func(t *testing.T) {
			validated := false
			h := &baseHandle{
				az: &AzureConfig{},
				clientTokenValidator: func(http.ResponseWriter, *http.Request) bool {
					validated = true
					return false
				},
			}
			req := httptest.NewRequest(http.MethodPost, "http://proxy"+path, strings.NewReader(`{}`))
			recorder := httptest.NewRecorder()

			h.ServeHTTP(recorder, req)

			if recorder.Code != http.StatusNotFound {
				t.Fatalf("expected 404 for retired v1 route, got %d", recorder.Code)
			}
			if validated {
				t.Fatal("retired v1 route should not fall through to generic Azure handling")
			}
		})
	}
}

func TestHandleRerank_RejectsReturnDocuments(t *testing.T) {
	called := false
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	defer upstream.Close()

	h := &baseHandle{
		az:                     &AzureConfig{ApiKey: "azure-key"},
		rerankClient:           upstream.Client(),
		rerankEndpointOverride: upstream.URL,
		clientTokenValidator: func(http.ResponseWriter, *http.Request) bool {
			return true
		},
	}
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v2/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"],"return_documents":false}`))
	recorder := httptest.NewRecorder()

	h.HandleRerank(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for return_documents, got %d", recorder.Code)
	}
	if called {
		t.Fatal("return_documents request should be rejected before calling upstream")
	}
}

func TestHandleRerank_RejectsInvalidRequestBeforeUpstream(t *testing.T) {
	called := false
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	defer upstream.Close()

	h := &baseHandle{
		az:                     &AzureConfig{ApiKey: "azure-key"},
		rerankClient:           upstream.Client(),
		rerankEndpointOverride: upstream.URL,
		clientTokenValidator: func(http.ResponseWriter, *http.Request) bool {
			return true
		},
	}
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v2/rerank", strings.NewReader(`{"query":"","documents":[]}`))
	recorder := httptest.NewRecorder()

	h.HandleRerank(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if called {
		t.Fatal("upstream should not be called for invalid input")
	}
}

func TestHandleRerank_RejectsInvalidUpstreamIndex(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"bad","results":[{"index":4,"relevance_score":0.5}]}`))
	}))
	defer upstream.Close()

	h := &baseHandle{
		az:                     &AzureConfig{ApiKey: "azure-key"},
		rerankClient:           upstream.Client(),
		rerankEndpointOverride: upstream.URL,
		clientTokenValidator: func(http.ResponseWriter, *http.Request) bool {
			return true
		},
	}
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v2/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
	recorder := httptest.NewRecorder()

	h.HandleRerank(recorder, req)

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", recorder.Code)
	}
}

func TestHandleRerank_RejectsMissingUpstreamID(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"results":[{"index":0,"relevance_score":0.5}],"meta":{"billed_units":{"search_units":1}}}`))
	}))
	defer upstream.Close()

	h := &baseHandle{
		az:                     &AzureConfig{ApiKey: "azure-key"},
		rerankClient:           upstream.Client(),
		rerankEndpointOverride: upstream.URL,
		clientTokenValidator: func(http.ResponseWriter, *http.Request) bool {
			return true
		},
	}
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v2/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
	recorder := httptest.NewRecorder()

	h.HandleRerank(recorder, req)

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestHandleRerank_RejectsMissingBilledUnits(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"rerank-test","results":[{"index":0,"relevance_score":0.5}]}`))
	}))
	defer upstream.Close()

	h := &baseHandle{
		az:                     &AzureConfig{ApiKey: "azure-key"},
		rerankClient:           upstream.Client(),
		rerankEndpointOverride: upstream.URL,
		clientTokenValidator: func(http.ResponseWriter, *http.Request) bool {
			return true
		},
	}
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v2/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
	recorder := httptest.NewRecorder()

	h.HandleRerank(recorder, req)

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestHandleRerank_ReturnsPersistenceErrorBeforeResponse(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"rerank-test","results":[{"index":0,"relevance_score":0.5}],"meta":{"billed_units":{"search_units":1}}}`))
	}))
	defer upstream.Close()

	store := &rerankTestDB{writeErr: io.ErrClosedPipe}
	h := &baseHandle{
		db:                     store,
		az:                     &AzureConfig{ApiKey: "azure-key"},
		rerankClient:           upstream.Client(),
		rerankEndpointOverride: upstream.URL,
		clientTokenValidator: func(http.ResponseWriter, *http.Request) bool {
			return true
		},
	}
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v2/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
	recorder := httptest.NewRecorder()

	h.HandleRerank(recorder, req)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "rerank-test") {
		t.Fatal("successful upstream response should not be returned after persistence failure")
	}
}

func TestHandleRerankPersistsExactSearchUnits(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"rerank-test","results":[{"index":0,"relevance_score":0.5}],"meta":{"billed_units":{"search_units":7}}}`))
	}))
	defer upstream.Close()

	store := &rerankTestDB{}
	h := &baseHandle{
		db:                     store,
		az:                     &AzureConfig{ApiKey: "azure-key"},
		rerankClient:           upstream.Client(),
		rerankEndpointOverride: upstream.URL,
		clientTokenValidator: func(http.ResponseWriter, *http.Request) bool {
			return true
		},
	}
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v2/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
	recorder := httptest.NewRecorder()

	h.HandleRerank(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if store.request == nil || store.request.SearchUnits == nil || *store.request.SearchUnits != 7 {
		t.Fatalf("expected exact persisted search units, got %+v", store.request)
	}
	if store.request.IsApproximated {
		t.Fatal("provider billed units should not be marked approximated")
	}
}

func TestHandleRerank_RejectsNonRerankModel(t *testing.T) {
	called := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	defer upstream.Close()

	h := &baseHandle{
		db:                     &rerankTestDB{modelType: db.ModelTypeChatCompletion},
		az:                     &AzureConfig{ApiKey: "azure-key"},
		rerankClient:           upstream.Client(),
		rerankEndpointOverride: upstream.URL,
		clientTokenValidator: func(http.ResponseWriter, *http.Request) bool {
			return true
		},
	}
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v2/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
	recorder := httptest.NewRecorder()

	h.HandleRerank(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if called {
		t.Fatal("upstream should not be called for a non-rerank model")
	}
}
