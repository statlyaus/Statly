import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('league matchup schema ownership', () => {
  it('stores scoring mode, lineup settings, fixtures, lineups, scores, and standings in Prisma', () => {
    const schema = readRepoFile('prisma/schema.prisma');

    expect(schema).toContain('enum LeagueScoringMode');
    expect(schema).toContain('H2H_EACH_CATEGORY');
    expect(schema).toContain('H2H_MOST_CATEGORIES');
    expect(schema).toContain('enum LeagueLineupSlot');
    expect(schema).toContain('FWD');
    expect(schema).toContain('DEF');
    expect(schema).toContain('MID');
    expect(schema).toContain('RUC');
    expect(schema).toContain('UTIL');
    expect(schema).toContain('BENCH');
    expect(schema).toContain('enum CategoryDirection');
    expect(schema).toContain('HIGH_WINS');
    expect(schema).toContain('LOW_WINS');
    expect(schema).toContain('scoringMode');
    expect(schema).toContain('lineupSlotsJson');
    expect(schema).toContain('categoryDirectionsJson');
    expect(schema).toContain('scoringSettingsLockedAt');
    expect(schema).toContain('model LeagueMatchup');
    expect(schema).toContain('model LeagueLineup');
    expect(schema).toContain('model LeagueLineupPlayer');
    expect(schema).toContain('model LeagueMatchupScore');
    expect(schema).toContain('model LeagueStanding');
    expect(schema).toContain('byeMember');
  });
});
