-- Create "reporting_groups" table
CREATE TABLE "reporting_groups" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "title" character varying(255) NOT NULL,
    "created_by" character varying(255) NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "reporting_groups"
    ADD CONSTRAINT "reporting_groups_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users" ("id")
    ON DELETE CASCADE;

-- Create "reporting_group_members" table
CREATE TABLE "reporting_group_members" (
    "group_id" bigint NOT NULL,
    "user_id" character varying(255) NOT NULL,
    CONSTRAINT "reporting_group_members_pkey" PRIMARY KEY ("group_id", "user_id")
);

ALTER TABLE "reporting_group_members"
    ADD CONSTRAINT "reporting_group_members_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "reporting_groups" ("id")
    ON DELETE CASCADE;

ALTER TABLE "reporting_group_members"
    ADD CONSTRAINT "reporting_group_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id")
    ON DELETE CASCADE;

-- Create "reporting_group_viewers" table
CREATE TABLE "reporting_group_viewers" (
    "group_id" bigint NOT NULL,
    "user_id" character varying(255) NOT NULL,
    CONSTRAINT "reporting_group_viewers_pkey" PRIMARY KEY ("group_id", "user_id")
);

ALTER TABLE "reporting_group_viewers"
    ADD CONSTRAINT "reporting_group_viewers_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "reporting_groups" ("id")
    ON DELETE CASCADE;

ALTER TABLE "reporting_group_viewers"
    ADD CONSTRAINT "reporting_group_viewers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id")
    ON DELETE CASCADE;
