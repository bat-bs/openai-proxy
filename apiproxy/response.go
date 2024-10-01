package apiproxy

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	db "openai-api-proxy/db"
	"strings"
)

type Response struct {
	rs       *http.Response
	db       *db.Database
	apiKeyID string
	content  Content
}
type Content struct {
	ID     string `json:"id"`
	Model  string `json:"model"`
	Object string `json:"object"`
	Usage  struct {
		CompletionTokens int `json:"completion_tokens"`
		PromptTokens     int `json:"prompt_tokens"`
	} `json:"usage"`
}

func NewResponse(in *http.Response) error {

	r := Response{
		rs: in,
		db: db.NewDB(),
	}
	err := r.ReadValues()
	if err != nil {
		return err
	}
	go r.ProcessValues()
	return nil
}

func (r *Response) GetApiKeyUUID() string {
	header := r.rs.Request.Header.Get(authHeader)

	apiKey := strings.TrimPrefix(header, "Bearer ")

	hashes, err := r.db.LookupApiKeys("*")
	if err != nil || len(hashes) == 0 {
		log.Println("Error while requesting API Keys from DB", err)
	}

	uid, err := CompareToken(hashes, apiKey)
	log.Println(uid, err)
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
	json.Unmarshal(body, &r.content)
	return nil
}

func (r *Response) ProcessValues() {
	c := r.content
	if c.Object != "chat.completion" {
		log.Printf("Untested API Endpoint '%s' is used, check the Request in the DB: %s", c.Object, c.ID)
	}
	if r.apiKeyID = r.GetApiKeyUUID(); r.apiKeyID == "" {
		err := errors.New("error processing Response: Key could not be looked up from DB")
		log.Println(err)
		return
	}
	rq := db.Request{
		ID:                 c.ID,
		ApiKeyID:           r.apiKeyID,
		TokenCountPrompt:   c.Usage.PromptTokens,
		TokenCountComplete: c.Usage.CompletionTokens,
		Model:              c.Model,
	}
	if err := r.db.WriteRequest(&rq); err != nil {
		log.Println("error processing Response: Response could not be written to db DB")
		log.Println(err)
		return
	}
	log.Println("Written Request to DB")

}