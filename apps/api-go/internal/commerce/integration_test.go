package commerce_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
	"teachem/api-go/internal/accounts"
	"teachem/api-go/internal/commerce"
	"teachem/api-go/internal/core"
	"teachem/api-go/internal/learning"
)

type storedObject struct {
	data []byte
	mime string
}
type memoryStorage struct {
	mu    sync.Mutex
	files map[string]storedObject
}

func (s *memoryStorage) Upload(_ context.Context, key, mime string, _ int) (core.Row, error) {
	return core.Row{"url": "https://storage.example.test/upload", "fields": core.Row{"key": key, "Content-Type": mime}}, nil
}
func (s *memoryStorage) Inspect(_ context.Context, key string) (int64, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.files[key]
	if !ok {
		return 0, "", fmt.Errorf("missing fixture")
	}
	return int64(len(f.data)), f.mime, nil
}
func (s *memoryStorage) Read(_ context.Context, key string, max int64) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.files[key]
	if !ok || int64(len(f.data)) > max {
		return nil, fmt.Errorf("invalid fixture")
	}
	return append([]byte(nil), f.data...), nil
}
func (s *memoryStorage) Put(_ context.Context, key string, body []byte, mime string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.files[key] = storedObject{append([]byte(nil), body...), mime}
	return nil
}
func (s *memoryStorage) Download(_ context.Context, key, _ string) (string, error) {
	return "https://storage.example.test/" + key, nil
}
func (s *memoryStorage) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.files, key)
	return nil
}
func (s *memoryStorage) Healthy(context.Context) error { return nil }

type testClient struct {
	client     *http.Client
	base, csrf string
}

func (a *testClient) call(method, path string, body any) (int, core.Row, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, a.base+"/api/v1"+path, reader)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Origin", "http://localhost:8080")
	req.Header.Set("Content-Type", "application/json")
	if a.csrf != "" {
		req.Header.Set("X-CSRF-Token", a.csrf)
	}
	response, err := a.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	result := core.Row{}
	err = json.NewDecoder(response.Body).Decode(&result)
	return response.StatusCode, result, err
}
func (a *testClient) require(t *testing.T, status int, method, path string, body any) core.Row {
	t.Helper()
	code, result, err := a.call(method, path, body)
	if err != nil {
		t.Fatal(err)
	}
	if code != status {
		t.Fatalf("%s %s: expected %d got %d: %v", method, path, status, code, result)
	}
	return result
}
func newClient(t *testing.T, base string) *testClient {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	a := &testClient{client: &http.Client{Jar: jar, Timeout: 20 * time.Second}, base: base}
	r := a.require(t, 200, "GET", "/auth/csrf", nil)
	a.csrf = core.Str(r, "token")
	return a
}

