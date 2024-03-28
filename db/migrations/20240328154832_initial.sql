-- Create "apiKeys" table
CREATE TABLE `apiKeys` (
  `ApiKey` text NOT NULL,
  `Owner` text NULL,
  `AiApi` text NULL,
  `Description` text NULL,
  PRIMARY KEY (`ApiKey`)
);
