import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('league matchup API route architecture', () => {
  it('keeps routes league-scoped, authorization-gated, and service-backed', () => {
    const matchupsRoute = readRepoFile('src/app/api/leagues/[id]/matchups/route.ts');
    const recalcRoute = readRepoFile(
      'src/app/api/leagues/[id]/matchups/[round]/recalculate/route.ts'
    );
    const lineupRoute = readRepoFile('src/app/api/leagues/[id]/lineups/[round]/route.ts');

    expect(matchupsRoute).toContain('getAuthenticatedUserId');
    expect(matchupsRoute).toContain('getLeagueMembership');
    expect(matchupsRoute).toContain('loadLeagueMatchupReadModel');
    expect(matchupsRoute).toContain('userId');
    expect(matchupsRoute).not.toContain('generateLeagueFixtures');
    expect(matchupsRoute).toContain('Fixtures are published from Competition Rules');
    expect(matchupsRoute).toContain('export async function GET');
    expect(matchupsRoute).toContain('export async function POST');

    expect(recalcRoute).toContain('getAuthenticatedUserId');
    expect(recalcRoute).toContain('getLeagueMembership');
    expect(recalcRoute).toContain('recalculateLeagueRoundMatchups');
    expect(recalcRoute).not.toContain('scoreHeadToHeadCategories;');
    expect(recalcRoute).not.toContain('calculateStandingsRows;');

    expect(lineupRoute).toContain('getAuthenticatedUserId');
    expect(lineupRoute).toContain('getLeagueMembership');
    expect(lineupRoute).toContain('loadMemberLineup');
    expect(lineupRoute).toContain('saveMemberLineup');
    expect(lineupRoute).not.toContain('requestedPlayers');
    expect(lineupRoute).toContain('export async function GET');
    expect(lineupRoute).toContain('export async function PATCH');
  });
});
