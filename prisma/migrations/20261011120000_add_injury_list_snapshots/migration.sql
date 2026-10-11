-- CreateEnum
CREATE TYPE "InjuryListMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'AMBIGUOUS');

-- CreateTable
CREATE TABLE "InjuryListSnapshot" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "aflSeason" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "matchedCount" INTEGER NOT NULL,
    "unmatchedCount" INTEGER NOT NULL,
    "ambiguousCount" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InjuryListSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InjuryListEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "clubName" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "injuryRaw" TEXT NOT NULL,
    "returnRaw" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "etaWeeksMin" INTEGER,
    "etaWeeksMax" INTEGER,
    "etaDaysMin" INTEGER,
    "etaDaysMax" INTEGER,
    "playerId" TEXT,
    "matchStatus" "InjuryListMatchStatus" NOT NULL,

    CONSTRAINT "InjuryListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InjuryListSnapshot_source_confirmedAt_idx" ON "InjuryListSnapshot"("source", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InjuryListSnapshot_source_contentSha256_key" ON "InjuryListSnapshot"("source", "contentSha256");

-- CreateIndex
CREATE INDEX "InjuryListEntry_snapshotId_idx" ON "InjuryListEntry"("snapshotId");

-- CreateIndex
CREATE INDEX "InjuryListEntry_playerId_idx" ON "InjuryListEntry"("playerId");

-- AddForeignKey
ALTER TABLE "InjuryListEntry" ADD CONSTRAINT "InjuryListEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "InjuryListSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InjuryListEntry" ADD CONSTRAINT "InjuryListEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
