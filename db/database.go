package database

import (
	"database/sql"
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
	UUID               string // ID that will be displayed in UI
	ApiKey             string // Backend, not implemented yet
	Owner              string // sub from oidc claims or name string on return
	AiApi              string // can be openai or azure
	Description        string // optional, user can describe his key
	TokenCountPrompt   *int
	TokenCountComplete *int
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
	_, err := d.db.Exec("INSERT INTO apiKeys VALUES ($1, $2, $3, $4, $5)", a.UUID, a.ApiKey, a.Owner, a.AiApi, a.Description)
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
	ID                 string
	ApiKeyID           string
	TokenCountPrompt   int // Tokens of the Request (string) by the user
	TokenCountComplete int // Tokens of the Response from the API
	Model              string
}

func (d *Database) WriteRequest(r *Request) error {
	_, err := d.db.Exec("INSERT INTO requests (id,api_key_id,token_count_prompt,token_count_complete,model) VALUES ($1,$2,$3,$4,$5)", r.ID, r.ApiKeyID, r.TokenCountPrompt, r.TokenCountComplete, r.Model)
	return err
}

func (d *Database) LookupApiKeyInfos(uid string) ([]ApiKey, error) {
	var apikeys []ApiKey
	rows, err := d.db.Query(`
		SELECT a.UUID,a.Owner,a.AiApi,a.Description,SUM(r.token_count_prompt),SUM(r.token_count_complete)
		FROM apiKeys a
		LEFT JOIN requests r ON a.UUID = r.api_key_id
		WHERE Owner=$1
		GROUP BY a.UUID`, uid)
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		var a ApiKey
		if err := rows.Scan(&a.UUID, &a.Owner, &a.AiApi, &a.Description, &a.TokenCountPrompt, &a.TokenCountComplete); err != nil {
			return apikeys, err
		}
		apikeys = append(apikeys, a)
	}
	return apikeys, nil
}

type Costs struct {
	ModelName     string
	RetailPrice   int
	TokenType     string
	UnitOfMeasure string
	IsRegional    bool
	BackendName   string // currently only azure
	Currency      string
	RequestTime   time.Time
}

func (d *Database) WriteCosts(carray []*Costs) error {
	for _, c := range carray {
		_, err := d.db.Exec(`
		INSERT INTO costs
		  (model,price,token_type,unit_of_messure,is_regional,backend_name,currency)
		VALUES
		  ($1, $2, $3, $4, $5, $6, $7)`, c.ModelName, c.RetailPrice, c.TokenType, c.UnitOfMeasure, c.IsRegional, c.BackendName, c.Currency)
		if !strings.Contains(fmt.Sprintf("%s", err), "SQLSTATE 23505") {
			log.Println(err)
		}
		if err == nil {
			log.Printf("%s-costs: Wrote %s-Costs (%v) for Model %s to db. Unit: %s", c.BackendName, c.TokenType, c.RetailPrice, c.ModelName, c.UnitOfMeasure)
		}
	}
	log.Println("Azure: Collecting Prices Done!")
	return nil
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

type RequestSummary struct {
	ID                 string
	Cost               float64
	Name               string
	Model              string
	RequestTime        time.Time
	IsEstimated        bool
	TokenCountPrompt   int
	TokenCountComplete int
}

func (d *Database) LookupCosts(model string) (carray []Costs) {
	rows, err := d.db.Query("select * from costs where model = $1", model)
	if err != nil {
		return nil
	}

	var c Costs
	for rows.Next() {
		if err := rows.Scan(&c.ModelName, &c.RetailPrice, &c.RequestTime, &c.TokenType, &c.UnitOfMeasure, &c.IsRegional, &c.BackendName, &c.Currency); err != nil {
			log.Println("DB Error for looking up costs: ", err)
			return carray
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

	query := fmt.Sprintf("SELECT count(*) FROM requests r INNER JOIN apikeys a ON a.UUID = r.api_key_id INNER JOIN users u on a.Owner = u.id WHERE %s = '%s'", kind, uid)
	val := d.db.QueryRow(query)

	var rowcount *int
	val.Scan(&rowcount)
	return *rowcount, nil

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
			SUM(r.token_count_prompt),
			SUM(r.token_count_complete),
			date_trunc('%[2]s', r.request_time) AS rq_time
		FROM requests r
		INNER JOIN apikeys a ON a.UUID = r.api_key_id 
		INNER JOIN users u on a.Owner = u.id 
		WHERE 
			%[1]s = $1
			AND %[3]s
		GROUP BY %[1]s, r.model, rq_time
		ORDER BY rq_time;`,
		kind, dateTrunc, condition)
	rows, err := d.db.Query(query, uid)
	if err != nil {
		return nil, err
	}
	var summary []RequestSummary
	for rows.Next() {
		var rq RequestSummary
		if err := rows.Scan(&rq.ID, &rq.Model, &rq.TokenCountPrompt, &rq.TokenCountComplete, &rq.RequestTime); err != nil {
			return summary, err
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
				SUM(r.token_count_prompt),
				SUM(r.token_count_complete)
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
		var tokenprompt, tokencomplete sql.NullInt64
		if err := rows.Scan(&rq.Name, &rq.ID, &tokenprompt, &tokencomplete); err != nil {
			return summary, err
		}
		rq.TokenCountPrompt = int(tokenprompt.Int64)
		rq.TokenCountComplete = int(tokencomplete.Int64)
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
		rows, err = d.db.Query("SELECT UUID,ApiKey,Owner FROM apiKeys")
	} else {
		rows, err = d.db.Query("SELECT UUID,ApiKey,Owner FROM apiKeys WHERE Owner=$1", uid)
	}
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		var a ApiKey
		if err := rows.Scan(&a.UUID, &a.ApiKey, &a.Owner); err != nil {
			return apikeys, err
		}
		apikeys = append(apikeys, a)
	}
	return apikeys, nil
}
