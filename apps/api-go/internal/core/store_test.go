package core_test

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/url"
	"os"
	"strings"
	"teachem/api-go/internal/core"
	"testing"
)

func TestTransactionPanicRollsBackAndReleasesConnection(t *testing.T) {
	raw := os.Getenv("TEACHEM_TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("isolated database required")
	}
	u, e := url.Parse(raw)
	if e != nil || !strings.Contains(u.Path, "test") {
		t.Fatal("test database required")
	}
	s, e := core.Open(context.Background(), raw)
	if e != nil {
		t.Fatal(e)
	}
	pool := s.DB.(*pgxpool.Pool)
	defer pool.Close()
	func() {
		defer func() {
			if recover() == nil {
				t.Error("expected panic")
			}
		}()
		_, _ = s.Tx(func(tx core.Store) (any, error) {
			if _, err := tx.Exec(`CREATE TABLE "panic_rollback_probe" (id int)`); err != nil {
				t.Fatal(err)
			}
			panic("synthetic test failure")
		})
	}()
	r, e := s.One(`SELECT to_regclass('public.panic_rollback_probe') AS probe`)
	if e != nil || r["probe"] != nil {
		t.Fatal("transaction was not rolled back")
	}
	if pool.Stat().AcquiredConns() != 0 {
		t.Fatal("connection leaked")
	}
}
