package migrate

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
	"teachem/api-go/internal/core"
)

//go:embed sql/*.sql
var files embed.FS

// Run retains Prisma's migration journal, so reverting code never replays applied migrations.
func Run(ctx context.Context, s core.Store) error {
	pool, ok := s.DB.(*pgxpool.Pool)
	if !ok {
		return errors.New("migration requires a pool")
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err = conn.Exec(ctx, `SELECT pg_advisory_lock(78429316)`); err != nil {
		return err
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock(78429316)`)
	_, err = conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)`)
	if err != nil {
		return err
	}
	entries, err := files.ReadDir("sql")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		name := strings.TrimSuffix(entry.Name(), ".sql")
		body, err := files.ReadFile("sql/" + entry.Name())
		if err != nil {
			return err
		}
		sum := sha256.Sum256(body)
		checksum := hex.EncodeToString(sum[:])
		var previous string
		var finished bool
		err = conn.QueryRow(ctx, `SELECT checksum,finished_at IS NOT NULL FROM "_prisma_migrations" WHERE migration_name=$1 AND rolled_back_at IS NULL ORDER BY started_at DESC LIMIT 1`, name).Scan(&previous, &finished)
		if err == nil {
			if !finished {
				return fmt.Errorf("unfinished migration %s requires review", name)
			}
			lf := sha256.Sum256([]byte(strings.ReplaceAll(string(body), "\r\n", "\n")))
			crlf := sha256.Sum256([]byte(strings.ReplaceAll(strings.ReplaceAll(string(body), "\r\n", "\n"), "\n", "\r\n")))
			if previous != checksum && previous != hex.EncodeToString(lf[:]) && previous != hex.EncodeToString(crlf[:]) {
				return fmt.Errorf("migration checksum mismatch: %s", name)
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, string(body)); err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),1)`, core.NewID(), checksum, name)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migration %s failed", name)
		}
		if err = tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}
func Seed(s core.Store) error {
	_, err := s.Tx(func(tx core.Store) (any, error) {
		owners, e := tx.Rows(`SELECT id FROM "User" WHERE role='SUPERADMIN'`)
		if e != nil {
			return nil, e
		}
		if len(owners) > 1 {
			return nil, errors.New("multiple owners require review")
		}
		if len(owners) == 0 {
			email := strings.ToLower(strings.TrimSpace(os.Getenv("ADMIN_EMAIL")))
			password := os.Getenv("ADMIN_PASSWORD")
			if email == "" || len(password) > 72 || len([]rune(password)) < 12 || password == "replace-with-a-strong-password" {
				return nil, errors.New("configure initial ADMIN_EMAIL and strong ADMIN_PASSWORD")
			}
			h, e := bcrypt.GenerateFromPassword([]byte(password), 12)
			if e != nil {
				return nil, e
			}
			if _, e = tx.Insert("User", core.Row{"email": email, "passwordHash": string(h), "name": "Администратор", "role": "SUPERADMIN"}); e != nil {
				return nil, e
			}
		}
		for _, setting := range []struct{ key, value string }{{"commissionBps", "1000"}, {"paymentDetails", `""`}} {
			if _, e = tx.Exec(`INSERT INTO "PlatformSetting" (id,key,value,"createdAt","updatedAt") VALUES ($1,$2,$3::jsonb,now(),now()) ON CONFLICT (key) DO NOTHING`, core.NewID(), setting.key, setting.value); e != nil {
				return nil, e
			}
		}
		return core.OK(), nil
	})
	return err
}
