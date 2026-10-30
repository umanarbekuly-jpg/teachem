package commerce

import (
	"encoding/json"
	"teachem/api-go/internal/core"
)

func settings(s core.Store) (core.Row, error) {
	rows, err := s.Rows(`SELECT key,value FROM "PlatformSetting"`)
	if err != nil {
		return nil, err
	}
	result := core.Row{"commissionBps": 1000, "paymentDetails": ""}
	for _, r := range rows {
		k := core.Str(r, "key")
		if k == "commissionBps" || k == "paymentDetails" {
			result[k] = r["value"]
		}
	}
	return result, nil
}
func payment(s core.Store, id string) (core.Row, error) {
	return s.One(`SELECT p.*,coalesce((SELECT jsonb_agg(h ORDER BY h."createdAt") FROM "PaymentStatusHistory" h WHERE h."paymentId"=p.id),'[]'::jsonb) AS history FROM "Payment" p WHERE p.id=$1`, id)
}
func history(s core.Store, id, actor string, from any, to string, reason any) error {
	_, err := s.Insert("PaymentStatusHistory", core.Row{"paymentId": id, "actorId": actor, "fromStatus": from, "toStatus": to, "reason": reason})
	return err
}
func listPayments(c *core.Context, student string) (any, error) {
	page, size, err := core.Page(c)
	if err != nil {
		return nil, err
	}
	status := c.R.URL.Query().Get("status")
	if status != "" && status != "pending" && status != "awaiting_review" && status != "approved" && status != "rejected" {
		return nil, core.Field("status", "Недопустимый статус")
	}
	where := ` FROM "Payment" p JOIN "Enrollment" e ON e.id=p."enrollmentId" WHERE ($1='' OR e."studentId"::text=$1) AND ($2='' OR p.status::text=$2)`
	total, err := c.Store.One(`SELECT count(*) AS total`+where, student, status)
	if err != nil {
		return nil, err
	}
	items, err := c.Store.Rows(`SELECT p.*,jsonb_build_object('course',jsonb_build_object('id',c.id,'title',c.title),'student',jsonb_build_object('id',u.id,'name',u.name)) AS enrollment FROM "Payment" p JOIN "Enrollment" e ON e.id=p."enrollmentId" JOIN "Course" c ON c.id=e."courseId" JOIN "User" u ON u.id=e."studentId" WHERE ($1='' OR e."studentId"::text=$1) AND ($2='' OR p.status::text=$2) ORDER BY p."createdAt" DESC,p.id LIMIT $3 OFFSET $4`, student, status, size, (page-1)*size)
	if err != nil {
		return nil, err
	}
	return core.Paged(items, core.Int(total, "total"), page, size), nil
}
func listPayouts(c *core.Context, tutor string) (any, error) {
	page, size, err := core.Page(c)
	if err != nil {
		return nil, err
	}
	total, err := c.Store.One(`SELECT count(*) AS total FROM "Payout" WHERE ($1='' OR "tutorId"::text=$1)`, tutor)
	if err != nil {
		return nil, err
	}
	items, err := c.Store.Rows(`SELECT p.*,jsonb_build_object('id',u.id,'name',u.name) AS tutor FROM "Payout" p JOIN "User" u ON u.id=p."tutorId" WHERE ($1='' OR p."tutorId"::text=$1) ORDER BY p."createdAt" DESC,p.id LIMIT $2 OFFSET $3`, tutor, size, (page-1)*size)
	if err != nil {
		return nil, err
	}
	return core.Paged(items, core.Int(total, "total"), page, size), nil
}
func finances(c *core.Context) (any, error) {
	r, err := c.Store.One(`SELECT coalesce(sum("netMinor") FILTER (WHERE status='pending'),0) AS "pendingMinor",coalesce(sum("netMinor") FILTER (WHERE status='paid'),0) AS "paidMinor",coalesce(sum("netMinor"),0) AS "accruedMinor" FROM "Payout" WHERE "tutorId"=$1`, c.Actor.ID)
	if err == nil {
		r["currency"] = "KZT"
	}
	return r, err
}
func saveSetting(s core.Store, key string, value any, actor string) error {
	bytes, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.Exec(`INSERT INTO "PlatformSetting" (id,key,value,"updatedById","createdAt","updatedAt") VALUES ($1,$2,$3::jsonb,$4,now(),now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,"updatedById"=EXCLUDED."updatedById","updatedAt"=now()`, core.NewID(), key, string(bytes), actor)
	return err
}
