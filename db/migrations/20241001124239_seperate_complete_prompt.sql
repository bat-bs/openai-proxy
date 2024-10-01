-- Modify "requests" table
ALTER TABLE "requests" DROP COLUMN "apikey", DROP COLUMN "token_count", ADD COLUMN "api_key_id" character varying(255) NOT NULL, ADD COLUMN "token_count_prompt" integer NOT NULL, ADD COLUMN "token_count_complete" integer NOT NULL, ADD CONSTRAINT "requests_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "apikeys" ("uuid") ON UPDATE NO ACTION ON DELETE NO ACTION;
