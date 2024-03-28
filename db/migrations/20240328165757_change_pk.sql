-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_apiKeys" table
CREATE TABLE `new_apiKeys` (
  `UUID` text NOT NULL,
  `ApiKey` text NOT NULL,
  `Owner` text NULL,
  `AiApi` text NULL,
  `Description` text NULL,
  PRIMARY KEY (`UUID`)
);
-- Copy rows from old table "apiKeys" to new temporary table "new_apiKeys"
INSERT INTO `new_apiKeys` (`UUID`, `ApiKey`, `Owner`, `AiApi`, `Description`) SELECT `UUID`, `ApiKey`, `Owner`, `AiApi`, `Description` FROM `apiKeys`;
-- Drop "apiKeys" table after copying rows
DROP TABLE `apiKeys`;
-- Rename temporary table "new_apiKeys" to "apiKeys"
ALTER TABLE `new_apiKeys` RENAME TO `apiKeys`;
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
