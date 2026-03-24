package database

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	atlasmigrate "ariga.io/atlas/sql/migrate"
)

func migrationFilePath(t *testing.T, filename string) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime.Caller failed")
	}
	return filepath.Join(filepath.Dir(thisFile), "migrations", filename)
}

func readMigrationFile(t *testing.T, filename string) string {
	t.Helper()
	b, err := os.ReadFile(migrationFilePath(t, filename))
	if err != nil {
		t.Fatalf("read migration file %s: %v", filename, err)
	}
	return string(b)
}

func TestDropBackendPricingColumns_DoesNotContainAzureSpecialCase(t *testing.T) {
	sqlText := readMigrationFile(t, "20260324120000_drop_backend_pricing_columns.sql")
	if strings.Contains(strings.ToLower(sqlText), "azure") {
		t.Fatalf("migration unexpectedly references 'azure'; backend-based deletion would be unsafe")
	}
}

func TestAtlasMigrationChecksum_IsInSync(t *testing.T) {
	// This mirrors the same integrity check Atlas runs before applying migrations,
	// but uses the Atlas Go library instead of requiring the `atlas` CLI binary.
	migrationsDir := filepath.Join(filepath.Dir(migrationFilePath(t, "atlas.sum")), "")
	// migrationFilePath(t, "atlas.sum") points at db/migrations/atlas.sum, so its parent is db/migrations.
	// The extra "" keeps the join explicit and gofmt-stable.
	dir, err := atlasmigrate.NewLocalDir(migrationsDir)
	if err != nil {
		t.Fatalf("atlas migrate new local dir: %v", err)
	}
	if err := atlasmigrate.Validate(dir); err != nil {
		t.Fatalf("atlas migration dir checksum validation failed: %v", err)
	}
}

