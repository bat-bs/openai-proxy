CREATE TABLE IF NOT EXISTS company (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    company_name VARCHAR(255) NOT NULL
);


CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) NOT NULL UNIQUE PRIMARY KEY,
    name VARCHAR(255),
    is_admin BOOLEAN,
    company_id bigint REFERENCES company(id)

);

CREATE TABLE IF NOT EXISTS apiKeys (
    UUID        VARCHAR(255) NOT NULL PRIMARY KEY,
    ApiKey      VARCHAR(255) NOT NULL,
    Owner       VARCHAR(255) NOT NULL REFERENCES users(id),
    Description VARCHAR(255)
);

DO $$ BEGIN
    CREATE TYPE request_type AS ENUM ('CHAT_COMPLETION', 'RERANK');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE billing_unit AS ENUM ('TOKENS', 'SEARCHES');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE model_type AS ENUM ('CHAT_COMPLETION', 'RERANK');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE cost_unit AS ENUM ('1M', '1K');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS costs (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    model VARCHAR(255) NOT NULL,
    price integer NOT NULL,
    valid_from date DEFAULT now() NOT NULL,
    request_type request_type NOT NULL,
    billing_unit billing_unit NOT NULL,
    token_type VARCHAR(255),
    unit_of_messure cost_unit,
    currency CHAR(3),
    stage_type text NOT NULL DEFAULT 'context_length',
    stage_min_tokens integer NOT NULL DEFAULT 0,
    stage_max_tokens integer NULL,
    CONSTRAINT costs_usage_shape_check CHECK (
        (
            request_type = 'CHAT_COMPLETION'
            AND billing_unit = 'TOKENS'
            AND token_type IS NOT NULL
        )
        OR
        (
            request_type = 'RERANK'
            AND billing_unit = 'SEARCHES'
            AND token_type IS NULL
        )
    )
);

CREATE TABLE IF NOT EXISTS models (
    id VARCHAR(255) PRIMARY KEY,
    model_type model_type NOT NULL DEFAULT 'CHAT_COMPLETION'
);

CREATE UNIQUE INDEX IF NOT EXISTS costs_natural_key_idx
ON costs (
    model,
    valid_from,
    request_type,
    billing_unit,
    COALESCE(token_type, ''),
    unit_of_messure,
    currency,
    stage_type,
    stage_min_tokens,
    COALESCE(stage_max_tokens, -1)
);

CREATE TABLE IF NOT EXISTS requests (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    api_key_id VARCHAR(255) NOT NULL REFERENCES apiKeys(UUID),
    request_time timestamp with time zone DEFAULT now(),
    request_type request_type NOT NULL,
    input_token_count integer,
    cached_input_token_count integer,
    cache_write_token_count integer NOT NULL DEFAULT 0,
    output_token_count integer,
    search_units integer,
    model VARCHAR(255),
    snapshot_version VARCHAR(255),
    is_approximated boolean NOT NULL DEFAULT false,
    CONSTRAINT requests_usage_shape_check CHECK (
        (
            request_type = 'CHAT_COMPLETION'
            AND input_token_count IS NOT NULL
            AND cached_input_token_count IS NOT NULL
            AND output_token_count IS NOT NULL
            AND search_units IS NULL
        )
        OR
        (
            request_type = 'RERANK'
            AND input_token_count IS NULL
            AND cached_input_token_count IS NULL
            AND output_token_count IS NULL
            AND search_units IS NOT NULL
        )
    )
);

CREATE TABLE IF NOT EXISTS request_statistics_cache_buckets (
    bucket_start timestamptz PRIMARY KEY,
    built_at timestamptz NOT NULL DEFAULT now(),
    invalidated_at timestamptz
);

