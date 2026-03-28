-- Remove backend/regional pricing dimensions.
-- This migration drops pricing columns that are no longer used for stage selection.

BEGIN;

-- Deduplicate using the new backend-free natural key only.
--
-- This migration used to delete rows based on backend_name alone, but backend is
-- no longer part of the model. When multiple backend variants exist for the same
-- remaining key, keep exactly one deterministically:
--   - keep the newest row by `id` (largest `id`)
--   - collapse only rows that share all remaining key columns
WITH ranked_costs AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY
                model,
                valid_from,
                token_type,
                unit_of_messure,
                currency,
                stage_type,
                stage_min_tokens,
                COALESCE(stage_max_tokens, -1)
            ORDER BY id DESC
        ) AS row_num
    FROM costs
)
DELETE FROM costs
USING ranked_costs
WHERE costs.id = ranked_costs.id
  AND ranked_costs.row_num > 1;

DROP INDEX IF EXISTS costs_natural_key_idx;

ALTER TABLE costs DROP COLUMN IF EXISTS is_regional;
ALTER TABLE costs DROP COLUMN IF EXISTS backend_name;

ALTER TABLE apikeys DROP COLUMN IF EXISTS aiapi;

-- Recreate the unique index without backend/regional columns.
CREATE UNIQUE INDEX IF NOT EXISTS costs_natural_key_idx
ON costs (
    model,
    valid_from,
    token_type,
    unit_of_messure,
    currency,
    stage_type,
    stage_min_tokens,
    COALESCE(stage_max_tokens, -1)
);

COMMIT;
