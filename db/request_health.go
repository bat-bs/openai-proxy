package database

import (
	"context"
	"time"
)

// RequestHealthAttempt is an append-only, payload-free record of one upstream
// attempt. It is intentionally separate from usage accounting because failed
// requests do not have usage records.
type RequestHealthAttempt struct {
	AttemptID         string
	RequestID         string
	Endpoint          string
	Upstream          string
	Model             string
	Method            string
	StatusCode        int
	Outcome           string
	Duration          time.Duration
	FirstByteDuration *time.Duration
	Streaming         bool
	ClientCancelled   bool
	StartedAt         time.Time
	CompletedAt       time.Time
}

const defaultRequestHealthRetention = 30 * 24 * time.Hour

func (d *Database) WriteRequestHealthAttempt(a *RequestHealthAttempt) error {
	return d.WriteRequestHealthAttemptContext(context.Background(), a)
}

func (d *Database) WriteRequestHealthAttemptContext(ctx context.Context, a *RequestHealthAttempt) error {
	_, err := d.db.ExecContext(ctx, `
		INSERT INTO request_health_attempts
		(attempt_id, request_id, endpoint, upstream, model, method, status_code,
		 outcome, duration_ms, first_byte_duration_ms, streaming, client_cancelled, started_at, completed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13, now()),COALESCE($14, now()))
		ON CONFLICT (attempt_id) DO NOTHING`,
		a.AttemptID, nullOrString(a.RequestID), a.Endpoint, a.Upstream,
		nullOrString(a.Model), a.Method, nullableStatus(a.StatusCode), a.Outcome,
		a.Duration.Milliseconds(), nullableDurationMillis(a.FirstByteDuration),
		a.Streaming, a.ClientCancelled, nullableTime(a.StartedAt), nullableTime(a.CompletedAt))
	return err
}

func (d *Database) RequestHealthRetention() (time.Duration, error) {
	var seconds int64
	err := d.db.QueryRow(`
		SELECT retention_seconds
		FROM request_health_settings
		WHERE id = 1`).Scan(&seconds)
	if err != nil {
		return defaultRequestHealthRetention, err
	}
	if seconds <= 0 {
		return defaultRequestHealthRetention, nil
	}
	return time.Duration(seconds) * time.Second, nil
}

func (d *Database) DeleteExpiredRequestHealthAttempts(before time.Time) (int64, error) {
	result, err := d.db.Exec(
		"DELETE FROM request_health_attempts WHERE started_at < $1",
		before.UTC(),
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func nullableStatus(status int) any {
	if status == 0 {
		return nil
	}
	return status
}

func nullableDurationMillis(duration *time.Duration) any {
	if duration == nil {
		return nil
	}
	return duration.Milliseconds()
}

func nullableTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}
