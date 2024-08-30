package webui

import (
	"log"
	"net/http"
	"openai-api-proxy/auth"
)

func Init(mux *http.ServeMux, a *auth.Auth) {
	w := Webserver{
		auth: a,
		fs:   http.FileServer(http.Dir("./public")),
	}
	mux.HandleFunc("/", w.Serve)

}

type Webserver struct {
	auth *auth.Auth
	fs   http.Handler
}

func (web *Webserver) Serve(w http.ResponseWriter, r *http.Request) {
	if web.auth.ValidateSessionToken(w, r) {
		web.fs.ServeHTTP(w, r)

	} else {
		log.Println("Session Token Wrong")
		http.Redirect(w, r, "/login/", http.StatusTemporaryRedirect)
	}
}
