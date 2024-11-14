package main

import (
	"log"
	"net/http"
	api "openai-api-proxy/api"
	proxy "openai-api-proxy/apiproxy"
	auth "openai-api-proxy/auth"
	costs "openai-api-proxy/costs"
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

	ticker := time.NewTicker(24 * time.Hour)

	go costs.GetAllCosts(db, ticker.C)

	osExit(db)
	defer log.Println("Closing DB Clients :)")

	mux := http.NewServeMux()
	a := auth.Init(mux, db)
	//
	proxy.Init(mux, db)     // Start AI Proxy
	web.Init(mux, a)        // Start Web UI
	api.ApiInit(mux, a, db) // Start Backend API

	log.Printf("Serving on http://localhost:%d", 8082)
	log.Fatal(http.ListenAndServe(":8082", mux))

}

// Close DB on Program Exit
func osExit(db *db.Database) {
	sigc := make(chan os.Signal, 1)
	signal.Notify(sigc,
		syscall.SIGHUP,
		syscall.SIGINT,
		syscall.SIGTERM,
		syscall.SIGQUIT)
	go func() {
		s := <-sigc
		log.Printf("Exit: %s Closing DB Clients :)", s)
		db.Close()
		os.Exit(1)
	}()
}
