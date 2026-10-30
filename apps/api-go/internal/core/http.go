package core

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type Config struct {
	DatabaseURL, AccessSecret, RefreshSecret, PublicOrigin, CORSOrigins, Port, StorageEndpoint, StoragePublicEndpoint, StorageRegion, StorageBucket, StorageAccessKey, StorageSecretKey string
	CookieSecure                                                                                                                                                                        bool
	RateLimit, AuthRateLimit                                                                                                                                                            int
	TrustProxy                                                                                                                                                                          bool
}

func LoadConfig() (Config, error) {
	get := func(k, d string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return d
	}
	c := Config{DatabaseURL: get("DATABASE_URL", ""), AccessSecret: get("JWT_ACCESS_SECRET", ""), RefreshSecret: get("JWT_REFRESH_SECRET", ""), PublicOrigin: get("PUBLIC_ORIGIN", ""), CORSOrigins: get("CORS_ORIGINS", "http://localhost:8080"), Port: get("PORT", "4000"), CookieSecure: get("COOKIE_SECURE", "false") == "true", StorageEndpoint: get("S3_ENDPOINT", ""), StoragePublicEndpoint: get("S3_PUBLIC_ENDPOINT", ""), StorageRegion: get("S3_REGION", "us-east-1"), StorageBucket: get("S3_BUCKET", "tutor-private"), StorageAccessKey: get("S3_ACCESS_KEY", ""), StorageSecretKey: get("S3_SECRET_KEY", ""), RateLimit: 120, AuthRateLimit: 8, TrustProxy: get("TRUST_PROXY", "false") == "true"}
	if len(c.AccessSecret) < 32 || len(c.RefreshSecret) < 32 || c.AccessSecret == c.RefreshSecret {
		return c, errors.New("configure distinct JWT secrets of at least 32 characters")
	}
	for _, v := range []string{c.DatabaseURL, c.PublicOrigin, c.StorageEndpoint, c.StoragePublicEndpoint} {
		u, err := url.Parse(v)
		if err != nil || u.Host == "" {
			return c, errors.New("configure database, origin and storage URLs")
		}
	}
	if c.StorageAccessKey == "" || c.StorageSecretKey == "" {
		return c, errors.New("configure storage credentials")
	}
	if os.Getenv("NODE_ENV") == "production" && (!c.CookieSecure || !strings.HasPrefix(c.PublicOrigin, "https://")) {
		return c, errors.New("production requires HTTPS and secure cookies")
	}
	return c, nil
}

type Storage interface {
	Download(context.Context, string, string) (string, error)
	Upload(context.Context, string, string, int) (Row, error)
	Inspect(context.Context, string) (int64, string, error)
	Read(context.Context, string, int64) ([]byte, error)
	Put(context.Context, string, []byte, string) error
	Delete(context.Context, string) error
	Healthy(context.Context) error
}
type Actor struct {
	ID, Role, SessionID string
	MustChangePassword  bool
}
type Context struct {
	W         http.ResponseWriter
	R         *http.Request
	Store     Store
	Actor     *Actor
	App       *App
	RequestID string
}

func (c *Context) ID() string { return c.R.PathValue("id") }
func (c *Context) Body(allowed ...string) (Row, error) {
	dec := json.NewDecoder(http.MaxBytesReader(c.W, c.R.Body, 1024*1024))
	var data Row
	err := dec.Decode(&data)
	if err == io.EOF {
		return Row{}, nil
	}
	if err != nil || data == nil {
		return nil, Error(400, "Некорректный JSON")
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		return nil, Error(400, "Некорректный JSON")
	}
	for k := range data {
		found := false
		for _, a := range allowed {
			if a == k {
				found = true
				break
			}
		}
		if !found {
			return nil, Field(k, "Поле не разрешено")
		}
	}
	return data, nil
}

type HTTPError struct {
	Status  int
	Message string
	Fields  map[string]string
	Code    string
}

func (e *HTTPError) Error() string       { return e.Message }
func Error(status int, msg string) error { return &HTTPError{Status: status, Message: msg} }
func Field(key, msg string) error        { return FieldStatus(400, key, msg) }
func FieldStatus(status int, key, msg string) error {
	return &HTTPError{Status: status, Message: msg, Fields: map[string]string{key: msg}}
}
func Page(c *Context) (int, int, error) {
	p, size := 1, 20
	var err error
	if v := c.R.URL.Query().Get("page"); c.R.URL.Query().Has("page") {
		p, err = strconv.Atoi(v)
		if err != nil || p < 1 || p > 10000000 {
			return 0, 0, Field("page", "Некорректная страница")
		}
	}
	if v := c.R.URL.Query().Get("pageSize"); c.R.URL.Query().Has("pageSize") {
		size, err = strconv.Atoi(v)
		if err != nil || size < 1 || size > 100 {
			return 0, 0, Field("pageSize", "От 1 до 100 записей")
		}
	}
	return p, size, nil
}
func Paged(items []Row, total, page, size int) Row {
	if items == nil {
		items = []Row{}
	}
	return Row{"items": items, "total": total, "page": page, "pageSize": size}
}

type Handler func(*Context) (any, error)
type Route struct{ Method, Path, Roles string }
type App struct {
	Store             Store
	Config            Config
	Storage           Storage
	Authenticate      func(*Context) (*Actor, error)
	Access, OwnCourse func(*Context, string) (Row, error)
	Routes            []Route
	mux               *http.ServeMux
	mu                sync.Mutex
	limits            map[string]bucket
}
type bucket struct {
	until time.Time
	count int
}

