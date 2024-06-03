package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/joho/godotenv"
	"golang.org/x/oauth2"
)

var oidcConf *oauth2.Config

func Init(mux *http.ServeMux) {
	err := godotenv.Load()
	if err != nil {
		log.Println(err)
	}
	oidcConf = &oauth2.Config{
		ClientID:     os.Getenv("OPENID_CLIENT_ID"),
		ClientSecret: os.Getenv("OPENID_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("OPENID_REDIRECT_URL"),

		Scopes: []string{oidc.ScopeOpenID, "profile", "email"},
	}

	log.Println("Running this config: ", oidcConf)
	providerURL := os.Getenv("OPENID_PROVIDER_URL")
	provider, err := oidc.NewProvider(context.Background(), providerURL)
	oidcConf.Endpoint = provider.Endpoint()
	if err != nil {
		log.Fatal(err)
	}

	verifier := provider.Verifier(&oidc.Config{ClientID: oidcConf.ClientID})
	callbackHandler := &baseHandle{
		verifier: verifier,
	}
	mux.HandleFunc("/auth/openid/login", handleOAuth2Login)
	mux.Handle("/auth/openid/callback", callbackHandler)

}

type Claims struct {
	Email    string `json:"email"`
	Verified bool   `json:"email_verified"`
	Sub      string `json:"sub"`
}

type baseHandle struct {
	verifier *oidc.IDTokenVerifier
	Claims   *Claims
}

func (h *baseHandle) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if ValidateJWTToken(h.Claims) {
		http.RedirectHandler("/", 301)
		return
	}
	h.handleOAuth2Callback(w, r)
	ValidateJWTToken(h.Claims)
}

func Login() {

}

func handleOAuth2Login(w http.ResponseWriter, r *http.Request) {

	// Create oauthState cookie
	oauthState := generateStateOauthCookie(w)

	/*
		AuthCodeURL receive state that is a token to protect the user from CSRF attacks. You must always provide a non-empty string and
		validate that it matches the the state query parameter on your redirect callback.
	*/
	u := oidcConf.AuthCodeURL(oauthState)
	http.Redirect(w, r, u, http.StatusTemporaryRedirect)
}

func generateStateOauthCookie(w http.ResponseWriter) string {
	var expiration = time.Now().Add(20 * time.Minute)

	b := make([]byte, 16)
	rand.Read(b)
	state := base64.URLEncoding.EncodeToString(b)
	cookie := http.Cookie{Name: "oauthstate", Value: state, Expires: expiration}
	http.SetCookie(w, &cookie)

	return state
}

// TODO: Adapt to https://github.com/coreos/go-oidc/blob/v3/example/idtoken/app.go
func (h *baseHandle) handleOAuth2Callback(w http.ResponseWriter, r *http.Request) {
	state, err := r.Cookie("state")
	if err != nil {
		http.Error(w, "state not found", http.StatusBadRequest)
		return
	}
	ctx := context.Background()
	// Verify state and errors.

	oauth2Token, err := oidcConf.Exchange(ctx, r.URL.Query().Get("code"))
	if err != nil {
		// handle error
	}

	// Extract the ID Token from OAuth2 token.
	rawIDToken, ok := oauth2Token.Extra("id_token").(string)
	if !ok {
		// handle missing token
	}

	// Parse and verify ID Token payload.
	idToken, err := h.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		// handle error
	}

	// Extract custom claims
	if err := idToken.Claims(h.Claims); err != nil {
		log.Printf("openid: cannot put id Token Claims into struct: ", err)
		// handle error
	}
}
