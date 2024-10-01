-- atlas:delimiter \n\n\n
ALTER TABLE "requests" ALTER COLUMN "id" DROP IDENTITY;
ALTER TABLE "requests" ALTER COLUMN "id" TYPE VARCHAR(255);
-- atlas:delimiter -- end