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
	"os"
	"strings"
)

// type clientConfig struct {

// }

type AzureConfig struct {
	DeploymentName string
	ApiVersion     string
	RessourceName  string
	BaseUrl        string
	ApiKey         string
}

var (
	authHeader = "Authorization"
	// hostDst        = "0.0.0.0"
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

func Init(mux *http.ServeMux) {
	// Setup Azure Vars and Connection String
	azconf := &AzureConfig{
		DeploymentName: os.Getenv("DEPLOYMENT_NAME"),
		ApiVersion:     os.Getenv("API_VERSION"),
		RessourceName:  os.Getenv("RESSOURCE_NAME"),
		BaseUrl:        os.Getenv("BASE_URL"),
	}
	defaultBackend = os.Getenv("DEFAULT_BACKEND")

	h := &baseHandle{azconf}
	mux.Handle("/api/", h)

}

type baseHandle struct {
	az *AzureConfig
}

func (h *baseHandle) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	backend := r.Header.Get("Backend")
	r.Header.Del("Backend")
	log.Println(r.Header.Get("Content-Type"))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

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

// function to handle 1:1 OpenAI compatible apis (not tested yet lol)
// func (h *baseHandle) HandleOpenAI(w http.ResponseWriter, r *http.Request, backend string) {
// 	token := ValidateToken(w, r)
// 	if token == "" {
// 		log.Println("No API Token Set for OpenAI.")
// 		return
// 	}

// 	r.Header.Set(authHeader, "Bearer "+token)
// 	remoteUrl, err := url.Parse(backend)
// 	log.Printf("Received Request for Backend %s for remoteURL %s", backend, remoteUrl)
// 	if err != nil {
// 		log.Println("backend parse fail:", err)
// 		return
// 	}
// 	proxy := httputil.NewSingleHostReverseProxy(remoteUrl)
// 	backendProxy[r.Host] = proxy
// 	proxy.ServeHTTP(w, r)
// }

// Since OpenAI and Azure API are not really compatible, we need 2 different handler functions
func (h *baseHandle) HandleAzure(w http.ResponseWriter, r *http.Request, backend string) {
	azureToken := ValidateToken(w, r)
	if azureToken == "" {
		return
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Api-Key", azureToken)

	remoteUrl := h.SetAzureUrl(r)

	log.Printf("Received Request for Backend %s for remoteURL %s", backend, remoteUrl)
	proxy := httputil.NewSingleHostReverseProxy(remoteUrl)
	r.Host = remoteUrl.Host
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api")

	q := r.URL.Query()
	q.Add("api-version", h.az.ApiVersion)
	r.URL.RawQuery = q.Encode()

	backendProxy[r.Host] = proxy

	// Before proxying, log the intended complete URL.
	actualURL := *remoteUrl // Make a copy of the URL struct
	actualURL.Path = r.URL.Path
	actualURL.RawQuery = r.URL.RawQuery
	log.Printf("Proxying request to Azure backend: %s", actualURL.String())
	r.Body.Close()

	log.Println("Hier 1")
	proxy.ModifyResponse = NewResponse
	log.Println("Hier 2")

	proxy.ServeHTTP(w, r)

}

// Used When Debugging is Active
type DebugTransport struct{}

func (DebugTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	b, err := httputil.DumpRequestOut(r, false)
	if err != nil {
		return nil, err
	}
	fmt.Println(string(b))
	return http.DefaultTransport.RoundTrip(r)
}

// used for translating openai requests to Azure API
type OpenAIBody struct {
	Model string `json:"model"`
}

func (h *baseHandle) SetAzureUrl(r *http.Request) *url.URL {
	r.Header.Del(authHeader)

	//Extract Model -> Azure Deployment -- Why Copy? https://stackoverflow.com/questions/62017146/http-request-clone-is-not-deep-clone

	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Println("Error Parsing Body")
	}
	r2 := r.Clone(r.Context())
	// clone body
	r.Body = io.NopCloser(bytes.NewReader(body))
	r2.Body = io.NopCloser(bytes.NewReader(body))

	oaibody := OpenAIBody{}

	err = json.NewDecoder(r2.Body).Decode(&oaibody)
	if err != nil {
		log.Println("Error Decoding Body")
	}

	model := h.az.RessourceName
	if oaibody.Model != "" {
		model = oaibody.Model
		log.Println("Routing Request to Model: ", model)
	}

	azureUrl := fmt.Sprintf("https://%s.%s/openai/deployments/%s", h.az.DeploymentName, h.az.BaseUrl, model)
	log.Println("Set Azure URL to ", azureUrl)
	url, err := url.Parse(azureUrl)
	if err != nil {
		log.Println("target parse fail:", err)
		return nil
	}
	return url

}
