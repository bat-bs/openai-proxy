-- Add endpoint-specific usage types while preserving existing Chat usage.
DO $$ BEGIN
    CREATE TYPE request_type AS ENUM ('CHAT_COMPLETION', 'RERANK');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE billing_unit AS ENUM ('TOKENS', 'SEARCHES');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE model_type AS ENUM ('CHAT_COMPLETION', 'RERANK');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE models
    ADD COLUMN IF NOT EXISTS model_type model_type NOT NULL DEFAULT 'CHAT_COMPLETION';

ALTER TABLE models
    ALTER COLUMN model_type DROP DEFAULT;

ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS request_type request_type NOT NULL DEFAULT 'CHAT_COMPLETION',
    ADD COLUMN IF NOT EXISTS search_units integer;

ALTER TABLE requests
    ALTER COLUMN input_token_count DROP NOT NULL,
    ALTER COLUMN cached_input_token_count DROP NOT NULL,
    ALTER COLUMN output_token_count DROP NOT NULL,
    ALTER COLUMN request_type DROP DEFAULT;

ALTER TABLE requests
    DROP CONSTRAINT IF EXISTS requests_usage_shape_check;

ALTER TABLE requests
    ADD CONSTRAINT requests_usage_shape_check CHECK (
        (
            request_type = 'CHAT_COMPLETION'
            AND input_token_count IS NOT NULL
            AND cached_input_token_count IS NOT NULL
            AND output_token_count IS NOT NULL
            AND search_units IS NULL
        )
        OR
        (
            request_type = 'RERANK'
            AND input_token_count IS NULL
            AND cached_input_token_count IS NULL
            AND output_token_count IS NULL
            AND search_units IS NOT NULL
        )
    );

ALTER TABLE costs
    ADD COLUMN IF NOT EXISTS request_type request_type NOT NULL DEFAULT 'CHAT_COMPLETION',
    ADD COLUMN IF NOT EXISTS billing_unit billing_unit NOT NULL DEFAULT 'TOKENS';

ALTER TABLE costs
    ALTER COLUMN token_type DROP NOT NULL,
    ALTER COLUMN request_type DROP DEFAULT,
    ALTER COLUMN billing_unit DROP DEFAULT;

ALTER TABLE costs
    DROP CONSTRAINT IF EXISTS costs_usage_shape_check;

ALTER TABLE costs
    ADD CONSTRAINT costs_usage_shape_check CHECK (
        (
            request_type = 'CHAT_COMPLETION'
            AND billing_unit = 'TOKENS'
            AND token_type IS NOT NULL
        )
        OR
        (
            request_type = 'RERANK'
            AND billing_unit = 'SEARCHES'
            AND token_type IS NULL
        )
    );

DROP INDEX IF EXISTS costs_natural_key_idx;

CREATE UNIQUE INDEX costs_natural_key_idx
ON costs (
    model,
    valid_from,
    request_type,
    billing_unit,
    COALESCE(token_type, ''),
    unit_of_messure,
    currency,
    stage_type,
    stage_min_tokens,
    COALESCE(stage_max_tokens, -1)
);

INSERT INTO models (id, model_type)
VALUES ('Cohere-rerank-v4.0-fast', 'RERANK')
ON CONFLICT (id) DO UPDATE SET model_type = EXCLUDED.model_type;

INSERT INTO costs (
    model,
    price,
    valid_from,
    request_type,
    billing_unit,
    token_type,
    unit_of_messure,
    currency
)
VALUES (
    'Cohere-rerank-v4.0-fast',
    200,
    CURRENT_DATE,
    'RERANK',
    'SEARCHES',
    NULL,
    '1K',
    'USD'
)
ON CONFLICT DO NOTHING;
