package apiproxy

import (
	"fmt"
	"log"
	"net/http"
	db "openai-api-proxy/db"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func CompareToken(hashes []db.ApiKey, apiKey string) (string, error) {

	for _, hash := range hashes {
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
	header := r.Header.Get(authHeader)

	apiKey := strings.TrimPrefix(header, "Bearer ")
	//fmt.Println("\"", apiKey, "\"")
	if apiKey == "Bearer " {
		http.Error(w, "401 - Token Empty", http.StatusUnauthorized)

		return ""
	}

	hashes, err := h.db.LookupApiKeys("*")
	if err != nil || len(hashes) == 0 {
		log.Println("Error while requesting API Keys from DB", err)
		http.Error(w, "401 - Token Invalid", http.StatusUnauthorized)
		return ""
	}

	if _, err := CompareToken(hashes, apiKey); err != nil {
		http.Error(w, "401 - Token Invalid", http.StatusUnauthorized)
		return ""
	}
	azureApiKey := os.Getenv("AZURE_API_KEY")
	return azureApiKey
}
