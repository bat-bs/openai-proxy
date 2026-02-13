package api

import (
	"html/template"
	"log"
	"net/http"
	auth "openai-api-proxy/auth"
	db "openai-api-proxy/db"
	"os"

	"github.com/Masterminds/sprig/v3"
)

func ApiInit(mux *http.ServeMux, a *auth.Auth, db *db.Database) {
	timeZone, ok := os.LookupEnv("TIMEZONE")
	if !ok {
		timeZone = "Europe/Berlin"
	}

	api := ApiHandler{db, a, timeZone}
	graph := NewGraphHandler(&api)
	mux.HandleFunc("/api2/user/widget", api.GetUserWidget)
	mux.HandleFunc("/api2/user/logout", api.LogoutUser)
	mux.HandleFunc("/api2/admin/table/get", api.GetAdminTable)
	mux.HandleFunc("/api2/admin/table/graph/get/", graph.GetAdminTableGraph)
	mux.HandleFunc("/api2/table/graph/get/", graph.GetTableGraph)
	mux.HandleFunc("/api2/table/get", api.GetTable)
	mux.HandleFunc("/api2/table/entry/save", api.CreateEntry)
	mux.HandleFunc("/api2/table/entry/delete/", api.DeleteEntry)
	mux.HandleFunc("/api2/admin/models/get", api.GetModelsTable)
	mux.HandleFunc("/api2/admin/models/add", api.AddModel)
	mux.HandleFunc("/api2/admin/models/delete/", api.DeleteModel)

}

type ApiHandler struct {
	db       *db.Database
	auth     *auth.Auth
	timeZone string
}

func (a *ApiHandler) GetAdminTable(w http.ResponseWriter, r *http.Request) {
	ok, err := a.auth.ValidateAdminSession(w, r)
	if err == nil && ok {
		keys, err := a.db.LookupApiKeyUserOverview()
		if err != nil {
			log.Fatal(err)
		}
		templ := template.Must(template.New("adminTable.html.templ").Funcs(sprig.FuncMap()).ParseFiles("templates/adminTable.html.templ"))

		if err != nil {
			panic(err)
		}

		err = templ.Execute(w, keys)
		if err != nil {
			panic(err)
		}
	} else {
		http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
	}
}

func (a *ApiHandler) LogoutUser(w http.ResponseWriter, r *http.Request) {
	a.auth.LogoutHandler(w, r)

}

func (a *ApiHandler) GetUserWidget(w http.ResponseWriter, r *http.Request) {

	claims, err := a.auth.GetClaims(r)
	if err != nil {
		http.Error(w, "Not Authenticated", http.StatusForbidden)
		return
	}
	claimsDB, err := a.db.GetUser(claims.Sub)
	if err != nil {
		log.Println("Could not get Claims from DB")
		return
	}
	userWidgetContent := `
	<p class="text-xl">{{if .IsAdmin }}<a class="text-sky-400" href="/admin">Admin-Panel</a> - <a class="text-sky-400" href="/">Homepage</a>{{ end }} </p><p>Hallo, {{.Name}} <u><a class="text-sky-400" href="/api2/user/logout">logout</a></u></p>

	`
	userWidget, err := template.New(userWidgetContent).Parse(userWidgetContent)
	if err != nil {
		log.Println("Error while templating the pop up")
		return
	}

	err = userWidget.Execute(w, claimsDB)
	if err != nil {
		log.Println("Error while filling out the Template or writing Response")
	}
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
	admin := false
	for _, group := range claims.Roles {
		if group == "admin" {
			admin = true
		}
	}
	// Check/Create user as its the first authenticated action ran
	u := db.User{
		Name:    claims.Name,
		Sub:     claims.Sub,
		IsAdmin: admin,
	}
	a.db.WriteUser(&u)

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
