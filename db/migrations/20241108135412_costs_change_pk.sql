-- Modify "costs" table
ALTER TABLE "costs" DROP CONSTRAINT "costs_pkey", ALTER COLUMN "token_type" SET NOT NULL, ALTER COLUMN "is_regional" SET NOT NULL, ALTER COLUMN "backend_name" SET NOT NULL, ADD PRIMARY KEY ("model", "request_day", "token_type", "is_regional", "price", "backend_name");
