package learning

import (
	"teachem/api-go/internal/core"
)

func validateCourse(d core.Row, create bool) error {
	for _, v := range []struct {
		k        string
		min, max int
	}{{"title", 3, 160}, {"description", 20, 10000}, {"subject", 1, 80}} {
		if v.k == "subject" {
			if s, ok := d[v.k].(string); ok {
				d[v.k] = normalSubject(s)
			}
		}
		if e := text(d, v.k, v.min, v.max, create); e != nil {
			return e
		}
	}
	if e := text(d, "level", 0, 100, false); e != nil {
		return e
	}
	if e := integer(d, "monthlyPriceMinor", 100, 1000000000, create); e != nil {
		return e
	}
	if e := integer(d, "durationDays", 1, 2147483647, false); e != nil {
		return e
	}
	if v, ok := d["coverAssetId"]; ok && v != nil {
		if s, ok := v.(string); !ok || !isUUID(s) {
			return core.Field("coverAssetId", "Некорректная обложка")
		}
	}
	if v, ok := d["tags"]; ok {
		tags, valid := stringsArray(v)
		if !valid || len(tags) > 3 {
			return core.Field("tags", "Разрешено не более 3 хештегов")
		}
		seen := map[string]bool{}
		for i, t := range tags {
			t = normalTag(t)
			if !tagPattern.MatchString(t) || seen[t] {
				return core.Field("tags", "Теги должны быть уникальны: 1–30 букв, цифр или _, без пробелов")
			}
			tags[i] = t
			seen[t] = true
		}
		d["tags"] = tags
	}
	return nil
}
