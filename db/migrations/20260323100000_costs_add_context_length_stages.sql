-- Add staged pricing (context length) support to the "costs" table.
--
-- Design:
-- - Keep existing single-stage rows working by backfilling defaults:
--   stage_type='context_length', stage_min_tokens=0, stage_max_tokens=NULL (open-ended).
-- - Insert GPT-5.4 short/long context rows (input/cached/output) for the same stage_type.
-- - Change the primary key to a generated `id` so stage_max_tokens can remain NULL.

-- 1) Primary key change: composite PK -> generated `id`.
ALTER TABLE "costs" ADD COLUMN "id" bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE "costs" DROP CONSTRAINT "costs_pkey";
ALTER TABLE "costs" ADD PRIMARY KEY ("id");

-- 2) Stage columns.
ALTER TABLE "costs" ADD COLUMN "stage_type" text NOT NULL DEFAULT 'context_length';
ALTER TABLE "costs" ADD COLUMN "stage_min_tokens" integer NOT NULL DEFAULT 0;
ALTER TABLE "costs" ADD COLUMN "stage_max_tokens" integer NULL;