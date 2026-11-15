-- Bloodsucker review fixes (#1343): the sweep records a failing or stuck bite on the bite itself, so
-- it can alert once instead of failing every 5-minute run. Additive: four nullable or defaulted
-- columns. Rollback: drop the four columns.

-- AlterTable
ALTER TABLE "LeagueBite" ADD COLUMN     "failureAlertedAt" TIMESTAMP(3),
ADD COLUMN     "failureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastFailureAt" TIMESTAMP(3),
ADD COLUMN     "lastFailureReason" TEXT;
