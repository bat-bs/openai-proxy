-- Create "company" table
CREATE TABLE "company" ("id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY, "company_name" character varying(255) NOT NULL, PRIMARY KEY ("id"));
-- Create "users" table
CREATE TABLE "users" ("id" character varying(255) NOT NULL, "company_id" bigint NULL, PRIMARY KEY ("id"), CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION);
-- Create "apikeys" table
CREATE TABLE "apikeys" ("uuid" character varying(255) NOT NULL, "apikey" character varying(255) NOT NULL, "owner" character varying(255) NOT NULL, "aiapi" character varying(255) NULL, "description" character varying(255) NULL, PRIMARY KEY ("uuid"), CONSTRAINT "apikeys_owner_fkey" FOREIGN KEY ("owner") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION);
-- Create "requests" table
CREATE TABLE "requests" ("id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY, "apikey" character varying(255) NOT NULL, "request_time" timestamptz NULL DEFAULT now(), "token_count" integer NOT NULL, "model" character varying(255) NULL, PRIMARY KEY ("id"), CONSTRAINT "requests_apikey_fkey" FOREIGN KEY ("apikey") REFERENCES "apikeys" ("uuid") ON UPDATE NO ACTION ON DELETE NO ACTION);
