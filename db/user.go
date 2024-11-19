package database

import (
	"database/sql"
	"log"
)

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
