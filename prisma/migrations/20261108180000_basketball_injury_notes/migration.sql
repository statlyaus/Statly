-- Fantasy basketball: keep the provider's one-line injury note and fantasy status, and a derived
-- season-ending flag, so a season-ending injury with no real return date is not read as a short
-- absence. Additive: existing rows read as no note, no status, not season-ending until the next
-- injuries run replaces the list. Rollback: drop the three columns.

-- AlterTable
ALTER TABLE "NbaPlayerInjury" ADD COLUMN     "comment" TEXT,
ADD COLUMN     "fantasyStatus" TEXT,
ADD COLUMN     "seasonEnding" BOOLEAN NOT NULL DEFAULT false;
