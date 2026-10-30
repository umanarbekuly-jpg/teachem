package learning

import (
	"net/url"
	"strings"
	"teachem/api-go/internal/core"
	"time"
)

const sessionView = `s.id,s."courseId",s.topic,s."startsAt",s."durationMinutes",s.status,s."createdAt",jsonb_build_object('title',c.title) AS course`

func meetingURL(s string) bool {
	u, e := url.Parse(s)
	return e == nil && httpsURL(s) && strings.EqualFold(u.Hostname(), "meet.google.com") && u.User == nil
}
func sessionInput(d core.Row, partial bool) error {
	if e := text(d, "topic", 2, 160, !partial); e != nil {
		return e
	}
	if e := integer(d, "durationMinutes", 5, 480, !partial); e != nil {
		return e
	}
	if v, ok := d["startsAt"]; ok || !partial {
		s, ok := v.(string)
		if !ok {
			return core.Field("startsAt", "Укажите дату и время")
		}
		t, e := time.Parse(time.RFC3339Nano, s)
		if e != nil {
			for _, layout := range []string{"2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02"} {
				t, e = time.Parse(layout, s)
				if e == nil {
					break
				}
			}
		}
		if e != nil {
			return core.Field("startsAt", "Укажите корректную дату ISO 8601")
		}
		d["startsAt"] = t
	}
	if _, ok := d["joinUrl"]; ok || !partial {
		if !meetingURL(core.Str(d, "joinUrl")) {
			return core.Field("joinUrl", "Нужна ссылка https://meet.google.com/...")
		}
	}
	return nil
}
func sessionGet(c *core.Context, id string) (core.Row, error) {
	return c.Store.One(`SELECT `+sessionView+` FROM "LiveSession" s JOIN "Course" c ON c.id=s."courseId" WHERE s.id=$1 AND s."deletedAt" IS NULL`, id)
}
func registerSessions(a *core.App) {
	a.Handle("GET", "/api/v1/courses/{id}/sessions", "", func(c *core.Context) (any, error) {
		if _, e := access(c, c.ID()); e != nil {
			return nil, e
		}
		return list(c, `SELECT `+sessionView+` FROM "LiveSession" s JOIN "Course" c ON c.id=s."courseId" WHERE s."courseId"=$1 AND s."deletedAt" IS NULL ORDER BY s."startsAt",s.id`, c.ID())
	})
	a.Handle("GET", "/api/v1/sessions/me", "", func(c *core.Context) (any, error) {
		where := `s."courseId" IN (SELECT "courseId" FROM "Enrollment" WHERE "studentId"=$1 AND "accessExpiresAt">now())`
		if c.Actor.Role == "tutor" {
			where = `c."tutorId"=$1 AND c."deletedAt" IS NULL`
		}
		return list(c, `SELECT `+sessionView+` FROM "LiveSession" s JOIN "Course" c ON c.id=s."courseId" WHERE `+where+` AND s."deletedAt" IS NULL ORDER BY s."startsAt",s.id`, c.Actor.ID)
	})
	a.Handle("POST", "/api/v1/courses/{id}/sessions", "tutor", func(c *core.Context) (any, error) {
		if _, e := ownCourse(c, c.ID()); e != nil {
			return nil, e
		}
		d, e := c.Body("topic", "startsAt", "durationMinutes", "joinUrl")
		if e != nil {
			return nil, e
		}
		if e = sessionInput(d, false); e != nil {
			return nil, e
		}
		d["courseId"] = c.ID()
		r, e := c.Store.Insert("LiveSession", d)
		if e != nil {
			return nil, e
		}
		return sessionGet(c, core.Str(r, "id"))
	})
	a.Handle("PATCH", "/api/v1/sessions/{id}", "tutor", func(c *core.Context) (any, error) {
		s, e := live(c.Store, "LiveSession", c.ID())
		if e != nil {
			return nil, e
		}
		if _, e = ownCourse(c, core.Str(s, "courseId")); e != nil {
			return nil, e
		}
		d, e := c.Body("topic", "startsAt", "durationMinutes", "joinUrl")
		if e != nil {
			return nil, e
		}
		if e = sessionInput(d, true); e != nil {
			return nil, e
		}
		if _, e = c.Store.Update("LiveSession", c.ID(), d); e != nil {
			return nil, e
		}
		return sessionGet(c, c.ID())
	})
	a.Handle("POST", "/api/v1/sessions/{id}/cancel", "tutor", func(c *core.Context) (any, error) {
		s, e := live(c.Store, "LiveSession", c.ID())
		if e != nil {
			return nil, e
		}
		if _, e = ownCourse(c, core.Str(s, "courseId")); e != nil {
			return nil, e
		}
		if _, e = c.Store.Update("LiveSession", c.ID(), core.Row{"status": "cancelled"}); e != nil {
			return nil, e
		}
		return sessionGet(c, c.ID())
	})
	a.Handle("GET", "/api/v1/sessions/{id}/join", "", func(c *core.Context) (any, error) {
		s, e := live(c.Store, "LiveSession", c.ID())
		if e != nil {
			return nil, e
		}
		if _, e = access(c, core.Str(s, "courseId")); e != nil {
			return nil, e
		}
		if core.Str(s, "status") == "cancelled" {
			return nil, core.Error(400, "Занятие отменено")
		}
		return core.Row{"url": s["joinUrl"]}, nil
	})
}
