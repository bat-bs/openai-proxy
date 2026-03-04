ALTER TABLE "apikeys"
    ADD COLUMN IF NOT EXISTS "deactivated" boolean NOT NULL DEFAULT false;
