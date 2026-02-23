package apiproxy

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	db "openai-api-proxy/db"
	"os"
	"regexp"
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
	ID           string         `json:"id"`
	Model        string         `json:"model"`
	Object       string         `json:"object"`
	Usage        map[string]int `json:"usage"`
	UsageDetails map[string]map[string]int
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
		// Create a pipe to intercept the stream without blocking it.
		// One end goes to the client (via in.Body), the other to our parser.
		pr, pw := io.Pipe()
		tr := io.TeeReader(in.Body, pw)
		in.Body = &readCloserWithCallback{
			Reader: tr,
			CloseFunc: func() error {
				return pw.Close()
			},
		}

		// Parse SSE events in a separate goroutine
		go func() {
			// Ensure we always close the pipe reader even if we exit early
			defer pr.Close()

			// Use a scanner or similar to read from pr
			// We can reuse a lot of the logic below, but adapted for streaming
			rc.parseSSEStream(pr, in.Request)
		}()

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

	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		raw = nil
	}
	var usageTotals map[string]int
	var usageDetails map[string]map[string]int
	if raw != nil {
		if u, ok := raw["usage"].(map[string]interface{}); ok {
			usageTotals, usageDetails = parseUsageMap(u)
		}
	}

	r.rs.Body = io.NopCloser(bytes.NewReader(body))
	// Try to unmarshal into the expected struct first.
	if err := json.Unmarshal(body, &r.content); err == nil {
		if usageTotals != nil {
			r.content.Usage = usageTotals
			r.content.UsageDetails = usageDetails
		}
		// If we found key values, return.
		if r.content.ID != "" || r.content.Object != "" || r.content.Model != "" {
			if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
				log.Printf("DEV LOG: ReadValues quick-unmarshal id=%s model=%s object=%s usage=%v", r.content.ID, r.content.Model, r.content.Object, r.content.Usage)
			}
			return nil
		}
	}

	// Fallback: attempt a flexible parse for different response shapes (Responses API etc.)
	if raw == nil {
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
	if usageTotals != nil {
		r.content.Usage = usageTotals
		r.content.UsageDetails = usageDetails
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
	pcount, ccount, tot, cached := extractTokenCounts(c.Usage, c.UsageDetails)
	if os.Getenv("DEV_LOG_TOKEN_DEBUG") == "1" {
		log.Printf("DEV DEBUG: ProcessValues extracted counts prompt=%d completion=%d total=%d cached=%d usage=%v details=%v", pcount, ccount, tot, cached, c.Usage, c.UsageDetails)
	}
	modelAlias, snapshot := splitModelSnapshot(c.Model)
	promptTokens := dedupPromptTokens(pcount, cached)
	rq := db.Request{
		ID:                    c.ID,
		ApiKeyID:              r.apiKeyID,
		TokenCountPrompt:      promptTokens,
		TokenCountComplete:    ccount,
		InputTokenCount:       pcount,
		CachedInputTokenCount: cached,
		OutputTokenCount:      ccount,
		Model:                 modelAlias,
		SnapshotVersion:       snapshot,
		IsApproximated:        false,
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
// counts and also returns how many of the prompt tokens were cached.
func extractTokenCounts(totals map[string]int, details map[string]map[string]int) (prompt int, completion int, total int, cached int) {
	if totals == nil {
		return 0, 0, 0, 0
	}

	promptKeys := []string{"prompt_tokens", "input_tokens", "prompt"}
	completionKeys := []string{"completion_tokens", "output_tokens", "completion", "output"}
	totalKeys := []string{"total_tokens", "total"}

	prompt = findFirstTotalValue(totals, promptKeys)
	completion = findFirstTotalValue(totals, completionKeys)
	total = findFirstTotalValue(totals, totalKeys)
	cached = findCachedTokens(details, totals)

	if completion == 0 && total > 0 && prompt > 0 {
		completion = total - prompt
	}
	if prompt == 0 && total > 0 && completion > 0 {
		prompt = total - completion
	}
	if total == 0 {
		total = prompt + completion
	}
	return
}

func findFirstTotalValue(m map[string]int, keys []string) int {
	for _, key := range keys {
		if v, ok := m[key]; ok {
			return v
		}
	}
	return 0
}

func findCachedTokens(details map[string]map[string]int, totals map[string]int) int {
	if details != nil {
		for _, candidate := range []string{"prompt_tokens_details", "input_tokens_details"} {
			if detail, ok := details[candidate]; ok {
				if v, ok := detail["cached_tokens"]; ok {
					return v
				}
			}
		}
		for _, detail := range details {
			if v, ok := detail["cached_tokens"]; ok {
				return v
			}
		}
	}
	if totals != nil {
		if v, ok := totals["cached_tokens"]; ok {
			return v
		}
	}
	return 0
}

func dedupPromptTokens(total, cached int) int {
	if total <= cached {
		return 0
	}
	return total - cached
}

var snapshotSuffixPattern = regexp.MustCompile(`\d{4}-\d{2}-\d{2}$`)

func splitModelSnapshot(model string) (string, string) {
	if model == "" {
		return "", ""
	}
	if idx := strings.LastIndex(model, "-"); idx > 0 {
		suffix := model[idx+1:]
		if snapshotSuffixPattern.MatchString(suffix) {
			return model[:idx], suffix
		}
	}
	return model, ""
}

func modelAliasFromResponseMap(resp map[string]interface{}) (string, string) {
	if resp == nil {
		return "", ""
	}
	if v, ok := resp["model"].(string); ok && v != "" {
		return splitModelSnapshot(v)
	}
	if v, ok := resp["modelName"].(string); ok && v != "" {
		return splitModelSnapshot(v)
	}
	return "", ""
}

func (rc *ResponseConf) parseSSEStream(r io.Reader, req *http.Request) {
	// Re-use logic from the previous implementation but for a stream
	var cumPrompt, cumCompletion, cumCached int
	var accumulatedText strings.Builder
	var lastModel, lastID string
	var foundAny bool
	eventIdx := 0
	wrote := false
	// Track whether we had to estimate any token usage (e.g., output tokens from accumulated text)
	estimatedUsed := false

	// Use a scanner to read line by line from the pipe
	// SSE events are separated by double newlines
	// We need to handle the case where a single data: block is split across lines (though rare in OpenAI)
	// or where multiple data: lines exist in one event.

	// A simple approach is to read until we find a blank line or EOF
	// then process what we have.

	// However, we can also just read line by line and if it starts with data: process it.
	// Most usage info in OpenAI SSE is contained in a single data: line.

	// We'll use a scanner.
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data:") {
			jsonText := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if jsonText == "[DONE]" {
				continue
			}
			var raw map[string]interface{}
			if os.Getenv("DEV_LOG_TOKEN_DEBUG") == "1" {
				preview := jsonText
				if len(preview) > 1024 {
					preview = preview[:1024] + "..."
				}
				log.Printf("DEV DEBUG: SSE event received (data line: %s)", jsonText)
			}
			if err := json.Unmarshal([]byte(jsonText), &raw); err != nil {
				if os.Getenv("DEV_LOG_TOKEN_DEBUG") == "1" {
					log.Printf("DEV DEBUG: SSE data-line JSON unmarshal error: %v; json=%s", err, jsonText)
				}
				continue
			}

			// Extract text for fallback estimation
			if t, ok := raw["text"].(string); ok {
				accumulatedText.WriteString(t)
			} else if part, ok := raw["part"].(map[string]interface{}); ok {
				if t, ok := part["text"].(string); ok {
					accumulatedText.WriteString(t)
				}
			} else if choices, ok := raw["choices"].([]interface{}); ok && len(choices) > 0 {
				if choice, ok := choices[0].(map[string]interface{}); ok {
					if delta, ok := choice["delta"].(map[string]interface{}); ok {
						if content, ok := delta["content"].(string); ok {
							accumulatedText.WriteString(content)
						}
					}
				}
			}

			// Track ID and Model for fallback
			if idv, ok := raw["id"].(string); ok && idv != "" {
				lastID = idv
			}
			if modelv, ok := raw["model"].(string); ok && modelv != "" {
				lastModel = modelv
			}

			var usageFound bool
			var pcount, ccount, cached int
			if u, ok := raw["usage"].(map[string]interface{}); ok {
				totals, details := parseUsageMap(u)
				pcount, ccount, _, cached = extractTokenCounts(totals, details)
				cumPrompt = max(cumPrompt, pcount)
				cumCompletion = max(cumCompletion, ccount)
				cumCached = max(cumCached, cached)
				foundAny = true
				eventIdx++
				usageFound = true
				if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
					log.Printf("DEV LOG: SSE event %d usage: prompt=%d completion=%d cached=%d (top-level)", eventIdx, pcount, ccount, cached)
				}
			}
			// also check nested response.usage
			if !usageFound {
				if respObj, ok := raw["response"].(map[string]interface{}); ok {
					if u2, ok2 := respObj["usage"].(map[string]interface{}); ok2 {
						totals, details := parseUsageMap(u2)
						pcount, ccount, _, cached = extractTokenCounts(totals, details)
						cumPrompt = max(cumPrompt, pcount)
						cumCompletion = max(cumCompletion, ccount)
						cumCached = max(cumCached, cached)
						foundAny = true
						eventIdx++
						usageFound = true
						if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
							log.Printf("DEV LOG: SSE event %d usage: prompt=%d completion=%d cached=%d (nested response)", eventIdx, pcount, ccount, cached)
						}
					}
					if idv, ok := respObj["id"].(string); ok && idv != "" {
						lastID = idv
					}
					if modelv, ok := respObj["model"].(string); ok && modelv != "" {
						lastModel = modelv
					}
				}
			}

			// If this event signals completion, write to DB.
			if !wrote {
				isCompleted := false
				if tstr, ok := raw["type"].(string); ok && tstr == "response.completed" {
					isCompleted = true
				}
				// Also check for finished choices in standard chat completion stream
				if choices, ok := raw["choices"].([]interface{}); ok && len(choices) > 0 {
					if choice, ok := choices[0].(map[string]interface{}); ok {
						if finish, ok := choice["finish_reason"].(string); ok && finish != "" {
							// Not necessarily the very last event if usage follows,
							// but it's a signal.
							// Actually, we should wait for the usage event if possible.
						}
					}
				}

				if isCompleted {
					respID := lastID
					respModel := lastModel
					if respObj, ok := raw["response"].(map[string]interface{}); ok {
						if idv, ok := respObj["id"].(string); ok && idv != "" {
							respID = idv
						}
						if modelv, ok := respObj["model"].(string); ok && modelv != "" {
							respModel = modelv
						}
					}

					if respID != "" {
						apiKeyID := ""
						header := ""
						if req != nil {
							header = req.Header.Get(authHeader)
						}
						apiKey := strings.TrimPrefix(header, "Bearer ")
						if hashes, err := rc.db.LookupApiKeys("*"); err == nil {
							if uid, err := CompareToken(hashes, apiKey); err == nil {
								apiKeyID = uid
							}
						}

						// Final counts: prefer current event, then cumulative, then estimation
						finalPrompt := pcount
						finalCompletion := ccount
						finalCached := cached

						if finalPrompt == 0 {
							finalPrompt = cumPrompt
						}
						if finalCompletion == 0 {
							finalCompletion = cumCompletion
						}
						if finalCached == 0 {
							finalCached = cumCached
						}

						// Estimation fallback for completion tokens
						if finalCompletion == 0 && accumulatedText.Len() > 0 {
							// Simple heuristic: 1 token ≈ 4 characters
							finalCompletion = accumulatedText.Len() / 4
							if finalCompletion == 0 && accumulatedText.Len() > 0 {
								finalCompletion = 1
							}
							estimatedUsed = true
							if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
								log.Printf("DEV LOG: using estimated completion tokens: %d (chars: %d)", finalCompletion, accumulatedText.Len())
							}
						}

						modelAlias, snapshot := splitModelSnapshot(respModel)
						promptTokens := dedupPromptTokens(finalPrompt, finalCached)
						rq := db.Request{
							ID:                    respID,
							ApiKeyID:              apiKeyID,
							TokenCountPrompt:      promptTokens,
							TokenCountComplete:    finalCompletion,
							InputTokenCount:       finalPrompt,
							CachedInputTokenCount: finalCached,
							OutputTokenCount:      finalCompletion,
							Model:                 modelAlias,
							SnapshotVersion:       snapshot,
							IsApproximated:        estimatedUsed,
						}
						if err := rc.db.WriteRequest(&rq); err != nil {
							log.Printf("DEV LOG: failed to write request for SSE completed id=%s: %v", respID, err)
						} else {
							if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
								log.Printf("DEV LOG: wrote SSE completed request id=%s prompt=%d completion=%d api_key_id=%s", respID, finalPrompt, finalCompletion, apiKeyID)
							}
						}
						wrote = true
					}
				}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		log.Printf("DEV LOG: SSE stream scanner error: %v", err)
	}

	if !wrote && lastID != "" {
		// Try fallback if we haven't written yet (e.g. stream ended without response.completed but we have an ID)
		apiKeyID := ""
		header := ""
		if req != nil {
			header = req.Header.Get(authHeader)
		}
		apiKey := strings.TrimPrefix(header, "Bearer ")
		if hashes, err := rc.db.LookupApiKeys("*"); err == nil {
			if uid, err := CompareToken(hashes, apiKey); err == nil {
				apiKeyID = uid
			}
		}

		finalPrompt := cumPrompt
		finalCompletion := cumCompletion
		finalCached := cumCached
		estimated := false

		if finalCompletion == 0 && accumulatedText.Len() > 0 {
			finalCompletion = accumulatedText.Len() / 4
			if finalCompletion == 0 && accumulatedText.Len() > 0 {
				finalCompletion = 1
			}
			estimated = true
		}

		modelAlias, snapshot := splitModelSnapshot(lastModel)
		promptTokens := dedupPromptTokens(finalPrompt, finalCached)
		rq := db.Request{
			ID:                    lastID,
			ApiKeyID:              apiKeyID,
			TokenCountPrompt:      promptTokens,
			TokenCountComplete:    finalCompletion,
			InputTokenCount:       finalPrompt,
			CachedInputTokenCount: finalCached,
			OutputTokenCount:      finalCompletion,
			Model:                 modelAlias,
			SnapshotVersion:       snapshot,
			IsApproximated:        estimated,
		}
		if err := rc.db.WriteRequest(&rq); err == nil {
			if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
				log.Printf("DEV LOG: wrote SSE request (fallback at end of stream) id=%s prompt=%d completion=%d", lastID, finalPrompt, finalCompletion)
			}
		}
	}

	if foundAny {
		if os.Getenv("DEV_LOG_TOKEN_COUNT") == "1" {
			log.Printf("DEV LOG: SSE stream processing finished: events=%d prompt_max=%d completion_max=%d", eventIdx, cumPrompt, cumCompletion)
		}
	}
}

type readCloserWithCallback struct {
	io.Reader
	CloseFunc func() error
}

func (r *readCloserWithCallback) Close() error {
	if r.CloseFunc != nil {
		return r.CloseFunc()
	}
	if closer, ok := r.Reader.(io.Closer); ok {
		return closer.Close()
	}
	return nil
}

func parseUsageMap(raw map[string]interface{}) (map[string]int, map[string]map[string]int) {
	totals := make(map[string]int)
	details := make(map[string]map[string]int)

	for key, value := range raw {
		switch v := value.(type) {
		case float64:
			totals[key] = int(v)
		case int:
			totals[key] = v
		case int64:
			totals[key] = int(v)
		case json.Number:
			if iv, err := v.Int64(); err == nil {
				totals[key] = int(iv)
			}
		case map[string]interface{}:
			detail := make(map[string]int)
			for dk, dv := range v {
				switch dval := dv.(type) {
				case float64:
					detail[dk] = int(dval)
				case int:
					detail[dk] = dval
				case int64:
					detail[dk] = int(dval)
				case json.Number:
					if iv, err := dval.Int64(); err == nil {
						detail[dk] = int(iv)
					}
				}
			}
			details[key] = detail
		}
	}

	return totals, details
}
