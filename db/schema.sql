CREATE TABLE IF NOT EXISTS apiKeys (
    ApiKey      TEXT NOT NULL PRIMARY KEY,
    UUID        TEXT NOT NULL,
    Owner       TEXT,
    AiApi       TEXT,
    Description TEXT
);