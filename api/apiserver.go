package api

import (
	"html/template"
	"log"
	"net/http"
	auth "openai-api-proxy/auth"
	db "openai-api-proxy/db"
)

func ApiInit(mux *http.ServeMux, a *auth.Auth) {
	api := ApiHandler{db.NewDB(), a}
	mux.HandleFunc("/api2/table/get", api.GetTable)
	mux.HandleFunc("/api2/table/entry/save", api.CreateEntry)
	mux.HandleFunc("/api2/table/entry/delete/", api.DeleteEntry)

}

type ApiHandler struct {
	db   *db.Database
	auth *auth.Auth
}

func (h *ApiHandler) GetTable(w http.ResponseWriter, r *http.Request) {
	// Check if Request is Authenticated
	if !h.auth.ValidateSessionToken(w, r) {
		http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
		return
	}
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

func (h *ApiHandler) Unauthenticated(w http.ResponseWriter, r *http.Request) {

	//Redirect will be better for the users, as it saves them the reload
	w.Header().Set("HX-Redirect", "/")
	http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)

}
