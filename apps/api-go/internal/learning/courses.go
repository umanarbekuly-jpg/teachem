package learning

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"teachem/api-go/internal/core"
	"time"
)

var subjects = []string{"Математика", "Английский язык", "Русский язык", "Физика", "Химия", "Биология", "Информатика", "История", "Казахский язык"}
var tagPattern = regexp.MustCompile(`^[\p{Latin}\p{Cyrillic}0-9_]{1,30}$`)
var courseQueryKeys = []string{"page", "pageSize", "search", "subject", "tag", "priceFromMinor", "priceToMinor"}

const courseFields = `c.*, jsonb_build_object('id',u.id,'name',u.name) AS tutor`

func courseList(c *core.Context, mine, all bool) (any, error) {
	where := []string{`c."deletedAt" IS NULL`}
	args := []any{}
	add := func(expr string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(expr, len(args)))
	}
	if mine {
		add(`c."tutorId"=$%d`, c.Actor.ID)
	} else if !all {
		where = append(where, `c.status='published' AND u."blockedAt" IS NULL AND u."deletedAt" IS NULL`)
	}
	q := c.R.URL.Query()
	if e := queryAllowed(c, courseQueryKeys); e != nil {
		return nil, e
	}
	if q.Has("tag") && q.Get("tag") == "" {
		return nil, core.Field("tag", "От 1 до 31 символа")
	}
	if term := q.Get("search"); term != "" {
		if len([]rune(term)) > 100 {
			return nil, core.Field("search", "Не более 100 символов")
		}
		args = append(args, "%"+escapeLike(term)+"%", normalTag(term))
		where = append(where, fmt.Sprintf(`(c.title ILIKE $%d OR c.subject ILIKE $%d OR $%d=ANY(c.tags))`, len(args)-1, len(args)-1, len(args)))
	}
	if term := q.Get("subject"); term != "" {
		if len([]rune(term)) > 100 {
			return nil, core.Field("subject", "Не более 100 символов")
		}
		add(`lower(c.subject)=lower($%d)`, normalSubject(term))
	}
	if term := q.Get("tag"); term != "" {
		if len([]rune(term)) > 31 {
			return nil, core.Field("tag", "Не более 31 символа")
		}
		add(`$%d=ANY(c.tags)`, normalTag(term))
	}
	for _, p := range []struct{ k, op string }{{"priceFromMinor", ">="}, {"priceToMinor", "<="}} {
		if v := q.Get(p.k); v != "" {
			n, e := strconv.Atoi(v)
			if e != nil || n < 0 {
				return nil, core.Field(p.k, "Укажите неотрицательное целое число")
			}
			add(`c."monthlyPriceMinor"`+p.op+`$%d`, n)
		}
	}
	value, e := listQuery(c, `SELECT `+courseFields+` FROM "Course" c JOIN "User" u ON u.id=c."tutorId" WHERE `+strings.Join(where, " AND ")+` ORDER BY c."createdAt" DESC,c.id`, courseQueryKeys, args...)
	if e != nil {
		return nil, e
	}
	r := value.(core.Row)
	items := rows(r["items"])
	for _, item := range items {
		if _, e := coverView(c, item); e != nil {
			return nil, e
		}
	}
	r["items"] = items
	return r, nil
}
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}
func courseWrite(c *core.Context, create bool) (any, error) {
	d, e := c.Body("title", "description", "subject", "level", "durationDays", "tags", "coverAssetId", "monthlyPriceMinor")
	if e != nil {
		return nil, e
	}
	if e = validateCourse(d, create); e != nil {
		return nil, e
	}
	var old core.Row
	if !create {
		old, e = ownCourse(c, c.ID())
		if e != nil {
			return nil, e
		}
	}
	if id := core.Str(d, "coverAssetId"); id != "" && (create || id != core.Str(old, "coverAssetId")) {
		if e = validateAsset(c, id, "course_cover"); e != nil {
			return nil, e
		}
	}
	v, e := c.Store.Tx(func(s core.Store) (any, error) {
		data := merge(core.Row{}, d)
		if name := core.Str(data, "subject"); name != "" {
			canonicalName, e := canonical(s, name)
			if e != nil {
				return nil, e
			}
			data["subject"] = canonicalName
		}
		if create {
			data["tutorId"] = c.Actor.ID
			return s.Insert("Course", data)
		}
		return s.Update("Course", c.ID(), data)
	})
	if e != nil {
		return nil, e
	}
	return courseGet(c, core.Str(v.(core.Row), "id"))
}
func registerCourses(a *core.App) {
	a.Handle("GET", "/api/v1/courses", "*", func(c *core.Context) (any, error) { return courseList(c, false, false) })
	a.Handle("GET", "/api/v1/admin/courses", "SUPERADMIN", func(c *core.Context) (any, error) { return courseList(c, false, true) })
	a.Handle("GET", "/api/v1/tutors/me/courses", "tutor", func(c *core.Context) (any, error) { return courseList(c, true, false) })
	a.Handle("GET", "/api/v1/courses/subjects", "*", func(c *core.Context) (any, error) {
		r, e := c.Store.Rows(`SELECT DISTINCT c.subject FROM "Course" c JOIN "User" u ON u.id=c."tutorId" WHERE c.status='published' AND c."deletedAt" IS NULL AND u."deletedAt" IS NULL AND u."blockedAt" IS NULL ORDER BY c.subject`)
		if e != nil {
			return nil, e
		}
		items := append([]string{}, subjects...)
		seen := map[string]bool{}
		for _, v := range items {
			seen[strings.ToLower(v)] = true
		}
		for _, v := range r {
			name := normalSubject(core.Str(v, "subject"))
			key := strings.ToLower(name)
			if name != "" && !seen[key] {
				items = append(items, name)
				seen[key] = true
			}
		}
		return core.Row{"items": items}, nil
	})
	a.Handle("GET", "/api/v1/courses/{id}", "*", func(c *core.Context) (any, error) { return publicCourse(c, c.ID()) })
	a.Handle("GET", "/api/v1/courses/{id}/edit", "tutor,SUPERADMIN", func(c *core.Context) (any, error) { return ownCourse(c, c.ID()) })
	a.Handle("POST", "/api/v1/courses", "tutor", func(c *core.Context) (any, error) { return courseWrite(c, true) })
	a.Handle("PATCH", "/api/v1/courses/{id}", "tutor,SUPERADMIN", func(c *core.Context) (any, error) { return courseWrite(c, false) })
	for _, action := range []string{"publish", "archive"} {
		action := action
		a.Handle("POST", "/api/v1/courses/{id}/"+action, "tutor", func(c *core.Context) (any, error) {
			if _, e := ownCourse(c, c.ID()); e != nil {
				return nil, e
			}
			status := "published"
			if action == "archive" {
				status = "archived"
			}
			if _, e := c.Store.Update("Course", c.ID(), core.Row{"status": status}); e != nil {
				return nil, e
			}
			return courseGet(c, c.ID())
		})
	}
	a.Handle("DELETE", "/api/v1/courses/{id}", "tutor", func(c *core.Context) (any, error) {
		r, e := ownCourse(c, c.ID())
		if e != nil {
			return nil, e
		}
		data := core.Row{"status": "archived"}
		if core.Str(r, "status") == "draft" {
			data = core.Row{"deletedAt": time.Now()}
		}
		tutor := r["tutor"]
		r, e = c.Store.Update("Course", c.ID(), data)
		if e != nil {
			return nil, e
		}
		r["tutor"] = tutor
		return coverView(c, r)
	})
}
