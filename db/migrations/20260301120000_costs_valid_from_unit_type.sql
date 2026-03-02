-- Modify "costs" table
ALTER TABLE "costs"
    ALTER COLUMN "unit_of_messure" TYPE character varying(255);

ALTER TABLE "costs"
    RENAME COLUMN "request_day" TO "valid_from";