CREATE TABLE IF NOT EXISTS request_statistics_cache (
    bucket_start timestamptz NOT NULL REFERENCES request_statistics_cache_buckets(bucket_start) ON DELETE CASCADE,
    api_key_id varchar(255) NOT NULL REFERENCES apiKeys(UUID) ON DELETE CASCADE,
    model varchar(255) NOT NULL DEFAULT '',
    request_type request_type NOT NULL,
    request_count bigint NOT NULL DEFAULT 0,
    input_token_count bigint NOT NULL DEFAULT 0,
    cached_input_token_count bigint NOT NULL DEFAULT 0,
    cache_write_token_count bigint NOT NULL DEFAULT 0,
    output_token_count bigint NOT NULL DEFAULT 0,
    search_units bigint NOT NULL DEFAULT 0,
    total_cost_scaled bigint NOT NULL DEFAULT 0,
    input_cost_scaled bigint NOT NULL DEFAULT 0,
    cached_cost_scaled bigint NOT NULL DEFAULT 0,
    cache_write_cost_scaled bigint NOT NULL DEFAULT 0,
    output_cost_scaled bigint NOT NULL DEFAULT 0,
    search_cost_scaled bigint NOT NULL DEFAULT 0,
    currency char(3),
    currency_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
    missing_cost boolean NOT NULL DEFAULT false,
    currency_issue boolean NOT NULL DEFAULT false,
    used_costs jsonb NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT request_statistics_cache_pkey PRIMARY KEY (bucket_start, api_key_id, model, request_type)
);

CREATE TABLE IF NOT EXISTS request_health_settings (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    retention_seconds bigint NOT NULL DEFAULT 2592000 CHECK (retention_seconds > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(255) REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO request_health_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

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
CREATE INDEX IF NOT EXISTS request_health_attempts_started_at_idx ON request_health_attempts (started_at);
CREATE INDEX IF NOT EXISTS request_health_attempts_outcome_started_at_idx ON request_health_attempts (outcome, started_at);
CREATE INDEX IF NOT EXISTS request_health_attempts_status_started_at_idx ON request_health_attempts (status_code, started_at);

CREATE INDEX IF NOT EXISTS request_statistics_cache_bucket_idx
    ON request_statistics_cache (bucket_start);

CREATE INDEX IF NOT EXISTS request_statistics_cache_api_key_bucket_idx
    ON request_statistics_cache (api_key_id, bucket_start);

CREATE OR REPLACE FUNCTION invalidate_request_statistics_cache_for_request()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP <> 'INSERT' AND OLD.request_time IS NOT NULL THEN
        UPDATE request_statistics_cache_buckets
        SET invalidated_at = now()
        WHERE bucket_start = date_trunc('hour', OLD.request_time, 'UTC');
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.request_time IS NOT NULL THEN
        UPDATE request_statistics_cache_buckets
        SET invalidated_at = now()
        WHERE bucket_start = date_trunc('hour', NEW.request_time, 'UTC');
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS requests_invalidate_statistics_cache ON requests;
CREATE TRIGGER requests_invalidate_statistics_cache
AFTER INSERT OR UPDATE OR DELETE ON requests
FOR EACH ROW EXECUTE FUNCTION invalidate_request_statistics_cache_for_request();

CREATE OR REPLACE FUNCTION invalidate_request_statistics_cache_for_cost()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        UPDATE request_statistics_cache_buckets
        SET invalidated_at = now()
        WHERE bucket_start >= (OLD.valid_from::timestamp AT TIME ZONE 'UTC')
          AND EXISTS (
              SELECT 1 FROM request_statistics_cache cached
              WHERE cached.bucket_start = request_statistics_cache_buckets.bucket_start
                AND lower(cached.model) = lower(OLD.model)
                AND cached.request_type = OLD.request_type
          );
    END IF;
    IF TG_OP <> 'DELETE' THEN
        UPDATE request_statistics_cache_buckets
        SET invalidated_at = now()
        WHERE bucket_start >= (NEW.valid_from::timestamp AT TIME ZONE 'UTC')
          AND EXISTS (
              SELECT 1 FROM request_statistics_cache cached
              WHERE cached.bucket_start = request_statistics_cache_buckets.bucket_start
                AND lower(cached.model) = lower(NEW.model)
                AND cached.request_type = NEW.request_type
          );
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS costs_invalidate_statistics_cache ON costs;
CREATE TRIGGER costs_invalidate_statistics_cache
AFTER INSERT OR UPDATE OR DELETE ON costs
FOR EACH ROW EXECUTE FUNCTION invalidate_request_statistics_cache_for_cost();