func TestDropBackendPricingColumns_DedupesByBackendFreeKey(t *testing.T) {
	connStr := os.Getenv("DATABASE_PATH")
	if connStr == "" {
		// Mirrors local-dev/docker-compose default credentials/port.
		connStr = "postgresql://openai:openai_pass@localhost:54329/openai_proxy?sslmode=disable"
	}

	db, err := sql.Open("pgx", connStr)
	if err != nil {
		t.Skipf("cannot open DB connection: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		t.Skipf("cannot connect to Postgres; skipping migration integration test: %v", err)
	}

	// Use a dedicated schema so we can run DDL without touching dev/prod tables.
	schema := "test_mig_drop_backend_pricing_columns_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if _, err := db.ExecContext(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	t.Cleanup(func() {
		// Best-effort cleanup.
		_, _ = db.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	})

	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatalf("db.Conn: %v", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "SET search_path TO "+schema); err != nil {
		t.Fatalf("set search_path: %v", err)
	}

	// Pre-migration shape: costs contains backend dimensions and the old natural key includes backend_name/is_regional.
	if _, err := conn.ExecContext(ctx, `
		CREATE TABLE apikeys (
			uuid VARCHAR(255) NOT NULL PRIMARY KEY,
			aiapi VARCHAR(255)
		)`,
	); err != nil {
		t.Fatalf("create apikeys table: %v", err)
	}

	if _, err := conn.ExecContext(ctx, `
		CREATE TABLE costs (
			id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
			model VARCHAR(255) NOT NULL,
			price integer NOT NULL,
			valid_from date NOT NULL,
			token_type VARCHAR(255) NOT NULL,
			unit_of_messure VARCHAR(255),
			is_regional boolean NOT NULL,
			backend_name VARCHAR(255) NOT NULL,
			currency CHAR(3),
			stage_type text NOT NULL DEFAULT 'context_length',
			stage_min_tokens integer NOT NULL DEFAULT 0,
			stage_max_tokens integer NULL
		)`); err != nil {
		t.Fatalf("create costs table: %v", err)
	}

	if _, err := conn.ExecContext(ctx, `
		CREATE UNIQUE INDEX costs_natural_key_idx
		ON costs (
			model,
			valid_from,
			token_type,
			unit_of_messure,
			is_regional,
			backend_name,
			currency,
			stage_type,
			stage_min_tokens,
			COALESCE(stage_max_tokens, -1)
		)`); err != nil {
		t.Fatalf("create old unique index: %v", err)
	}

	validFrom := "2026-03-23"
	model := "gpt-5.4-mini"
	tokenType := "input"
	unitOfMeasure := "1M"
	currency := "EUR"
	stageType := "context_length"

	// Remaining backend-free natural keys:
	// K1: stage_min_tokens=0, stage_max_tokens=NULL (has both azure and non-azure rows; dedupe should keep newest by id)
	// K3: stage_min_tokens=272001, stage_max_tokens=NULL (non-azure only; must not be deleted just because azure exists somewhere)
	const (
		k1StageMin   = 0
		k3StageMin   = 272001
		priceAzureK1 = 100
		priceNonK1   = 200
		priceNonK3   = 300
	)

	var idAzureK1 int64
	var idNonK1 int64
	var idNonK3 int64

	if err := conn.QueryRowContext(ctx, `
		INSERT INTO costs (
			model, price, valid_from, token_type, unit_of_messure,
			is_regional, backend_name, currency, stage_type, stage_min_tokens, stage_max_tokens
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id`,
		model, priceAzureK1, validFrom, tokenType, unitOfMeasure,
		false, "azure", currency, stageType, k1StageMin, nil,
	).Scan(&idAzureK1); err != nil {
		t.Fatalf("insert azure K1: %v", err)
	}

	if err := conn.QueryRowContext(ctx, `
		INSERT INTO costs (
			model, price, valid_from, token_type, unit_of_messure,
			is_regional, backend_name, currency, stage_type, stage_min_tokens, stage_max_tokens
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id`,
		model, priceNonK1, validFrom, tokenType, unitOfMeasure,
		false, "openai", currency, stageType, k1StageMin, nil,
	).Scan(&idNonK1); err != nil {
		t.Fatalf("insert non-azure K1: %v", err)
	}

	if err := conn.QueryRowContext(ctx, `
		INSERT INTO costs (
			model, price, valid_from, token_type, unit_of_messure,
			is_regional, backend_name, currency, stage_type, stage_min_tokens, stage_max_tokens
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id`,
		model, priceNonK3, validFrom, tokenType, unitOfMeasure,
		false, "openai", currency, stageType, k3StageMin, nil,
	).Scan(&idNonK3); err != nil {
		t.Fatalf("insert non-azure K3: %v", err)
	}

	// Execute the migration SQL directly (avoid Atlas CLI dependency in unit tests).
	migrationSQL := readMigrationFile(t, "20260324120000_drop_backend_pricing_columns.sql")
	// Note: this file is intentionally plain SQL (no PL/pgSQL blocks), so splitting on ';' is safe.
	for _, stmt := range strings.Split(migrationSQL, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		upper := strings.ToUpper(stmt)
		if !(strings.Contains(upper, "BEGIN") ||
			strings.Contains(upper, "COMMIT") ||
			strings.Contains(upper, "DELETE") ||
			strings.Contains(upper, "DROP") ||
			strings.Contains(upper, "ALTER") ||
			strings.Contains(upper, "CREATE")) {
			continue
		}

		if _, err := conn.ExecContext(ctx, stmt); err != nil {
			t.Fatalf("exec migration statement failed: %v\nstmt:\n%s", err, stmt)
		}
	}

	var total int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM costs`).Scan(&total); err != nil {
		t.Fatalf("count costs: %v", err)
	}

	// Distinct backend-free keys expected after dedupe:
	// - K1 (kept newest by id across azure/non-azure)
	// - K3 (non-azure only, must survive)
	if total != 2 {
		t.Fatalf("expected 2 backend-free pricing rows after migration, got %d", total)
	}

	type costKeyRow struct {
		id    int64
		price int
	}

	var k1 costKeyRow
	if err := conn.QueryRowContext(ctx, `
		SELECT id, price
		FROM costs
		WHERE model = $1
		  AND valid_from = $2
		  AND token_type = $3
		  AND unit_of_messure = $4
		  AND currency = $5
		  AND stage_type = $6
		  AND stage_min_tokens = $7
		  AND stage_max_tokens IS NULL
		ORDER BY id DESC
		LIMIT 1`,
		model, validFrom, tokenType, unitOfMeasure, currency, stageType, k1StageMin,
	).Scan(&k1.id, &k1.price); err != nil {
		t.Fatalf("lookup K1: %v", err)
	}

	if k1.id != idNonK1 {
		t.Fatalf("expected K1 kept row id=%d (newest by id), got %d", idNonK1, k1.id)
	}
	if k1.price != priceNonK1 {
		t.Fatalf("expected K1 price=%d (from newest row), got %d", priceNonK1, k1.price)
	}

	var k3 costKeyRow
	if err := conn.QueryRowContext(ctx, `
		SELECT id, price
		FROM costs
		WHERE model = $1
		  AND valid_from = $2
		  AND token_type = $3
		  AND unit_of_messure = $4
		  AND currency = $5
		  AND stage_type = $6
		  AND stage_min_tokens = $7
		  AND stage_max_tokens IS NULL
		ORDER BY id DESC
		LIMIT 1`,
		model, validFrom, tokenType, unitOfMeasure, currency, stageType, k3StageMin,
	).Scan(&k3.id, &k3.price); err != nil {
		t.Fatalf("lookup K3: %v", err)
	}

	if k3.id != idNonK3 {
		t.Fatalf("expected K3 kept row id=%d (only row in that backend-free key), got %d", idNonK3, k3.id)
	}
	if k3.price != priceNonK3 {
		t.Fatalf("expected K3 price=%d, got %d", priceNonK3, k3.price)
	}

	// Ensure backend columns were actually dropped.
	var backendCols int
	if err := conn.QueryRowContext(ctx, fmt.Sprintf(`
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema = %s
		  AND table_name = 'costs'
		  AND column_name IN ('backend_name', 'is_regional')`,
		// Avoid SQL injection by using a fixed, controlled identifier for schema.
		// (schema is generated locally and should only include [a-z0-9_].)
		quoteLiteral(schema),
	)).Scan(&backendCols); err != nil {
		t.Fatalf("check dropped columns: %v", err)
	}
	if backendCols != 0 {
		t.Fatalf("expected backend dimension columns to be dropped, found %d remaining columns", backendCols)
	}

	var aiapiCols int
	if err := conn.QueryRowContext(ctx, fmt.Sprintf(`
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema = %s
		  AND table_name = 'apikeys'
		  AND column_name = 'aiapi'`,
		quoteLiteral(schema),
	)).Scan(&aiapiCols); err != nil {
		t.Fatalf("check dropped aiapi column: %v", err)
	}
	if aiapiCols != 0 {
		t.Fatalf("expected apikeys.aiapi to be dropped, found %d remaining", aiapiCols)
	}
}

func quoteLiteral(s string) string {
	// Minimal SQL literal quoting for test-only identifiers.
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}
