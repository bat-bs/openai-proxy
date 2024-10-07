package database

import (
	"context"
	"fmt"
	"log"
	"os"
	"regexp"

	"ariga.io/atlas-go-sdk/atlasexec"
)

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

	var re = regexp.MustCompile(`(postgresql://)([^?]*)(?:\?(.*))?`)
	atlasurl = re.ReplaceAllString(databasePath, `postgres://$2?search_path=public&$3`)

	// Run `atlas migrate apply` on a PSQL database
	res, err := client.MigrateApply(context.Background(), &atlasexec.MigrateApplyParams{
		URL: atlasurl,
	})
	if err != nil {
		log.Fatalf("failed to apply migrations: %v", err)
	}
	fmt.Printf("Applied %d migrations\n", len(res.Applied))
}
