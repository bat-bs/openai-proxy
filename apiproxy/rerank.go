package apiproxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	db "openai-api-proxy/db"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultRerankTimeout          = 30 * time.Second
	defaultRerankMaxRequestBytes  = 10 * 1024 * 1024
	defaultRerankMaxResponseBytes = 10 * 1024 * 1024
)

type RerankRequest struct {
	Model           string   `json:"model"`
	Query           string   `json:"query"`
	Documents       []string `json:"documents"`
	TopN            *int     `json:"top_n,omitempty"`
	ReturnDocuments *bool    `json:"return_documents,omitempty"`
}

type rerankUpstreamResponse struct {
	ID      string                 `json:"id"`
	Results []rerankUpstreamResult `json:"results"`
	Meta    rerankMeta             `json:"meta"`
}

type rerankMeta struct {
	BilledUnits rerankBilledUnits `json:"billed_units"`
}

type rerankBilledUnits struct {
	SearchUnits *int `json:"search_units"`
}

type rerankUpstreamResult struct {
	Index          int             `json:"index"`
	RelevanceScore float64         `json:"relevance_score"`
	Document       *RerankDocument `json:"document,omitempty"`
}

type RerankDocument struct {
	Text string `json:"text"`
}

type rerankResponse struct {
	ID      string         `json:"id,omitempty"`
	Results []RerankResult `json:"results"`
}

type RerankResult struct {
	Index          int             `json:"index"`
	RelevanceScore float64         `json:"relevance_score"`
	Document       *RerankDocument `json:"document"`
}

func rerankTimeoutFromEnv() time.Duration {
	if value := strings.TrimSpace(os.Getenv("RERANK_TIMEOUT_MS")); value != "" {
		milliseconds, err := strconv.ParseInt(value, 10, 64)
		if err == nil && milliseconds > 0 {
			return time.Duration(milliseconds) * time.Millisecond
		}
		log.Printf("invalid RERANK_TIMEOUT_MS=%q; using default %s", value, defaultRerankTimeout)
	}
	return defaultRerankTimeout
}

func rerankMaxRequestBytesFromEnv() int64 {
	return positiveInt64Env("RERANK_MAX_REQUEST_BYTES", defaultRerankMaxRequestBytes)
}

func rerankMaxResponseBytesFromEnv() int64 {
	return positiveInt64Env("RERANK_MAX_RESPONSE_BYTES", defaultRerankMaxResponseBytes)
}

func positiveInt64Env(name string, fallback int64) int64 {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err == nil && parsed > 0 {
			return parsed
		}
		log.Printf("invalid %s=%q; using default %d", name, value, fallback)
	}
	return fallback
}

func azureServiceHost(prefix, resource, baseURL string) string {
	baseURL = strings.TrimSuffix(strings.TrimSpace(baseURL), ".")
	baseURL = strings.TrimPrefix(baseURL, "https://")
	baseURL = strings.TrimPrefix(baseURL, "http://")
	baseURL = strings.TrimPrefix(baseURL, "openai.")
	baseURL = strings.TrimPrefix(baseURL, "services.ai.")
	return resource + "." + prefix + "." + baseURL
}

