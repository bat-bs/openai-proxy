package apiproxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	db "openai-api-proxy/db"
	"os"
	"strings"
	"time"
)

type AzureConfig struct {
	DeploymentName         string
	RessourceName          string
	BaseUrl                string
	ApiKey                 string
	RerankTimeout          time.Duration
	RerankMaxRequestBytes  int64
	RerankMaxResponseBytes int64
}

var (
	authHeader     = "Authorization"
	defaultBackend = "openai"
)

// hostTarget maps hostnames to their corresponding backend server URLs.
var (
	OpenAIbackendService = map[string]string{
		// "azure": "", // see SetAzureUrl
		"openai":     "https://api.openai.com/",
		"openrouter": "https://openrouter.ai/api/",
	}
)

func Init(mux *http.ServeMux, db *db.Database) *requestHealthRecorder {
	// Setup Azure Vars and Connection String
	azconf := &AzureConfig{
		DeploymentName:         os.Getenv("DEPLOYMENT_NAME"),
		RessourceName:          os.Getenv("RESSOURCE_NAME"),
		BaseUrl:                os.Getenv("BASE_URL"),
		ApiKey:                 os.Getenv("AZURE_API_KEY"),
		RerankTimeout:          rerankTimeoutFromEnv(),
		RerankMaxRequestBytes:  rerankMaxRequestBytesFromEnv(),
		RerankMaxResponseBytes: rerankMaxResponseBytesFromEnv(),
	}
	defaultBackend = os.Getenv("DEFAULT_BACKEND")
	rc := &ResponseConf{
		db: db,
	}
	h := &baseHandle{
		db:           db,
		az:           azconf,
		rc:           rc,
		rerankClient: &http.Client{Timeout: azconf.RerankTimeout},
	}
	h.health = newRequestHealthRecorder(db)
	mux.Handle("/api/", h)
	return h.health
}

type baseHandle struct {
	db                     ProxyDB
	az                     *AzureConfig
	rc                     *ResponseConf
	rerankClient           *http.Client
	clientTokenValidator   func(http.ResponseWriter, *http.Request) bool
	rerankEndpointOverride string
	health                 *requestHealthRecorder
}

type ProxyDB interface {
	LookupApiKeys(string) ([]db.ApiKey, error)
	ListConfiguredModels() ([]string, error)
	LookupConfiguredModelType(string) (string, bool, error)
	WriteRequest(*db.Request) error
	WriteRerankRequest(*db.Request) error
}

func (h *baseHandle) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api/rerank" || r.URL.Path == "/api/rerank/" ||
		r.URL.Path == "/api/v1/rerank" || r.URL.Path == "/api/v1/rerank/" {
		h.HandleRerank(w, r)
		return
	}
	// Intercept OpenAI-compatible models endpoints and serve locally
	if strings.HasPrefix(r.URL.Path, "/api/models") || strings.HasPrefix(r.URL.Path, "/api/v1/models") {
		h.handleModels(w, r)
		return
	}
	// The only fully supported runtime path today is the Azure OpenAI proxy.
	// Routing by the request `Backend` header is intentionally removed.
	h.HandleAzure(w, r, "azure")
}

// Since OpenAI and Azure API are not really compatible, we need 2 different handler functions

