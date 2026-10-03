PRAGMA foreign_keys=OFF;

CREATE TABLE "new_LeagueTradePlayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerNameSnapshot" TEXT NOT NULL,
    "playerClubSnapshot" TEXT NOT NULL,
    "playerPositionSnapshot" TEXT NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueTradePlayer_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LeagueTradeOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradePlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradePlayer_fromMemberId_fkey" FOREIGN KEY ("fromMemberId") REFERENCES "LeagueMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradePlayer_toMemberId_fkey" FOREIGN KEY ("toMemberId") REFERENCES "LeagueMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_LeagueTradePlayer" (
    "id",
    "offerId",
    "playerId",
    "playerNameSnapshot",
    "playerClubSnapshot",
    "playerPositionSnapshot",
    "fromMemberId",
    "toMemberId",
    "createdAt"
)
SELECT
    trade_player."id",
    trade_player."offerId",
    trade_player."playerId",
    player."name",
    player."club",
    player."position",
    trade_player."fromMemberId",
    trade_player."toMemberId",
    trade_player."createdAt"
FROM "LeagueTradePlayer" AS trade_player
INNER JOIN "Player" AS player ON player."id" = trade_player."playerId";

DROP TABLE "LeagueTradePlayer";
ALTER TABLE "new_LeagueTradePlayer" RENAME TO "LeagueTradePlayer";

CREATE INDEX "LeagueTradePlayer_playerId_idx" ON "LeagueTradePlayer"("playerId");
CREATE INDEX "LeagueTradePlayer_fromMemberId_idx" ON "LeagueTradePlayer"("fromMemberId");
CREATE INDEX "LeagueTradePlayer_toMemberId_idx" ON "LeagueTradePlayer"("toMemberId");
CREATE UNIQUE INDEX "LeagueTradePlayer_offerId_playerId_key" ON "LeagueTradePlayer"("offerId", "playerId");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
