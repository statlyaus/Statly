import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readMigration(name: string) {
  return readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
}

describe('competition governance migration', () => {
  it('copies existing matchup data, restores legacy indexes, and adds the competition-round FK', () => {
    const originalMigration = readMigration('20260704030000_add_league_matchups_scoring');
    const governanceMigration = readMigration('20260714090000_add_league_competition_governance');
    const legacyIndexNames = [
      ...originalMigration.matchAll(/CREATE (?:UNIQUE )?INDEX "(LeagueMatchup_[^"]+)"/g),
    ].map((match) => match[1]);

    expect(governanceMigration).toContain('INSERT INTO "new_LeagueMatchup"');
    expect(governanceMigration).toContain('FROM "LeagueMatchup";');
    expect(governanceMigration).toContain(
      'FOREIGN KEY ("competitionRoundId") REFERENCES "LeagueCompetitionRound" ("id") ON DELETE SET NULL'
    );
    expect(legacyIndexNames).not.toHaveLength(0);
    for (const indexName of legacyIndexNames) {
      expect(governanceMigration).toContain(`INDEX "${indexName}"`);
    }
  });
});
