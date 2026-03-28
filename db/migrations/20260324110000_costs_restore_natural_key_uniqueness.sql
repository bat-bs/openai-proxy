WITH ranked_costs AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY
                model,
                valid_from,
                token_type,
                unit_of_messure,
                is_regional,
                backend_name,
                currency,
                stage_type,
                stage_min_tokens,
                COALESCE(stage_max_tokens, -1)
            ORDER BY id
        ) AS row_num
    FROM costs
)
DELETE FROM costs
USING ranked_costs
WHERE costs.id = ranked_costs.id
  AND ranked_costs.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS costs_natural_key_idx
ON costs (
    model,
    valid_from,
    token_type,
    unit_of_messure,
    is_regional,
    backend_name,
    currency,
    stage_type,
    stage_min_tokens,
    COALESCE(stage_max_tokens, -1)
);
