package learning

import (
	"fmt"
	"teachem/api-go/internal/core"
)

const enrollmentView = `e.*,jsonb_build_object('id',c.id,'title',c.title,'subject',c.subject,'monthlyPriceMinor',c."monthlyPriceMinor",'status',c.status) AS course,jsonb_build_object('id',u.id,'name',u.name) AS student,CASE WHEN e."accessExpiresAt" IS NULL THEN 'inactive' WHEN e."accessExpiresAt">now() THEN 'active' ELSE 'expired' END AS "accessStatus"`

func enrollmentList(c *core.Context, mode string) (any, error) {
	where := `e."studentId"=$1`
	value := c.Actor.ID
	if mode == "course" {
		if _, e := ownCourse(c, c.ID()); e != nil {
			return nil, e
		}
		where = `e."courseId"=$1`
		value = c.ID()
	} else if mode == "tutor" {
		where = `c."tutorId"=$1 AND c."deletedAt" IS NULL`
	}
	return list(c, `SELECT `+enrollmentView+` FROM "Enrollment" e JOIN "Course" c ON c.id=e."courseId" JOIN "User" u ON u.id=e."studentId" WHERE `+where+` ORDER BY e."createdAt" DESC,e.id`, value)
}
func registerEnrollments(a *core.App) {
	a.Handle("GET", "/api/v1/learning/courses/{id}", "", func(c *core.Context) (any, error) { return access(c, c.ID()) })
	a.Handle("POST", "/api/v1/courses/{id}/enrollments", "student", func(c *core.Context) (any, error) {
		if _, e := publicCourse(c, c.ID()); e != nil {
			return nil, e
		}
		_, e := c.Store.Exec(`INSERT INTO "Enrollment" (id,"studentId","courseId","createdAt","updatedAt") VALUES($1,$2,$3,now(),now()) ON CONFLICT ("studentId","courseId") DO NOTHING`, core.NewID(), c.Actor.ID, c.ID())
		if e != nil {
			return nil, e
		}
		return c.Store.One(`SELECT * FROM "Enrollment" WHERE "studentId"=$1 AND "courseId"=$2`, c.Actor.ID, c.ID())
	})
	a.Handle("GET", "/api/v1/enrollments/me", "student", func(c *core.Context) (any, error) { return enrollmentList(c, "student") })
	a.Handle("GET", "/api/v1/courses/{id}/enrollments", "tutor", func(c *core.Context) (any, error) { return enrollmentList(c, "course") })
	a.Handle("GET", "/api/v1/tutors/me/students", "tutor", func(c *core.Context) (any, error) { return enrollmentList(c, "tutor") })
}
func count(s core.Store, query string, args ...any) (int, error) {
	r, e := s.One(fmt.Sprintf("SELECT count(*)::int AS n FROM (%s) AS counted", query), args...)
	return core.Int(r, "n"), e
}
