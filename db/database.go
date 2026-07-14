package database

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type Database struct {
	db *sql.DB
}

type ApiKey struct {
	UUID                  string // ID that will be displayed in UI
	ApiKey                string // Backend, not implemented yet
	Owner                 string // sub from oidc claims or name string on return
	Description           string // optional, user can describe his key
	Deactivated           bool
	TokenCountPrompt      *int
	TokenCountComplete    *int
	InputTokenCount       int
	CachedInputTokenCount int
	CacheWriteTokenCount  int
	OutputTokenCount      int
	CacheRatioPercent     float64
}

func DatabaseInit() *Database {
	createTable, err := os.ReadFile("db/schema.sql")
	if err != nil {
		log.Fatal("cannot load schema file: ", err)
	}

	d := NewDB()
	d.Migrate()
	if _, err := d.db.Exec(string(createTable)); err != nil {
		log.Fatal(err)
	}
	return d

}

var databasePath string

func NewDB() *Database {
	var d Database

	databasePath = d.LookupDatabasePath()
	var err error
	d.db, err = sql.Open("pgx", databasePath)
	if err != nil {
		log.Fatal(err)
	}
	return &d

}

func (d *Database) Close() {
	d.db.Close()
}

func (d *Database) LookupDatabasePath() string {
	var path string
	var ok bool

	if path, ok = os.LookupEnv("DATABASE_PATH"); !ok {
		username, ok := os.LookupEnv("DATABASE_USERNAME")
		if !ok {
			log.Println("DATABASE_USERNAME unset")
		}
		password, ok := os.LookupEnv("DATABASE_PASSWORD")
		if !ok {
			log.Println("DATABASE_PASSWORD unset")
		}
		host, ok := os.LookupEnv("DATABASE_HOST")
		if !ok {
			log.Println("DATABASE_HOST unset")
		}
		dbname, ok := os.LookupEnv("DATABASE_NAME")
		if !ok {
			log.Println("DATABASE_NAME unset")
		}

		path = fmt.Sprintf("postgresql://%s:%s@%s/%s", username, password, host, dbname)

		return path
	} else {

		return path
	}
}

func (d *Database) WriteEntry(a *ApiKey) error {
	_, err := d.db.Exec(
		"INSERT INTO apiKeys (UUID, ApiKey, Owner, Description, Deactivated) VALUES ($1, $2, $3, $4, $5)",
		a.UUID, a.ApiKey, a.Owner, a.Description, a.Deactivated,
	)
	if err != nil {
		log.Printf("Api-Key Insert Failed: %v", err)
		return err
	}
	return nil
}

func (d *Database) DeleteEntry(key *string, uid string) {
	log.Println("Deleting Key ", *key)
	_, err := d.db.Exec("DELETE FROM apiKeys WHERE UUID=$1 AND Owner=$2", *key, uid)
	if err != nil {
		log.Printf("Delete Failed: %v", err)
		return
	}

}

type Request struct {
	ID                    string
	ApiKeyID              string
	RequestType           string
	TokenCountPrompt      *int // Tokens of the Request (string) by the user
	TokenCountComplete    *int // Tokens of the Response from the API
	InputTokenCount       *int // Total input tokens (may include cached tokens)
	CachedInputTokenCount *int // Tokens already cached (subset of InputTokenCount)
	OutputTokenCount      *int // Output tokens (should match TokenCountComplete)
	SearchUnits           *int
	CacheWriteTokenCount  int // Tokens written to cache, as reported by the API
	Model                 string
	SnapshotVersion       string
	IsApproximated        bool // true if any usage count was estimated, not provided by API
}

const (
	RequestTypeChatCompletion = "CHAT_COMPLETION"
	RequestTypeRerank         = "RERANK"
	BillingUnitTokens         = "TOKENS"
	BillingUnitSearches       = "SEARCHES"
	ModelTypeChatCompletion   = "CHAT_COMPLETION"
	ModelTypeRerank           = "RERANK"
)

