package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Row = map[string]any

func Str(r Row, k string) string { v, _ := r[k].(string); return v }
func Int(r Row, k string) int {
	switch v := r[k].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	}
	return 0
}
func Bool(r Row, k string) bool { v, _ := r[k].(bool); return v }
func Pick(r Row, keys ...string) Row {
	out := Row{}
	for _, k := range keys {
		out[k] = r[k]
	}
	return out
}
func NewID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	h := hex.EncodeToString(b)
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}
func OK() Row { return Row{"ok": true} }

type Queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}
type Store struct {
	DB  Queryer
	Ctx context.Context
}

func (s Store) Context() context.Context {
	if s.Ctx != nil {
		return s.Ctx
	}
	return context.Background()
}
func Open(ctx context.Context, url string) (Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return Store{}, errors.New("invalid database configuration")
	}
	delete(cfg.ConnConfig.RuntimeParams, "schema")
	cfg.MaxConns = 20
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return Store{}, err
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return Store{}, err
	}
	return Store{DB: pool, Ctx: ctx}, nil
}
func (s Store) Rows(sql string, args ...any) ([]Row, error) {
	var body []byte
	err := s.DB.QueryRow(s.Context(), "SELECT COALESCE(jsonb_agg(_row),'[]'::jsonb) FROM ("+strings.TrimSuffix(strings.TrimSpace(sql), ";")+") _row", args...).Scan(&body)
	if err != nil {
		return nil, err
	}
	out := []Row{}
	err = json.Unmarshal(body, &out)
	return out, err
}
func (s Store) One(sql string, args ...any) (Row, error) {
	rows, err := s.Rows(sql, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, Error(404, "Запись не найдена")
	}
	return rows[0], nil
}
func (s Store) Exec(sql string, args ...any) (int64, error) {
	tag, err := s.DB.Exec(s.Context(), sql, args...)
	return tag.RowsAffected(), err
}
func (s Store) Find(table, id string) (Row, error) {
	if _, ok := columns[table]; !ok {
		return nil, errors.New("unknown table")
	}
	return s.One(`SELECT * FROM `+quote(table)+` WHERE id=$1`, id)
}
func quote(v string) string { return `"` + strings.ReplaceAll(v, `"`, `""`) + `"` }
func (s Store) write(table, id string, data Row, insert bool) (Row, error) {
	fields, ok := columns[table]
	if !ok {
		return nil, errors.New("unknown table")
	}
	d := Row{}
	for k, v := range data {
		if _, ok := fields[k]; !ok {
			return nil, errors.New("unknown column")
		}
		d[k] = v
	}
	now := time.Now().UTC()
	if insert {
		if _, ok := d["id"]; !ok {
			d["id"] = NewID()
		}
		if _, ok := d["createdAt"]; !ok {
			d["createdAt"] = now
		}
	}
	d["updatedAt"] = now
	keys := make([]string, 0, len(d))
	for k := range d {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	names, values, sets := []string{}, []string{}, []string{}
	args := []any{}
	for i, k := range keys {
		v := d[k]
		typ := fields[k]
		if typ == "Json" {
			encoded, err := json.Marshal(v)
			if err != nil {
				return nil, err
			}
			v = encoded
		}
		if text, ok := v.(string); ok && typ == "DateTime" {
			parsed, err := time.Parse(time.RFC3339Nano, text)
			if err != nil {
				return nil, Field(k, "Некорректная дата")
			}
			v = parsed
		}
		if n, ok := v.(float64); ok && typ == "Int" {
			v = int64(n)
		}
		if strings.HasSuffix(typ, "[]") {
			if list, ok := v.([]any); ok {
				a := make([]string, len(list))
				for j, x := range list {
					str, ok := x.(string)
					if !ok {
						return nil, Field(k, "Некорректный список")
					}
					a[j] = str
				}
				v = a
			}
		}
		args = append(args, v)
		names = append(names, quote(k))
		p := fmt.Sprintf("$%d", i+1)
		values = append(values, p)
		sets = append(sets, quote(k)+"="+p)
	}
	var sql string
	if insert {
		sql = `INSERT INTO ` + quote(table) + ` (` + strings.Join(names, ",") + `) VALUES (` + strings.Join(values, ",") + `)`
	} else {
		args = append(args, id)
		sql = `UPDATE ` + quote(table) + ` SET ` + strings.Join(sets, ",") + fmt.Sprintf(` WHERE id=$%d`, len(args))
	}
	sql += ` RETURNING to_jsonb(` + quote(table) + `.*)`
	var body []byte
	err := s.DB.QueryRow(s.Context(), sql, args...).Scan(&body)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, Error(404, "Запись не найдена")
	}
	if err != nil {
		return nil, err
	}
	out := Row{}
	err = json.Unmarshal(body, &out)
	return out, err
}
func (s Store) Insert(table string, data Row) (Row, error) { return s.write(table, "", data, true) }
func (s Store) Update(table, id string, data Row) (Row, error) {
	return s.write(table, id, data, false)
}
func (s Store) Tx(work func(Store) (any, error)) (any, error) {
	pool, ok := s.DB.(*pgxpool.Pool)
	if !ok {
		return work(s)
	}
	for attempt := 0; attempt < 4; attempt++ {
		value, err := func() (any, error) {
			tx, err := pool.BeginTx(s.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
			if err != nil {
				return nil, err
			}
			defer func() {
				cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				_ = tx.Rollback(cleanup)
			}()
			value, err := work(Store{DB: tx, Ctx: s.Context()})
			if err != nil {
				return nil, err
			}
			return value, tx.Commit(s.Context())
		}()
		if err == nil {
			return value, nil
		}
		var pg *pgconn.PgError
		if errors.As(err, &pg) && (pg.Code == "40001" || pg.Code == "40P01") && attempt < 3 {
			continue
		}
		return nil, err
	}
	return nil, Error(409, "Конфликт данных. Повторите запрос")
}
