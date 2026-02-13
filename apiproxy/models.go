package apiproxy

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// OpenAI-compatible model representations

type OpenAIModel struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

type OpenAIModelList struct {
	Object string        `json:"object"`
	Data   []OpenAIModel `json:"data"`
}

type OpenAIError struct {
	Message string      `json:"message"`
	Type    string      `json:"type"`
	Param   interface{} `json:"param"`
	Code    string      `json:"code"`
}

type OpenAIErrorResponse struct {
	Err OpenAIError `json:"error"`
}

// handleModels intercepts requests to /api/models and /api/v1/models and returns
// static model metadata derived from environment configuration.
func (h *baseHandle) handleModels(w http.ResponseWriter, r *http.Request) {
	// Enforce API key like other endpoints
	if h.ValidateToken(w, r) == "" { // ValidateToken writes the error response
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api")
	path = strings.Trim(path, "/")

	// Collect configured models from database
	models, err := h.db.ListConfiguredModels()
	if err != nil {
		log.Printf("Error fetching models from DB: %v", err)
		models = []string{}
	}

	// Route: GET /models or /v1/models
	if path == "models" || path == "v1/models" {
		list := OpenAIModelList{
			Object: "list",
			Data:   make([]OpenAIModel, 0, len(models)),
		}
		created := time.Now().Unix()
		owner := os.Getenv("MODELS_OWNER")
		if owner == "" {
			owner = "system"
		}
		for _, id := range models {
			list.Data = append(list.Data, OpenAIModel{
				ID:      id,
				Object:  "model",
				Created: created,
				OwnedBy: owner,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
		return
	}

	// Route: GET /models/{id} or /v1/models/{id}
	if strings.HasPrefix(path, "models/") || strings.HasPrefix(path, "v1/models/") {
		parts := strings.Split(path, "/")
		id := parts[len(parts)-1]
		found := false
		for _, m := range models {
			if m == id {
				found = true
				break
			}
		}
		if !found {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			resp := OpenAIErrorResponse{Err: OpenAIError{
				Message: "The model '" + id + "' does not exist",
				Type:    "invalid_request_error",
				Param:   nil,
				Code:    "model_not_found",
			}}
			json.NewEncoder(w).Encode(resp)
			return
		}
		created := time.Now().Unix()
		owner := os.Getenv("MODELS_OWNER")
		if owner == "" {
			owner = "system"
		}
		model := OpenAIModel{ID: id, Object: "model", Created: created, OwnedBy: owner}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(model)
		return
	}

	// Fallback shouldn't happen; let proxy handle.
}
