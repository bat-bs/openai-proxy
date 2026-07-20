package apiproxy

import (
	"fmt"
	"log"
	"net/http"
	db "openai-api-proxy/db"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func CompareToken(hashes []db.ApiKey, apiKey string) (string, error) {

	for _, hash := range hashes {
		if hash.Deactivated {
			continue
		}
		err := bcrypt.CompareHashAndPassword([]byte(hash.ApiKey), []byte(apiKey))
		// log.Printf("Compared %s with %s", apiKey, hash.ApiKey)
		if err == nil {
			return hash.UUID, nil
		}
	}
	err := fmt.Errorf("received invalid bearer token")

	return "", err
}

func (h *baseHandle) ValidateToken(w http.ResponseWriter, r *http.Request) string {
	if !h.ValidateClientToken(w, r) {
		return ""
	}
	return h.az.ApiKey
}

// ValidateClientToken authenticates the proxy API key without selecting an
// upstream provider credential. Provider-specific handlers can then choose
// the appropriate upstream authentication scheme.
func (h *baseHandle) ValidateClientToken(w http.ResponseWriter, r *http.Request) bool {
	_, ok := h.ValidateClientTokenID(w, r)
	return ok
}

func (h *baseHandle) ValidateClientTokenID(w http.ResponseWriter, r *http.Request) (string, bool) {
	if h.clientTokenValidator != nil {
		if h.clientTokenValidator(w, r) {
			return "test-api-key", true
		}
		return "", false
	}
	header := r.Header.Get(authHeader)

	if !strings.HasPrefix(header, "Bearer ") {
		http.Error(w, "401 - Token Empty", http.StatusUnauthorized)
		return "", false
	}
	apiKey := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if apiKey == "" {
		http.Error(w, "401 - Token Empty", http.StatusUnauthorized)
		return "", false
	}

	hashes, err := h.db.LookupApiKeys("*")
	if err != nil || len(hashes) == 0 {
		log.Println("Error while requesting API Keys from DB", err)
		http.Error(w, "401 - Token Invalid", http.StatusUnauthorized)
		return "", false
	}

	uid, err := CompareToken(hashes, apiKey)
	if err != nil {
		http.Error(w, "401 - Token Invalid", http.StatusUnauthorized)
		return "", false
	}
	return uid, true
}
