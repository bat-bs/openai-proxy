ALTER TABLE requests
  ADD COLUMN cache_write_token_count integer NOT NULL DEFAULT 0;