func (d *Database) WriteRequest(r *Request) error {
	_, err := d.db.Exec(`
		INSERT INTO requests (
			id, api_key_id,
			request_type,
			input_token_count, cached_input_token_count, cache_write_token_count, output_token_count, search_units,
			model, snapshot_version, is_approximated
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		r.ID, r.ApiKeyID,
		r.RequestType,
		r.InputTokenCount, r.CachedInputTokenCount, r.CacheWriteTokenCount, r.OutputTokenCount, r.SearchUnits,
		r.Model, nullOrString(r.SnapshotVersion), r.IsApproximated,
	)
	return err
}

// WriteRerankRequest records a Rerank usage row idempotently. A repeated write
// for the same upstream ID is safe only when it describes the same request.
func (d *Database) WriteRerankRequest(r *Request) error {
	if strings.TrimSpace(r.ID) == "" {
		return fmt.Errorf("rerank request ID is required")
	}
	result, err := d.db.Exec(`
		INSERT INTO requests (
			id, api_key_id, request_type, search_units, model, snapshot_version, is_approximated
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (id) DO NOTHING`,
		r.ID, r.ApiKeyID, RequestTypeRerank, r.SearchUnits,
		r.Model, nullOrString(r.SnapshotVersion), r.IsApproximated,
	)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected > 0 {
		return nil
	}

	var existing struct {
		ApiKeyID       string
		RequestType    string
		SearchUnits    sql.NullInt64
		Model          sql.NullString
		IsApproximated bool
	}
	err = d.db.QueryRow(`
		SELECT api_key_id, request_type, search_units, model, is_approximated
		FROM requests WHERE id = $1`, r.ID).Scan(
		&existing.ApiKeyID,
		&existing.RequestType,
		&existing.SearchUnits,
		&existing.Model,
		&existing.IsApproximated,
	)
	if err != nil {
		return err
	}
	if existing.ApiKeyID != r.ApiKeyID ||
		existing.RequestType != RequestTypeRerank ||
		(existing.Model.Valid && existing.Model.String != r.Model) ||
		(!existing.Model.Valid && r.Model != "") ||
		existing.IsApproximated != r.IsApproximated ||
		!nullableIntEqual(existing.SearchUnits, r.SearchUnits) {
		return fmt.Errorf("rerank request ID %q already exists with different usage", r.ID)
	}
	return nil
}

func nullableIntEqual(existing sql.NullInt64, value *int) bool {
	if value == nil {
		return !existing.Valid
	}
	return existing.Valid && existing.Int64 == int64(*value)
}

func (d *Database) LookupApiKeyInfos(uid string) ([]ApiKey, error) {
	var apikeys []ApiKey
	rows, err := d.db.Query(`
		SELECT
			a.UUID, a.Owner, a.Description,
			COALESCE(SUM(r.input_token_count), 0),
			COALESCE(SUM(r.cached_input_token_count), 0),
			COALESCE(SUM(r.cache_write_token_count), 0),
			COALESCE(SUM(r.output_token_count), 0)
		FROM apiKeys a
		LEFT JOIN requests r ON a.UUID = r.api_key_id
		WHERE Owner=$1
		GROUP BY a.UUID`, uid)
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		var a ApiKey
		var inputTotal, cachedTotal, cacheWriteTotal, outputTotal int
		if err := rows.Scan(
			&a.UUID, &a.Owner, &a.Description,
			&inputTotal, &cachedTotal, &cacheWriteTotal, &outputTotal,
		); err != nil {
			return apikeys, err
		}
		prompt := inputTotal - cachedTotal - cacheWriteTotal
		if prompt < 0 {
			prompt = 0
		}
		promptValue := prompt
		a.TokenCountPrompt = &promptValue
		a.InputTokenCount = inputTotal
		a.CachedInputTokenCount = cachedTotal
		a.CacheWriteTokenCount = cacheWriteTotal
		a.OutputTokenCount = outputTotal
		outValue := outputTotal
		a.TokenCountComplete = &outValue
		if inputTotal > 0 {
			a.CacheRatioPercent = (float64(cachedTotal) / float64(inputTotal)) * 100
		}
		apikeys = append(apikeys, a)
	}
	return apikeys, nil
}

type Costs struct {
	ID            int64
	ModelName     string
	RetailPrice   int
	RequestType   string
	BillingUnit   string
	TokenType     string
	UnitOfMeasure string
	Currency      string
	RequestTime   time.Time

	// Stage pricing (e.g. context length).
	StageType      string
	StageMinTokens int
	StageMaxTokens *int // NULL means open-ended stage
}

func (d *Database) WriteCosts(carray []*Costs) error {
	for _, c := range carray {
		stageType := c.StageType
		if strings.TrimSpace(stageType) == "" {
			stageType = ContextLengthStageType
		}
		validFrom := c.RequestTime
		if validFrom.IsZero() {
			now := time.Now().UTC()
			validFrom = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		}

		result, err := d.db.Exec(`
		INSERT INTO costs
		  (
		    model, price, valid_from, request_type, billing_unit, token_type, unit_of_messure,
		    currency, stage_type, stage_min_tokens, stage_max_tokens
		  )
		VALUES
		  ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT DO NOTHING`,
			c.ModelName,
			c.RetailPrice,
			validFrom,
			defaultRequestType(c.RequestType),
			defaultBillingUnit(c.BillingUnit),
			c.TokenType,
			c.UnitOfMeasure,
			c.Currency,
			stageType,
			c.StageMinTokens,
			c.StageMaxTokens,
		)
		if err != nil {
			return fmt.Errorf("write cost for %s: %w", c.ModelName, err)
		}
		if err == nil {
			rowsAffected, rowsErr := result.RowsAffected()
			if rowsErr == nil && rowsAffected > 0 {
				log.Printf("costs: Wrote %s-Costs (%v) for Model %s to db. Unit: %s", c.TokenType, c.RetailPrice, c.ModelName, c.UnitOfMeasure)
			}
		}
	}
	log.Println("Azure: Collecting Prices Done!")
	return nil
}

func defaultRequestType(requestType string) string {
	if strings.TrimSpace(requestType) == "" {
		return RequestTypeChatCompletion
	}
	return requestType
}

func defaultBillingUnit(billingUnit string) string {
	if strings.TrimSpace(billingUnit) == "" {
		return BillingUnitTokens
	}
	return billingUnit
}

func (d *Database) LookupModels() []string {
	var models []string
	rows, err := d.db.Query(`select model from requests group by model`)
	if err != nil {
		log.Println(err)
		return nil
	}
	var model string
	for rows.Next() {
		if err := rows.Scan(&model); err != nil {
			return models
		}
		if model == "" {
			continue
		}
		models = append(models, model)
	}
	return models
}

func (d *Database) ListConfiguredModels() ([]string, error) {
	var models []string
	rows, err := d.db.Query(`SELECT id FROM models ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		models = append(models, id)
	}
	return models, nil
}

type ConfiguredModel struct {
	ID        string
	ModelType string
}

func (d *Database) LookupConfiguredModelType(id string) (string, bool, error) {
	var modelType string
	err := d.db.QueryRow(
		`SELECT model_type FROM models WHERE lower(id) = lower($1)`,
		id,
	).Scan(&modelType)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return modelType, true, nil
}

func (d *Database) AddConfiguredModelWithType(id, modelType string) error {
	_, err := d.db.Exec(
		`INSERT INTO models (id, model_type) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		id,
		modelType,
	)
	return err
}

func (d *Database) AddConfiguredModel(id string) error {
	_, err := d.db.Exec(
		`INSERT INTO models (id, model_type) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		id,
		ModelTypeChatCompletion,
	)
	return err
}

func (d *Database) DeleteConfiguredModel(id string) error {
	_, err := d.db.Exec(`DELETE FROM models WHERE id = $1`, id)
	return err
}

type RequestSummary struct {
	ID                    string
	Cost                  float64
	Name                  string
	Model                 string
	RequestTime           time.Time
	IsEstimated           bool
	TokenCountPrompt      int
	TokenCountComplete    int
	InputTokenCount       int
	CachedInputTokenCount int
	CacheWriteTokenCount  int
	OutputTokenCount      int
	SearchUnits           int
	RequestType           string
	CacheRatioPercent     float64
}

func (d *Database) LookupCosts(model string) (carray []Costs) {
	rows, err := d.db.Query(`
		SELECT
			id,
			model,
			price,
			valid_from,
			request_type,
			billing_unit,
			token_type,
			unit_of_messure,
			currency,
			stage_type,
			stage_min_tokens,
			stage_max_tokens
		FROM costs
		WHERE model = $1`, model)
	if err != nil {
		return nil
	}

	var c Costs
	for rows.Next() {
		var currency, requestType, billingUnit, tokenType sql.NullString
		var stageMax sql.NullInt64
		if err := rows.Scan(
			&c.ID,
			&c.ModelName,
			&c.RetailPrice,
			&c.RequestTime,
			&requestType,
			&billingUnit,
			&tokenType,
			&c.UnitOfMeasure,
			&currency,
			&c.StageType,
			&c.StageMinTokens,
			&stageMax,
		); err != nil {
			log.Println("DB Error for looking up costs: ", err)
			return carray
		}
		c.RequestType = requestType.String
		c.BillingUnit = billingUnit.String
		c.TokenType = tokenType.String
		if currency.Valid {
			c.Currency = currency.String
		} else {
			c.Currency = ""
		}
		if stageMax.Valid {
			v := int(stageMax.Int64)
			c.StageMaxTokens = &v
		} else {
			c.StageMaxTokens = nil
		}
		carray = append(carray, c)
	}
	return carray
}

// used to check if cache has to be updated
func (d *Database) LookupApiKeyUserStatsRows(uid string, kind string) (int, error) {
	// handle "user" view for admintable and "apiKey" view for usertable
	if kind == "user" {
		kind = "u.id"
	} else {
		kind = "a.UUID"
	}

	query := fmt.Sprintf("SELECT count(*) FROM requests r INNER JOIN apikeys a ON a.UUID = r.api_key_id INNER JOIN users u on a.Owner = u.id WHERE %s = $1", kind)
	var rowcount int
	if err := d.db.QueryRow(query, uid).Scan(&rowcount); err != nil {
		return 0, err
	}
	return rowcount, nil

}

func GetFilterTruncMap() map[string]string {
	// Define FilterTrunc as Map, as its re-used in api/graph
	return map[string]string{
		"24 Hours":   "hour",
		"30 days":    "day",
		"This Month": "day",
		"Last Month": "day",
		"This Year":  "month",
		"Last Year":  "month",
	}
}

func (d *Database) LookupApiKeyUserStats(uid string, kind string, filter string, overwriteDateTrunc bool) ([]RequestSummary, error) {

	// build sql condition based on filter
	var condition string
	switch filter {
	case "24 Hours":
		condition = "r.request_time >= NOW() - INTERVAL '1 day'"
	case "30 days", "7 days":
		condition = "r.request_time >= NOW() - INTERVAL '1 month'"
	case "This Month":
		condition = `
			r.request_time >= date_trunc('month', current_timestamp)
			AND r.request_time < date_trunc('month', current_timestamp) + interval '1 month'`
	case "Last Month":
		condition = `
			r.request_time >= date_trunc('month', current_timestamp) - interval '1 month'
			AND r.request_time < date_trunc('month', current_timestamp)`
	case "This Year":
		condition = `
			r.request_time >= date_trunc('year', current_timestamp)
			AND r.request_time < date_trunc('year', current_timestamp) + interval '1 year'`
	case "Last Year":
		condition = `
			r.request_time >= date_trunc('year', current_timestamp) - interval '1 year'
			AND r.request_time < date_trunc('year', current_timestamp)`
	default:
		log.Println("Filter did not match", filter)
	}

	// Overwrite Date Trunc if Money as a unit is selected, to calculate costs based of the model costs of the day
	dateTrunc := GetFilterTruncMap()[filter]
	if overwriteDateTrunc && dateTrunc != "hour" {
		dateTrunc = "day"
	}

	// handle "user" view for admintable and "apiKey" view for usertable
	if kind == "user" {
		kind = "u.id"
	} else {
		kind = "a.UUID"
	}

	query := fmt.Sprintf(`
		SELECT
			%[1]s,
			r.model,
			COALESCE(SUM(r.input_token_count), 0),
			COALESCE(SUM(r.cached_input_token_count), 0),
			COALESCE(SUM(r.cache_write_token_count), 0),
			COALESCE(SUM(r.output_token_count), 0),
			COALESCE(SUM(r.search_units), 0),
			r.request_type,
			date_trunc('%[2]s', r.request_time) AS rq_time
		FROM requests r
		INNER JOIN apikeys a ON a.UUID = r.api_key_id 
		INNER JOIN users u on a.Owner = u.id 
		WHERE 
			%[1]s = $1
			AND %[3]s
		GROUP BY %[1]s, r.model, r.request_type, rq_time
		ORDER BY rq_time;`,
		kind, dateTrunc, condition)
	rows, err := d.db.Query(query, uid)
	if err != nil {
		return nil, err
	}
	var summary []RequestSummary
	for rows.Next() {
		var rq RequestSummary
		if err := rows.Scan(&rq.ID, &rq.Model, &rq.InputTokenCount, &rq.CachedInputTokenCount, &rq.CacheWriteTokenCount, &rq.OutputTokenCount, &rq.SearchUnits, &rq.RequestType, &rq.RequestTime); err != nil {
			return summary, err
		}
		rq.TokenCountPrompt = rq.InputTokenCount - rq.CachedInputTokenCount - rq.CacheWriteTokenCount
		if rq.TokenCountPrompt < 0 {
			rq.TokenCountPrompt = 0
		}
		rq.TokenCountComplete = rq.OutputTokenCount
		summary = append(summary, rq)
	}
	return summary, nil
}

func (d *Database) LookupApiKeyUserRequests(uid string, kind string, filter string) ([]RequestSummary, error) {
	// build sql condition based on filter (same rules as LookupApiKeyUserStats)
	var condition string
	switch filter {
	case "24 Hours":
		condition = "r.request_time >= NOW() - INTERVAL '1 day'"
	case "30 days", "7 days":
		condition = "r.request_time >= NOW() - INTERVAL '1 month'"
	case "This Month":
		condition = `
			r.request_time >= date_trunc('month', current_timestamp)
			AND r.request_time < date_trunc('month', current_timestamp) + interval '1 month'`
	case "Last Month":
		condition = `
			r.request_time >= date_trunc('month', current_timestamp) - interval '1 month'
			AND r.request_time < date_trunc('month', current_timestamp)`
	case "This Year":
		condition = `
			r.request_time >= date_trunc('year', current_timestamp)
			AND r.request_time < date_trunc('year', current_timestamp) + interval '1 year'`
	case "Last Year":
		condition = `
			r.request_time >= date_trunc('year', current_timestamp) - interval '1 year'
			AND r.request_time < date_trunc('year', current_timestamp)`
	default:
		log.Println("Filter did not match", filter)
	}

	// handle "user" view for admin table and "apiKey" view for user table
	if kind == "user" {
		kind = "u.id"
	} else {
		kind = "a.UUID"
	}

	query := fmt.Sprintf(`
		SELECT
			u.name,
			r.id,
			r.model,
			COALESCE(r.input_token_count, 0),
			COALESCE(r.cached_input_token_count, 0),
			COALESCE(r.cache_write_token_count, 0),
			COALESCE(r.output_token_count, 0),
			COALESCE(r.search_units, 0),
			r.request_type,
			r.request_time
		FROM requests r
		INNER JOIN apikeys a ON a.UUID = r.api_key_id
		INNER JOIN users u on a.Owner = u.id
		WHERE
			%[1]s = $1
			AND %[2]s
		ORDER BY r.request_time;`,
		kind, condition)

	rows, err := d.db.Query(query, uid)
	if err != nil {
		return nil, err
	}

	var summary []RequestSummary
	for rows.Next() {
		var rq RequestSummary
		if err := rows.Scan(
			&rq.Name,
			&rq.ID,
			&rq.Model,
			&rq.InputTokenCount,
			&rq.CachedInputTokenCount,
			&rq.CacheWriteTokenCount,
			&rq.OutputTokenCount,
			&rq.SearchUnits,
			&rq.RequestType,
			&rq.RequestTime,
		); err != nil {
			return summary, err
		}

		// Keep legacy fields populated for any UI paths that still use prompt/output.
		rq.TokenCountPrompt = rq.InputTokenCount - rq.CachedInputTokenCount - rq.CacheWriteTokenCount
		if rq.TokenCountPrompt < 0 {
			rq.TokenCountPrompt = 0
		}
		rq.TokenCountComplete = rq.OutputTokenCount
		if rq.InputTokenCount > 0 {
			rq.CacheRatioPercent = (float64(rq.CachedInputTokenCount) / float64(rq.InputTokenCount)) * 100
		}
		summary = append(summary, rq)
	}
	return summary, nil
}
func (d *Database) LookupApiKeyUserOverview() ([]RequestSummary, error) {
	var summary []RequestSummary
	rows, err := d.db.Query(`
			SELECT
				u.name,
				u.id,
				COALESCE(SUM(r.input_token_count), 0),
				COALESCE(SUM(r.cached_input_token_count), 0),
				COALESCE(SUM(r.cache_write_token_count), 0),
				COALESCE(SUM(r.output_token_count), 0)
				,COALESCE(SUM(r.search_units), 0)
			FROM apiKeys a
			LEFT JOIN users u on a.Owner = u.id 
			LEFT JOIN requests r ON a.UUID = r.api_key_id
			WHERE 
				u.name IS NOT NULL
				AND u.name <> ''
			GROUP BY u.id, u.name
			`)
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		var rq RequestSummary
		var inputTotal, cachedTotal, cacheWriteTotal, outputTotal sql.NullInt64
		if err := rows.Scan(&rq.Name, &rq.ID, &inputTotal, &cachedTotal, &cacheWriteTotal, &outputTotal, &rq.SearchUnits); err != nil {
			return summary, err
		}
		in := int(inputTotal.Int64)
		cached := int(cachedTotal.Int64)
		cacheWrite := int(cacheWriteTotal.Int64)
		out := int(outputTotal.Int64)
		if in < 0 {
			in = 0
		}
		if cached < 0 {
			cached = 0
		}
		if cacheWrite < 0 {
			cacheWrite = 0
		}
		if out < 0 {
			out = 0
		}
		rq.InputTokenCount = in
		rq.CachedInputTokenCount = cached
		rq.CacheWriteTokenCount = cacheWrite
		rq.OutputTokenCount = out
		if in > 0 {
			rq.CacheRatioPercent = (float64(cached) / float64(in)) * 100
		}
		rq.TokenCountPrompt = in - cached - cacheWrite
		if rq.TokenCountPrompt < 0 {
			rq.TokenCountPrompt = 0
		}
		rq.TokenCountComplete = out
		summary = append(summary, rq)
	}
	return summary, nil
}

func (d *Database) LookupApiKeys(uid string) ([]ApiKey, error) {
	var apikeys []ApiKey

	// Handle wildcard for ApiKey Comparison
	var rows *sql.Rows
	var err error
	if uid == "*" {
		rows, err = d.db.Query("SELECT UUID, ApiKey, Owner, Deactivated FROM apiKeys")
	} else {
		rows, err = d.db.Query("SELECT UUID, ApiKey, Owner, Deactivated FROM apiKeys WHERE Owner=$1", uid)
	}
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		var a ApiKey
		if err := rows.Scan(&a.UUID, &a.ApiKey, &a.Owner, &a.Deactivated); err != nil {
			return apikeys, err
		}
		apikeys = append(apikeys, a)
	}
	return apikeys, nil
}

func nullOrString(val string) interface{} {
	if val == "" {
		return nil
	}
	return val
}
