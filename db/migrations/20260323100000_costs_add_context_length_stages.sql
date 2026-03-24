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

-- 3) Backfill GPT-5.4 mini + nano short/long context pricing.
--
-- OpenAI "long context" tier:
-- - prompts with >272K input tokens are priced at 2x input and 1.5x output.
-- - We model this as:
--   short: input_tokens <= 272000
--   long:  input_tokens >= 272001
--
-- NOTE: We keep the existing single-stage rows (now open-ended) and add explicit
-- stage-specific rows. The resolver will pick the most specific stage match.

INSERT INTO "costs" (
    "model",
    "price",
    "valid_from",
    "token_type",
    "unit_of_messure",
    "is_regional",
    "backend_name",
    "currency",
    "stage_type",
    "stage_min_tokens",
    "stage_max_tokens"
) VALUES
    -- gpt-5.4-mini: short (<=272k)
    ('gpt-5.4-mini', 65, CURRENT_DATE, 'input',  '1M', false, 'openai', 'EUR', 'context_length', 0,       272000),
    ('gpt-5.4-mini', 7,  CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR', 'context_length', 0,       272000),
    ('gpt-5.4-mini', 392,CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR', 'context_length', 0,       272000),
    -- gpt-5.4-mini: long (>=272001)
    ('gpt-5.4-mini', 130, CURRENT_DATE, 'input',  '1M', false, 'openai', 'EUR', 'context_length', 272001, NULL),
    ('gpt-5.4-mini', 14,  CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR', 'context_length', 272001, NULL),
    ('gpt-5.4-mini', 588, CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR', 'context_length', 272001, NULL),

    -- gpt-5.4-nano: short (<=272k)
    ('gpt-5.4-nano', 17, CURRENT_DATE, 'input',  '1M', false, 'openai', 'EUR', 'context_length', 0,       272000),
    ('gpt-5.4-nano', 2,  CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR', 'context_length', 0,       272000),
    ('gpt-5.4-nano', 109,CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR', 'context_length', 0,       272000),
    -- gpt-5.4-nano: long (>=272001)
    ('gpt-5.4-nano', 34, CURRENT_DATE, 'input',  '1M', false, 'openai', 'EUR', 'context_length', 272001, NULL),
    ('gpt-5.4-nano', 4,  CURRENT_DATE, 'cached', '1M', false, 'openai', 'EUR', 'context_length', 272001, NULL),
    ('gpt-5.4-nano', 164,CURRENT_DATE, 'output', '1M', false, 'openai', 'EUR', 'context_length', 272001, NULL);

