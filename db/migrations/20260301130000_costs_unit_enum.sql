DO $$ BEGIN
    CREATE TYPE cost_unit AS ENUM ('1M', '1K');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "costs"
    ALTER COLUMN "unit_of_messure" TYPE cost_unit
    USING "unit_of_messure"::cost_unit;
