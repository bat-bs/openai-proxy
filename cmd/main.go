package main

import (
	"context"
	"log"
	"net/http"
	api "openai-api-proxy/api"
	proxy "openai-api-proxy/apiproxy"
	auth "openai-api-proxy/auth"
	db "openai-api-proxy/db"
	web "openai-api-proxy/webui"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
)

func main() {
	log.Println("openai-proxy started")
	err := godotenv.Load()
	if err != nil {
		log.Println("Warning: not able to loading Env File", err)
	}
	db := db.DatabaseInit()
	defer db.Close()

	mux := http.NewServeMux()
	a := auth.Init(mux, db)
	recorder := proxy.Init(mux, db) // Start AI Proxy
	web.Init(mux, a)                // Start Web UI
	api.ApiInit(mux, a, db)         // Start Backend API

	log.Printf("Serving on http://localhost:%d", 8082)
	server := &http.Server{Addr: ":8082", Handler: mux}
	sigc := make(chan os.Signal, 1)
	signal.Notify(sigc, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)
	go func() {
		s := <-sigc
		log.Printf("Exit: %s", s)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("HTTP server shutdown failed: %v", err)
		}
		recorder.CloseContext(ctx)
		db.Close()
	}()
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("HTTP server stopped unexpectedly: %v", err)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		recorder.CloseContext(ctx)
		cancel()
	}
}
