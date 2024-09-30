package apiproxy

import (
	"bytes"
	"io"
	"log"
	"net/http"
)

type Response struct {
	rs *http.Response
}

func NewResponse(in *http.Response) error {

	r := Response{in}
	err := r.ReadValues()
	return err
}
func (r *Response) ReadValues() error {
	defer r.rs.Body.Close()
	body, err := io.ReadAll(r.rs.Body)
	if err != nil {
		log.Println("Error Parsing Body")
		return err
	}

	r.rs.Body = io.NopCloser(bytes.NewReader(body))

	log.Println(string(body))
	return nil
}
