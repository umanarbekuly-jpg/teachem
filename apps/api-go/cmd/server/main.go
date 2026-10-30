package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"teachem/api-go/contracts"
	"teachem/api-go/internal/accounts"
	"teachem/api-go/internal/commerce"
	"teachem/api-go/internal/core"
	"teachem/api-go/internal/learning"
	"teachem/api-go/internal/migrate"
	"teachem/api-go/internal/storage"
)

func main() {
	if err := run(); err != nil {
		log.Printf("startup failed: %T; check configuration and migration status", err)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	if command == "healthcheck" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "4000"
		}
		client := http.Client{Timeout: 4 * time.Second}
		r, e := client.Get("http://localhost:" + port + "/health/ready")
		if e != nil {
			return e
		}
		defer r.Body.Close()
		if r.StatusCode != 200 {
			return errors.New("not ready")
		}
		return nil
	}
	s, e := core.Open(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		return e
	}
	if command == "migrate" {
		return migrate.Run(ctx, s)
	}
	if command == "seed" {
		return migrate.Seed(s)
	}
	if command != "serve" {
		return errors.New("unknown command")
	}
	cfg, e := core.LoadConfig()
	if e != nil {
		return e
	}
	objects, e := storage.New(cfg)
	if e != nil {
		return e
	}
	a := core.New(s, cfg, objects)
	accounts.Register(a)
	learning.Register(a)
	commerce.Register(a)
	a.Handle("GET", "/health/live", "*", func(c *core.Context) (any, error) { return core.Row{"status": "ok"}, nil })
	a.Handle("GET", "/health/ready", "*", func(c *core.Context) (any, error) {
		if _, e := c.Store.One("SELECT 1"); e != nil {
			return nil, core.Error(503, "Инфраструктура не готова")
		}
		if e := objects.Healthy(c.R.Context()); e != nil {
			return nil, core.Error(503, "Инфраструктура не готова")
		}
		return core.Row{"status": "ok"}, nil
	})
	var spec core.Row
	if e = json.Unmarshal(contracts.OpenAPI, &spec); e != nil {
		return e
	}
	a.Handle("GET", "/api/openapi.json", "*", func(c *core.Context) (any, error) { return spec, nil })
	a.Raw("GET", "/api/docs", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<!doctype html><html lang="ru"><head><title>TeachEm API</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head><body><p><a href="/api/openapi.json">OpenAPI JSON</a></p><div id="swagger"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/openapi.json',dom_id:'#swagger'});</script></body></html>`))
	}))
	server := &http.Server{Addr: ":" + cfg.Port, Handler: a.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Print("TeachEm Go API ready")
	e = server.ListenAndServe()
	if errors.Is(e, http.ErrServerClosed) {
		return nil
	}
	return e
}
