package commerce

import (
	"strings"
	"teachem/api-go/internal/core"
	"time"
)

func ownPayment(c *core.Context, id string) (core.Row, error) {
	p, err := payment(c.Store, id)
	if err != nil {
		return nil, err
	}
	if c.Actor.Role != "SUPERADMIN" {
		e, err := c.Store.Find("Enrollment", core.Str(p, "enrollmentId"))
		if err != nil {
			return nil, err
		}
		if core.Str(e, "studentId") != c.Actor.ID {
			return nil, core.Error(403, "Это не ваша запись")
		}
	}
	return p, nil
}
func getPayment(c *core.Context) (any, error) { return ownPayment(c, c.ID()) }
func paymentInstructions(c *core.Context) (any, error) {
	p, err := ownPayment(c, c.ID())
	if err != nil {
		return nil, err
	}
	s, err := settings(c.Store)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(core.Str(s, "paymentDetails")) == "" {
		return nil, core.Error(400, "Платформа ещё не настроила реквизиты. Оплата временно недоступна")
	}
	return core.Row{"reference": p["id"], "amountMinor": p["amountMinor"], "currency": "KZT", "details": s["paymentDetails"]}, nil
}
func createPayment(c *core.Context) (any, error) {
	d, err := c.Body("idempotencyKey")
	if err != nil {
		return nil, err
	}
	key, err := uuidField(d, "idempotencyKey", false)
	if err != nil {
		return nil, err
	}
	return c.Store.Tx(func(s core.Store) (any, error) {
		e, err := s.One(`SELECT * FROM "Enrollment" WHERE id=$1 FOR UPDATE`, c.ID())
		if err != nil {
			return nil, err
		}
		if core.Str(e, "studentId") != c.Actor.ID {
			return nil, core.Error(403, "Это не ваша запись")
		}
		course, err := s.One(`SELECT c.* FROM "Course" c JOIN "User" u ON u.id=c."tutorId" WHERE c.id=$1 AND c."deletedAt" IS NULL AND c.status='published' AND u."blockedAt" IS NULL AND u."deletedAt" IS NULL`, e["courseId"])
		if err != nil {
			return nil, err
		}
		config, err := settings(s)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(core.Str(config, "paymentDetails")) == "" {
			return nil, core.Error(400, "Платформа ещё не настроила реквизиты. Оплата временно недоступна")
		}
		old, err := s.Rows(`SELECT * FROM "Payment" WHERE "idempotencyKey"=$1`, key)
		if err != nil {
			return nil, err
		}
		if len(old) > 0 {
			if core.Str(old[0], "enrollmentId") != c.ID() {
				return nil, core.Error(409, "Ключ уже использован")
			}
			return old[0], nil
		}
		unfinished, err := s.Rows(`SELECT * FROM "Payment" WHERE "enrollmentId"=$1 AND status IN ('pending','awaiting_review') ORDER BY "createdAt",id LIMIT 1`, c.ID())
		if err != nil {
			return nil, err
		}
		if len(unfinished) > 0 {
			return unfinished[0], nil
		}
		p, err := s.Insert("Payment", core.Row{"enrollmentId": c.ID(), "amountMinor": course["monthlyPriceMinor"], "durationDays": course["durationDays"], "commissionBps": config["commissionBps"], "idempotencyKey": key})
		if err != nil {
			return nil, err
		}
		if err = history(s, core.Str(p, "id"), c.Actor.ID, nil, "pending", nil); err != nil {
			return nil, err
		}
		return p, nil
	})
}
func submitPayment(c *core.Context) (any, error) {
	d, err := c.Body("receiptAssetId")
	if err != nil {
		return nil, err
	}
	receipt, err := uuidField(d, "receiptAssetId", true)
	if err != nil {
		return nil, err
	}
	if _, err = ownPayment(c, c.ID()); err != nil {
		return nil, err
	}
	return c.Store.Tx(func(s core.Store) (any, error) {
		if receipt != "" {
			if _, err := ownedFile(s, receipt, c.Actor.ID, "receipt"); err != nil {
				return nil, err
			}
		}
		p, err := s.One(`SELECT * FROM "Payment" WHERE id=$1 FOR UPDATE`, c.ID())
		if err != nil {
			return nil, err
		}
		status := core.Str(p, "status")
		if status == "awaiting_review" {
			return payment(s, c.ID())
		}
		if status != "pending" {
			return nil, core.Error(400, "Платёж уже обработан")
		}
		data := core.Row{"status": "awaiting_review", "submittedAt": time.Now().UTC()}
		if receipt != "" {
			data["receiptAssetId"] = receipt
		}
		if _, err = s.Update("Payment", c.ID(), data); err != nil {
			return nil, err
		}
		if err = history(s, c.ID(), c.Actor.ID, "pending", "awaiting_review", nil); err != nil {
			return nil, err
		}
		return payment(s, c.ID())
	})
}
func reviewPayment(c *core.Context, approved bool) (any, error) {
	var reason any
	if !approved {
		d, err := c.Body("reason")
		if err != nil {
			return nil, err
		}
		v, err := textField(d, "reason", 3, 1000)
		if err != nil {
			return nil, err
		}
		reason = v
	} else {
		if _, err := c.Body(); err != nil {
			return nil, err
		}
	}
	return c.Store.Tx(func(s core.Store) (any, error) {
		if err := authority(s, c); err != nil {
			return nil, err
		}
		p, err := s.One(`SELECT * FROM "Payment" WHERE id=$1 FOR UPDATE`, c.ID())
		if err != nil {
			return nil, err
		}
		next := "rejected"
		if approved {
			next = "approved"
		}
		if core.Str(p, "status") == next {
			return payment(s, c.ID())
		}
		if core.Str(p, "status") != "awaiting_review" {
			return nil, core.Error(400, "Платёж не ожидает проверки")
		}
		if _, err = s.Update("Payment", c.ID(), core.Row{"status": next, "reviewerId": c.Actor.ID, "reviewedAt": time.Now().UTC(), "reviewReason": reason}); err != nil {
			return nil, err
		}
		if err = history(s, c.ID(), c.Actor.ID, "awaiting_review", next, reason); err != nil {
			return nil, err
		}
		if approved {
			// Lock the enrollment so two distinct approvals extend access sequentially.
			e, err := s.One(`SELECT * FROM "Enrollment" WHERE id=$1 FOR UPDATE`, p["enrollmentId"])
			if err != nil {
				return nil, err
			}
			if _, err = s.Exec(`UPDATE "Enrollment" SET "accessStartsAt"=coalesce("accessStartsAt",now()),"accessExpiresAt"=greatest(coalesce("accessExpiresAt",now()),now())+($2::double precision*interval '1 day'),"updatedAt"=now() WHERE id=$1`, e["id"], core.Int(p, "durationDays")); err != nil {
				return nil, err
			}
			course, err := s.One(`SELECT * FROM "Course" WHERE id=$1 AND "deletedAt" IS NULL`, e["courseId"])
			if err != nil {
				return nil, err
			}
			gross, commission, net := calculatePayout(int64(core.Int(p, "amountMinor")), int64(core.Int(p, "commissionBps")))
			if _, err = s.Insert("Payout", core.Row{"paymentId": p["id"], "tutorId": course["tutorId"], "grossMinor": gross, "commissionMinor": commission, "netMinor": net}); err != nil {
				return nil, err
			}
		}
		if err = audit(s, c, "payment."+next, "Payment", c.ID(), core.Row{"reason": reason}); err != nil {
			return nil, err
		}
		return payment(s, c.ID())
	})
}
func calculatePayout(amount, bps int64) (gross, commission, net int64) {
	return amount, amount * bps / 10000, amount - amount*bps/10000
}
func markPaid(c *core.Context) (any, error) {
	d, err := c.Body("reference")
	if err != nil {
		return nil, err
	}
	reference, err := textField(d, "reference", 3, 200)
	if err != nil {
		return nil, err
	}
	return c.Store.Tx(func(s core.Store) (any, error) {
		if err := authority(s, c); err != nil {
			return nil, err
		}
		p, err := s.One(`SELECT * FROM "Payout" WHERE id=$1 FOR UPDATE`, c.ID())
		if err != nil {
			return nil, err
		}
		if core.Str(p, "status") != "paid" {
			p, err = s.Update("Payout", c.ID(), core.Row{"status": "paid", "paidAt": time.Now().UTC(), "paidById": c.Actor.ID, "reference": reference})
			if err != nil {
				return nil, err
			}
		}
		if err = audit(s, c, "payout.paid", "Payout", c.ID(), core.Row{"reference": reference}); err != nil {
			return nil, err
		}
		return p, nil
	})
}
