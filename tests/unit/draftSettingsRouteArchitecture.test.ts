import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league draft-settings route architecture', () => {
  it('authorizes members for reads and managers for writes before data access', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/draft-settings/route.ts'),
      'utf8'
    );

    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain(
      "import { getLeagueMembershipAccess } from '@/server/leagues/membership'"
    );
    expect(source).toContain('authorizeDraftSettingsRead(request, id)');
    expect(source).toContain('authorizeDraftSettingsWrite(request, id)');
    expect(source).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(source).toContain('const access = await getLeagueMembershipAccess(leagueId, userId);');
    expect(source).toContain('if (!access.canManage)');
    expect(source).not.toContain('isLeagueManagerRole');
    expect(source.indexOf('authorizeDraftSettingsWrite(request, id)')).toBeLessThan(
      source.indexOf('prisma.league.findUnique')
    );
    expect(source.indexOf('authorizeDraftSettingsRead(request, id)')).toBeLessThan(
      source.lastIndexOf('prisma.league.findUnique')
    );
  });

  it('persists the durable commissioner draft settings fields', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/draft-settings/route.ts'),
      'utf8'
    );

    expect(source).toContain('MIN_PICK_SECONDS');
    expect(source).toContain('positionLimitsJson: JSON.stringify(positionLimits)');
    expect(source).toContain('autoPickRulesJson: JSON.stringify(autoPickRules)');
    expect(source).toContain("pickOrder: pickOrder === 'manual' ? 'MANUAL' : 'RANDOM'");
    expect(source).toContain('allowAutoPick: autoPickRules.enabled');
  });

  it('cancels queued start jobs when the commissioner clears the schedule', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/draft-settings/route.ts'),
      'utf8'
    );

    expect(source).toContain('if (isClearingDraftDate)');
    expect(source).toContain('await cancelDraftStart(id);');
  });
});
