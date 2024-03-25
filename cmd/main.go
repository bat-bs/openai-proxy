package main

import (
	"log"
	"net/http"
	api "openai-api-proxy/api"
	proxy "openai-api-proxy/apiproxy"
	web "openai-api-proxy/webui"

	"github.com/joho/godotenv"
)

func main() {
	log.Println("openai-proxy started")
	err := godotenv.Load()
	if err != nil {
		log.Println("Error loading Env File", err)
	}
	mux := http.NewServeMux()
	proxy.Init(mux)     // Start AI Proxy
	go web.Init(mux)    // Start Web UI
	go api.ApiInit(mux) // Start Backend API

	log.Fatal(http.ListenAndServe(":8082", mux))

}
