package core_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"teachem/api-go/contracts"
	"teachem/api-go/internal/accounts"
	"teachem/api-go/internal/commerce"
	"teachem/api-go/internal/core"
	"teachem/api-go/internal/learning"
)

func TestExistingRouteCoverage(t *testing.T) {
	a := core.New(core.Store{}, core.Config{}, nil)
	accounts.Register(a)
	learning.Register(a)
	commerce.Register(a)
	routes := map[string]bool{}
	for _, r := range a.Routes {
		routes[strings.ToLower(r.Method)+" "+r.Path] = true
	}
	var doc struct {
		Paths map[string]map[string]any `json:"paths"`
	}
	if err := json.Unmarshal(contracts.OpenAPI, &doc); err != nil {
		t.Fatal(err)
	}
	count := 0
	for path, methods := range doc.Paths {
		if strings.HasPrefix(path, "/health/") {
			continue
		}
		for method := range methods {
			if method == "parameters" {
				continue
			}
			count++
			if !routes[method+" "+path] {
				t.Errorf("missing legacy route: %s %s", method, path)
			}
		}
	}
	t.Logf("%d legacy domain operations covered", count)
}
func TestTransportGuards(t *testing.T) {
	cfg := core.Config{PublicOrigin: "http://localhost:8080", CORSOrigins: "http://localhost:8080", RateLimit: 120, AuthRateLimit: 8}
	a := core.New(core.Store{}, cfg, nil)
	accounts.Register(a)
	a.Authenticate = func(c *core.Context) (*core.Actor, error) {
		return &core.Actor{ID: core.NewID(), Role: "student", MustChangePassword: c.R.Header.Get("X-Test-Forced") == "yes"}, nil
	}
	a.Handle("PATCH", "/api/v1/test/{id}", "", func(c *core.Context) (any, error) { return c.Body("name") })
	token := strings.Repeat("a", 64)
	call := func(origin, csrf, cookie, body, path, forced string) int {
		r := httptest.NewRequest("PATCH", path, strings.NewReader(body))
		r.Header.Set("Origin", origin)
		r.Header.Set("X-CSRF-Token", csrf)
		r.Header.Set("X-Test-Forced", forced)
		r.AddCookie(&http.Cookie{Name: "csrf", Value: cookie})
		w := httptest.NewRecorder()
		a.Handler().ServeHTTP(w, r)
		return w.Code
	}
	path := "/api/v1/test/" + core.NewID()
	for _, test := range []struct {
		origin, csrf, cookie, body, path, forced string
		want                                     int
	}{
		{cfg.PublicOrigin, token, token, `{"name":"Valid"}`, path, "", 200},
		{"https://attacker.test", token, token, `{}`, path, "", 403},
		{cfg.PublicOrigin, "wrong", token, `{}`, path, "", 403},
		{cfg.PublicOrigin, token, token, `{"role":"SUPERADMIN"}`, path, "", 400},
		{cfg.PublicOrigin, token, token, `{} {}`, path, "", 400},
		{cfg.PublicOrigin, token, token, `{}`, "/api/v1/test/not-uuid", "", 400},
		{cfg.PublicOrigin, token, token, `{}`, path, "yes", 403},
	} {
		if got := call(test.origin, test.csrf, test.cookie, test.body, test.path, test.forced); got != test.want {
			t.Fatalf("status %d want %d", got, test.want)
		}
	}
}
func TestRateLimitAndCORS(t *testing.T) {
	cfg := core.Config{PublicOrigin: "http://localhost:8080", CORSOrigins: "http://localhost:8080", RateLimit: 2}
	a := core.New(core.Store{}, cfg, nil)
	a.Handle("GET", "/test", "*", func(c *core.Context) (any, error) { return core.OK(), nil })
	for i := 0; i < 3; i++ {
		r := httptest.NewRequest("GET", "/test", nil)
		r.Header.Set("Origin", cfg.PublicOrigin)
		w := httptest.NewRecorder()
		a.Handler().ServeHTTP(w, r)
		if w.Header().Get("Access-Control-Allow-Origin") != cfg.PublicOrigin {
			t.Fatal("CORS missing")
		}
		if i == 2 && w.Code != 429 {
			t.Fatal("rate limit missing")
		}
	}
}
