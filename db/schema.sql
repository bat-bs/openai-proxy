CREATE TABLE IF NOT EXISTS apiKeys (
    UUID        TEXT NOT NULL PRIMARY KEY,
    ApiKey      TEXT NOT NULL ,
    Owner       TEXT,
    AiApi       TEXT,
    Description TEXT
);