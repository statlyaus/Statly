import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league trade route Firestore architecture', () => {
  it('provides a league-scoped server mutation boundary for trade proposals', () => {
    const routePath = join(process.cwd(), 'src/app/api/leagues/[id]/trades/route.ts');

    expect(existsSync(routePath)).toBe(true);

    const source = readFileSync(routePath, 'utf8');
    expect(source).toContain('export async function POST');
    expect(source).toContain('getAuthenticatedUserId');
    expect(source).toContain('verifyLeagueMembership');
    expect(source).toContain("collection('trades')");
    expect(source).toContain('revalidateTag(tags.trades(leagueId))');
    expect(source).toContain('revalidateTag(tags.league(leagueId))');
  });
});
