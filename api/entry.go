package api

import (
	"crypto/rand"
	"encoding/base32"
	"log"
	"net/http"
	db "openai-api-proxy/db"
	"strings"
	"text/template"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

func (a *ApiHandler) generateToken(length int) string {
	randomBytes := make([]byte, 32)
	_, err := rand.Read(randomBytes)
	if err != nil {
		panic(err)
	}
	return base32.StdEncoding.EncodeToString(randomBytes)[:length]
}
func (a *ApiHandler) hashToken(token string) string {
	bytes, err := bcrypt.GenerateFromPassword([]byte(token), 5)
	if err != nil {
		log.Println("Error while hashing Secret: ", err)
	}
	return string(bytes)
}

func (a *ApiHandler) CreateEntry(w http.ResponseWriter, r *http.Request) {
	// Check if Request is Authenticated
	if !a.auth.ValidateSessionToken(w, r) {
		a.Unauthenticated(w, r)
		return
	}

	claims, err := a.auth.GetClaims(r)
	if err != nil {
		// If Claims Extraction Failed, user will be Redirected to Update his Token.
		a.Unauthenticated(w, r)
	}

	r.ParseForm()
	uuid := uuid.NewString()
	apikey := a.generateToken(32)
	h := db.ApiKey{
		UUID:        uuid,
		ApiKey:      a.hashToken(apikey),
		Owner:       claims.Sub,
		AiApi:       r.Form.Get("apitype"),
		Description: r.Form.Get("beschreibung"),
	}
	a.db.WriteEntry(&h)

	popupContent := `
	<div class="w-full max-w-[40rem] ">
    <div class="relative">
	<div class="text-center p-2">
		<div class="p-2 bg-yellow-500 items-center w-auto rounded-full text-yellow-100 leading-none lg:rounded-full flex lg:inline-flex" role="alert">
			<span class="flex rounded-full bg-yellow-400 uppercase px-2 py-1 text-xs font-bold mr-3">Warn</span>
			<span class="font-semibold mr-2 text-left flex-auto">Der Key wird nur 1x Angezeigt.</span>
		</div>
	</div>
		<label class="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2" for="apikey">Api Key:</label>
        <input id="apikey" type="text" class="p-2 bg-gray-50 border border-gray-300 text-gray-500 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-80 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-gray-400 dark:focus:ring-blue-500 dark:focus:border-blue-500" value="{{ . }}" disabled readonly>
	</div>
	</div>

	`
	popupTemplate, err := template.New(popupContent).Parse(popupContent)
	if err != nil {
		log.Println("Error while templating the pop up")
	}

	err = popupTemplate.Execute(w, apikey)
	if err != nil {
		log.Println("Error while filling out the Template or writing Response")
	}
}

func (a *ApiHandler) DeleteEntry(w http.ResponseWriter, r *http.Request) {
	// Check if Request is Authenticated
	if !a.auth.ValidateSessionToken(w, r) {
		a.Unauthenticated(w, r)
		return
	}

	claims, err := a.auth.GetClaims(r)
	if err != nil {
		// If Claims Extraction Failed, user will be Redirected to Update his Token.
		a.Unauthenticated(w, r)
	}
	w.Header().Set("HX-Trigger", "rld")
	key := strings.TrimPrefix(r.URL.Path, "/api2/table/entry/delete/")
	a.db.DeleteEntry(&key, claims.Sub)
}
