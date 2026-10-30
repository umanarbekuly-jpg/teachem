package accounts

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"teachem/api-go/internal/core"
)

func textValue(d core.Row, key string, min, max int, required, trim bool) error {
	value, exists := d[key]
	if !exists && !required {
		return nil
	}
	s, ok := value.(string)
	if !ok {
		return core.Field(key, "Укажите текстовое значение")
	}
	if trim {
		s = strings.TrimSpace(s)
		d[key] = s
	}
	n := utf8.RuneCountInString(s)
	if n < min || n > max {
		return core.Field(key, fmt.Sprintf("От %d до %d символов", min, max))
	}
	return nil
}
func validEmail(email string, special bool) bool {
	if special && email == "supadmin@teachem" {
		return true
	}
	if len(email) > 254 || strings.ContainsAny(email, "\r\n\t ") {
		return false
	}
	parsed, e := mail.ParseAddress(email)
	if e != nil || parsed.Address != email {
		return false
	}
	parts := strings.Split(email, "@")
	return len(parts) == 2 && len(parts[0]) > 0 && strings.Contains(parts[1], ".") && !strings.HasSuffix(parts[1], ".")
}
func emailValue(d core.Row, required, special bool) error {
	if _, ok := d["email"]; !ok && !required {
		return nil
	}
	s, ok := d["email"].(string)
	s = strings.ToLower(strings.TrimSpace(s))
	if !ok || !validEmail(s, special) {
		return core.Field("email", "Укажите корректный email")
	}
	d["email"] = s
	return nil
}
func passwordValue(d core.Row, key string) error {
	s, ok := d[key].(string)
	if !ok || utf8.RuneCountInString(s) < 12 || len(s) > 72 {
		return core.Field(key, "Пароль: не менее 12 символов и не более 72 байт")
	}
	return nil
}
func profileFields(d core.Row) error {
	for _, spec := range []struct {
		k        string
		min, max int
		trim     bool
	}{{"name", 2, 100, true}, {"surname", 0, 100, true}, {"phone", 0, 40, true}, {"bio", 0, 5000, false}, {"education", 0, 2000, false}} {
		if err := textValue(d, spec.k, spec.min, spec.max, false, spec.trim); err != nil {
			return err
		}
	}
	if e := emailValue(d, false, false); e != nil {
		return e
	}
	if v, ok := d["experienceYears"]; ok {
		n, valid := v.(float64)
		if !valid || n < 0 || n > 80 || n != float64(int(n)) {
			return core.Field("experienceYears", "Укажите целое число от 0 до 80")
		}
	}
	for _, k := range []string{"subjects", "languages"} {
		if v, ok := d[k]; ok {
			arr, ok := v.([]any)
			if !ok || len(arr) > 20 {
				return core.Field(k, "Не более 20 значений")
			}
			ss := make([]string, 0, len(arr))
			for _, v := range arr {
				s, ok := v.(string)
				if !ok || utf8.RuneCountInString(s) < 1 || utf8.RuneCountInString(s) > 100 {
					return core.Field(k, "Значения должны содержать от 1 до 100 символов")
				}
				ss = append(ss, s)
			}
			d[k] = ss
		}
	}
	if v, ok := d["photoAssetId"]; ok && v != nil {
		s, ok := v.(string)
		if !ok || !uuid(s) {
			return core.Field("photoAssetId", "Укажите корректный ID файла")
		}
	}
	return nil
}
func uuid(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if r != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return false
		}
	}
	return true
}
func paging(q url.Values) (int, int, error) {
	page, size := 1, 20
	for k, p := range map[string]*int{"page": &page, "pageSize": &size} {
		if v := q.Get(k); v != "" {
			n, e := strconv.Atoi(v)
			if e != nil || n < 1 || (k == "pageSize" && n > 100) || (k == "page" && n > 10000000) {
				return 0, 0, core.Field(k, "Некорректная страница")
			}
			*p = n
		}
	}
	return page, size, nil
}
func pageRows(items []core.Row, total, page, size int) core.Row {
	return core.Row{"items": items, "total": total, "page": page, "pageSize": size}
}
func same(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
func dbConflict(err error) error {
	var p *pgconn.PgError
	if errors.As(err, &p) && p.Code == "23505" {
		return core.Field("email", "Email или фото уже используются. Обновите страницу")
	}
	return err
}
func duplicateEmailConflict(err error) error {
	var p *pgconn.PgError
	if errors.As(err, &p) && p.Code == "23505" {
		return core.FieldStatus(409, "email", "Этот email уже используется")
	}
	return err
}
