CREATE TABLE IF NOT EXISTS company (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    company_name VARCHAR(255) NOT NULL
);


CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) NOT NULL UNIQUE PRIMARY KEY,
    name VARCHAR(255),
    company_id bigint REFERENCES company(id)

);

CREATE TABLE IF NOT EXISTS apiKeys (
    UUID        VARCHAR(255) NOT NULL PRIMARY KEY,
    ApiKey      VARCHAR(255) NOT NULL,
    Owner       VARCHAR(255) NOT NULL REFERENCES users(id),
    AiApi       VARCHAR(255),
    Description VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS requests (
    id VARCHAR(255) NOT NULL PRIMARY KEY,
    api_key_id VARCHAR(255) NOT NULL REFERENCES apiKeys(UUID),
    request_time timestamp with time zone DEFAULT now(),
    token_count_prompt integer NOT NULL,
    token_count_complete integer NOT NULL,
    model VARCHAR(255)
);

