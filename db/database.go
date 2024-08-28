package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"

	"ariga.io/atlas-go-sdk/atlasexec"
	_ "github.com/mattn/go-sqlite3"
)

type Database struct {
	db *sql.DB
}

type ApiKey struct {
	UUID        string
	ApiKey      string
	Owner       string
	AiApi       string // can be openai or azure
	Description string //optional
}

func DatabaseInit() {
	createTable, err := os.ReadFile("db/schema.sql")
	if err != nil {
		log.Fatal("cannot load schema file: ", err)
	}

	d := NewDB()
	if _, err := d.db.Exec(string(createTable)); err != nil {
		log.Fatal(err)
	}
	d.Migrate()

}

var databasePath string

func NewDB() *Database {
	var d Database

	databasePath = d.LookupDatabasePath()
	var err error
	d.db, err = sql.Open("sqlite3", databasePath)
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
	// Run `atlas migrate apply` on a SQLite database under /tmp.
	res, err := client.MigrateApply(context.Background(), &atlasexec.MigrateApplyParams{
		URL: "sqlite://" + databasePath,
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
		return "apiproxy.sqlite"
	}
	return path
}

func (d *Database) WriteEntry(a *ApiKey) {
	_, err := d.db.Exec("INSERT INTO apiKeys VALUES (?, ?, ?, ?, ?)", a.UUID, a.ApiKey, a.Owner, a.AiApi, a.Description)
	if err != nil {
		log.Printf("Insert Failed: %v", err)
		return
	}
}
func (d *Database) DeleteEntry(key *string, uid string) {
	log.Println("Deleting Key ", *key)
	_, err := d.db.Exec("DELETE FROM apiKeys WHERE UUID=? AND Owner=?", *key, uid)
	if err != nil {
		log.Printf("Delete Failed: %v", err)
		return
	}

}

func (d *Database) LookupApiKeyInfos(uid string) ([]ApiKey, error) {
	var apikeys []ApiKey
	rows, err := d.db.Query("SELECT UUID,Owner,AiApi,Description FROM apiKeys WHERE Owner=?", uid)
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
	rows, err := d.db.Query("SELECT ApiKey,Owner FROM apiKeys WHERE Owner=?", uid)
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
