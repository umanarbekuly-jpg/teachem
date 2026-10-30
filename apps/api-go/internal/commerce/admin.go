package commerce

import (
	"teachem/api-go/internal/core"
	"time"
)

func updateSettings(c *core.Context) (any, error) {
	d, err := c.Body("commissionBps", "paymentDetails")
	if err != nil {
		return nil, err
	}
	if _, ok := d["commissionBps"]; ok {
		if _, err = integerField(d, "commissionBps", 0, 10000); err != nil {
			return nil, err
		}
	}
	if _, ok := d["paymentDetails"]; ok {
		if _, err = textField(d, "paymentDetails", 10, 5000); err != nil {
			return nil, err
		}
	}
	return c.Store.Tx(func(s core.Store) (any, error) {
		if err := authority(s, c); err != nil {
			return nil, err
		}
		keys := []string{}
		for k, v := range d {
			if err := saveSetting(s, k, v, c.Actor.ID); err != nil {
				return nil, err
			}
			keys = append(keys, k)
		}
		if err := audit(s, c, "settings.update", "PlatformSetting", "platform", core.Row{"keys": keys}); err != nil {
			return nil, err
		}
		return d, nil
	})
}
func auditLogs(c *core.Context) (any, error) {
	page, size, err := core.Page(c)
	if err != nil {
		return nil, err
	}
	total, err := c.Store.One(`SELECT count(*) AS total FROM "AuditLog"`)
	if err != nil {
		return nil, err
	}
	rows, err := c.Store.Rows(`SELECT * FROM "AuditLog" ORDER BY "createdAt" DESC,id LIMIT $1 OFFSET $2`, size, (page-1)*size)
	if err != nil {
		return nil, err
	}
	return core.Paged(rows, core.Int(total, "total"), page, size), nil
}
func block(c *core.Context, blocked bool) (any, error) {
	if _, err := c.Body(); err != nil {
		return nil, err
	}
	if c.ID() == c.Actor.ID {
		return nil, core.Error(400, "Нельзя заблокировать себя")
	}
	return c.Store.Tx(func(s core.Store) (any, error) {
		if err := authority(s, c); err != nil {
			return nil, err
		}
		user, err := s.One(`SELECT * FROM "User" WHERE id=$1 AND "deletedAt" IS NULL FOR UPDATE`, c.ID())
		if err != nil {
			return nil, err
		}
		if core.Str(user, "role") == "SUPERADMIN" {
			return nil, core.Error(400, "Блокировка администратора недоступна")
		}
		var date any
		if blocked {
			date = time.Now().UTC()
		}
		user, err = s.Update("User", c.ID(), core.Row{"blockedAt": date, "authVersion": core.Int(user, "authVersion") + 1})
		if err != nil {
			return nil, err
		}
		if blocked {
			if _, err = s.Exec(`UPDATE "AuthSession" SET "revokedAt"=now(),"updatedAt"=now() WHERE "userId"=$1 AND "revokedAt" IS NULL`, c.ID()); err != nil {
				return nil, err
			}
		}
		action := "user.unblock"
		if blocked {
			action = "user.block"
		}
		if err = audit(s, c, action, "User", c.ID(), nil); err != nil {
			return nil, err
		}
		return core.Pick(user, "id", "name", "surname", "email", "role", "blockedAt", "createdAt", "mustChangePassword", "authVersion"), nil
	})
}
