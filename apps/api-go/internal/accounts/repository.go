package accounts

import "teachem/api-go/internal/core"

func currentUser(s core.Store, id string) (core.Row, error) {
	return s.One(`SELECT * FROM "User" WHERE id=$1 AND "deletedAt" IS NULL`, id)
}
func publicSelf(u core.Row) core.Row {
	return core.Pick(u, "id", "name", "surname", "email", "role", "blockedAt", "createdAt", "mustChangePassword", "authVersion")
}
func revoke(s core.Store, id string) error {
	_, e := s.Exec(`UPDATE "AuthSession" SET "revokedAt"=now(),"updatedAt"=now() WHERE "userId"=$1 AND "revokedAt" IS NULL`, id)
	return e
}
func audit(s core.Store, c *core.Context, id, action string, metadata core.Row) error {
	if metadata == nil {
		metadata = core.Row{}
	}
	_, err := s.Insert("AuditLog", core.Row{"actorId": c.Actor.ID, "entityType": "User", "entityId": id, "action": action, "requestId": c.RequestID, "metadata": metadata})
	return err
}
func requireOrdinary(s core.Store, id string) (core.Row, error) {
	u, e := currentUser(s, id)
	if e != nil {
		return nil, e
	}
	if core.Str(u, "role") == "SUPERADMIN" {
		return nil, core.Error(403, "Суперадминистратор защищён. Свои данные меняйте в личном профиле")
	}
	return u, nil
}
func authority(s core.Store, c *core.Context) error {
	rows, e := s.Rows(`SELECT s.id FROM "AuthSession" s JOIN "User" u ON u.id=s."userId" WHERE s.id=$1 AND u.id=$2 AND s."revokedAt" IS NULL AND s."expiresAt">now() AND s."authVersion"=u."authVersion" AND u.role='SUPERADMIN' AND u."blockedAt" IS NULL AND u."deletedAt" IS NULL AND NOT u."mustChangePassword" FOR UPDATE OF s,u`, c.Actor.SessionID, c.Actor.ID)
	if e != nil {
		return e
	}
	if len(rows) != 1 {
		return core.Error(403, "Сессия суперадминистратора завершена")
	}
	return nil
}
func photoAllowed(s core.Store, photo string, owners []string, userID string) error {
	rows, e := s.Rows(`SELECT id FROM "FileAsset" WHERE id=$1 AND status='ready' AND purpose='avatar' AND "ownerId"=ANY($2::uuid[])`, photo, owners)
	if e != nil {
		return e
	}
	if len(rows) != 1 {
		return core.Field("photoAssetId", "Фото недоступно или не проверено")
	}
	rows, e = s.Rows(`SELECT id FROM "TutorProfile" WHERE "photoAssetId"=$1 AND "userId"<>$2`, photo, userID)
	if e != nil {
		return e
	}
	if len(rows) != 0 {
		return core.Field("photoAssetId", "Фото уже используется другим профилем")
	}
	return nil
}
