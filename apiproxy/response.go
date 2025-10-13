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

type ResponseConf struct {
	db DBStore
}

// DBStore is the subset of database methods used by ResponseConf. Using an
// interface allows tests to inject a fake DB implementation.
type DBStore interface {
	LookupApiKeys(string) ([]db.ApiKey, error)
	WriteRequest(*db.Request) error
}

type Response struct {
	rs       *http.Response
	rc       *ResponseConf
	apiKeyID string
	content  Content
}
type Content struct {
	ID     string         `json:"id"`
	Model  string         `json:"model"`
	Object string         `json:"object"`
	Usage  map[string]int `json:"usage"`
}

func (rc *ResponseConf) NewResponse(in *http.Response) error {

	ct := in.Header.Get("Content-Type")
	if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
		// log basic response info so operators can verify ModifyResponse is called
		reqInfo := ""
		if in.Request != nil {
			reqInfo = in.Request.Method + " " + in.Request.URL.String()
		}
		log.Printf("DEV LOG: NewResponse invoked for %s status=%d content-type=%q", reqInfo, in.StatusCode, ct)
	}
	if strings.Contains(ct, "text/event-stream") || strings.Contains(ct, "text/event") {
		if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
			// Read whole body and restore it so the proxy can still stream.
			b, err := io.ReadAll(in.Body)
			if err != nil {
				log.Printf("DEV LOG: failed to read SSE body: %v", err)
				in.Body = io.NopCloser(bytes.NewReader(b))
				return nil
			}
			// Restore body for downstream readers
			in.Body = io.NopCloser(bytes.NewReader(b))
			// Parse SSE events and extract usage objects
			text := string(b)
			parts := strings.Split(text, "\n\n")
			var cumPrompt, cumCompletion int
			var foundAny bool
			eventIdx := 0
			wrote := false
			for _, p := range parts {
				// find lines starting with "data: " and try to unmarshal the JSON
				for _, line := range strings.Split(p, "\n") {
					line = strings.TrimSpace(line)
					if strings.HasPrefix(line, "data:") {
						jsonText := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
						var raw map[string]interface{}
						if os.Getenv("DEV_LOG_TOKEN_DEBUG") == "1" {
							preview := jsonText
							if len(preview) > 1024 {
								preview = preview[:1024] + "..."
							}
							log.Printf("DEV DEBUG: SSE data-line: %s", preview)
						}
						if err := json.Unmarshal([]byte(jsonText), &raw); err != nil {
							if os.Getenv("DEV_LOG_TOKEN_DEBUG") == "1" {
								log.Printf("DEV DEBUG: SSE data-line JSON unmarshal error: %v; json=%s", err, jsonText)
							}
							continue
						}
						var usageFound bool
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
							pcount, ccount, tot := extractTokenCounts(m)
							if os.Getenv("DEV_LOG_TOKEN_DEBUG") == "1" {
								log.Printf("DEV DEBUG: extractTokenCounts returned prompt=%d completion=%d total=%d keys=%v", pcount, ccount, tot, m)
							}
							cumPrompt += pcount
							cumCompletion += ccount
							foundAny = true
							eventIdx++
							usageFound = true
							log.Printf("DEV LOG: SSE event %d usage: prompt=%d completion=%d total=%d usage=%v (top-level)", eventIdx, pcount, ccount, pcount+ccount, m)
							// If this event signals completion, write to DB.
							if !wrote {
								if tstr, ok := raw["type"].(string); ok && tstr == "response.completed" {
									// try to extract response id
									if respObj, ok := raw["response"].(map[string]interface{}); ok {
										if idv, ok := respObj["id"].(string); ok && idv != "" {
											apiKeyID := ""
											header := ""
											if in.Request != nil {
												header = in.Request.Header.Get(authHeader)
											}
											apiKey := strings.TrimPrefix(header, "Bearer ")
											if hashes, err := rc.db.LookupApiKeys("*"); err == nil {
												if uid, err := CompareToken(hashes, apiKey); err == nil {
													apiKeyID = uid
												}
											}
											rq := db.Request{
												ID:                 idv,
												ApiKeyID:           apiKeyID,
												TokenCountPrompt:   pcount,
												TokenCountComplete: ccount,
											}
											if err := rc.db.WriteRequest(&rq); err != nil {
												log.Printf("DEV LOG: failed to write request for SSE completed id=%s: %v", idv, err)
											} else {
												log.Printf("DEV LOG: wrote SSE completed request id=%s prompt=%d completion=%d api_key_id=%s", idv, pcount, ccount, apiKeyID)
											}
											wrote = true
										}
									}
								}
							}
						}
						// also check nested response.usage
						if !usageFound {
							if respObj, ok := raw["response"].(map[string]interface{}); ok {
								if u2, ok2 := respObj["usage"].(map[string]interface{}); ok2 {
									m := make(map[string]int)
									for k, val := range u2 {
										switch tv := val.(type) {
										case float64:
											m[k] = int(tv)
										case int:
											m[k] = tv
										}
									}
									pcount, ccount, tot := extractTokenCounts(m)
									if os.Getenv("DEV_LOG_TOKEN_DEBUG") == "1" {
										log.Printf("DEV DEBUG: extractTokenCounts returned prompt=%d completion=%d total=%d keys=%v", pcount, ccount, tot, m)
									}
									cumPrompt += pcount
									cumCompletion += ccount
									foundAny = true
									eventIdx++
									log.Printf("DEV LOG: SSE event %d usage: prompt=%d completion=%d total=%d usage=%v (nested response)", eventIdx, pcount, ccount, pcount+ccount, m)
									if !wrote {
										if tstr, ok := raw["type"].(string); ok && tstr == "response.completed" {
											if respObj, ok := raw["response"].(map[string]interface{}); ok {
												if idv, ok := respObj["id"].(string); ok && idv != "" {
													apiKeyID := ""
													header := ""
													if in.Request != nil {
														header = in.Request.Header.Get(authHeader)
													}
													apiKey := strings.TrimPrefix(header, "Bearer ")
													if hashes, err := rc.db.LookupApiKeys("*"); err == nil {
														if uid, err := CompareToken(hashes, apiKey); err == nil {
															apiKeyID = uid
														}
													}
													rq := db.Request{
														ID:                 idv,
														ApiKeyID:           apiKeyID,
														TokenCountPrompt:   pcount,
														TokenCountComplete: ccount,
													}
													if err := rc.db.WriteRequest(&rq); err != nil {
														log.Printf("DEV LOG: failed to write request for SSE completed id=%s: %v", idv, err)
													} else {
														log.Printf("DEV LOG: wrote SSE completed request id=%s prompt=%d completion=%d api_key_id=%s", idv, pcount, ccount, apiKeyID)
													}
													wrote = true
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
			if foundAny {
				log.Printf("DEV LOG: SSE cumulative usage parsed: events=%d prompt_total=%d completion_total=%d grand_total=%d", eventIdx, cumPrompt, cumCompletion, cumPrompt+cumCompletion)
			} else {
				log.Printf("DEV LOG: SSE Response had no usage object in data events")
				if os.Getenv("DEV_LOG_TOKEN_DEBUG") == "1" {
					// provide additional context: number of parts scanned and a small body preview
					log.Printf("DEV DEBUG: scanned %d SSE parts; total bytes=%d", len(parts), len(b))
					bodyPreview := string(b)
					if len(bodyPreview) > 2048 {
						bodyPreview = bodyPreview[:2048] + "..."
					}
					log.Printf("DEV DEBUG: SSE body preview:\n%s", bodyPreview)
				}
			}
		}
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
			if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
				log.Printf("DEV LOG: ReadValues quick-unmarshal id=%s model=%s object=%s usage=%v", r.content.ID, r.content.Model, r.content.Object, r.content.Usage)
			}
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
		if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
			log.Printf("DEV LOG: ReadValues parsed usage (fallback) id=%s model=%s usage=%v", r.content.ID, r.content.Model, r.content.Usage)
		}
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
	// Extract token counts using flexible key mapping (handles input_tokens/output_tokens etc.).
	pcount, ccount, tot := extractTokenCounts(c.Usage)
	if os.Getenv("DEV_LOG_TOKEN_DEBUG") == "1" {
		log.Printf("DEV DEBUG: ProcessValues extracted counts prompt=%d completion=%d total=%d usage=%v", pcount, ccount, tot, c.Usage)
	}
	rq := db.Request{
		ID:                 c.ID,
		ApiKeyID:           r.apiKeyID,
		TokenCountPrompt:   pcount,
		TokenCountComplete: ccount,
		Model:              c.Model,
	}

	if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
		total := rq.TokenCountPrompt + rq.TokenCountComplete
		log.Printf("DEV LOG: Token counts for Response id=%s api_key_id=%s model=%s prompt=%d completion=%d total=%d usage=%v", r.apiKeyID, rq.ApiKeyID, rq.Model, rq.TokenCountPrompt, rq.TokenCountComplete, total, c.Usage)
	}

	if rq.ID == "" {
		log.Printf("DEV LOG: skipping DB write for response with empty id; usage=%v", c.Usage)
		return
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

// extractTokenCounts maps a flexible usage map into prompt/completion/total
// counts. It understands common key variants from different APIs.
func extractTokenCounts(m map[string]int) (prompt int, completion int, total int) {
	if m == nil {
		return 0, 0, 0
	}
	// possible keys
	promptKeys := []string{"prompt_tokens", "input_tokens", "prompt"}
	completionKeys := []string{"completion_tokens", "output_tokens", "completion", "output"}
	totalKeys := []string{"total_tokens", "total"}

	for _, k := range promptKeys {
		if v, ok := m[k]; ok {
			prompt = v
			break
		}
	}
	for _, k := range completionKeys {
		if v, ok := m[k]; ok {
			completion = v
			break
		}
	}
	for _, k := range totalKeys {
		if v, ok := m[k]; ok {
			total = v
			break
		}
	}

	// If completion missing but total and prompt present, derive completion
	if completion == 0 && total > 0 && prompt > 0 {
		completion = total - prompt
	}
	// If prompt missing but total and completion present, derive prompt
	if prompt == 0 && total > 0 && completion > 0 {
		prompt = total - completion
	}
	return
}
