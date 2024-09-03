CREATE TABLE IF NOT EXISTS apiKeys (
    UUID        varchar(255) NOT NULL PRIMARY KEY,
    ApiKey      VARCHAR(255) NOT NULL ,
    Owner       VARCHAR(255) NOT NULL ,
    AiApi       VARCHAR(255),
    Description VARCHAR(255)
);