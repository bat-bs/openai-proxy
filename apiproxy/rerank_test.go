package apiproxy

import (
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

func TestHandleRerank_ForwardsRequestAndNormalizesResponse(t *testing.T) {
	var gotAuthorization string
	var gotRequest RerankRequest
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuthorization = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &gotRequest); err != nil {
			t.Fatalf("failed to decode upstream request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
      "id": "rerank-test",
      "results": [
        {"index": 1, "relevance_score": 0.91},
        {"index": 0, "relevance_score": 0.12}
      ],
      "model": "backend-model",
      "meta": {"billed_units": {"search_units": 1}}
    }`))
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
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v1/rerank", strings.NewReader(`{
    "model": "Cohere-rerank-v4.0-fast",
    "query": "green tea benefits",
    "documents": ["first document", "second document"],
    "top_n": 2,
    "return_documents": true
  }`))
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

	var response map[string]interface{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response["id"] != "rerank-test" {
		t.Fatalf("unexpected response id: %v", response["id"])
	}
	if _, ok := response["model"]; ok {
		t.Fatal("response should not expose upstream model")
	}
	if _, ok := response["meta"]; ok {
		t.Fatal("response should not expose upstream meta")
	}
	results := response["results"].([]interface{})
	first := results[0].(map[string]interface{})
	if first["index"] != float64(1) || first["relevance_score"] != 0.91 {
		t.Fatalf("unexpected first result: %v", first)
	}
	if first["document"].(map[string]interface{})["text"] != "second document" {
		t.Fatalf("expected document text to be reconstructed: %v", first["document"])
	}
}

func TestHandleRerank_ReturnsNullDocumentWhenNotRequested(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v1/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"],"return_documents":false}`))
	recorder := httptest.NewRecorder()

	h.HandleRerank(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Results []struct {
			Document *RerankDocument `json:"document"`
		} `json:"results"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(response.Results) != 1 || response.Results[0].Document != nil {
		t.Fatalf("expected document=null, got %+v", response.Results)
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
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v1/rerank", strings.NewReader(`{"query":"","documents":[]}`))
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
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v1/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
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
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v1/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
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
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v1/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
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
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v1/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
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
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v1/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
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
	req := httptest.NewRequest(http.MethodPost, "http://proxy/api/v1/rerank", strings.NewReader(`{"model":"test-model","query":"query","documents":["document"]}`))
	recorder := httptest.NewRecorder()

	h.HandleRerank(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
	if called {
		t.Fatal("upstream should not be called for a non-rerank model")
	}
}
