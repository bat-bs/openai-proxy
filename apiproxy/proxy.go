package apiproxy

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	db "openai-api-proxy/db"
	"os"
	"strings"
)

type AzureConfig struct {
	DeploymentName string
	RessourceName  string
	BaseUrl        string
	ApiKey         string
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

	backendProxy = make(map[string]*httputil.ReverseProxy)
)

func Init(mux *http.ServeMux, db *db.Database) {
	// Setup Azure Vars and Connection String
	azconf := &AzureConfig{
		DeploymentName: os.Getenv("DEPLOYMENT_NAME"),
		RessourceName:  os.Getenv("RESSOURCE_NAME"),
		BaseUrl:        os.Getenv("BASE_URL"),
	}
	defaultBackend = os.Getenv("DEFAULT_BACKEND")
	rc := &ResponseConf{
		db: db,
	}
	h := &baseHandle{
		db: db,
		az: azconf,
		rc: rc}
	mux.Handle("/api/", h)

}

type baseHandle struct {
	db *db.Database
	az *AzureConfig
	rc *ResponseConf
}

func (h *baseHandle) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	backend := r.Header.Get("Backend")
	r.Header.Del("Backend")
	log.Println(r.Header.Get("Content-Type"))

	// Intercept OpenAI-compatible models endpoints and serve locally
	if strings.HasPrefix(r.URL.Path, "/api/models") || strings.HasPrefix(r.URL.Path, "/api/v1/models") {
		h.handleModels(w, r)
		return
	}

	if fn, ok := backendProxy[backend]; ok {
		fn.ServeHTTP(w, r)
		return
	}

	// See if backend is OpenAI compatible
	_, ok := OpenAIbackendService[backend]

	if ok {
		//h.HandleOpenAI(w, r, backend)
		return
	}
	if backend == "azure" {
		h.HandleAzure(w, r, backend)
		return
	}

	if backend == "" {
		log.Printf("No backend specified, the default backend (%s) will be used.", defaultBackend)
		if defaultBackend == "azure" {
			h.HandleAzure(w, r, defaultBackend)
			return
		} else {
			//h.HandleOpenAI(w, r, defaultBackend)
			return
		}
	}

	w.Write([]byte("404: Backend not found "))
}

// Since OpenAI and Azure API are not really compatible, we need 2 different handler functions

// Since OpenAI and Azure API are not really compatible, we need 2 different handler functions
func (h *baseHandle) HandleAzure(w http.ResponseWriter, r *http.Request, backend string) {
	azureToken := h.ValidateToken(w, r)
	if azureToken == "" {
		http.Error(w, "Error Processing Request", http.StatusUnauthorized)
		return
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Api-Key", azureToken)

	remoteUrl := h.SetAzureUrl(r)
	if remoteUrl == nil {
		http.Error(w, "Bad Request: missing or invalid model", http.StatusBadRequest)
		return
	}

	log.Printf("Received Request for Backend %s for remoteURL %s", backend, remoteUrl)
	proxy := httputil.NewSingleHostReverseProxy(remoteUrl)
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
	// Preserve incoming query parameters unchanged.
	r.URL.RawQuery = r.URL.RawQuery

	backendProxy[r.Host] = proxy

	// Before proxying, log the intended complete URL.
	actualURL := *remoteUrl // Make a copy of the URL struct
	// Join the deployment base path and the incoming path similar to ReverseProxy behavior.
	actualURL.Path = singleJoiningSlash(remoteUrl.Path, r.URL.Path)
	// Combine query params from remote (none) and the request (we already encoded api-version into r.URL.RawQuery)
	actualURL.RawQuery = r.URL.RawQuery
	log.Printf("Proxying request to Azure backend: %s", actualURL.String())
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
		log.Printf("Outgoing request: %s %s headers=%v body_preview=%s", r.Method, actualURL.Path, headers, preview(bbuf, 200))
	}

	proxy.ModifyResponse = h.rc.NewResponse

	proxy.ServeHTTP(w, r)

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
	azureUrl := fmt.Sprintf("https://%s.%s/openai", h.az.DeploymentName, h.az.BaseUrl)
	log.Println("Set Azure URL to ", azureUrl)
	url, err := url.Parse(azureUrl)
	if err != nil {
		log.Println("target parse fail:", err)
		return nil
	}
	return url
}
