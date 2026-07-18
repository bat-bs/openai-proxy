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
