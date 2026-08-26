CREATE TABLE IF NOT EXISTS request_statistics_cache_buckets (
    bucket_start timestamptz PRIMARY KEY,
    built_at timestamptz NOT NULL DEFAULT now(),
    invalidated_at timestamptz
);

CREATE TABLE IF NOT EXISTS request_statistics_cache (
    bucket_start timestamptz NOT NULL REFERENCES request_statistics_cache_buckets(bucket_start) ON DELETE CASCADE,
    api_key_id varchar(255) NOT NULL REFERENCES apiKeys(UUID) ON DELETE CASCADE,
    model varchar(255) NOT NULL DEFAULT '',
    request_type request_type NOT NULL,
    request_count bigint NOT NULL DEFAULT 0,
    input_token_count bigint NOT NULL DEFAULT 0,
    cached_input_token_count bigint NOT NULL DEFAULT 0,
    cache_write_token_count bigint NOT NULL DEFAULT 0,
    output_token_count bigint NOT NULL DEFAULT 0,
    search_units bigint NOT NULL DEFAULT 0,
    total_cost_scaled bigint NOT NULL DEFAULT 0,
    input_cost_scaled bigint NOT NULL DEFAULT 0,
    cached_cost_scaled bigint NOT NULL DEFAULT 0,
    cache_write_cost_scaled bigint NOT NULL DEFAULT 0,
    output_cost_scaled bigint NOT NULL DEFAULT 0,
    search_cost_scaled bigint NOT NULL DEFAULT 0,
    currency char(3),
    currency_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
    missing_cost boolean NOT NULL DEFAULT false,
    currency_issue boolean NOT NULL DEFAULT false,
    used_costs jsonb NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT request_statistics_cache_pkey PRIMARY KEY (bucket_start, api_key_id, model, request_type)
);

CREATE INDEX IF NOT EXISTS request_statistics_cache_bucket_idx
    ON request_statistics_cache (bucket_start);

CREATE INDEX IF NOT EXISTS request_statistics_cache_api_key_bucket_idx
    ON request_statistics_cache (api_key_id, bucket_start);

CREATE OR REPLACE FUNCTION invalidate_request_statistics_cache_for_request()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP <> 'INSERT' AND OLD.request_time IS NOT NULL THEN
        UPDATE request_statistics_cache_buckets
        SET invalidated_at = now()
        WHERE bucket_start = date_trunc('hour', OLD.request_time, 'UTC');
    END IF;

    IF TG_OP <> 'DELETE' AND NEW.request_time IS NOT NULL THEN
        UPDATE request_statistics_cache_buckets
        SET invalidated_at = now()
        WHERE bucket_start = date_trunc('hour', NEW.request_time, 'UTC');
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS requests_invalidate_statistics_cache
    ON requests;
CREATE TRIGGER requests_invalidate_statistics_cache
AFTER INSERT OR UPDATE OR DELETE ON requests
FOR EACH ROW
EXECUTE FUNCTION invalidate_request_statistics_cache_for_request();

CREATE OR REPLACE FUNCTION invalidate_request_statistics_cache_for_cost()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        UPDATE request_statistics_cache_buckets
        SET invalidated_at = now()
        WHERE bucket_start >= (OLD.valid_from::timestamp AT TIME ZONE 'UTC')
          AND EXISTS (
              SELECT 1
              FROM request_statistics_cache cached
              WHERE cached.bucket_start = request_statistics_cache_buckets.bucket_start
                AND lower(cached.model) = lower(OLD.model)
                AND cached.request_type = OLD.request_type
          );
    END IF;

    IF TG_OP <> 'DELETE' THEN
        UPDATE request_statistics_cache_buckets
        SET invalidated_at = now()
        WHERE bucket_start >= (NEW.valid_from::timestamp AT TIME ZONE 'UTC')
          AND EXISTS (
              SELECT 1
              FROM request_statistics_cache cached
              WHERE cached.bucket_start = request_statistics_cache_buckets.bucket_start
                AND lower(cached.model) = lower(NEW.model)
                AND cached.request_type = NEW.request_type
          );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS costs_invalidate_statistics_cache
    ON costs;
CREATE TRIGGER costs_invalidate_statistics_cache
AFTER INSERT OR UPDATE OR DELETE ON costs
FOR EACH ROW
EXECUTE FUNCTION invalidate_request_statistics_cache_for_cost();
