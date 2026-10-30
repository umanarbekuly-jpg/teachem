package accounts

import (
	"golang.org/x/crypto/bcrypt"
	"strings"
	"teachem/api-go/internal/core"
)

func updateSelf(c *core.Context) (any, error) {
	d, e := c.Body("name", "surname", "email", "currentPassword")
	if e != nil {
		return nil, e
	}
	if e = textValue(d, "name", 2, 100, true, true); e != nil {
		return nil, e
	}
	if e = textValue(d, "surname", 0, 100, false, true); e != nil {
		return nil, e
	}
	if e = textValue(d, "currentPassword", 1, 72, false, false); e != nil {
		return nil, e
	}
	u, e := currentUser(c.Store, c.Actor.ID)
	if e != nil {
		return nil, e
	}
	if e = emailValue(d, false, core.Str(u, "role") == "SUPERADMIN"); e != nil {
		return nil, e
	}
	email := core.Str(u, "email")
	if value, exists := d["email"]; exists {
		email = value.(string)
	}
	changed := email != core.Str(u, "email")
	if changed && bcrypt.CompareHashAndPassword([]byte(core.Str(u, "passwordHash")), []byte(core.Str(d, "currentPassword"))) != nil {
		return nil, core.Field("currentPassword", "Введите верный текущий пароль")
	}
	result, e := c.Store.Tx(func(s core.Store) (any, error) {
		locked, e := s.One(`SELECT * FROM "User" WHERE id=$1 FOR UPDATE`, c.Actor.ID)
		if e != nil {
			return nil, e
		}
		if core.Int(locked, "authVersion") != core.Int(u, "authVersion") || core.Str(locked, "email") != core.Str(u, "email") || locked["blockedAt"] != nil || locked["deletedAt"] != nil || core.Bool(locked, "mustChangePassword") {
			return nil, core.Error(409, "Аккаунт изменился. Обновите страницу и повторите действие")
		}
		data := core.Row{"name": d["name"], "email": email}
		if v, ok := d["surname"]; ok {
			data["surname"] = v
		}
		if changed {
			data["emailVerifiedAt"] = nil
		}
		saved, e := s.Update("User", c.Actor.ID, data)
		if e != nil {
			return nil, e
		}
		return publicSelf(saved), nil
	})
	return result, duplicateEmailConflict(e)
}

var managedKeys = []string{"id", "name", "surname", "email", "phone", "bio", "photoAssetId", "role", "blockedAt", "createdAt", "emailVerifiedAt", "mustChangePassword"}

