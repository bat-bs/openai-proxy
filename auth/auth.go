package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"

	db "openai-api-proxy/db"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

func Init(mux *http.ServeMux, db *db.Database) (a *Auth) {
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
	var claims *ProviderClaims
	err = provider.Claims(&claims)
	if err != nil {
		log.Println("Cannot extract provider Claims for LogoutURL", err)
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
		Scopes: []string{oidc.ScopeOpenID, "profile", "email", "roles"},
	}

	var verifier = provider.Verifier(&oidc.Config{ClientID: clientId})

	a = &Auth{
		oauth2Config: oauth2Config,
		db:           db,
		ctx:          context.Background(),
		verifier:     verifier,
		provider:     provider,
		claims:       claims,
	}
	mux.HandleFunc("/callback/", a.CallbackHandler)
	mux.HandleFunc("/login/", a.LoginHandler)
	return a
}

type ProviderClaims struct {
	EndSessionURL string `json:"end_session_endpoint"`
}

type Claims struct {
	Email    string   `json:"email"`
	Name     string   `json:"name"`
	Verified bool     `json:"email_verified"`
	Sub      string   `json:"sub"`
	Roles    []string `json:"roles"`
}

type Auth struct {
	oauth2Config *oauth2.Config
	db           *db.Database
	ctx          context.Context
	verifier     *oidc.IDTokenVerifier
	provider     *oidc.Provider
	claims       *ProviderClaims
}

func (a *Auth) LogoutHandler(w http.ResponseWriter, r *http.Request) {
	state, _ := r.Cookie("oauthstate")
	http.SetCookie(w, &http.Cookie{
		Name:    "session_token",
		Path:    "/",
		Value:   "",
		Expires: time.Unix(0, 0),
	})
	if a.claims.EndSessionURL == "" {
		http.Error(w, "Logout not implemented by Identity Provider", http.StatusNotImplemented)
		return
	}
	logoutURL, err := url.Parse(a.claims.EndSessionURL)
	if err != nil {
		log.Println("Error parsing URL: ", err)
	}
	query := logoutURL.Query()
	query.Set("state", state.Value)
	query.Set("post_logout_redirect_uri", a.oauth2Config.RedirectURL) // Not implemented by our IDP of Testing https://github.com/zitadel/zitadel/issues/6615
	logoutURL.RawQuery = query.Encode()

	http.Redirect(w, r, logoutURL.String(), http.StatusTemporaryRedirect)
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

	if err = idToken.Claims(&claims); err != nil {
		log.Println("Error Extracting User-Claim", err)
		return nil, err
		// handle error
	}
	return claims, nil
}

type NotAdmin struct {
	uid string
}

func (n *NotAdmin) Error() string {
	return fmt.Sprintf("User %s has no Admin Role", n.uid)
}

func (a *Auth) ValidateAdminSession(w http.ResponseWriter, r *http.Request) (bool, error) {
	authenticated := a.ValidateSessionToken(w, r)
	if !authenticated {
		log.Println("Not Authenticated")
		return false, nil
	}
	claims, err := a.GetClaims(r)
	if err != nil {
		log.Println("Claims not found")
		return false, err
	}

	user, err := a.db.GetUser(claims.Sub)
	if err != nil {
		return false, err
	}
	if user.IsAdmin {
		return true, nil
	}
	return false, &NotAdmin{uid: claims.Sub}
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
