import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Prisma's MANAGER role is every ordinary team, so a role string cannot decide commissioner
// powers. Commissioner-only actions use getLeagueMembershipAccess, where only the owner or a
// co-commissioner with an active membership can manage the league.
const commissionerRoutes = [
  'src/app/api/leagues/[id]/draft-settings/route.ts',
  'src/app/api/leagues/[id]/matchups/route.ts',
  'src/app/api/leagues/[id]/matchups/[round]/recalculate/route.ts',
  'src/app/api/leagues/[id]/sync-draft-results/route.ts',
  'src/app/api/leagues/[id]/waivers/cancel/route.ts',
];

describe('commissioner authorization architecture', () => {
  it.each(commissionerRoutes)('%s decides commissioner powers from the shared rule', (path) => {
    const source = readFileSync(join(process.cwd(), path), 'utf8');

    expect(source).toContain(
      "import { getLeagueMembershipAccess } from '@/server/leagues/membership'"
    );
    expect(source).toContain('access.canManage');
    expect(source).not.toContain('isLeagueManagerRole');
  });

  it('keeps a single canManageLeague implementation on the server', () => {
    expect(readFileSync(join(process.cwd(), 'src/lib/leagueMembership.ts'), 'utf8')).not.toContain(
      'export async function canManageLeague'
    );
  });
});
