import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('team roster architecture', () => {
  it('loads roster players only from the authenticated canonical league route', () => {
    const source = readFileSync(join(root, 'src/hooks/useTeamRoster.ts'), 'utf8');

    expect(source).toContain('`/api/leagues/${leagueId}/roster/${userId}`');
    expect(source).toContain('rosterData.data?.roster?.players');
    expect(source).not.toContain('`/api/draft/${leagueId}/roster/${userId}`');
  });

  it('does not expose obsolete unauthenticated or placeholder roster routes', () => {
    const obsoleteRoutes = [
      'src/app/api/draft/[id]/roster/[userId]/route.ts',
      'src/app/api/draft/cmeilycnf00047gue6xhkh7xzl/roster/addison_real_user_id/route.ts',
      'src/app/api/draft/cmeilycnf00047gue6xhkh7xzl/roster/addisonarmadale@gmail.com/route.ts',
      'src/app/api/leagues/[id]/[id2]/roster/[userId]/route.ts',
    ];

    for (const route of obsoleteRoutes) {
      expect(existsSync(join(root, route)), route).toBe(false);
    }
  });
});
