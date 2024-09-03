package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"regexp"

	"ariga.io/atlas-go-sdk/atlasexec"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type Database struct {
	db *sql.DB
}

type ApiKey struct {
	UUID        string // ID that will be displayed in UI
	ApiKey      string // Backend, not implemented yet
	Owner       string // sub from oidc claims
	AiApi       string // can be openai or azure
	Description string // optional, user can describe his key
}

func DatabaseInit() {
	createTable, err := os.ReadFile("db/schema.sql")
	if err != nil {
		log.Fatal("cannot load schema file: ", err)
	}

	d := NewDB()
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

func (d *Database) Migrate() {
	// Define the execution context, supplying a migration directory
	// and potentially an `atlas.hcl` configuration file using `atlasexec.WithHCL`.
	workdir, err := atlasexec.NewWorkingDir(
		atlasexec.WithMigrations(
			os.DirFS("db/migrations"),
		),
	)
	if err != nil {
		log.Fatalf("failed to load working directory: %v", err)
	}
	// atlasexec works on a temporary directory, so we need to close it
	defer workdir.Close()

	// Initialize the client.
	client, err := atlasexec.NewClient(workdir.Path(), "atlas")
	if err != nil {
		log.Fatalf("failed to initialize client: %v", err)
	}

	var atlasurl string

	var re = regexp.MustCompile(`(postgresql://)(.*)`)
	atlasurl = re.ReplaceAllString(databasePath, `postgres://$2?search_path=public`)

	// Run `atlas migrate apply` on a PSQL database
	res, err := client.MigrateApply(context.Background(), &atlasexec.MigrateApplyParams{
		URL: atlasurl,
	})
	if err != nil {
		log.Fatalf("failed to apply migrations: %v", err)
	}
	fmt.Printf("Applied %d migrations\n", len(res.Applied))
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

func (d *Database) WriteEntry(a *ApiKey) {
	_, err := d.db.Exec("INSERT INTO apiKeys VALUES ($1, $2, $3, $4, $5)", a.UUID, a.ApiKey, a.Owner, a.AiApi, a.Description)
	if err != nil {
		log.Printf("Insert Failed: %v", err)
		return
	}
}
func (d *Database) DeleteEntry(key *string, uid string) {
	log.Println("Deleting Key ", *key)
	_, err := d.db.Exec("DELETE FROM apiKeys WHERE UUID=$1 AND Owner=$2", *key, uid)
	if err != nil {
		log.Printf("Delete Failed: %v", err)
		return
	}

}

func (d *Database) LookupApiKeyInfos(uid string) ([]ApiKey, error) {
	var apikeys []ApiKey
	rows, err := d.db.Query("SELECT UUID,Owner,AiApi,Description FROM apiKeys WHERE Owner=$1", uid)
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		var a ApiKey
		if err := rows.Scan(&a.UUID, &a.Owner, &a.AiApi, &a.Description); err != nil {
			return apikeys, err
		}
		apikeys = append(apikeys, a)
	}
	return apikeys, nil
}

func (d *Database) LookupApiKeys(uid string) ([]ApiKey, error) {
	var apikeys []ApiKey

	// Handle wildcard for ApiKey Comparison
	var rows *sql.Rows
	var err error
	if uid == "*" {
		rows, err = d.db.Query("SELECT ApiKey,Owner FROM apiKeys")
	} else {
		rows, err = d.db.Query("SELECT ApiKey,Owner FROM apiKeys WHERE Owner=$1", uid)
	}
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		var a ApiKey
		if err := rows.Scan(&a.ApiKey, &a.Owner); err != nil {
			return apikeys, err
		}
		apikeys = append(apikeys, a)
	}
	return apikeys, nil
}
