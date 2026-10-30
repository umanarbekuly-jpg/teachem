package learning_test

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
	"teachem/api-go/internal/accounts"
	"teachem/api-go/internal/commerce"
	"teachem/api-go/internal/core"
	"teachem/api-go/internal/learning"
)

type memoryFile struct {
	body []byte
	mime string
}
type memoryStorage struct{ files map[string]memoryFile }

func (m *memoryStorage) Download(_ context.Context, key, name string) (string, error) {
	return "https://files.example.test/" + key, nil
}
func (m *memoryStorage) Upload(_ context.Context, key, mime string, size int) (core.Row, error) {
	return core.Row{"url": "https://files.example.test/upload", "fields": core.Row{"key": key, "Content-Type": mime}}, nil
}
func (m *memoryStorage) Inspect(_ context.Context, key string) (int64, string, error) {
	f := m.files[key]
	return int64(len(f.body)), f.mime, nil
}
func (m *memoryStorage) Read(_ context.Context, key string, _ int64) ([]byte, error) {
	return m.files[key].body, nil
}
func (m *memoryStorage) Put(_ context.Context, key string, b []byte, mime string) error {
	m.files[key] = memoryFile{append([]byte{}, b...), mime}
	return nil
}
func (m *memoryStorage) Delete(_ context.Context, key string) error { delete(m.files, key); return nil }
func (m *memoryStorage) Healthy(context.Context) error              { return nil }

type browser struct {
	client     *http.Client
	csrf, base string
	t          *testing.T
}

