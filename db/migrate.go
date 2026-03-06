package database

import (
	"context"
	"fmt"
	"log"
	"os"
	"regexp"
	"strconv"
	"time"

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
	maxAttempts := migrationMaxAttempts()
	retryDelay := migrationRetryDelay()
	var res *atlasexec.MigrateApply
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		res, err = client.MigrateApply(context.Background(), &atlasexec.MigrateApplyParams{
			URL: atlasurl,
		})
		if err == nil {
			fmt.Printf("Applied %d migrations\n", len(res.Applied))
			return
		}
		if attempt < maxAttempts {
			log.Printf("migration attempt %d/%d failed: %v; retrying in %s", attempt, maxAttempts, err, retryDelay)
			time.Sleep(retryDelay)
		}
	}
	log.Fatalf("failed to apply migrations after %d attempts: %v", maxAttempts, err)
}

func migrationMaxAttempts() int {
	raw := os.Getenv("MIGRATE_MAX_ATTEMPTS")
	if raw == "" {
		return 30
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		log.Printf("invalid MIGRATE_MAX_ATTEMPTS=%q; using default 30", raw)
		return 30
	}
	return v
}

func migrationRetryDelay() time.Duration {
	raw := os.Getenv("MIGRATE_RETRY_DELAY")
	if raw == "" {
		return 2 * time.Second
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		log.Printf("invalid MIGRATE_RETRY_DELAY=%q; using default 2s", raw)
		return 2 * time.Second
	}
	return d
}
