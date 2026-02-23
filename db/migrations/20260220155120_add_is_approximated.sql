-- Add a flag to track whether token usage was approximated (estimated)
ALTER TABLE IF EXISTS requests
  ADD COLUMN IF NOT EXISTS is_approximated boolean NOT NULL DEFAULT false;
