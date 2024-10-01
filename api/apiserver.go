package api

import (
	"html/template"
	"log"
	"net/http"
	auth "openai-api-proxy/auth"
	db "openai-api-proxy/db"

	"github.com/Masterminds/sprig/v3"
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

func (a *ApiHandler) GetTable(w http.ResponseWriter, r *http.Request) {
	// Check if Request is Authenticated
	if !a.auth.ValidateSessionToken(w, r) {
		http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
		return
	}
	claims, err := a.auth.GetClaims(r)
	if err != nil {
		// If Claims Extraction Failed, user will be Redirected to Update his Token.
		a.Unauthenticated(w, r)
	}
	keys, err := a.db.LookupApiKeyInfos(claims.Sub)
	if err != nil {
		log.Fatal(err)
	}
	templ := template.Must(template.New("table.html.templ").Funcs(sprig.FuncMap()).ParseFiles("templates/table.html.templ"))

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
