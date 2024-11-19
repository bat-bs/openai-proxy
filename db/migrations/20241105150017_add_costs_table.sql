-- Create "costs" table
CREATE TABLE "costs" ("model" character varying(255) NOT NULL, "price" integer NOT NULL, "request_day" date NOT NULL DEFAULT now(), "token_type" character varying(255) NULL, "unit_of_messure" character varying(255) NULL, "is_regional" boolean NULL, "backend_name" character varying(255) NULL, PRIMARY KEY ("model", "request_day", "price"));
