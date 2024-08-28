package webui

import (
	"log"
	"net/http"
	"openai-api-proxy/auth"
)

func Init(mux *http.ServeMux, a *auth.Auth) {
	w := Webserver{a}
	mux.HandleFunc("/", w.Serve)

}

type Webserver struct {
	auth *auth.Auth
}

func (web *Webserver) Serve(w http.ResponseWriter, r *http.Request) {
	if web.auth.ValidateSessionToken(w, r) {
		http.ServeFile(w, r, "./public")
	} else {
		log.Println("Session Token Wrong")
		http.Redirect(w, r, "/login/", http.StatusTemporaryRedirect)
	}
}
