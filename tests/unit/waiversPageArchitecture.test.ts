import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league waivers page Firestore architecture', () => {
  it('authorizes league membership before Admin SDK league reads', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/leagues/[id]/waivers/page.tsx'),
      'utf8'
    );

    expect(source).toContain("import { requireUser } from '@/lib/requireUser'");
    expect(source).toContain("import { verifyLeagueMembership } from '@/lib/leagueMembership'");
    expect(source).toContain('const userId = await requireUser();');
    expect(source).toContain('const membership = await verifyLeagueMembership(leagueId, userId);');
    expect(source).toContain('if (!membership.isMember)');
    expect(source.indexOf('verifyLeagueMembership(leagueId, userId)')).toBeLessThan(
      source.indexOf("adminDb.collection('leagues').doc(leagueId)")
    );
  });
});
