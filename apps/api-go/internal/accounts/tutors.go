package accounts

import (
	"strconv"
	"teachem/api-go/internal/core"
)

func upsertTutor(s core.Store, id string, d core.Row) (core.Row, error) {
	rows, e := s.Rows(`SELECT id FROM "TutorProfile" WHERE "userId"=$1`, id)
	if e != nil {
		return nil, e
	}
	if len(rows) > 0 {
		if len(d) == 0 {
			return s.Find("TutorProfile", core.Str(rows[0], "id"))
		}
		return s.Update("TutorProfile", core.Str(rows[0], "id"), d)
	}
	data := core.Row{"userId": id, "subjects": []string{}, "languages": []string{}}
	for k, v := range d {
		data[k] = v
	}
	return s.Insert("TutorProfile", data)
}
func tutorView(s core.Store, id string) (core.Row, error) {
	return s.One(`SELECT p.*,jsonb_build_object('id',u.id,'name',u.name) AS "user" FROM "TutorProfile" p JOIN "User" u ON p."userId"=u.id WHERE u.id=$1 AND u."blockedAt" IS NULL AND u."deletedAt" IS NULL`, id)
}
func myTutor(c *core.Context) (any, error) {
	_, e := c.Store.Tx(func(s core.Store) (any, error) { return upsertTutor(s, c.Actor.ID, core.Row{}) })
	if e != nil {
		return nil, e
	}
	return tutorView(c.Store, c.Actor.ID)
}
func editTutor(c *core.Context) (any, error) {
	d, e := c.Body("bio", "education", "experienceYears", "subjects", "languages", "photoAssetId")
	if e != nil {
		return nil, e
	}
	if e = profileFields(d); e != nil {
		return nil, e
	}
	if photo := core.Str(d, "photoAssetId"); photo != "" {
		if e = photoAllowed(c.Store, photo, []string{c.Actor.ID}, c.Actor.ID); e != nil {
			return nil, e
		}
	}
	_, e = c.Store.Tx(func(s core.Store) (any, error) { return upsertTutor(s, c.Actor.ID, d) })
	if e != nil {
		return nil, dbConflict(e)
	}
	return tutorView(c.Store, c.Actor.ID)
}
func getTutor(c *core.Context) (any, error) {
	p, e := tutorView(c.Store, c.ID())
	if e != nil {
		return nil, e
	}
	v, e := avatar(c, core.Str(p, "photoAssetId"))
	if e != nil {
		return nil, e
	}
	p["photoUrl"] = v
	return p, nil
}
func listTutors(c *core.Context) (any, error) {
	q := c.R.URL.Query()
	page, size, e := paging(q)
	if e != nil {
		return nil, e
	}
	search, subject := q.Get("search"), q.Get("subject")
	if len([]rune(search)) > 100 || len([]rune(subject)) > 100 {
		return nil, core.Error(400, "Слишком длинный фильтр")
	}
	var from, to any
	for k, dest := range map[string]*any{"priceFromMinor": &from, "priceToMinor": &to} {
		if raw := q.Get(k); raw != "" {
			n, e := strconv.ParseInt(raw, 10, 32)
			if e != nil || n < 0 {
				return nil, core.Field(k, "Укажите неотрицательную цену")
			}
			*dest = n
		}
	}
	where := ` FROM "TutorProfile" p JOIN "User" u ON p."userId"=u.id WHERE u.role='tutor' AND u."blockedAt" IS NULL AND u."deletedAt" IS NULL AND ($1='' OR u.name ILIKE '%'||$1||'%') AND ($2='' OR $2=ANY(p.subjects)) AND (($3::int IS NULL AND $4::int IS NULL) OR EXISTS(SELECT 1 FROM "Course" c WHERE c."tutorId"=u.id AND c.status='published' AND c."deletedAt" IS NULL AND ($2='' OR c.subject=$2) AND ($3::int IS NULL OR c."monthlyPriceMinor">=$3) AND ($4::int IS NULL OR c."monthlyPriceMinor"<=$4)))`
	rows, e := c.Store.Rows(`SELECT p.*,jsonb_build_object('id',u.id,'name',u.name) AS "user"`+where+` ORDER BY p."createdAt" DESC LIMIT $5 OFFSET $6`, search, subject, from, to, size, (page-1)*size)
	if e != nil {
		return nil, e
	}
	count, e := c.Store.One(`SELECT count(*) AS total`+where, search, subject, from, to)
	if e != nil {
		return nil, e
	}
	return pageRows(rows, core.Int(count, "total"), page, size), nil
}
