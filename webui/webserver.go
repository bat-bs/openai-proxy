package webui

import (
	"net/http"
)

func Init(mux *http.ServeMux) {
	fs := http.FileServer(http.Dir("./public"))
	mux.Handle("/", fs)

}
