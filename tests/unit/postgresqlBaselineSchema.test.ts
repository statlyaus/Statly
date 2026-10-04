import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Schema facts that the archived SQLite migrations introduced, checked where they now live.
const baseline = readFileSync(
  join(process.cwd(), 'prisma/migrations/20261004000000_postgresql_baseline/migration.sql'),
  'utf8'
);
const socialMessage = baseline.match(/CREATE TABLE "SocialMessage" \([\s\S]*?\n\);/)?.[0] ?? '';

describe('PostgreSQL baseline schema', () => {
  it('stores structured context and only the durable GIPHY identity on chat messages', () => {
    expect(socialMessage).toContain('"contextJson" TEXT,');
    expect(socialMessage).toContain('"giphyId" TEXT,');
    expect(socialMessage).not.toMatch(/url|media|asset/i);
  });

  it('keeps social actor history when a member is removed', () => {
    expect(baseline).toContain(
      'ADD CONSTRAINT "SocialCommand_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL'
    );
  });

  it('scopes matchup uniqueness to the fixture version and links competition rounds', () => {
    expect(baseline).toContain(
      'CREATE UNIQUE INDEX "LeagueMatchup_leagueId_fixtureVersion_round_homeMemberId_aw_key" ON "LeagueMatchup"("leagueId", "fixtureVersion", "round", "homeMemberId", "awayMemberId")'
    );
    expect(baseline).not.toContain('"LeagueMatchup_leagueId_round_homeMemberId_awayMemberId_key"');
    expect(baseline).toContain(
      'FOREIGN KEY ("competitionRoundId") REFERENCES "LeagueCompetitionRound"("id") ON DELETE SET NULL'
    );
  });
});