func TestCommerceHTTPWithPostgres(t *testing.T) {
	databaseURL := os.Getenv("TEACHEM_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEACHEM_TEST_DATABASE_URL is required for PostgreSQL integration")
	}
	u, err := url.Parse(databaseURL)
	if err != nil || !strings.Contains(strings.ToLower(u.Path), "test") {
		t.Fatal("only an explicitly named test database is allowed")
	}
	store, err := core.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.DB.(*pgxpool.Pool).Close() })
	storage := &memoryStorage{files: map[string]storedObject{}}
	app := core.New(store, core.Config{AccessSecret: strings.Repeat("a", 48), RefreshSecret: strings.Repeat("b", 48), PublicOrigin: "http://localhost:8080", CORSOrigins: "http://localhost:8080", RateLimit: 10000, AuthRateLimit: 10000}, storage)
	accounts.Register(app)
	learning.Register(app)
	commerce.Register(app)
	server := httptest.NewServer(app.Handler())
	defer server.Close()
	const password = "commerce-isolated-test-password"
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		t.Fatal(err)
	}
	owners, err := store.Rows(`SELECT id,"authVersion" FROM "User" WHERE role='SUPERADMIN'`)
	if err != nil {
		t.Fatal(err)
	}
	ownerEmail := "commerce-owner-" + core.NewID() + "@example.test"
	var owner core.Row
	if len(owners) == 0 {
		owner, err = store.Insert("User", core.Row{"name": "Commerce test owner", "email": ownerEmail, "passwordHash": string(hashed), "role": "SUPERADMIN"})
	} else {
		owner, err = store.Update("User", core.Str(owners[0], "id"), core.Row{"email": ownerEmail, "passwordHash": string(hashed), "mustChangePassword": false, "authVersion": core.Int(owners[0], "authVersion") + 1})
	}
	if err != nil {
		t.Fatal(err)
	}
	admin := newClient(t, server.URL)
	admin.require(t, 201, "POST", "/auth/login", core.Row{"email": ownerEmail, "password": password})
	tutor, student, stranger := newClient(t, server.URL), newClient(t, server.URL), newClient(t, server.URL)
	for _, pair := range []struct {
		a    *testClient
		role string
	}{{tutor, "tutor"}, {student, "student"}, {stranger, "student"}} {
		pair.a.require(t, 201, "POST", "/auth/register", core.Row{"email": "commerce-" + core.NewID() + "@example.test", "password": password, "name": "Commerce test", "role": pair.role})
	}
	tutorID := core.Str(tutor.require(t, 200, "GET", "/auth/me", nil), "id")
	studentID := core.Str(student.require(t, 200, "GET", "/auth/me", nil), "id")
	admin.require(t, 200, "PATCH", "/admin/settings", core.Row{"commissionBps": 1250, "paymentDetails": "Test-only payment instructions; no real transfer"})

	t.Run("file validation and immutable ready objects", func(t *testing.T) {
		var pngData bytes.Buffer
		if err = png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
			t.Fatal(err)
		}
		created := tutor.require(t, 201, "POST", "/files/uploads", core.Row{"purpose": "course_cover", "originalName": "cover.png", "mimeType": "image/png", "sizeBytes": pngData.Len()})
		id := core.Str(created, "id")
		file, err := store.Find("FileAsset", id)
		if err != nil {
			t.Fatal(err)
		}
		pending := core.Str(file, "objectKey")
		if err = storage.Put(context.Background(), pending, pngData.Bytes(), "image/png"); err != nil {
			t.Fatal(err)
		}
		stranger.require(t, 403, "POST", "/files/"+id+"/complete", core.Row{})
		tutor.require(t, 201, "POST", "/files/"+id+"/complete", core.Row{})
		ready, err := store.Find("FileAsset", id)
		if err != nil {
			t.Fatal(err)
		}
		if core.Str(ready, "objectKey") == pending {
			t.Fatal("completed file retained writable pending key")
		}
		_ = storage.Put(context.Background(), pending, bytes.Repeat([]byte("x"), pngData.Len()), "image/png")
		actual, err := storage.Read(context.Background(), core.Str(ready, "objectKey"), 5*1024*1024)
		if err != nil || !bytes.Equal(actual, pngData.Bytes()) {
			t.Fatal("ready bytes were overwritten")
		}
		tutor.require(t, 201, "POST", "/files/"+id+"/complete", nil)
		stranger.require(t, 403, "GET", "/files/"+id+"/download", nil)
		tutor.require(t, 200, "GET", "/files/"+id+"/download", nil)
		forged := []byte{137, 80, 78, 71, 13, 10, 26, 10}
		r := tutor.require(t, 201, "POST", "/files/uploads", core.Row{"purpose": "course_cover", "originalName": "forged.png", "mimeType": "image/png", "sizeBytes": len(forged)})
		bad, err := store.Find("FileAsset", core.Str(r, "id"))
		if err != nil {
			t.Fatal(err)
		}
		_ = storage.Put(context.Background(), core.Str(bad, "objectKey"), forged, "image/png")
		tutor.require(t, 400, "POST", "/files/"+core.Str(r, "id")+"/complete", nil)
		tutor.require(t, 400, "POST", "/files/uploads", core.Row{"purpose": "course_cover", "originalName": "large.png", "mimeType": "image/png", "sizeBytes": 5*1024*1024 + 1})
		student.require(t, 403, "POST", "/files/uploads", core.Row{"purpose": "material", "originalName": "x.pdf", "mimeType": "application/pdf", "sizeBytes": 10})
	})

	course, err := store.Insert("Course", core.Row{"tutorId": tutorID, "title": "Commerce 45-day course", "description": "A complete isolated test course description.", "subject": "Математика", "durationDays": 45, "monthlyPriceMinor": 10001, "status": "published"})
	if err != nil {
		t.Fatal(err)
	}
	enrollment := student.require(t, 201, "POST", "/courses/"+core.Str(course, "id")+"/enrollments", nil)
	enrollmentID := core.Str(enrollment, "id")
	key := core.NewID()
	payment := student.require(t, 201, "POST", "/enrollments/"+enrollmentID+"/payments", core.Row{"idempotencyKey": key})
	paymentID := core.Str(payment, "id")
	repeated := student.require(t, 201, "POST", "/enrollments/"+enrollmentID+"/payments", core.Row{"idempotencyKey": key})
	if core.Str(repeated, "id") != paymentID {
		t.Fatal("idempotency created a second payment")
	}
	if _, err = store.Update("Course", core.Str(course, "id"), core.Row{"durationDays": 7, "monthlyPriceMinor": 30000}); err != nil {
		t.Fatal(err)
	}
	student.require(t, 403, "POST", "/admin/payments/"+paymentID+"/approve", nil)
	stranger.require(t, 403, "GET", "/payments/"+paymentID, nil)
	student.require(t, 200, "GET", "/payments/"+paymentID+"/instructions", nil)
	student.require(t, 201, "POST", "/payments/"+paymentID+"/submit", core.Row{})

	t.Run("concurrent approval uses immutable purchase terms once", func(t *testing.T) {
		results := make(chan error, 2)
		for i := 0; i < 2; i++ {
			go func() {
				code, _, err := admin.call("POST", "/admin/payments/"+paymentID+"/approve", nil)
				if err == nil && code != 201 {
					err = fmt.Errorf("approval HTTP %d", code)
				}
				results <- err
			}()
		}
		for i := 0; i < 2; i++ {
			if err := <-results; err != nil {
				t.Fatal(err)
			}
		}
		payouts, err := store.Rows(`SELECT * FROM "Payout" WHERE "paymentId"=$1`, paymentID)
		if err != nil || len(payouts) != 1 {
			t.Fatalf("payout count %d, error %v", len(payouts), err)
		}
		if core.Int(payouts[0], "netMinor") != 8751 {
			t.Fatal("incorrect snapshotted commission")
		}
		e, err := store.Find("Enrollment", enrollmentID)
		if err != nil {
			t.Fatal(err)
		}
		start, err := time.Parse(time.RFC3339Nano, core.Str(e, "accessStartsAt"))
		if err != nil {
			t.Fatal(err)
		}
		expiry, err := time.Parse(time.RFC3339Nano, core.Str(e, "accessExpiresAt"))
		if err != nil {
			t.Fatal(err)
		}
		if expiry.Sub(start) != 45*24*time.Hour {
			t.Fatalf("access length changed: %v", expiry.Sub(start))
		}
		p, err := store.Find("Payment", paymentID)
		if err != nil {
			t.Fatal(err)
		}
		if core.Int(p, "durationDays") != 45 || core.Int(p, "amountMinor") != 10001 {
			t.Fatal("existing purchase terms changed")
		}
		student.require(t, 200, "GET", "/learning/courses/"+core.Str(course, "id"), nil)
		stranger.require(t, 403, "GET", "/learning/courses/"+core.Str(course, "id"), nil)
		admin.require(t, 201, "POST", "/admin/payouts/"+core.Str(payouts[0], "id")+"/mark-paid", core.Row{"reference": "TEST confirmation"})
		totals := tutor.require(t, 200, "GET", "/tutors/me/finances", nil)
		if core.Int(totals, "paidMinor") < 8751 {
			t.Fatal("finance totals not updated")
		}
	})
	t.Run("account protection and immediate blocking", func(t *testing.T) {
		admin.require(t, 400, "POST", "/admin/users/"+core.Str(owner, "id")+"/block", nil)
		student.require(t, 403, "GET", "/admin/audit-logs", nil)
		student.require(t, 403, "PATCH", "/admin/settings", core.Row{"commissionBps": 0})
		admin.require(t, 201, "POST", "/admin/users/"+studentID+"/block", nil)
		student.require(t, 401, "GET", "/auth/me", nil)
		admin.require(t, 201, "POST", "/admin/users/"+studentID+"/unblock", nil)
		student.require(t, 401, "GET", "/auth/me", nil)
		admin.require(t, 200, "GET", "/admin/audit-logs", nil)
	})
}
