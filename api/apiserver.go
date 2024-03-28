package api

import (
	"html/template"
	"log"
	"net/http"
	db "openai-api-proxy/db"

	_ "github.com/mattn/go-sqlite3"
)

func ApiInit(mux *http.ServeMux) {
	db := db.NewDB()
	mux.Handle("/api2/table/get", &ApiHandler{db})
	mux.Handle("/api2/table/entry/save", &EntryCreate{db})
	mux.Handle("/api2/table/entry/delete/", &EntryDelete{db})

}

type ApiHandler struct {
	db *db.Database
}

func (h *ApiHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	keys, err := h.db.LookupApiKeyInfos()
	if err != nil {
		log.Fatal(err)
	}

	templ, err := template.New("table.html.templ").ParseFiles("templates/table.html.templ")
	if err != nil {
		panic(err)
	}
	err = templ.Execute(w, keys)
	if err != nil {
		panic(err)
	}

}
