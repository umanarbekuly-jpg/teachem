package accounts

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"regexp"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"teachem/api-go/internal/core"
)

func Register(a *core.App) {
	a.Authenticate = authenticate
	a.Handle("GET", "/api/v1/auth/csrf", "*", csrf)
	a.Handle("POST", "/api/v1/auth/register", "*", register)
	a.Handle("POST", "/api/v1/auth/login", "*", login)
	a.Handle("POST", "/api/v1/auth/refresh", "*", refresh)
	a.Handle("GET", "/api/v1/auth/me", "", me)
	a.Handle("POST", "/api/v1/auth/logout", "", logout)
	a.Handle("POST", "/api/v1/auth/change-password", "", changePassword)
	a.Handle("GET", "/api/v1/users/me", "", me)
	a.Handle("PATCH", "/api/v1/users/me", "", updateSelf)
	a.Handle("GET", "/api/v1/admin/users", "SUPERADMIN", listUsers)
	a.Handle("GET", "/api/v1/admin/users/{id}", "SUPERADMIN", getUser)
	a.Handle("POST", "/api/v1/admin/users", "SUPERADMIN", createUser)
	a.Handle("PATCH", "/api/v1/admin/users/{id}", "SUPERADMIN", editUser)
	a.Handle("POST", "/api/v1/admin/users/{id}/role", "SUPERADMIN", changeRole)
	a.Handle("POST", "/api/v1/admin/users/{id}/password", "SUPERADMIN", resetPassword)
	a.Handle("GET", "/api/v1/tutors/me/profile", "tutor", myTutor)
	a.Handle("PATCH", "/api/v1/tutors/me/profile", "tutor", editTutor)
	a.Handle("GET", "/api/v1/tutors", "*", listTutors)
	a.Handle("GET", "/api/v1/tutors/{id}", "*", getTutor)
}
func digest(value string) string { h := sha256.Sum256([]byte(value)); return hex.EncodeToString(h[:]) }
func setCookie(c *core.Context, name, value string, maxAge int) {
	http.SetCookie(c.W, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: c.App.Config.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}
func clearCookies(c *core.Context) { setCookie(c, "access", "", -1); setCookie(c, "refresh", "", -1) }
func csrf(c *core.Context) (any, error) {
	cookie, _ := c.R.Cookie("csrf")
	value := ""
	if cookie != nil {
		value = cookie.Value
	}
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(value) {
		b := make([]byte, 32)
		if _, e := rand.Read(b); e != nil {
			return nil, e
		}
		value = hex.EncodeToString(b)
	}
	setCookie(c, "csrf", value, 0)
	return core.Row{"token": value}, nil
}
func token(c *core.Context, id, sid string, refresh bool, expiry time.Time) (string, error) {
	typ, secret := "access", c.App.Config.AccessSecret
	if refresh {
		typ, secret = "refresh", c.App.Config.RefreshSecret
	} else {
		expiry = time.Now().Add(15 * time.Minute)
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sid": sid, "type": typ, "sub": id, "iss": "tutor-api", "aud": "tutor-web", "jti": core.NewID(), "iat": time.Now().Unix(), "exp": expiry.Unix()})
	return t.SignedString([]byte(secret))
}
func decode(c *core.Context, raw string, refresh bool) (jwt.MapClaims, error) {
	secret, typ := c.App.Config.AccessSecret, "access"
	if refresh {
		secret, typ = c.App.Config.RefreshSecret, "refresh"
	}
	t, e := jwt.Parse(raw, func(*jwt.Token) (any, error) { return []byte(secret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("tutor-api"), jwt.WithAudience("tutor-web"), jwt.WithExpirationRequired())
	if e != nil || !t.Valid {
		return nil, core.Error(401, "Войдите в аккаунт")
	}
	p, ok := t.Claims.(jwt.MapClaims)
	if !ok || p["type"] != typ {
		return nil, core.Error(401, "Войдите в аккаунт")
	}
	sid, sok := p["sid"].(string)
	sub, uok := p["sub"].(string)
	if !sok || !uok || !uuid(sid) || !uuid(sub) {
		return nil, core.Error(401, "Войдите в аккаунт")
	}
	return p, nil
}
func sessionUser(s core.Store, sid, id string, lock bool) (core.Row, error) {
	sql := `SELECT u.*, s."authVersion" AS "sessionVersion",s."refreshTokenHash",s."expiresAt" AS "sessionExpiresAt",s.id AS "sessionId" FROM "AuthSession" s JOIN "User" u ON u.id=s."userId" WHERE s.id=$1 AND u.id=$2 AND s."revokedAt" IS NULL AND s."expiresAt">now() AND u."deletedAt" IS NULL AND u."blockedAt" IS NULL AND s."authVersion"=u."authVersion"`
	if lock {
		sql += " FOR UPDATE OF s,u"
	}
	r, e := s.Rows(sql, sid, id)
	if e != nil {
		return nil, e
	}
	if len(r) != 1 {
		return nil, core.Error(401, "Сессия завершена")
	}
	return r[0], nil
}
func authenticate(c *core.Context) (*core.Actor, error) {
	cookie, e := c.R.Cookie("access")
	if e != nil {
		return nil, core.Error(401, "Войдите в аккаунт")
	}
	p, e := decode(c, cookie.Value, false)
	if e != nil {
		return nil, e
	}
	u, e := sessionUser(c.Store, p["sid"].(string), p["sub"].(string), false)
	if e != nil {
		return nil, e
	}
	return &core.Actor{ID: core.Str(u, "id"), Role: core.Str(u, "role"), SessionID: p["sid"].(string), MustChangePassword: core.Bool(u, "mustChangePassword")}, nil
}
func issue(c *core.Context, user core.Row) (any, error) {
	id, sid := core.Str(user, "id"), core.NewID()
	expiry := time.Now().Add(30 * 24 * time.Hour)
	rt, e := token(c, id, sid, true, expiry)
	if e != nil {
		return nil, e
	}
	at, e := token(c, id, sid, false, expiry)
	if e != nil {
		return nil, e
	}
	saved, e := c.Store.Tx(func(s core.Store) (any, error) {
		u, e := s.One(`SELECT * FROM "User" WHERE id=$1 FOR UPDATE`, id)
		if e != nil {
			return nil, e
		}
		if core.Int(u, "authVersion") != core.Int(user, "authVersion") || u["blockedAt"] != nil || u["deletedAt"] != nil {
			return nil, core.Error(401, "Данные входа изменились. Войдите заново")
		}
		_, e = s.Insert("AuthSession", core.Row{"id": sid, "userId": id, "refreshTokenHash": digest(rt), "expiresAt": expiry, "authVersion": core.Int(u, "authVersion")})
		return publicSelf(u), e
	})
	if e != nil {
		return nil, e
	}
	setCookie(c, "access", at, 900)
	setCookie(c, "refresh", rt, 30*86400)
	return saved, nil
}
func register(c *core.Context) (any, error) {
	d, e := c.Body("name", "email", "password", "role")
	if e != nil {
		return nil, e
	}
	if e = textValue(d, "name", 2, 100, true, false); e != nil {
		return nil, e
	}
	if e = emailValue(d, true, false); e != nil {
		return nil, e
	}
	if e = passwordValue(d, "password"); e != nil {
		return nil, e
	}
	role := core.Str(d, "role")
	if role != "student" && role != "tutor" {
		return nil, core.Field("role", "Выберите ученика или тьютора")
	}
	h, e := bcrypt.GenerateFromPassword([]byte(core.Str(d, "password")), 12)
	if e != nil {
		return nil, e
	}
	u, e := c.Store.Insert("User", core.Row{"email": d["email"], "name": d["name"], "role": role, "passwordHash": string(h)})
	if e != nil {
		return nil, duplicateEmailConflict(e)
	}
	return issue(c, u)
}
func login(c *core.Context) (any, error) {
	d, e := c.Body("email", "password")
	if e != nil {
		return nil, e
	}
	if e = emailValue(d, true, true); e != nil {
		return nil, e
	}
	if e = passwordValue(d, "password"); e != nil {
		return nil, e
	}
	rows, e := c.Store.Rows(`SELECT * FROM "User" WHERE email=$1`, d["email"])
	if e != nil {
		return nil, e
	}
	if len(rows) != 1 || rows[0]["blockedAt"] != nil || rows[0]["deletedAt"] != nil || bcrypt.CompareHashAndPassword([]byte(core.Str(rows[0], "passwordHash")), []byte(core.Str(d, "password"))) != nil {
		return nil, core.Error(401, "Неверный email или пароль")
	}
	return issue(c, rows[0])
}
func me(c *core.Context) (any, error) {
	u, e := currentUser(c.Store, c.Actor.ID)
	if e != nil {
		return nil, e
	}
	return publicSelf(u), nil
}
func logout(c *core.Context) (any, error) {
	_, e := c.Store.Exec(`UPDATE "AuthSession" SET "revokedAt"=now(),"updatedAt"=now() WHERE id=$1`, c.Actor.SessionID)
	if e != nil {
		return nil, e
	}
	clearCookies(c)
	return core.OK(), nil
}
func refresh(c *core.Context) (any, error) {
	cookie, e := c.R.Cookie("refresh")
	if e != nil {
		return nil, core.Error(401, "Войдите в аккаунт")
	}
	p, e := decode(c, cookie.Value, true)
	if e != nil {
		return nil, e
	}
	var at, rt string
	replayed := false
	result, e := c.Store.Tx(func(s core.Store) (any, error) {
		u, e := sessionUser(s, p["sid"].(string), p["sub"].(string), true)
		if e != nil {
			return nil, e
		}
		if !same(core.Str(u, "refreshTokenHash"), digest(cookie.Value)) {
			replayed = true
			_, e = s.Exec(`UPDATE "AuthSession" SET "revokedAt"=now(),"updatedAt"=now() WHERE id=$1`, p["sid"])
			return core.OK(), e
		}
		if core.Bool(u, "mustChangePassword") {
			return nil, core.Error(401, "Смените пароль или войдите заново")
		}
		expiry, e := time.Parse(time.RFC3339Nano, core.Str(u, "sessionExpiresAt"))
		if e != nil {
			return nil, e
		}
		rt, e = token(c, core.Str(u, "id"), p["sid"].(string), true, expiry)
		if e != nil {
			return nil, e
		}
		at, e = token(c, core.Str(u, "id"), p["sid"].(string), false, expiry)
		if e != nil {
			return nil, e
		}
		_, e = s.Exec(`UPDATE "AuthSession" SET "refreshTokenHash"=$1,"updatedAt"=now() WHERE id=$2`, digest(rt), p["sid"])
		return publicSelf(u), e
	})
	if e != nil {
		return nil, e
	}
	if replayed {
		return nil, core.Error(401, "Сессия отозвана")
	}
	setCookie(c, "access", at, 900)
	setCookie(c, "refresh", rt, 30*86400)
	return result, nil
}
func changePassword(c *core.Context) (any, error) {
	d, e := c.Body("currentPassword", "newPassword", "confirmPassword")
	if e != nil {
		return nil, e
	}
	if e = textValue(d, "currentPassword", 1, 72, true, false); e != nil {
		return nil, e
	}
	if e = passwordValue(d, "newPassword"); e != nil {
		return nil, e
	}
	if v, ok := d["confirmPassword"].(string); !ok || v != core.Str(d, "newPassword") {
		return nil, core.Field("confirmPassword", "Пароли не совпадают")
	}
	u, e := currentUser(c.Store, c.Actor.ID)
	if e != nil {
		return nil, e
	}
	old := []byte(core.Str(u, "passwordHash"))
	if bcrypt.CompareHashAndPassword(old, []byte(core.Str(d, "currentPassword"))) != nil {
		return nil, core.Field("currentPassword", "Текущий пароль неверен")
	}
	if bcrypt.CompareHashAndPassword(old, []byte(core.Str(d, "newPassword"))) == nil {
		return nil, core.Field("newPassword", "Новый пароль должен отличаться от текущего")
	}
	h, e := bcrypt.GenerateFromPassword([]byte(core.Str(d, "newPassword")), 12)
	if e != nil {
		return nil, e
	}
	r, e := c.Store.Tx(func(s core.Store) (any, error) {
		n, e := s.Exec(`UPDATE "User" SET "passwordHash"=$1,"mustChangePassword"=false,"authVersion"="authVersion"+1,"updatedAt"=now() WHERE id=$2 AND "authVersion"=$3`, string(h), c.Actor.ID, core.Int(u, "authVersion"))
		if e != nil {
			return nil, e
		}
		if n != 1 {
			return nil, core.Error(409, "Аккаунт изменился. Войдите заново")
		}
		if e = revoke(s, c.Actor.ID); e != nil {
			return nil, e
		}
		if e = audit(s, c, c.Actor.ID, "user.password.change", nil); e != nil {
			return nil, e
		}
		return core.OK(), nil
	})
	if e != nil {
		return nil, e
	}
	clearCookies(c)
	return r, nil
}
