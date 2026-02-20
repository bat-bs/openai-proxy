ALTER TABLE requests
  ADD COLUMN input_token_count integer NOT NULL DEFAULT 0,
  ADD COLUMN cached_input_token_count integer NOT NULL DEFAULT 0,
  ADD COLUMN output_token_count integer NOT NULL DEFAULT 0;

UPDATE requests
  SET input_token_count = token_count_prompt,
      output_token_count = token_count_complete,
      cached_input_token_count = 0;

ALTER TABLE requests
  DROP COLUMN token_count_prompt,
  DROP COLUMN token_count_complete;
