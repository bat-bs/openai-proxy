package webui

import (
	"errors"
	"log"
	"net/http"
	auth "openai-api-proxy/auth"
)

func Init(mux *http.ServeMux, a *auth.Auth) {
	w := Webserver{
		auth: a,
		fs:   http.FileServer(http.Dir("./public")),
	}
	mux.HandleFunc("/admin/", w.ServeAdmin)
	mux.HandleFunc("/", w.Serve)

}

type Webserver struct {
	auth *auth.Auth
	fs   http.Handler
}

func (web *Webserver) ServeAdmin(w http.ResponseWriter, r *http.Request) {
	ok, err := web.auth.ValidateAdminSession(w, r)
	notAdminError := &auth.NotAdmin{}
	if errors.As(err, &notAdminError) {
		http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
	} else if err == nil && ok {
		web.fs.ServeHTTP(w, r)

	} else {
		log.Println("Session Token Wrong")
		http.Redirect(w, r, "/login/", http.StatusTemporaryRedirect)
	}
}

func (web *Webserver) Serve(w http.ResponseWriter, r *http.Request) {
	if web.auth.ValidateSessionToken(w, r) {
		web.fs.ServeHTTP(w, r)

	} else {
		log.Println("Session Token Wrong")
		http.Redirect(w, r, "/login/", http.StatusTemporaryRedirect)
	}
}
