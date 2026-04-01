PRAGMA foreign_keys=OFF;

CREATE TABLE "new_LeagueMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "draftSlot" INTEGER,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueMember_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_LeagueMember" ("id", "leagueId", "userId", "role", "teamName", "draftSlot", "joinedAt")
SELECT "id", "leagueId", "userId", "role", "teamName", "draftSlot", "joinedAt"
FROM "LeagueMember";

DROP TABLE "LeagueMember";
ALTER TABLE "new_LeagueMember" RENAME TO "LeagueMember";

CREATE INDEX "LeagueMember_leagueId_idx" ON "LeagueMember"("leagueId");
CREATE INDEX "LeagueMember_userId_idx" ON "LeagueMember"("userId");
CREATE INDEX "LeagueMember_leagueId_userId_idx" ON "LeagueMember"("leagueId", "userId");
CREATE INDEX "LeagueMember_draftSlot_idx" ON "LeagueMember"("draftSlot");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