func New(store Store, c Config, storage Storage) *App {
	return &App{Store: store, Config: c, Storage: storage, mux: http.NewServeMux(), limits: map[string]bucket{}}
}

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var csrfPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

func ValidUUID(s string) bool { return uuidPattern.MatchString(s) }
func (a *App) Handle(method, path, roles string, fn Handler) {
	a.Routes = append(a.Routes, Route{method, path, roles})
	a.mux.HandleFunc(method+" "+path, func(w http.ResponseWriter, r *http.Request) {
		c := &Context{W: w, R: r, Store: Store{DB: a.Store.DB, Ctx: r.Context()}, App: a, RequestID: w.Header().Get("X-Request-ID")}
		if id := c.ID(); id != "" && !ValidUUID(id) {
			a.fail(c, Field("id", "Некорректный ID"))
			return
		}
		if roles != "*" {
			if a.Authenticate == nil {
				a.fail(c, Error(503, "Сервер не готов"))
				return
			}
			actor, err := a.Authenticate(c)
			if err != nil {
				a.fail(c, err)
				return
			}
			c.Actor = actor
			if actor.MustChangePassword && path != "/api/v1/auth/me" && path != "/api/v1/auth/logout" && path != "/api/v1/auth/change-password" {
				a.fail(c, Error(403, "Сначала смените назначенный пароль"))
				return
			}
			if roles != "" {
				allowed := false
				for _, role := range strings.Split(roles, ",") {
					if role == actor.Role {
						allowed = true
					}
				}
				if !allowed {
					a.fail(c, Error(403, "Недостаточно прав"))
					return
				}
			}
		}
		result, err := fn(c)
		if err != nil {
			a.fail(c, err)
			return
		}
		status := 200
		if method == "POST" {
			status = 201
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(status)
		if result == nil {
			result = OK()
		}
		_ = json.NewEncoder(w).Encode(result)
	})
}
func (a *App) fail(c *Context, err error) {
	status, msg := 500, "Внутренняя ошибка сервера"
	fields := map[string]string(nil)
	code := ""
	var h *HTTPError
	var pg *pgconn.PgError
	if errors.As(err, &h) {
		status, msg, fields, code = h.Status, h.Message, h.Fields, h.Code
	} else if errors.As(err, &pg) {
		switch pg.Code {
		case "23505", "23503", "23514", "40001", "40P01":
			status, msg = 409, "Конфликт данных. Обновите страницу и повторите действие"
		case "22P02", "22003", "22007":
			status, msg = 400, "Некорректные данные запроса"
		}
	}
	if status == 500 {
		log.Printf("request=%s error_type=%T", c.RequestID, err)
	}
	if code == "" {
		code = fmt.Sprintf("HTTP_%d", status)
	}
	body := Row{"code": code, "message": msg, "requestId": c.RequestID}
	if fields != nil {
		body["fields"] = fields
	}
	c.W.Header().Set("Content-Type", "application/json; charset=utf-8")
	c.W.WriteHeader(status)
	_ = json.NewEncoder(c.W).Encode(body)
}
func (a *App) rate(r *http.Request) bool {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if a.Config.TrustProxy {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			parts := strings.Split(forwarded, ",")
			ip = strings.TrimSpace(parts[len(parts)-1])
		}
	}
	limit := a.Config.RateLimit
	_, routePattern := a.mux.Handler(r)
	key := ip + "|" + routePattern
	if r.URL.Path == "/api/v1/auth/login" || r.URL.Path == "/api/v1/auth/register" {
		limit = a.Config.AuthRateLimit
		key += "|" + r.URL.Path
	}
	if limit <= 0 {
		limit = 120
	}
	now := time.Now()
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.limits) > 10000 {
		for k, v := range a.limits {
			if v.until.Before(now) {
				delete(a.limits, k)
			}
		}
	}
	b := a.limits[key]
	if !b.until.After(now) {
		b = bucket{until: now.Add(time.Minute)}
	}
	b.count++
	a.limits[key] = b
	return b.count <= limit
}
func (a *App) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := NewID()
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "no-referrer")
		c := &Context{W: w, R: r, App: a, RequestID: requestID}
		defer func() {
			if recovered := recover(); recovered != nil {
				a.fail(c, errors.New("handler panic"))
			}
		}()
		origin := r.Header.Get("Origin")
		for _, allowed := range strings.Split(a.Config.CORSOrigins, ",") {
			if origin != "" && origin == strings.TrimSpace(allowed) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Add("Vary", "Origin")
			}
		}
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,X-CSRF-Token,Idempotency-Key")
			w.WriteHeader(204)
			return
		}
		if !a.rate(r) {
			a.fail(c, Error(429, "Слишком много запросов. Повторите позже"))
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			cookie, err := r.Cookie("csrf")
			header := r.Header.Get("X-CSRF-Token")
			if err != nil || origin != a.Config.PublicOrigin || !csrfPattern.MatchString(cookie.Value) || !csrfPattern.MatchString(header) || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(header)) != 1 {
				a.fail(c, &HTTPError{Status: 403, Code: "CSRF_FAILED", Message: "Обновите страницу и повторите действие"})
				return
			}
		}
		_, pattern := a.mux.Handler(r)
		if pattern == "" {
			a.fail(c, Error(404, "Маршрут не найден"))
			return
		}
		a.mux.ServeHTTP(w, r)
	})
}
func RandomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func (a *App) Raw(method, path string, h http.Handler) { a.mux.Handle(method+" "+path, h) }
