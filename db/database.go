package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
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

func DatabaseInit() {
	createTable, err := os.ReadFile("db/schema.sql")
	if err != nil {
		log.Fatal("cannot load schema file: ", err)
	}

	d := NewDB()
	defer d.Close()
	d.Migrate()
	if _, err := d.db.Exec(string(createTable)); err != nil {
		log.Fatal(err)
	}

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

// func (d *Database) CheckAndCreateUser(sub string) string {

// }

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

type User struct {
	Name    string
	Sub     string
	IsAdmin bool
}

func (d *Database) GetUser(uid string) (*User, error) {
	var sub string
	var name sql.NullString
	var isadmin sql.NullBool
	err := d.db.QueryRow("SELECT id,name,is_admin FROM users WHERE id = $1", uid).Scan(&sub, &name, &isadmin)
	if err != nil {
		return nil, err
	}
	return &User{
		Name:    name.String,
		Sub:     sub,
		IsAdmin: isadmin.Bool,
	}, nil

}

func (d *Database) WriteUser(userClaim *User) (err error) {

	userDB, err1 := d.GetUser(userClaim.Sub)
	if err1 == sql.ErrNoRows {
		_, err := d.db.Exec("INSERT INTO users (id,name,is_admin) VALUES ($1, $2, $3)", userClaim.Sub, userClaim.Name, userClaim.IsAdmin)
		if err != nil {
			log.Printf("User Insert Failed: %v", err)
			return err
		}
		return nil
	} else if err1 != nil {
		log.Println("Error reading User in DB: ", err1)
		return err1
	} else if userClaim.Name != userDB.Name {
		_, err := d.db.Exec("UPDATE users SET name=$1 WHERE id=$2", userClaim.Name, userClaim.Sub)
		if err != nil {
			log.Printf("User updating Failed: %v", err)
		}
	} else if userClaim.IsAdmin != userDB.IsAdmin {
		_, err := d.db.Exec("UPDATE users SET is_admin=$1 WHERE id=$2", userClaim.IsAdmin, userClaim.Sub)
		if err != nil {
			log.Printf("User updating Failed: %v", err)
		}
	}
	return nil
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

type RequestSummary struct {
	Uid                string
	Name               string
	RequestTime        time.Time
	TokenCountPrompt   int
	TokenCountComplete int
}

func (d *Database) LookupApiKeyUserStats(uid string, filter string) ([]RequestSummary, error) {
	dateTrunc := "day"
	if filter == "24 Hours" {
		dateTrunc = "hour"
	}

	query := fmt.Sprintf(`
		SELECT
			u.id,
			SUM(r.token_count_prompt),
			SUM(r.token_count_complete),
			date_trunc('%s', r.request_time) AS request_hour
		FROM requests r
		INNER JOIN apikeys a ON r.api_key_id = a.UUID
		INNER JOIN users u on a.Owner = u.id 
		WHERE 
			u.id = $1
			AND r.request_time >= NOW() - INTERVAL '%s'
		GROUP BY u.id, request_hour
		ORDER BY request_hour;`,
		dateTrunc, filter)

	rows, err := d.db.Query(query, uid)
	if err != nil {
		return nil, err
	}
	var summary []RequestSummary
	for rows.Next() {
		var rq RequestSummary
		if err := rows.Scan(&rq.Uid, &rq.TokenCountPrompt, &rq.TokenCountComplete, &rq.RequestTime); err != nil {
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
		if err := rows.Scan(&rq.Name, &rq.Uid, &tokenprompt, &tokencomplete); err != nil {
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
