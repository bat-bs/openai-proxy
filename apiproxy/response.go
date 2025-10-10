package apiproxy

import (
    "bytes"
    "encoding/json"
    "errors"
    "io"
    "log"
    "net/http"
    db "openai-api-proxy/db"
    "os"
    "strings"
)

// Process Response of Azure and Write Key Parameters to DB

type ResponseConf struct {
	db *db.Database
}

type Response struct {
	rs       *http.Response
	rc       *ResponseConf
	apiKeyID string
	content  Content
}
type Content struct {
    ID     string `json:"id"`
    Model  string `json:"model"`
    Object string `json:"object"`
    // Usage can differ between endpoints (responses vs chat/completions).
    // Store it as a flexible map and extract expected keys later.
    Usage map[string]int `json:"usage"`
}

func (rc *ResponseConf) NewResponse(in *http.Response) error {

	// Skip processing for streaming responses (SSE) to avoid consuming the stream.
	ct := in.Header.Get("Content-Type")
	if strings.Contains(ct, "text/event-stream") || strings.Contains(ct, "text/event") {
		return nil
	}

	r := Response{
		rs: in,
		rc: rc,
	}

	err := r.ReadValues()
	if err != nil {
		return err
	}
	r.ProcessValues()
	return nil
}

func (r *Response) GetApiKeyUUID() string {
	header := r.rs.Request.Header.Get(authHeader)

	apiKey := strings.TrimPrefix(header, "Bearer ")

	hashes, err := r.rc.db.LookupApiKeys("*")
	if err != nil || len(hashes) == 0 {
		log.Println("Error while requesting API Keys from DB", err)
	}

	uid, _ := CompareToken(hashes, apiKey)
	return uid
}
func (r *Response) ReadValues() error {
    defer r.rs.Body.Close()
    body, err := io.ReadAll(r.rs.Body)
    if err != nil {
        log.Println("Error Parsing Body")
        return err
    }

    r.rs.Body = io.NopCloser(bytes.NewReader(body))
    // Try to unmarshal into the expected struct first.
    if err := json.Unmarshal(body, &r.content); err == nil {
        // If we found key values, return.
        if r.content.ID != "" || r.content.Object != "" || r.content.Model != "" {
            return nil
        }
    }

    // Fallback: attempt a flexible parse for different response shapes (Responses API etc.)
    var raw map[string]interface{}
    if err := json.Unmarshal(body, &raw); err != nil {
        return nil
    }
    if v, ok := raw["id"].(string); ok {
        r.content.ID = v
    }
    if v, ok := raw["object"].(string); ok {
        r.content.Object = v
    }
    if v, ok := raw["model"].(string); ok {
        r.content.Model = v
    }
    // usage often contains numeric values which Unmarshal decodes as float64
    if u, ok := raw["usage"].(map[string]interface{}); ok {
        m := make(map[string]int)
        for k, val := range u {
            switch tv := val.(type) {
            case float64:
                m[k] = int(tv)
            case int:
                m[k] = tv
            }
        }
        r.content.Usage = m
    }
    // Try to extract id/model from nested 'response' object if present
    if r.content.ID == "" {
        if resp, ok := raw["response"].(map[string]interface{}); ok {
            if v, ok := resp["id"].(string); ok {
                r.content.ID = v
            }
            if v, ok := resp["model"].(string); ok {
                r.content.Model = v
            }
        }
    }
    return nil
}

func (r *Response) ProcessValues() {
    c := r.content
    if c.Object != "chat.completion" && c.Object != "response" {
        log.Printf("Untested API Endpoint '%s' is used, check the Request in the DB: %s", c.Object, c.ID)
    }
    if r.apiKeyID = r.GetApiKeyUUID(); r.apiKeyID == "" {
        err := errors.New("error processing Response: Key could not be looked up from DB")
        log.Println(err)
        return
    }
    if c.ID == "" {
        // Log response status and optionally the raw body for debugging.
        log.Printf("Response has no ID; skipping DB write. HTTP status: %v", r.rs.Status)
        if os.Getenv("DEV_LOG_RAW_RESPONSE") == "1" {
            // Read the body and log it (we already captured it in ReadValues and reset rs.Body)
            body, _ := io.ReadAll(r.rs.Body)
            // Reset body to allow other readers (though ModifyResponse is not expected to do more)
            r.rs.Body = io.NopCloser(bytes.NewReader(body))
            log.Printf("Raw response body: %s", string(body))
        }
        return
    }
    rq := db.Request{
        ID:                 c.ID,
        ApiKeyID:           r.apiKeyID,
        // Extract token counts with flexible keys. Common keys: "prompt_tokens", "completion_tokens", "total_tokens"
        TokenCountPrompt:   getUsageInt(c.Usage, "prompt_tokens"),
        TokenCountComplete: getUsageInt(c.Usage, "completion_tokens"),
        Model:              c.Model,
    }
    // If completion tokens are not provided, try using total_tokens - prompt_tokens
    if rq.TokenCountComplete == 0 {
        total := getUsageInt(c.Usage, "total_tokens")
        if total > 0 && rq.TokenCountPrompt > 0 {
            rq.TokenCountComplete = total - rq.TokenCountPrompt
        } else if total > 0 {
            // fallback: assign total to completion
            rq.TokenCountComplete = total
        }
    }
    if err := r.rc.db.WriteRequest(&rq); err != nil {
        log.Println("error processing Response: Response could not be written to db DB")
        log.Println(err)
        return
    }

}

// getUsageInt returns an int value for a key from the usage map, or 0 if missing.
func getUsageInt(m map[string]int, key string) int {
    if m == nil {
        return 0
    }
    if v, ok := m[key]; ok {
        return v
    }
    return 0
}
