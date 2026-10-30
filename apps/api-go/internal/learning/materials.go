package learning

import (
	"teachem/api-go/internal/core"
	"time"
)

func materialInput(d core.Row, partial bool) error {
	if e := text(d, "title", 2, 160, !partial); e != nil {
		return e
	}
	if _, ok := d["kind"]; ok || !partial {
		if s := core.Str(d, "kind"); s != "file" && s != "link" {
			return core.Field("kind", "Выберите файл или ссылку")
		}
	}
	if v, ok := d["fileAssetId"]; ok && v != nil {
		if s, ok := v.(string); !ok || !isUUID(s) {
			return core.Field("fileAssetId", "Некорректный файл")
		}
	}
	if v, ok := d["url"]; ok && v != nil {
		if s, ok := v.(string); !ok || !httpsURL(s) {
			return core.Field("url", "Нужна ссылка HTTPS")
		}
	}
	return integer(d, "position", 0, 10000, false)
}
func materialRules(c *core.Context, d core.Row) error {
	if core.Str(d, "kind") == "file" {
		if core.Str(d, "fileAssetId") == "" || core.Str(d, "url") != "" {
			return core.Error(400, "Укажите файл")
		}
		return validateAsset(c, core.Str(d, "fileAssetId"), "material")
	}
	if core.Str(d, "url") == "" || core.Str(d, "fileAssetId") != "" {
		return core.Error(400, "Укажите ссылку")
	}
	return nil
}
func registerMaterials(a *core.App) {
	a.Handle("GET", "/api/v1/courses/{id}/materials", "", func(c *core.Context) (any, error) {
		if _, e := access(c, c.ID()); e != nil {
			return nil, e
		}
		return list(c, `SELECT * FROM "Material" WHERE "courseId"=$1 AND "deletedAt" IS NULL ORDER BY position,id`, c.ID())
	})
	a.Handle("POST", "/api/v1/courses/{id}/materials", "tutor", func(c *core.Context) (any, error) {
		if _, e := ownCourse(c, c.ID()); e != nil {
			return nil, e
		}
		d, e := c.Body("title", "kind", "fileAssetId", "url", "position")
		if e != nil {
			return nil, e
		}
		if e = materialInput(d, false); e != nil {
			return nil, e
		}
		if e = materialRules(c, d); e != nil {
			return nil, e
		}
		d["courseId"] = c.ID()
		return c.Store.Insert("Material", d)
	})
	a.Handle("PATCH", "/api/v1/materials/{id}", "tutor", func(c *core.Context) (any, error) {
		m, e := live(c.Store, "Material", c.ID())
		if e != nil {
			return nil, e
		}
		if _, e = ownCourse(c, core.Str(m, "courseId")); e != nil {
			return nil, e
		}
		d, e := c.Body("title", "kind", "fileAssetId", "url", "position")
		if e != nil {
			return nil, e
		}
		if e = materialInput(d, true); e != nil {
			return nil, e
		}
		if e = materialRules(c, merge(m, d)); e != nil {
			return nil, e
		}
		return c.Store.Update("Material", c.ID(), d)
	})
	a.Handle("DELETE", "/api/v1/materials/{id}", "tutor", func(c *core.Context) (any, error) {
		m, e := live(c.Store, "Material", c.ID())
		if e != nil {
			return nil, e
		}
		if _, e = ownCourse(c, core.Str(m, "courseId")); e != nil {
			return nil, e
		}
		return c.Store.Update("Material", c.ID(), core.Row{"deletedAt": time.Now()})
	})
}