func managedUser(s core.Store, id string) (core.Row, error) {
	u, e := currentUser(s, id)
	if e != nil {
		return nil, e
	}
	view := core.Pick(u, managedKeys...)
	profiles, e := s.Rows(`SELECT bio,"photoAssetId","experienceYears",education,subjects,languages FROM "TutorProfile" WHERE "userId"=$1`, id)
	if e != nil {
		return nil, e
	}
	view["profile"] = nil
	if len(profiles) > 0 {
		view["profile"] = profiles[0]
	}
	return view, nil
}
func listUsers(c *core.Context) (any, error) {
	q := c.R.URL.Query()
	page, size, e := paging(q)
	if e != nil {
		return nil, e
	}
	term := strings.TrimSpace(q.Get("search"))
	if len([]rune(term)) > 100 {
		return nil, core.Field("search", "Не более 100 символов")
	}
	role, status := q.Get("role"), q.Get("status")
	if role != "" && role != "student" && role != "tutor" && role != "SUPERADMIN" {
		return nil, core.Field("role", "Неизвестная роль")
	}
	if status != "" && status != "active" && status != "blocked" {
		return nil, core.Field("status", "Неизвестный статус")
	}
	where := ` FROM "User" WHERE "deletedAt" IS NULL AND ($1='' OR role::text=$1) AND ($2='' OR ($2='active' AND "blockedAt" IS NULL) OR ($2='blocked' AND "blockedAt" IS NOT NULL)) AND ($3='' OR name ILIKE '%'||$3||'%' OR surname ILIKE '%'||$3||'%' OR email ILIKE '%'||$3||'%')`
	rows, e := c.Store.Rows(`SELECT id`+where+` ORDER BY "createdAt" DESC,id ASC LIMIT $4 OFFSET $5`, role, status, term, size, (page-1)*size)
	if e != nil {
		return nil, e
	}
	count, e := c.Store.One(`SELECT count(*) AS total`+where, role, status, term)
	if e != nil {
		return nil, e
	}
	views := make([]core.Row, 0, len(rows))
	for _, row := range rows {
		v, e := managedUser(c.Store, core.Str(row, "id"))
		if e != nil {
			return nil, e
		}
		views = append(views, v)
	}
	return pageRows(views, core.Int(count, "total"), page, size), nil
}
func avatar(c *core.Context, id string) (any, error) {
	if id == "" {
		return nil, nil
	}
	rows, e := c.Store.Rows(`SELECT * FROM "FileAsset" WHERE id=$1 AND purpose='avatar' AND status='ready'`, id)
	if e != nil {
		return nil, e
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return c.App.Storage.Download(c.R.Context(), core.Str(rows[0], "objectKey"), core.Str(rows[0], "originalName"))
}
func getUser(c *core.Context) (any, error) {
	u, e := managedUser(c.Store, c.ID())
	if e != nil {
		return nil, e
	}
	photo := core.Str(u, "photoAssetId")
	if p, ok := u["profile"].(core.Row); ok && core.Str(p, "photoAssetId") != "" {
		photo = core.Str(p, "photoAssetId")
	}
	v, e := avatar(c, photo)
	if e != nil {
		return nil, e
	}
	u["photoUrl"] = v
	return u, nil
}

var editKeys = []string{"name", "surname", "email", "phone", "bio", "photoAssetId", "experienceYears", "education", "subjects", "languages"}

func saveProfile(s core.Store, c *core.Context, id string, d core.Row, hasTutor bool) error {
	if photo := core.Str(d, "photoAssetId"); photo != "" {
		if e := photoAllowed(s, photo, []string{id, c.Actor.ID}, id); e != nil {
			return e
		}
	}
	current, e := currentUser(s, id)
	if e != nil {
		return e
	}
	userData := core.Row{}
	for _, k := range []string{"name", "surname", "email", "phone", "bio", "photoAssetId"} {
		if v, ok := d[k]; ok {
			userData[k] = v
		}
	}
	emailChanged := core.Str(d, "email") != "" && core.Str(d, "email") != core.Str(current, "email")
	if emailChanged {
		userData["emailVerifiedAt"] = nil
		userData["authVersion"] = core.Int(current, "authVersion") + 1
	}
	if len(userData) > 0 {
		if _, e = s.Update("User", id, userData); e != nil {
			return e
		}
	}
	if emailChanged {
		if e = revoke(s, id); e != nil {
			return e
		}
	}
	tutorData := core.Row{}
	for _, k := range []string{"bio", "photoAssetId", "experienceYears", "education", "subjects", "languages"} {
		if v, ok := d[k]; ok {
			tutorData[k] = v
		}
	}
	for _, k := range []string{"experienceYears", "education", "subjects", "languages"} {
		if _, ok := d[k]; ok {
			hasTutor = true
		}
	}
	if hasTutor {
		_, e = upsertTutor(s, id, tutorData)
	}
	return e
}
func createUser(c *core.Context) (any, error) {
	keys := append(append([]string{}, editKeys...), "password", "role")
	d, e := c.Body(keys...)
	if e != nil {
		return nil, e
	}
	if e = profileFields(d); e != nil {
		return nil, e
	}
	if e = textValue(d, "name", 2, 100, true, true); e != nil {
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
	result, e := c.Store.Tx(func(s core.Store) (any, error) {
		if e := authority(s, c); e != nil {
			return nil, e
		}
		u, e := s.Insert("User", core.Row{"name": d["name"], "email": d["email"], "role": role, "passwordHash": string(h), "mustChangePassword": true})
		if e != nil {
			return nil, e
		}
		id := core.Str(u, "id")
		if e = saveProfile(s, c, id, d, role == "tutor"); e != nil {
			return nil, e
		}
		if e = audit(s, c, id, "user.create", core.Row{"role": role}); e != nil {
			return nil, e
		}
		return managedUser(s, id)
	})
	return result, dbConflict(e)
}
func editUser(c *core.Context) (any, error) {
	d, e := c.Body(editKeys...)
	if e != nil {
		return nil, e
	}
	if e = profileFields(d); e != nil {
		return nil, e
	}
	r, e := c.Store.Tx(func(s core.Store) (any, error) {
		if e := authority(s, c); e != nil {
			return nil, e
		}
		u, e := requireOrdinary(s, c.ID())
		if e != nil {
			return nil, e
		}
		p, e := s.Rows(`SELECT id FROM "TutorProfile" WHERE "userId"=$1`, c.ID())
		if e != nil {
			return nil, e
		}
		if e = saveProfile(s, c, c.ID(), d, core.Str(u, "role") == "tutor" || len(p) > 0); e != nil {
			return nil, e
		}
		keys := make([]string, 0, len(d))
		for k := range d {
			keys = append(keys, k)
		}
		if e = audit(s, c, c.ID(), "user.profile.update", core.Row{"fields": keys}); e != nil {
			return nil, e
		}
		return managedUser(s, c.ID())
	})
	return r, dbConflict(e)
}
func changeRole(c *core.Context) (any, error) {
	d, e := c.Body("role")
	if e != nil {
		return nil, e
	}
	role := core.Str(d, "role")
	if role != "student" && role != "tutor" {
		return nil, core.Field("role", "Выберите ученика или тьютора")
	}
	return c.Store.Tx(func(s core.Store) (any, error) {
		if e := authority(s, c); e != nil {
			return nil, e
		}
		u, e := requireOrdinary(s, c.ID())
		if e != nil {
			return nil, e
		}
		old := core.Str(u, "role")
		if old == role {
			return core.OK(), nil
		}
		var obligations []core.Row
		if old == "tutor" {
			obligations, e = s.Rows(`SELECT c.id FROM "Course" c WHERE c."tutorId"=$1 AND ((c.status='published' AND c."deletedAt" IS NULL) OR EXISTS(SELECT 1 FROM "LiveSession" l WHERE l."courseId"=c.id AND l.status='scheduled' AND l."deletedAt" IS NULL AND l."startsAt">=now()) OR EXISTS(SELECT 1 FROM "Enrollment" e WHERE e."courseId"=c.id AND e."accessExpiresAt">now())) LIMIT 1`, c.ID())
		} else {
			obligations, e = s.Rows(`SELECT id FROM "Enrollment" WHERE "studentId"=$1 AND "accessExpiresAt">now() LIMIT 1`, c.ID())
		}
		if e != nil {
			return nil, e
		}
		if len(obligations) > 0 {
			return nil, core.Error(409, "Сначала завершите действующий оплаченный доступ, отмените будущие занятия и архивируйте опубликованные курсы. История сохранится")
		}
		if _, e = s.Update("User", c.ID(), core.Row{"role": role, "authVersion": core.Int(u, "authVersion") + 1}); e != nil {
			return nil, e
		}
		if role == "tutor" {
			p, e := s.Rows(`SELECT id FROM "TutorProfile" WHERE "userId"=$1`, c.ID())
			if e != nil {
				return nil, e
			}
			if len(p) == 0 {
				_, e = upsertTutor(s, c.ID(), core.Row{"bio": u["bio"], "photoAssetId": u["photoAssetId"]})
				if e != nil {
					return nil, e
				}
			}
		}
		if e = revoke(s, c.ID()); e != nil {
			return nil, e
		}
		if e = audit(s, c, c.ID(), "user.role.change", core.Row{"from": old, "to": role}); e != nil {
			return nil, e
		}
		return core.OK(), nil
	})
}
func resetPassword(c *core.Context) (any, error) {
	d, e := c.Body("newPassword", "confirmPassword")
	if e != nil {
		return nil, e
	}
	if e = passwordValue(d, "newPassword"); e != nil {
		return nil, e
	}
	if v, ok := d["confirmPassword"].(string); !ok || v != core.Str(d, "newPassword") {
		return nil, core.Field("confirmPassword", "Пароли не совпадают")
	}
	h, e := bcrypt.GenerateFromPassword([]byte(core.Str(d, "newPassword")), 12)
	if e != nil {
		return nil, e
	}
	return c.Store.Tx(func(s core.Store) (any, error) {
		if e := authority(s, c); e != nil {
			return nil, e
		}
		u, e := requireOrdinary(s, c.ID())
		if e != nil {
			return nil, e
		}
		if _, e = s.Update("User", c.ID(), core.Row{"passwordHash": string(h), "mustChangePassword": true, "authVersion": core.Int(u, "authVersion") + 1}); e != nil {
			return nil, e
		}
		if e = revoke(s, c.ID()); e != nil {
			return nil, e
		}
		if e = audit(s, c, c.ID(), "user.password.reset", nil); e != nil {
			return nil, e
		}
		return core.OK(), nil
	})
}