// Since OpenAI and Azure API are not really compatible, we need 2 different handler functions
func (h *baseHandle) HandleAzure(w http.ResponseWriter, r *http.Request, backend string) {
	azureToken := h.ValidateToken(w, r)
	if azureToken == "" {
		// ValidateToken writes the authentication error response.
		return
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Api-Key", azureToken)
	originalEndpoint := r.URL.Path
	requestID := r.Header.Get("X-Request-ID")

	remoteUrl := h.SetAzureUrl(r)
	if remoteUrl == nil {
		http.Error(w, "Bad Request: missing or invalid model", http.StatusBadRequest)
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(remoteUrl)
	if h.health != nil {
		proxy.Transport = &requestHealthTransport{base: http.DefaultTransport, recorder: h.health}
	}
	r.Host = remoteUrl.Host
	// Remove proxy/ingress headers that should not be forwarded to Azure.
	// These headers are added by our ingress and clients and may be rejected
	// or cause unexpected behavior when sent to the Azure OpenAI endpoint.
	for _, hdr := range []string{
		"X-Forwarded-For",
		"X-Forwarded-Host",
		"X-Forwarded-Port",
		"X-Forwarded-Proto",
		"X-Forwarded-Scheme",
		"X-Real-Ip",
		"X-Request-Id",
		"X-Scheme",
		"Forwarded",
		"Via",
		"Client-Ip",
	} {
		r.Header.Del(hdr)
	}
	// Normalize incoming path for Azure deployment endpoints.
	// Incoming v1 requests under `/api/v1/...` should be forwarded to
	// `/openai/deployments/{deployment}/...` on Azure. We remove `/api` and
	// `/v1` here; SetAzureUrl will build the deployments base URL based on the
	// model/deployment name.
	// Forward the path after `/api` unchanged. If the client sends `/api/v1/responses`
	// the forwarded path will include `/v1/responses`, and combined with the
	// `/openai` base will produce `/openai/v1/responses` as desired.
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api")
	ensureStreamUsageForChatCompletions(r)
	model, streaming := captureRequestHealthRequest(r)
	r = withRequestHealthMetadata(r, requestHealthMetadata{
		Endpoint:  originalEndpoint,
		Model:     model,
		RequestID: requestID,
		Streaming: streaming,
	})

	// Before proxying, log the intended complete URL.
	actualURL := *remoteUrl // Make a copy of the URL struct
	// Join the deployment base path and the incoming path similar to ReverseProxy behavior.
	actualURL.Path = singleJoiningSlash(remoteUrl.Path, r.URL.Path)
	// Combine query params from remote (none) and the request (we already encoded api-version into r.URL.RawQuery)
	actualURL.RawQuery = r.URL.RawQuery
	// Dev: optionally log outgoing request details (without exposing full secrets).
	if os.Getenv("DEV_LOG_REQUEST") == "1" {
		// log method, path, masked headers, and body preview
		var bbuf []byte
		if r.Body != nil {
			bodyBytes, _ := io.ReadAll(r.Body)
			bbuf = bodyBytes
			// reset body for proxy
			r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		}
		headers := map[string]string{}
		for k, v := range r.Header {
			if strings.ToLower(k) == "api-key" || strings.ToLower(k) == "authorization" {
				headers[k] = "[redacted]"
			} else {
				headers[k] = strings.Join(v, ",")
			}
		}
		if strings.Contains(strings.ToLower(r.URL.Path), "/rerank") {
			log.Printf("Outgoing request: %s %s headers=%v body_bytes=%d", r.Method, actualURL.Path, headers, len(bbuf))
		} else {
			log.Printf("Outgoing request: %s %s headers=%v body_preview=%s", r.Method, actualURL.Path, headers, preview(bbuf, 200))
		}
	}

	proxy.ModifyResponse = h.rc.NewResponse

	proxy.ServeHTTP(w, r)

}

// ensureStreamUsageForChatCompletions enables usage emission for streaming chat
// completions by adding stream_options.include_usage=true when it is missing.
func ensureStreamUsageForChatCompletions(r *http.Request) {
	if r == nil || r.URL == nil || r.Body == nil {
		return
	}
	path := strings.ToLower(r.URL.Path)
	if !(strings.HasSuffix(path, "/chat/completions") || strings.Contains(path, "/chat/completions/")) {
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		return
	}
	defer func() {
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
	}()
	if len(bytes.TrimSpace(bodyBytes)) == 0 {
		return
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		return
	}

	streamEnabled, _ := payload["stream"].(bool)
	if !streamEnabled {
		return
	}

	changed := false
	streamOptions, hasOptions := payload["stream_options"].(map[string]interface{})
	if !hasOptions {
		streamOptions = map[string]interface{}{}
		payload["stream_options"] = streamOptions
		changed = true
	}
	if _, exists := streamOptions["include_usage"]; !exists {
		streamOptions["include_usage"] = true
		changed = true
	}
	if !changed {
		return
	}

	updatedBody, err := json.Marshal(payload)
	if err != nil {
		return
	}
	bodyBytes = updatedBody
	r.ContentLength = int64(len(bodyBytes))
	r.Header.Set("Content-Length", fmt.Sprintf("%d", len(bodyBytes)))
}

// singleJoiningSlash joins two URL paths with a single slash between them.
func singleJoiningSlash(a, b string) string {
	aslash := strings.HasSuffix(a, "/")
	bslash := strings.HasPrefix(b, "/")
	switch {
	case aslash && bslash:
		return a + b[1:]
	case !aslash && !bslash:
		return a + "/" + b
	default:
		return a + b
	}
}

func preview(b []byte, n int) string {
	if len(b) == 0 {
		return ""
	}
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "..."
}

// Used When Debugging is Active
// used for translating openai requests to Azure API
type OpenAIBody struct {
	Model string `json:"model"`
}

func (h *baseHandle) SetAzureUrl(r *http.Request) *url.URL {
	// Use the Azure OpenAI v1 base path. Clients call `/api/v1/...` and the
	// proxy preserves the `/v1` segment, so combining this base with the
	// incoming path yields `/openai/v1/...` as required by the v1 API.
	azureUrl := fmt.Sprintf("https://%s/openai", azureServiceHost("openai", h.az.DeploymentName, h.az.BaseUrl))
	url, err := url.Parse(azureUrl)
	if err != nil {
		log.Println("target parse fail:", err)
		return nil
	}
	return url
}
