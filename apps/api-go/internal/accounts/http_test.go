package accounts

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
	"teachem/api-go/internal/core"
)

type testBrowser struct {
	client     *http.Client
	base, csrf string
	t          *testing.T
}

func (b *testBrowser) request(method, path string, body core.Row, want int) core.Row {
	b.t.Helper()
	var r io.Reader
	if body != nil {
		data, e := json.Marshal(body)
		if e != nil {
			b.t.Fatal(e)
		}
		r = bytes.NewReader(data)
	}
	req, e := http.NewRequest(method, b.base+"/api/v1/"+path, r)
	if e != nil {
		b.t.Fatal(e)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:8080")
	req.Header.Set("X-CSRF-Token", b.csrf)
	response, e := b.client.Do(req)
	if e != nil {
		b.t.Fatal(e)
	}
	defer response.Body.Close()
	var data core.Row
	if e = json.NewDecoder(response.Body).Decode(&data); e != nil {
		b.t.Fatal(e)
	}
	if response.StatusCode != want {
		b.t.Fatalf("%s %s: status %d want %d (code=%v)", method, path, response.StatusCode, want, data["code"])
	}
	return data
}
func browser(t *testing.T, base string) *testBrowser {
	jar, _ := cookiejar.New(nil)
	b := &testBrowser{client: &http.Client{Jar: jar}, base: base, t: t}
	b.csrf = core.Str(b.request("GET", "auth/csrf", nil, 200), "token")
	return b
}
func TestHTTPAccounts(t *testing.T) {
	database := os.Getenv("TEACHEM_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("set TEACHEM_TEST_DATABASE_URL to an isolated migrated test database")
	}
	parsed, e := url.Parse(database)
	if e != nil || !strings.Contains(strings.ToLower(parsed.Path), "test") {
		t.Fatal("refusing non-test database")
	}
	store, e := core.Open(context.Background(), database)
	if e != nil {
		t.Fatal(e)
	}
	const pw = "synthetic-profile-password"
	const next = "synthetic-replacement-password"
	hash, e := bcrypt.GenerateFromPassword([]byte(pw), 12)
	if e != nil {
		t.Fatal(e)
	}
	owner, e := store.Rows(`SELECT id FROM "User" WHERE role='SUPERADMIN'`)
	if e != nil {
		t.Fatal(e)
	}
	var ownerID string
	if len(owner) == 0 {
		u, e := store.Insert("User", core.Row{"email": "supadmin@teachem", "name": "Test Owner", "role": "SUPERADMIN", "passwordHash": string(hash)})
		if e != nil {
			t.Fatal(e)
		}
		ownerID = core.Str(u, "id")
	} else {
		ownerID = core.Str(owner[0], "id")
		_, e = store.Update("User", ownerID, core.Row{"email": "supadmin@teachem", "passwordHash": string(hash), "mustChangePassword": false})
		if e != nil {
			t.Fatal(e)
		}
	}
	app := core.New(store, core.Config{AccessSecret: strings.Repeat("a", 40), RefreshSecret: strings.Repeat("r", 40), PublicOrigin: "http://localhost:8080", CORSOrigins: "http://localhost:8080", RateLimit: 10000, AuthRateLimit: 10000}, nil)
	Register(app)
	server := httptest.NewServer(app.Handler())
	defer server.Close()
	admin := browser(t, server.URL)
	admin.request("POST", "auth/login", core.Row{"email": "supadmin@teachem", "password": pw}, 201)
	if role := admin.request("GET", "users/me", nil, 200)["role"]; role != "SUPERADMIN" {
		t.Fatal("owner role changed")
	}
	marker := core.NewID()
	studentEmail := "student-" + marker + "@example.test"
	tutorEmail := "tutor-" + marker + "@example.test"
	student := browser(t, server.URL)
	s := student.request("POST", "auth/register", core.Row{"email": studentEmail, "password": pw, "name": "Original full name", "role": "student"}, 201)
	studentID := core.Str(s, "id")
	if _, leak := s["passwordHash"]; leak {
		t.Fatal("password hash exposed")
	}
	tutor := browser(t, server.URL)
	tu := tutor.request("POST", "auth/register", core.Row{"email": tutorEmail, "password": pw, "name": "Tutor Name", "role": "tutor"}, 201)
	tutorID := core.Str(tu, "id")
	tutor.request("PATCH", "tutors/me/profile", core.Row{"education": "Preserved education", "bio": "Professional biography", "subjects": []string{"Math"}, "languages": []string{"Russian"}}, 200)
	for _, b := range []*testBrowser{student, tutor, admin} {
		b.request("GET", "users/me", nil, 200)
		b.request("PATCH", "users/me", core.Row{"name": "Updated name", "surname": "Surname"}, 200)
	}
	p := tutor.request("GET", "tutors/me/profile", nil, 200)
	if p["education"] != "Preserved education" {
		t.Fatal("professional profile lost")
	}
	student.request("GET", "admin/users", nil, 403)
	for _, key := range []string{"id", "userId", "role", "status", "passwordHash"} {
		student.request("PATCH", "users/me", core.Row{"name": "Attempt", key: tutorID}, 400)
	}
	student.request("PATCH", "users/"+tutorID, core.Row{"name": "Attempt"}, 404)
	browser(t, server.URL).request("PATCH", "users/me", core.Row{"name": "Attempt"}, 401)
	student.request("PATCH", "users/me", core.Row{"name": "Updated name", "email": "supadmin@teachem", "currentPassword": pw}, 400)
	student.request("PATCH", "users/me", core.Row{"name": "Updated name", "email": tutorEmail, "currentPassword": pw}, 409)
	newEmail := "new-" + marker + "@example.test"
	student.request("PATCH", "users/me", core.Row{"name": "Updated name", "email": newEmail}, 400)
	student.request("PATCH", "users/me", core.Row{"name": "Updated name", "email": newEmail, "currentPassword": "wrong-password"}, 400)
	student.request("PATCH", "users/me", core.Row{"name": "Updated name", "email": newEmail, "currentPassword": pw}, 200)
	second := browser(t, server.URL)
	second.request("POST", "auth/login", core.Row{"email": studentEmail, "password": pw}, 401)
	second.request("POST", "auth/login", core.Row{"email": newEmail, "password": pw}, 201)
	second.request("POST", "auth/refresh", nil, 201)
	student.request("POST", "auth/change-password", core.Row{"currentPassword": "wrong-password", "newPassword": next, "confirmPassword": next}, 400)
	student.request("POST", "auth/change-password", core.Row{"currentPassword": pw, "newPassword": next, "confirmPassword": "different-password"}, 400)
	student.request("POST", "auth/change-password", core.Row{"currentPassword": pw, "newPassword": next, "confirmPassword": next}, 201)
	second.request("GET", "users/me", nil, 401)
	second.request("POST", "auth/refresh", nil, 401)
	student.request("POST", "auth/login", core.Row{"email": newEmail, "password": pw}, 401)
	student.request("POST", "auth/login", core.Row{"email": newEmail, "password": next}, 201)
	for _, role := range []string{"student", "tutor"} {
		email := role + "-managed-" + marker + "@example.test"
		managed := admin.request("POST", "admin/users", core.Row{"name": "Managed account", "surname": "Family", "email": email, "role": role, "password": pw, "education": "Preserved school"}, 201)
		id := core.Str(managed, "id")
		b := browser(t, server.URL)
		b.request("POST", "auth/login", core.Row{"email": email, "password": pw}, 201)
		b.request("GET", "users/me", nil, 403)
		b.request("POST", "auth/change-password", core.Row{"currentPassword": pw, "newPassword": next, "confirmPassword": next}, 201)
		b.request("POST", "auth/login", core.Row{"email": email, "password": next}, 201)
		admin.request("PATCH", "admin/users/"+id, core.Row{"name": "Managed changed", "surname": "New family", "phone": "+77000000000"}, 200)
		saved := admin.request("GET", "admin/users/"+id, nil, 200)
		if saved["surname"] != "New family" {
			t.Fatal("admin profile edit not persisted")
		}
		newRole := "student"
		if role == "student" {
			newRole = "tutor"
		}
		admin.request("POST", "admin/users/"+id+"/role", core.Row{"role": newRole}, 201)
		b.request("GET", "users/me", nil, 401)
		b.request("POST", "auth/login", core.Row{"email": email, "password": next}, 201)
		admin.request("POST", "admin/users/"+id+"/password", core.Row{"newPassword": pw, "confirmPassword": pw}, 201)
		b.request("GET", "users/me", nil, 401)
		b.request("POST", "auth/login", core.Row{"email": email, "password": pw}, 201)
		b.request("GET", "users/me", nil, 403)
	}
	admin.request("POST", "admin/users/"+ownerID+"/role", core.Row{"role": "student"}, 403)
	admin.request("POST", "admin/users/"+ownerID+"/password", core.Row{"newPassword": next, "confirmPassword": next}, 403)
	admin.request("POST", "admin/users", core.Row{"name": "Second owner", "email": "owner-" + marker + "@example.test", "password": pw, "role": "SUPERADMIN"}, 400)
	admin.request("PATCH", "admin/users/"+studentID, core.Row{"role": "SUPERADMIN"}, 400)
	log, e := store.One(`SELECT count(*) AS total FROM "AuditLog" WHERE "actorId"=$1 AND action='user.password.reset'`, ownerID)
	if e != nil || core.Int(log, "total") < 2 {
		t.Fatal("reset audit missing", e)
	}
}