func (b *browser) call(method, path string, body any, status int) core.Row {
	b.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if e := json.NewEncoder(&buf).Encode(body); e != nil {
			b.t.Fatal(e)
		}
	}
	req, e := http.NewRequest(method, b.base+"/api/v1/"+path, &buf)
	if e != nil {
		b.t.Fatal(e)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:8080")
	if b.csrf != "" {
		req.Header.Set("X-CSRF-Token", b.csrf)
	}
	res, e := b.client.Do(req)
	if e != nil {
		b.t.Fatal(e)
	}
	defer res.Body.Close()
	var out core.Row
	if e = json.NewDecoder(res.Body).Decode(&out); e != nil {
		b.t.Fatalf("%s %s: invalid JSON: %v", method, path, e)
	}
	if res.StatusCode != status {
		b.t.Fatalf("%s %s: got %d want %d; error %v", method, path, res.StatusCode, status, out["message"])
	}
	return out
}
func newBrowser(t *testing.T, base string) *browser {
	jar, _ := cookiejar.New(nil)
	b := &browser{t: t, base: base, client: &http.Client{Jar: jar}}
	b.csrf = core.Str(b.call("GET", "auth/csrf", nil, 200), "token")
	return b
}
func getRows(v any) []core.Row {
	out := []core.Row{}
	for _, v := range v.([]any) {
		out = append(out, v.(map[string]any))
	}
	return out
}
func TestLearningHTTPPersistence(t *testing.T) {
	dbURL := os.Getenv("TEACHEM_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEACHEM_TEST_DATABASE_URL is required")
	}
	u, e := url.Parse(dbURL)
	if e != nil || !strings.Contains(u.Path, "test") {
		t.Fatal("isolated test database required")
	}
	store, e := core.Open(context.Background(), dbURL)
	if e != nil {
		t.Fatal(e)
	}
	defer store.DB.(*pgxpool.Pool).Close()
	storage := &memoryStorage{files: map[string]memoryFile{}}
	cfg := core.Config{PublicOrigin: "http://localhost:8080", CORSOrigins: "http://localhost:8080", AccessSecret: strings.Repeat("a", 40), RefreshSecret: strings.Repeat("b", 40), RateLimit: 10000, AuthRateLimit: 10000}
	app := core.New(store, cfg, storage)
	accounts.Register(app)
	learning.Register(app)
	commerce.Register(app)
	server := httptest.NewServer(app.Handler())
	defer server.Close()
	password := "learning-integration-password"
	digest, e := bcrypt.GenerateFromPassword([]byte(password), 12)
	if e != nil {
		t.Fatal(e)
	}
	owners, e := store.Rows(`SELECT id FROM "User" WHERE role='SUPERADMIN'`)
	if e != nil {
		t.Fatal(e)
	}
	if len(owners) == 0 {
		_, e = store.Insert("User", core.Row{"name": "Test Owner", "email": "supadmin@teachem", "role": "SUPERADMIN", "passwordHash": string(digest)})
	} else {
		_, e = store.Update("User", core.Str(owners[0], "id"), core.Row{"email": "supadmin@teachem", "passwordHash": string(digest), "mustChangePassword": false})
	}
	if e != nil {
		t.Fatal(e)
	}
	admin := newBrowser(t, server.URL)
	admin.call("POST", "auth/login", core.Row{"email": "supadmin@teachem", "password": password}, 201)
	admin.call("PATCH", "admin/settings", core.Row{"commissionBps": 1000, "paymentDetails": "Test transfer only"}, 200)
	tutor, other, student, outsider := newBrowser(t, server.URL), newBrowser(t, server.URL), newBrowser(t, server.URL), newBrowser(t, server.URL)
	var studentID string
	for _, x := range []struct {
		b    *browser
		role string
	}{{tutor, "tutor"}, {other, "tutor"}, {student, "student"}, {outsider, "student"}} {
		r := x.b.call("POST", "auth/register", core.Row{"name": "Learning fixture", "email": core.NewID() + "@example.test", "password": password, "role": x.role}, 201)
		if x.b == student {
			studentID = core.Str(r, "id")
		}
	}
	var pngData bytes.Buffer
	if e = png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 20, 10))); e != nil {
		t.Fatal(e)
	}
	upload := tutor.call("POST", "files/uploads", core.Row{"purpose": "course_cover", "originalName": "cover.png", "mimeType": "image/png", "sizeBytes": pngData.Len()}, 201)
	key := core.Str(upload["fields"].(map[string]any), "key")
	storage.files[key] = memoryFile{pngData.Bytes(), "image/png"}
	coverID := core.Str(upload, "id")
	tutor.call("POST", "files/"+coverID+"/complete", core.Row{}, 201)
	course := tutor.call("POST", "courses", core.Row{"title": "Integration course", "description": "Detailed course for learning integration verification", "subject": "  Шахматы   и стратегия ", "durationDays": 45, "monthlyPriceMinor": 500000, "tags": []string{"#Шахматы", "Practice", "AI_2026"}, "coverAssetId": coverID}, 201)
	courseID := core.Str(course, "id")
	if core.Int(course, "durationDays") != 45 || core.Str(course, "subject") != "Шахматы и стратегия" || core.Str(course, "coverUrl") == "" {
		t.Fatal("course configuration lost")
	}
	other.call("PATCH", "courses/"+courseID, core.Row{"title": "Stolen"}, 403)
	student.call("GET", "courses/"+courseID+"/edit", nil, 403)
	tutor.call("PATCH", "courses/"+courseID, core.Row{"tags": []string{"a", "b", "c", "d"}}, 400)
	tutor.call("PATCH", "courses/"+courseID, core.Row{"tags": []string{"Код", "#код"}}, 400)
	tutor.call("POST", "courses/"+courseID+"/publish", core.Row{}, 201)
	for _, query := range []string{"search=" + url.QueryEscape("#ШАХМАТЫ"), "search=" + url.QueryEscape("шахматы"), "tag=practice&subject=" + url.QueryEscape("шахматы и стратегия"), "tag=practice&priceFromMinor=500000&priceToMinor=500000"} {
		found := outsider.call("GET", "courses?"+query, nil, 200)
		if core.Int(found, "total") < 1 {
			t.Fatal("catalog filter missed course", query)
		}
	}
	edit := tutor.call("GET", "courses/"+courseID+"/edit", nil, 200)
	if len(edit["tags"].([]any)) != 3 || core.Str(edit, "coverAssetId") != coverID {
		t.Fatal("edit lost course metadata")
	}
	tutor.call("PATCH", "courses/"+courseID, core.Row{"coverAssetId": nil}, 200)
	fallback := outsider.call("GET", "courses/"+courseID, nil, 200)
	if fallback["coverUrl"] != nil {
		t.Fatal("cover removal ignored")
	}
	enrollment := student.call("POST", "courses/"+courseID+"/enrollments", core.Row{}, 201)
	enrollmentID := core.Str(enrollment, "id")
	student.call("GET", "learning/courses/"+courseID, nil, 403)
	payment := student.call("POST", "enrollments/"+enrollmentID+"/payments", core.Row{"idempotencyKey": core.NewID()}, 201)
	paymentID := core.Str(payment, "id")
	tutor.call("PATCH", "courses/"+courseID, core.Row{"durationDays": 7, "monthlyPriceMinor": 900000}, 200)
	student.call("POST", "payments/"+paymentID+"/submit", core.Row{}, 201)
	admin.call("POST", "admin/payments/"+paymentID+"/approve", core.Row{}, 201)
	paid, e := store.Find("Payment", paymentID)
	if e != nil {
		t.Fatal(e)
	}
	if core.Int(paid, "durationDays") != 45 || core.Int(paid, "amountMinor") != 500000 {
		t.Fatal("existing purchase terms changed")
	}
	access, e := store.Find("Enrollment", enrollmentID)
	if e != nil {
		t.Fatal(e)
	}
	start, _ := time.Parse(time.RFC3339Nano, core.Str(access, "accessStartsAt"))
	end, _ := time.Parse(time.RFC3339Nano, core.Str(access, "accessExpiresAt"))
	if end.Sub(start) != 45*24*time.Hour {
		t.Fatalf("access duration incorrect: %v", end.Sub(start))
	}
	student.call("GET", "learning/courses/"+courseID, nil, 200)
	outsider.call("GET", "learning/courses/"+courseID, nil, 403)
	material := tutor.call("POST", "courses/"+courseID+"/materials", core.Row{"title": "Learning link", "kind": "link", "url": "https://example.test/lesson"}, 201)
	materialID := core.Str(material, "id")
	student.call("GET", "courses/"+courseID+"/materials", nil, 200)
	student.call("GET", "courses/"+courseID+"/materials?unknown=value", nil, 400)
	outsider.call("GET", "courses/"+courseID+"/materials", nil, 403)
	other.call("PATCH", "materials/"+materialID, core.Row{"title": "Stolen"}, 403)
	tutor.call("PATCH", "materials/"+materialID, core.Row{"title": "Updated learning link"}, 200)
	pdfBytes := []byte("%PDF-1.7\nsynthetic material fixture")
	pdfUpload := tutor.call("POST", "files/uploads", core.Row{"purpose": "material", "originalName": "lesson.pdf", "mimeType": "application/pdf", "sizeBytes": len(pdfBytes)}, 201)
	pdfKey := core.Str(pdfUpload["fields"].(map[string]any), "key")
	storage.files[pdfKey] = memoryFile{pdfBytes, "application/pdf"}
	pdfID := core.Str(pdfUpload, "id")
	tutor.call("POST", "files/"+pdfID+"/complete", core.Row{}, 201)
	tutor.call("POST", "courses/"+courseID+"/materials", core.Row{"title": "Learning PDF", "kind": "file", "fileAssetId": pdfID}, 201)
	student.call("GET", "files/"+pdfID+"/download", nil, 200)
	outsider.call("GET", "files/"+pdfID+"/download", nil, 403)
	session := tutor.call("POST", "courses/"+courseID+"/sessions", core.Row{"topic": "Lesson one", "startsAt": time.Now().Add(time.Hour).UTC().Format(time.RFC3339), "durationMinutes": 45, "joinUrl": "https://meet.google.com/abc-defg-hij"}, 201)
	sessionID := core.Str(session, "id")
	if _, leaked := session["joinUrl"]; leaked {
		t.Fatal("meeting URL leaked in schedule")
	}
	student.call("GET", "sessions/"+sessionID+"/join", nil, 200)
	outsider.call("GET", "sessions/"+sessionID+"/join", nil, 403)
	student.call("GET", "sessions/me", nil, 200)
	tutor.call("PATCH", "sessions/"+sessionID, core.Row{"topic": "Rescheduled lesson", "durationMinutes": 60}, 200)
	tutor.call("POST", "sessions/"+sessionID+"/cancel", core.Row{}, 201)
	student.call("GET", "sessions/"+sessionID+"/join", nil, 400)
	test := tutor.call("POST", "courses/"+courseID+"/tests", core.Row{"title": "Knowledge check", "questions": []any{core.Row{"text": "Correct option?", "type": "single", "points": 5, "options": []any{core.Row{"text": "Yes", "isCorrect": true}, core.Row{"text": "No", "isCorrect": false}}}}}, 201)
	testID := core.Str(test, "id")
	question := getRows(test["questions"])[0]
	qid := core.Str(question, "id")
	correct := core.Str(getRows(question["options"])[0], "id")
	tutor.call("POST", "tests/"+testID+"/publish", core.Row{}, 201)
	tutor.call("PATCH", "tests/"+testID, core.Row{"title": "Changed after publishing"}, 400)
	studentView := student.call("GET", "tests/"+testID, nil, 200)
	for _, q := range getRows(studentView["questions"]) {
		for _, o := range getRows(q["options"]) {
			if _, ok := o["isCorrect"]; ok {
				t.Fatal("answer key leaked")
			}
		}
	}
	outsider.call("POST", "tests/"+testID+"/attempts", core.Row{}, 403)
	attempt := student.call("POST", "tests/"+testID+"/attempts", core.Row{}, 201)
	attemptID := core.Str(attempt, "id")
	outsider.call("PUT", "test-attempts/"+attemptID+"/answers", core.Row{"answers": []any{}}, 403)
	student.call("PUT", "test-attempts/"+attemptID+"/answers", core.Row{"answers": []any{core.Row{"questionId": qid, "optionIds": []string{core.NewID()}}}}, 400)
	student.call("PUT", "test-attempts/"+attemptID+"/answers", core.Row{"answers": []any{core.Row{"questionId": qid, "optionIds": []string{correct}}}}, 200)
	result := student.call("POST", "test-attempts/"+attemptID+"/submit", core.Row{}, 201)
	if core.Int(result, "score") != 5 || core.Int(result, "maxScore") != 5 {
		t.Fatal("scoring incorrect")
	}
	student.call("POST", "test-attempts/"+attemptID+"/submit", core.Row{}, 201)
	student.call("PUT", "test-attempts/"+attemptID+"/answers", core.Row{"answers": []any{}}, 400)
	tutor.call("GET", "tests/"+testID+"/attempts", nil, 200)
	outsider.call("GET", "test-attempts/"+attemptID, nil, 403)
	student.call("GET", "test-attempts/me", nil, 200)
	copy := tutor.call("POST", "tests/"+testID+"/copy", core.Row{}, 201)
	if core.Str(copy, "status") != "draft" || core.Str(copy, "id") == testID {
		t.Fatal("copy not independent")
	}
	copyID := core.Str(copy, "id")
	tutor.call("PATCH", "tests/"+copyID, core.Row{"title": "Edited draft copy"}, 200)
	listed := student.call("GET", "courses/"+courseID+"/tests", nil, 200)
	for _, test := range getRows(listed["items"]) {
		if core.Str(test, "id") == copyID {
			t.Fatal("student saw draft test")
		}
	}
	tutor.call("DELETE", "tests/"+copyID, nil, 200)
	tutor.call("DELETE", "materials/"+materialID, nil, 200)
	persisted, e := store.Find("TestAttempt", attemptID)
	if e != nil || core.Int(persisted, "score") != 5 || core.Str(persisted, "studentId") != studentID {
		t.Fatal("attempt not persisted")
	}
	// A fresh application process uses existing DB and sessions without resetting any data.
	restarted := core.New(store, cfg, storage)
	accounts.Register(restarted)
	learning.Register(restarted)
	commerce.Register(restarted)
	secondServer := httptest.NewServer(restarted.Handler())
	defer secondServer.Close()
	student.base = secondServer.URL
	student.call("GET", "users/me", nil, 200)
	after := student.call("GET", "test-attempts/"+attemptID, nil, 200)
	if core.Int(after, "score") != 5 {
		t.Fatal("state lost after restart")
	}
	draft := tutor.call("POST", "courses", core.Row{"title": "Draft to remove", "description": "Preserve deleted draft as a reversible record", "subject": "Математика", "monthlyPriceMinor": 1000}, 201)
	if core.Int(draft, "durationDays") != 30 || draft["coverUrl"] != nil {
		t.Fatal("legacy course defaults changed")
	}
	draftID := core.Str(draft, "id")
	tutor.call("DELETE", "courses/"+draftID, nil, 200)
	deleted, e := store.Find("Course", draftID)
	if e != nil || deleted["deletedAt"] == nil {
		t.Fatal("draft removal was not soft deletion")
	}
	archived := tutor.call("DELETE", "courses/"+courseID, nil, 200)
	if core.Str(archived, "status") != "archived" || archived["deletedAt"] != nil {
		t.Fatal("published removal should archive")
	}
	outsider.call("GET", "courses/"+courseID, nil, 404)
	student.call("GET", "learning/courses/"+courseID, nil, 200)
}
