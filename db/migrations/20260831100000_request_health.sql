CREATE TABLE IF NOT EXISTS request_health_settings (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    retention_seconds bigint NOT NULL DEFAULT 2592000 CHECK (retention_seconds > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(255) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO request_health_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS request_health_attempts (
    attempt_id varchar(36) PRIMARY KEY,
    request_id varchar(255),
    endpoint varchar(255) NOT NULL,
    upstream varchar(255) NOT NULL,
    model varchar(255),
    method varchar(16) NOT NULL,
    status_code smallint,
    outcome varchar(32) NOT NULL,
    duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
    first_byte_duration_ms bigint CHECK (first_byte_duration_ms >= 0),
    streaming boolean NOT NULL DEFAULT false,
    client_cancelled boolean NOT NULL DEFAULT false,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT request_health_attempts_status_check CHECK (
        status_code IS NULL OR (status_code >= 100 AND status_code <= 599)
    ),
    CONSTRAINT request_health_attempts_outcome_check CHECK (
        outcome IN (
            'success_2xx', 'redirect_3xx', 'client_error_4xx', 'server_error_5xx',
            'timeout', 'upstream_canceled', 'transport_error', 'caller_canceled'
        )
    )
);

CREATE INDEX IF NOT EXISTS request_health_attempts_started_at_idx
    ON request_health_attempts (started_at);
CREATE INDEX IF NOT EXISTS request_health_attempts_outcome_started_at_idx
    ON request_health_attempts (outcome, started_at);
CREATE INDEX IF NOT EXISTS request_health_attempts_status_started_at_idx
    ON request_health_attempts (status_code, started_at);