func (h *baseHandle) HandleRerank(w http.ResponseWriter, r *http.Request) {
	statusWriter := &rerankStatusWriter{ResponseWriter: w}
	w = statusWriter
	requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
	if requestID == "" {
		requestID = fmt.Sprintf("rerank-%d", time.Now().UnixNano())
	}
	w.Header().Set("X-Request-ID", requestID)
	startedAt := time.Now()
	requestModel := ""
	documentCount := 0
	defer func() {
		log.Printf("rerank request_id=%s model=%q document_count=%d status=%d duration_ms=%d", requestID, requestModel, documentCount, statusWriter.status, time.Since(startedAt).Milliseconds())
	}()

	if r.Method != http.MethodPost {
		writeRerankError(w, http.StatusMethodNotAllowed, "method not allowed", "method_not_allowed")
		return
	}
	if h.db == nil && h.clientTokenValidator == nil {
		writeRerankError(w, http.StatusServiceUnavailable, "request persistence is unavailable", "persistence_error")
		return
	}
	apiKeyID, authenticated := h.ValidateClientTokenID(w, r)
	if !authenticated {
		return
	}

	if h.az.RerankMaxRequestBytes > 0 {
		r.Body = http.MaxBytesReader(w, r.Body, h.az.RerankMaxRequestBytes)
	}
	var request RerankRequest
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&request); err != nil {
		if isMaxBytesError(err) {
			writeRerankError(w, http.StatusRequestEntityTooLarge, "rerank request body is too large", "request_too_large")
			return
		}
		writeRerankError(w, http.StatusBadRequest, "request body must be valid JSON", "invalid_request")
		return
	}
	requestModel = request.Model
	documentCount = len(request.Documents)
	var trailing interface{}
	if err := decoder.Decode(&trailing); err != io.EOF {
		writeRerankError(w, http.StatusBadRequest, "request body must contain exactly one JSON value", "invalid_request")
		return
	}
	if err := validateRerankRequest(&request); err != nil {
		writeRerankError(w, http.StatusBadRequest, err.Error(), "invalid_request")
		return
	}
	if h.db != nil {
		modelType, found, err := h.db.LookupConfiguredModelType(request.Model)
		if err != nil {
			writeRerankError(w, http.StatusServiceUnavailable, "model configuration is unavailable", "configuration_error")
			return
		}
		if !found || !strings.EqualFold(modelType, db.ModelTypeRerank) {
			writeRerankError(w, http.StatusBadRequest, "model is not configured for reranking", "invalid_model")
			return
		}
	}

	target, err := h.rerankURL()
	if err != nil {
		writeRerankError(w, http.StatusInternalServerError, err.Error(), "configuration_error")
		return
	}
	if strings.TrimSpace(h.az.ApiKey) == "" {
		writeRerankError(w, http.StatusInternalServerError, "AZURE_API_KEY is not configured", "configuration_error")
		return
	}

	body, err := json.Marshal(request)
	if err != nil {
		writeRerankError(w, http.StatusInternalServerError, "could not encode rerank request", "internal_error")
		return
	}
	upstreamRequest, err := http.NewRequestWithContext(r.Context(), http.MethodPost, target.String(), strings.NewReader(string(body)))
	if err != nil {
		writeRerankError(w, http.StatusInternalServerError, "could not create rerank request", "internal_error")
		return
	}
	upstreamRequest.Header.Set("Content-Type", "application/json")
	upstreamRequest.Header.Set("Authorization", "Bearer "+h.az.ApiKey)
	upstreamRequest.Header.Set("X-Request-ID", requestID)
	upstreamRequest = withRequestHealthMetadata(upstreamRequest, requestHealthMetadata{
		Endpoint: r.URL.Path,
		Model:    normalizeTelemetryModel(request.Model),
	})

	client := h.rerankClient
	if client == nil {
		client = http.DefaultClient
	}
	if h.health != nil {
		clientCopy := *client
		clientCopy.Transport = &requestHealthTransport{base: client.Transport, recorder: h.health}
		client = &clientCopy
	}
	response, err := client.Do(upstreamRequest)
	if err != nil {
		writeRerankError(w, http.StatusBadGateway, "rerank upstream request failed", "upstream_error")
		return
	}
	defer response.Body.Close()

	maxResponseBytes := h.az.RerankMaxResponseBytes
	if maxResponseBytes <= 0 {
		maxResponseBytes = defaultRerankMaxResponseBytes
	}
	upstreamBody, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		writeRerankError(w, http.StatusBadGateway, "could not read rerank upstream response", "upstream_error")
		return
	}
	if int64(len(upstreamBody)) > maxResponseBytes {
		writeRerankError(w, http.StatusBadGateway, "rerank upstream response is too large", "upstream_response_too_large")
		return
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		status := response.StatusCode
		if status >= http.StatusInternalServerError {
			status = http.StatusBadGateway
		}
		writeRerankError(w, status, "rerank upstream returned an error", "upstream_error")
		return
	}

	var upstream rerankUpstreamResponse
	if err := json.Unmarshal(upstreamBody, &upstream); err != nil {
		writeRerankError(w, http.StatusBadGateway, "rerank upstream response was invalid JSON", "upstream_error")
		return
	}
	if strings.TrimSpace(upstream.ID) == "" {
		writeRerankError(w, http.StatusBadGateway, "rerank upstream response is missing an id", "upstream_contract_error")
		return
	}
	if len(upstream.Results) == 0 {
		writeRerankError(w, http.StatusBadGateway, "rerank upstream response contains no results", "upstream_contract_error")
		return
	}
	if upstream.Meta.BilledUnits.SearchUnits == nil || *upstream.Meta.BilledUnits.SearchUnits <= 0 {
		writeRerankError(w, http.StatusBadGateway, "rerank upstream response is missing billed search units", "upstream_contract_error")
		return
	}

	translated := rerankResponse{
		ID:      upstream.ID,
		Results: make([]RerankResult, 0, len(upstream.Results)),
	}
	includeDocuments := request.ReturnDocuments != nil && *request.ReturnDocuments
	for _, result := range upstream.Results {
		if math.IsNaN(result.RelevanceScore) || math.IsInf(result.RelevanceScore, 0) {
			writeRerankError(w, http.StatusBadGateway, "rerank upstream returned an invalid relevance score", "upstream_contract_error")
			return
		}
		if result.Index < 0 || result.Index >= len(request.Documents) {
			writeRerankError(w, http.StatusBadGateway, fmt.Sprintf("rerank upstream returned invalid document index %d", result.Index), "upstream_error")
			return
		}
		var document *RerankDocument
		if includeDocuments {
			document = result.Document
			if document == nil {
				document = &RerankDocument{Text: request.Documents[result.Index]}
			}
		}
		translated.Results = append(translated.Results, RerankResult{
			Index:          result.Index,
			RelevanceScore: result.RelevanceScore,
			Document:       document,
		})
	}

	searchUnits := *upstream.Meta.BilledUnits.SearchUnits
	if h.db != nil {
		rq := db.Request{
			ID:             upstream.ID,
			ApiKeyID:       apiKeyID,
			RequestType:    db.RequestTypeRerank,
			SearchUnits:    &searchUnits,
			Model:          normalizeTelemetryModel(request.Model),
			IsApproximated: false,
		}
		if err := h.db.WriteRerankRequest(&rq); err != nil {
			log.Printf("rerank: failed to record request id=%s api_key_id=%s: %v", upstream.ID, apiKeyID, err)
			writeRerankError(w, http.StatusServiceUnavailable, "rerank usage could not be persisted", "persistence_error")
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(translated); err != nil {
		return
	}
}

type rerankStatusWriter struct {
	http.ResponseWriter
	status int
}

func (w *rerankStatusWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *rerankStatusWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func validateRerankRequest(request *RerankRequest) error {
	if strings.TrimSpace(request.Model) == "" {
		return fmt.Errorf("model is required")
	}
	if strings.TrimSpace(request.Query) == "" {
		return fmt.Errorf("query is required")
	}
	if len(request.Documents) == 0 {
		return fmt.Errorf("documents must contain at least one document")
	}
	if request.TopN != nil && (*request.TopN < 1 || *request.TopN > len(request.Documents)) {
		return fmt.Errorf("top_n must be between 1 and the number of documents")
	}
	return nil
}

func (h *baseHandle) rerankURL() (*url.URL, error) {
	if strings.TrimSpace(h.rerankEndpointOverride) != "" {
		target, err := url.Parse(h.rerankEndpointOverride)
		if err != nil {
			return nil, err
		}
		if target.Scheme == "" || target.Host == "" {
			return nil, fmt.Errorf("rerank endpoint must include a scheme and host")
		}
		return target, nil
	}
	if strings.TrimSpace(h.az.DeploymentName) == "" {
		return nil, fmt.Errorf("DEPLOYMENT_NAME is not configured")
	}
	if strings.TrimSpace(h.az.BaseUrl) == "" {
		return nil, fmt.Errorf("BASE_URL is not configured")
	}
	target, err := url.Parse(fmt.Sprintf("https://%s/providers/cohere/v2/rerank",
		azureServiceHost("services.ai", h.az.DeploymentName, h.az.BaseUrl)))
	if err != nil {
		return nil, err
	}
	return target, nil
}

func isMaxBytesError(err error) bool {
	var maxBytesError *http.MaxBytesError
	return errors.As(err, &maxBytesError)
}

func writeRerankError(w http.ResponseWriter, status int, message string, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	errorType := "invalid_request_error"
	if status >= http.StatusInternalServerError {
		errorType = "server_error"
	}
	_ = json.NewEncoder(w).Encode(OpenAIErrorResponse{Err: OpenAIError{
		Message: message,
		Type:    errorType,
		Code:    code,
	}})
}
