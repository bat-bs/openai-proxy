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
	"golang.org/x/oauth2"
)

func Init(mux *http.ServeMux) (a *Auth) {
	ctx := context.Background()
	issuer, ok := os.LookupEnv("ISSUER")
	if !ok {
		log.Println("ISSUER env for OpenID not defined")
		return
	}
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		// handle error
		log.Println("Cannot Initiate Provider: ", err)
	}

	clientId, ok := os.LookupEnv("CLIENT_ID")
	if !ok {
		log.Println("CLIENT_ID, required for OIDC not set")
		return
	}
	clientSecret, ok := os.LookupEnv("CLIENT_SECRET")
	if !ok {
		log.Println("CLIENT_SECRET, required for OIDC not set")
		return
	}
	redirect, ok := os.LookupEnv("OAUTH_REDIRECT_DOMAIN")
	if !ok {
		redirect = "http://localhost:8082"
	}
	// Configure an OpenID Connect aware OAuth2 client.
	oauth2Config := &oauth2.Config{
		ClientID:     clientId,
		ClientSecret: clientSecret,
		RedirectURL:  redirect + "/callback/",

		// Discovery returns the OAuth2 endpoints.
		Endpoint: provider.Endpoint(),

		// "openid" is a required scope for OpenID Connect flows.
		Scopes: []string{oidc.ScopeOpenID, "profile", "email"},
	}

	var verifier = provider.Verifier(&oidc.Config{ClientID: clientId})
	a = &Auth{
		oauth2Config: oauth2Config,
		ctx:          context.Background(),
		verifier:     verifier,
	}
	mux.HandleFunc("/callback/", a.CallbackHandler)
	mux.HandleFunc("/login/", a.LoginHandler)
	return a
}

type Claims struct {
	Email    string   `json:"email"`
	Name     string   `json:"name"`
	Verified bool     `json:"email_verified"`
	Sub      string   `json:"sub"`
	Groups   []string `json:"groups"`
}

type Auth struct {
	oauth2Config *oauth2.Config
	ctx          context.Context
	verifier     *oidc.IDTokenVerifier
}

func (a *Auth) LoginHandler(w http.ResponseWriter, r *http.Request) {

	// Create oauthState cookie
	oauthState := a.generateStateOauthCookie(w)
	u := a.oauth2Config.AuthCodeURL(oauthState)
	http.Redirect(w, r, u, http.StatusTemporaryRedirect)
}

func (a *Auth) generateStateOauthCookie(w http.ResponseWriter) string {
	var expiration = time.Now().Add(365 * 24 * time.Hour)
	b := make([]byte, 16)
	rand.Read(b)
	state := base64.URLEncoding.EncodeToString(b)
	cookie := http.Cookie{Name: "oauthstate", Path: "/", Value: state, Expires: expiration}
	http.SetCookie(w, &cookie)

	return state
}

func (a *Auth) CallbackHandler(w http.ResponseWriter, r *http.Request) {

	oauthState, _ := r.Cookie("oauthstate")
	if r.FormValue("state") != oauthState.Value {
		log.Println("invalid oauth state")
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}
	// Verify state and errors.
	oauth2Token, err := a.oauth2Config.Exchange(a.ctx, r.URL.Query().Get("code"))
	if err != nil {
		// handle error
		http.Error(w, "Token Exchange Failed", http.StatusBadRequest)
		return
	}

	// Extract the ID Token from OAuth2 token.
	rawIDToken, ok := oauth2Token.Extra("id_token").(string)
	if !ok {
		// handle missing token
		http.Error(w, "missing token in claim", http.StatusBadRequest)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "session_token", Path: "/", Value: rawIDToken})
	http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
}

func (a *Auth) GetClaims(r *http.Request) (*Claims, error) {
	var err error
	// Parse and verify ID Token payload.
	rawIDToken, err := r.Cookie("session_token")
	if err != nil {
		return nil, err
	}
	idToken, err := a.verifier.Verify(a.ctx, rawIDToken.Value)
	if err != nil {
		return nil, err
	}
	claims := &Claims{}
	// Extract custom claims
	if err = idToken.Claims(claims); err != nil {
		log.Println("Error Extracting User-Claim", err)
		return nil, err
		// handle error
	}
	return claims, nil
}
func (a *Auth) ValidateSessionToken(w http.ResponseWriter, r *http.Request) bool {
	// Parse and verify ID Token payload.
	rawIDToken, err := r.Cookie("session_token")
	if err != nil || rawIDToken == nil {
		return false
	}
	_, err = a.verifier.Verify(a.ctx, rawIDToken.Value)
	if err != nil {
		log.Println("Session Token Wrong")
		http.Redirect(w, r, "/login/", http.StatusTemporaryRedirect)
		return false
	}

	return true
}
