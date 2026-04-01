CREATE TABLE "DraftEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "draftId" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "payload" TEXT,
  "publishState" BOOLEAN NOT NULL DEFAULT false,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "publishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DraftEvent_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DraftEvent_draftId_createdAt_idx" ON "DraftEvent"("draftId", "createdAt");
CREATE INDEX "DraftEvent_leagueId_createdAt_idx" ON "DraftEvent"("leagueId", "createdAt");
CREATE INDEX "DraftEvent_publishedAt_createdAt_idx" ON "DraftEvent"("publishedAt", "createdAt");
