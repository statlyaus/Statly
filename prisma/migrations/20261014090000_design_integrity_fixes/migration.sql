-- Design-integrity fixes: enums for League.visibility and LeagueMember.status,
-- missing foreign keys (League.ownerId, QueueItem, LeagueRoster), and removal
-- of indexes made redundant by unique constraints.

-- CreateEnum
CREATE TYPE "LeagueVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "LeagueMemberStatus" AS ENUM ('ACTIVE', 'INVITED', 'DECLINED', 'INACTIVE', 'REMOVED');

-- Normalize existing data before casting to enums.
UPDATE "League" SET "visibility" = UPPER(TRIM("visibility"));
UPDATE "League" SET "visibility" = 'PRIVATE' WHERE "visibility" NOT IN ('PUBLIC', 'PRIVATE');
UPDATE "LeagueMember" SET "status" = UPPER(TRIM("status"));
UPDATE "LeagueMember" SET "status" = 'ACTIVE'
WHERE "status" NOT IN ('ACTIVE', 'INVITED', 'DECLINED', 'INACTIVE', 'REMOVED');

-- AlterColumn: cast to enums
ALTER TABLE "League"
  ALTER COLUMN "visibility" DROP DEFAULT,
  ALTER COLUMN "visibility" TYPE "LeagueVisibility" USING "visibility"::"LeagueVisibility",
  ALTER COLUMN "visibility" SET DEFAULT 'PRIVATE';

ALTER TABLE "LeagueMember"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "LeagueMemberStatus" USING "status"::"LeagueMemberStatus",
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- Remove orphaned rows before adding foreign keys.
DELETE FROM "QueueItem" q
WHERE NOT EXISTS (SELECT 1 FROM "LeagueMember" m WHERE m."id" = q."memberId")
   OR NOT EXISTS (SELECT 1 FROM "Player" p WHERE p."id" = q."playerId");

DELETE FROM "LeagueRoster" r
WHERE NOT EXISTS (SELECT 1 FROM "League" l WHERE l."id" = r."leagueId")
   OR NOT EXISTS (SELECT 1 FROM "LeagueMember" m WHERE m."id" = r."memberId");

-- League.ownerId has no safe automatic repair; fail the migration if dangling.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "League" l
    WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = l."ownerId")
  ) THEN
    RAISE EXCEPTION 'League rows with dangling ownerId exist; repair before migrating';
  END IF;
END $$;

-- AddForeignKey
ALTER TABLE "League" ADD CONSTRAINT "League_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueRoster" ADD CONSTRAINT "LeagueRoster_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueRoster" ADD CONSTRAINT "LeagueRoster_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "QueueItem_playerId_idx" ON "QueueItem"("playerId");

-- DropIndex: redundant with the unique constraints on the same columns
DROP INDEX IF EXISTS "User_email_idx";
DROP INDEX IF EXISTS "League_inviteCode_idx";
