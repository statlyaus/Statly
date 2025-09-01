-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LeagueSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rosterSize" INTEGER NOT NULL,
    "benchSize" INTEGER NOT NULL,
    "maxTeams" INTEGER NOT NULL,
    "pickSeconds" INTEGER NOT NULL,
    "allowAutoPick" BOOLEAN NOT NULL DEFAULT true,
    "draftType" TEXT NOT NULL,
    "pickOrder" TEXT NOT NULL DEFAULT 'RANDOM',
    "waiverRule" TEXT NOT NULL DEFAULT 'WEEKLY',
    "startAt" DATETIME NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "enableCaptainSystem" BOOLEAN NOT NULL DEFAULT false,
    "captainMultiplier" REAL NOT NULL DEFAULT 2.0,
    "viceCaptainMultiplier" REAL NOT NULL DEFAULT 1.5
);
INSERT INTO "new_LeagueSettings" ("allowAutoPick", "benchSize", "captainMultiplier", "draftType", "enableCaptainSystem", "id", "locked", "maxTeams", "pickSeconds", "rosterSize", "startAt", "timeZone", "viceCaptainMultiplier") SELECT "allowAutoPick", "benchSize", "captainMultiplier", "draftType", "enableCaptainSystem", "id", "locked", "maxTeams", "pickSeconds", "rosterSize", "startAt", "timeZone", "viceCaptainMultiplier" FROM "LeagueSettings";
DROP TABLE "LeagueSettings";
ALTER TABLE "new_LeagueSettings" RENAME TO "LeagueSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
