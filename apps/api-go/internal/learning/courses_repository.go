package learning

import (
	"strings"
	"teachem/api-go/internal/core"
)

func courseGet(c *core.Context, id string) (core.Row, error) {
	r, e := c.Store.One(`SELECT c.*,jsonb_build_object('id',u.id,'name',u.name,'blockedAt',u."blockedAt",'deletedAt',u."deletedAt",'profile',(SELECT to_jsonb(p) FROM "TutorProfile" p WHERE p."userId"=u.id)) AS tutor FROM "Course" c JOIN "User" u ON u.id=c."tutorId" WHERE c.id=$1 AND c."deletedAt" IS NULL`, id)
	if e != nil {
		return nil, e
	}
	return coverView(c, r)
}

func coverView(c *core.Context, r core.Row) (core.Row, error) {
	r["coverUrl"] = nil
	if id := core.Str(r, "coverAssetId"); id != "" {
		f, e := c.Store.Find("FileAsset", id)
		if e != nil {
			return nil, e
		}
		if core.Str(f, "purpose") == "course_cover" && core.Str(f, "status") == "ready" {
			url, e := c.App.Storage.Download(c.R.Context(), core.Str(f, "objectKey"), core.Str(f, "originalName"))
			if e != nil {
				return nil, e
			}
			r["coverUrl"] = url
		}
	}
	return r, nil
}

func canonical(s core.Store, name string) (string, error) {
	name = normalSubject(name)
	for _, std := range subjects {
		if strings.EqualFold(std, name) {
			return std, nil
		}
	}
	r, e := s.Rows(`SELECT subject FROM "Course" WHERE lower(subject)=lower($1) ORDER BY "createdAt",id LIMIT 1`, name)
	if e != nil {
		return "", e
	}
	if len(r) > 0 {
		return core.Str(r[0], "subject"), nil
	}
	return name, nil
}
