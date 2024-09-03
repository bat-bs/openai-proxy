package main

import "embed"

// content holds our static web server content.
//go:embed db/migrations/* db/schema.sql
//go:embed templates/* public/*

//go:embed html/index.html
var content embed.FS

import (
	"log"
	"net/http"
	api "openai-api-proxy/api"
	proxy "openai-api-proxy/apiproxy"
	auth "openai-api-proxy/auth"
	db "openai-api-proxy/db"
	web "openai-api-proxy/webui"

	"github.com/joho/godotenv"
)

func main() {
	log.Println("openai-proxy started")
	err := godotenv.Load()
	if err != nil {
		log.Println("Warning: not able to loading Env File", err)
	}
	db.DatabaseInit(content)
	mux := http.NewServeMux()
	a := auth.Init(mux)
	//
	proxy.Init(mux)        // Start AI Proxy
	go web.Init(mux, a, content)    // Start Web UI
	go api.ApiInit(mux, a) // Start Backend API

	log.Printf("Serving on http://localhost:%d", 8082)
	log.Fatal(http.ListenAndServe(":8082", mux))

}
