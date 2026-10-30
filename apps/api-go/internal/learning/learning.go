package learning

import (
	"fmt"
	"math"
	"net"
	"net/url"
	"regexp"
	"strings"
	"teachem/api-go/internal/core"
	"time"
	"unicode"
	"unicode/utf8"
)

var uuidPattern = regexp.MustCompile(`(?i)^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)

func isUUID(s string) bool { return uuidPattern.MatchString(s) }
func text(r core.Row, k string, min, max int, required bool) error {
	v, exists := r[k]
	if !exists && !required {
		return nil
	}
	s, ok := v.(string)
	if !ok || utf8.RuneCountInString(s) < min || utf8.RuneCountInString(s) > max {
		return core.Field(k, fmt.Sprintf("От %d до %d символов", min, max))
	}
	return nil
}
func integer(r core.Row, k string, min, max int, required bool) error {
	v, exists := r[k]
	if !exists && !required {
		return nil
	}
	n, ok := v.(float64)
	if !ok || math.Trunc(n) != n || n < float64(min) || n > float64(max) {
		return core.Field(k, "Укажите целое число в допустимом диапазоне")
	}
	return nil
}
func allowed(r core.Row, keys ...string) error {
	for k := range r {
		found := false
		for _, s := range keys {
			if s == k {
				found = true
				break
			}
		}
		if !found {
			return core.Field(k, "Недопустимое поле")
		}
	}
	return nil
}
func httpsURL(s string) bool {
	u, e := url.Parse(s)
	return e == nil && len(s) <= 2084 && strings.IndexFunc(s, unicode.IsSpace) < 0 && u.Scheme == "https" && u.Hostname() != "" && (strings.Contains(u.Hostname(), ".") || net.ParseIP(u.Hostname()) != nil)
}
func parseTime(v any) time.Time {
	if t, ok := v.(time.Time); ok {
		return t
	}
	s, _ := v.(string)
	t, _ := time.Parse(time.RFC3339Nano, s)
	return t
}
func rows(v any) []core.Row {
	var out = []core.Row{}
	switch x := v.(type) {
	case []core.Row:
		return x
	case []any:
		for _, r := range x {
			if m, ok := r.(map[string]any); ok {
				out = append(out, core.Row(m))
			}
		}
	}
	return out
}
func row(v any) core.Row {
	if r, ok := v.(map[string]any); ok {
		return core.Row(r)
	}
	return core.Row{}
}
func stringsArray(v any) ([]string, bool) {
	switch a := v.(type) {
	case []string:
		return a, true
	case []any:
		s := make([]string, 0, len(a))
		for _, v := range a {
			x, ok := v.(string)
			if !ok {
				return nil, false
			}
			s = append(s, x)
		}
		return s, true
	}
	return nil, false
}
func list(c *core.Context, sql string, args ...any) (any, error) {
	return listQuery(c, sql, []string{"page", "pageSize"}, args...)
}
func queryAllowed(c *core.Context, keys []string) error {
	for key, values := range c.R.URL.Query() {
		found := false
		for _, allowed := range keys {
			if key == allowed {
				found = true
				break
			}
		}
		if !found || len(values) != 1 {
			return core.Field(key, "Недопустимый или повторяющийся параметр")
		}
	}
	return nil
}
func listQuery(c *core.Context, sql string, keys []string, args ...any) (any, error) {
	if e := queryAllowed(c, keys); e != nil {
		return nil, e
	}
	page, size, e := core.Page(c)
	if e != nil {
		return nil, e
	}
	count, e := c.Store.One(`SELECT count(*)::int AS total FROM (`+sql+`) AS total_rows`, args...)
	if e != nil {
		return nil, e
	}
	args = append(args, size, (page-1)*size)
	items, e := c.Store.Rows(sql+fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)-1, len(args)), args...)
	if e != nil {
		return nil, e
	}
	return core.Paged(items, core.Int(count, "total"), page, size), nil
}
func live(s core.Store, table, id string) (core.Row, error) {
	return s.One(`SELECT * FROM "`+table+`" WHERE id=$1 AND "deletedAt" IS NULL`, id)
}
func merge(a, b core.Row) core.Row {
	r := core.Row{}
	for k, v := range a {
		r[k] = v
	}
	for k, v := range b {
		r[k] = v
	}
	return r
}
func validateAsset(c *core.Context, id, purpose string) error {
	if !isUUID(id) {
		return core.Field("fileAssetId", "Укажите корректный идентификатор файла")
	}
	f, e := c.Store.Find("FileAsset", id)
	if e != nil {
		return e
	}
	if core.Str(f, "ownerId") != c.Actor.ID || core.Str(f, "status") != "ready" || core.Str(f, "purpose") != purpose {
		return core.Error(400, "Файл недоступен или не проверен")
	}
	return nil
}
func publicCourse(c *core.Context, id string) (core.Row, error) {
	r, e := courseGet(c, id)
	if e != nil {
		return nil, e
	}
	t := row(r["tutor"])
	if core.Str(r, "status") != "published" || t["blockedAt"] != nil || t["deletedAt"] != nil {
		return nil, core.Error(404, "Курс не найден")
	}
	return r, nil
}
func ownCourse(c *core.Context, id string) (core.Row, error) {
	r, e := courseGet(c, id)
	if e != nil {
		return nil, e
	}
	if core.Str(r, "tutorId") != c.Actor.ID && c.Actor.Role != "SUPERADMIN" {
		return nil, core.Error(403, "Это не ваш курс")
	}
	return r, nil
}
func access(c *core.Context, id string) (core.Row, error) {
	r, e := courseGet(c, id)
	if e != nil {
		return nil, e
	}
	if c.Actor.Role == "SUPERADMIN" || core.Str(r, "tutorId") == c.Actor.ID {
		return r, nil
	}
	t := row(r["tutor"])
	en, e := c.Store.Rows(`SELECT id FROM "Enrollment" WHERE "studentId"=$1 AND "courseId"=$2 AND "accessExpiresAt">now()`, c.Actor.ID, id)
	if e != nil {
		return nil, e
	}
	if t["blockedAt"] != nil || len(en) == 0 {
		return nil, core.Error(403, "Нужна активная оплаченная запись на курс")
	}
	return r, nil
}
func Register(a *core.App) {
	a.Access = access
	a.OwnCourse = ownCourse
	registerCourses(a)
	registerEnrollments(a)
	registerMaterials(a)
	registerSessions(a)
	registerTests(a)
}
func normalSubject(s string) string { return strings.Join(strings.Fields(s), " ") }
func normalTag(s string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(s), "#"))
}
