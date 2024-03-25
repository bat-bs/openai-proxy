package api

import (
	"html/template"
	"log"
	"net/http"

	_ "github.com/mattn/go-sqlite3"
)

func ApiInit(mux *http.ServeMux) {
	db := DatabaseInit()
	mux.Handle("/api2/table/get", &ApiHandler{db})
	mux.Handle("/api2/table/entry/save", &EntryCreate{db})
	mux.Handle("/api2/table/entry/delete/", &EntryDelete{db})

}

type ApiHandler struct {
	db *Database
}

type ApiKey struct {
	ApiKey      string
	Owner       string
	AiApi       string // can be openai or azure
	Description string //optional
}

func DatabaseInit() *Database {
	createTable := `
	CREATE TABLE IF NOT EXISTS apiKeys (
		ApiKey      TEXT NOT NULL PRIMARY KEY,
		Owner       TEXT,
		AiApi       TEXT,
		Description TEXT
	);`
	d := NewDB()
	if _, err := d.db.Exec(createTable); err != nil {
		log.Fatal(err)
	}
	return d

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
