package commerce

import (
	"math"
	"regexp"
	"teachem/api-go/internal/core"
	"unicode/utf8"
)

func Register(a *core.App) {
	a.Handle("POST", "/api/v1/files/uploads", "", upload)
	a.Handle("POST", "/api/v1/files/{id}/complete", "", complete)
	a.Handle("GET", "/api/v1/files/{id}/download", "", download)
	a.Handle("POST", "/api/v1/enrollments/{id}/payments", "student", createPayment)
	a.Handle("GET", "/api/v1/payments/me", "student", func(c *core.Context) (any, error) { return listPayments(c, c.Actor.ID) })
	a.Handle("GET", "/api/v1/payments/{id}", "", getPayment)
	a.Handle("GET", "/api/v1/payments/{id}/instructions", "", paymentInstructions)
	a.Handle("POST", "/api/v1/payments/{id}/submit", "student", submitPayment)
	a.Handle("GET", "/api/v1/tutors/me/finances", "tutor", finances)
	a.Handle("GET", "/api/v1/tutors/me/payouts", "tutor", func(c *core.Context) (any, error) { return listPayouts(c, c.Actor.ID) })
	a.Handle("GET", "/api/v1/admin/payments", "SUPERADMIN", func(c *core.Context) (any, error) { return listPayments(c, "") })
	a.Handle("POST", "/api/v1/admin/payments/{id}/approve", "SUPERADMIN", func(c *core.Context) (any, error) { return reviewPayment(c, true) })
	a.Handle("POST", "/api/v1/admin/payments/{id}/reject", "SUPERADMIN", func(c *core.Context) (any, error) { return reviewPayment(c, false) })
	a.Handle("GET", "/api/v1/admin/payouts", "SUPERADMIN", func(c *core.Context) (any, error) { return listPayouts(c, "") })
	a.Handle("POST", "/api/v1/admin/payouts/{id}/mark-paid", "SUPERADMIN", markPaid)
	a.Handle("GET", "/api/v1/admin/settings", "SUPERADMIN", func(c *core.Context) (any, error) { return settings(c.Store) })
	a.Handle("PATCH", "/api/v1/admin/settings", "SUPERADMIN", updateSettings)
	a.Handle("GET", "/api/v1/admin/audit-logs", "SUPERADMIN", auditLogs)
	a.Handle("POST", "/api/v1/admin/users/{id}/block", "SUPERADMIN", func(c *core.Context) (any, error) { return block(c, true) })
	a.Handle("POST", "/api/v1/admin/users/{id}/unblock", "SUPERADMIN", func(c *core.Context) (any, error) { return block(c, false) })
}

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func textField(d core.Row, k string, min, max int) (string, error) {
	v, ok := d[k].(string)
	if !ok || utf8.RuneCountInString(v) < min || utf8.RuneCountInString(v) > max {
		return "", core.Field(k, "Некорректная длина текста")
	}
	return v, nil
}
func integerField(d core.Row, k string, min, max int) (int, error) {
	v, ok := d[k].(float64)
	if !ok || math.IsNaN(v) || math.Trunc(v) != v || v < float64(min) || v > float64(max) {
		return 0, core.Field(k, "Укажите целое число в допустимых пределах")
	}
	return int(v), nil
}
func uuidField(d core.Row, k string, optional bool) (string, error) {
	if d[k] == nil && optional {
		return "", nil
	}
	v, ok := d[k].(string)
	if !ok || !uuidPattern.MatchString(v) {
		return "", core.Field(k, "Некорректный идентификатор")
	}
	return v, nil
}
func audit(s core.Store, c *core.Context, action, entity, id string, metadata core.Row) error {
	if metadata == nil {
		metadata = core.Row{}
	}
	_, err := s.Insert("AuditLog", core.Row{"actorId": c.Actor.ID, "action": action, "entityType": entity, "entityId": id, "requestId": c.RequestID, "metadata": metadata})
	return err
}

// Sensitive administrative writes recheck the session within the transaction.
func authority(s core.Store, c *core.Context) error {
	rows, err := s.Rows(`SELECT u.id FROM "AuthSession" s JOIN "User" u ON u.id=s."userId" WHERE s.id=$1 AND u.id=$2 AND s."revokedAt" IS NULL AND s."expiresAt">now() AND s."authVersion"=u."authVersion" AND u.role='SUPERADMIN' AND u."blockedAt" IS NULL AND u."deletedAt" IS NULL AND NOT u."mustChangePassword"`, c.Actor.SessionID, c.Actor.ID)
	if err != nil {
		return err
	}
	if len(rows) != 1 {
		return core.Error(403, "Сессия суперадминистратора завершена")
	}
	return nil
}
