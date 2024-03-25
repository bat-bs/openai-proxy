package api

import (
	"database/sql"
	"log"
	"os"
)

type Database struct {
	db *sql.DB
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

func (d *Database) LookupDatabasePath() string {
	var path string
	var ok bool

	if path, ok = os.LookupEnv("DATABASE_PATH"); !ok {
		return "apiproxy.sqlite"
	}
	return path
}

func (d *Database) WriteEntry(a *ApiKey) {
	_, err := d.db.Exec("INSERT INTO apiKeys VALUES (?, ?, ?, ?)", a.ApiKey, a.Owner, a.AiApi, a.Description)
	if err != nil {
		log.Printf("Insert Failed: %v", err)
		return
	}
}
func (d *Database) DeleteEntry(key *string) {
	log.Println("Deleting Key ", *key)
	_, err := d.db.Exec("DELETE FROM apiKeys WHERE ApiKey=?", *key)
	if err != nil {
		log.Printf("Delete Failed: %v", err)
		return
	}

}

func (d *Database) LookupApiKeyInfos() ([]ApiKey, error) {
	var apikeys []ApiKey
	rows, err := d.db.Query("SELECT ApiKey,Owner,AiApi,Description FROM apiKeys")
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		var a ApiKey
		if err := rows.Scan(&a.ApiKey, &a.Owner, &a.AiApi, &a.Description); err != nil {
			return apikeys, err
		}
		apikeys = append(apikeys, a)
	}
	return apikeys, nil
}

func (d *Database) LookupApiKeys() ([]ApiKey, error) {
	var apikeys []ApiKey
	rows, err := d.db.Query("SELECT ApiKey,Owner FROM apiKeys")
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
