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
CREATE TABLE IF NOT EXISTS costs (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    model VARCHAR(255) NOT NULL,
    price integer NOT NULL,
    valid_from date DEFAULT now() NOT NULL,
    token_type VARCHAR(255) NOT NULL,
    unit_of_messure VARCHAR(255),
    currency CHAR(3),
    stage_type text NOT NULL DEFAULT 'context_length',
    stage_min_tokens integer NOT NULL DEFAULT 0,
    stage_max_tokens integer NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS costs_natural_key_idx
ON costs (
    model,
    valid_from,
    token_type,
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
    token_count_prompt integer NOT NULL,
    token_count_complete integer NOT NULL,
    model VARCHAR(255)
);
