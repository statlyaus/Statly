import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league settings route architecture', () => {
  const readSource = () =>
    readFileSync(join(process.cwd(), 'src/app/api/leagues/[id]/settings/route.ts'), 'utf8');

  it('authorizes members for reads and managers for writes before data access', () => {
    const source = readSource();

    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain(
      "import { getLeagueMembership, isLeagueManagerRole } from '@/lib/leagueMembership'"
    );
    expect(source).toContain('authorizeLeagueSettingsRead(request, id)');
    expect(source).toContain('authorizeLeagueSettingsWrite(request, id)');
    expect(source).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(source).toContain('const membership = await getLeagueMembership(leagueId, userId);');
    expect(source).toContain('!isLeagueManagerRole(membership.data?.role)');
    expect(source.indexOf('authorizeLeagueSettingsRead(request, id)')).toBeLessThan(
      source.indexOf('prisma.league.findUnique')
    );
    expect(source.indexOf('authorizeLeagueSettingsWrite(request, id)')).toBeLessThan(
      source.indexOf('const body = (await request.json()) as Record<string, unknown>;')
    );
    expect(source.indexOf('authorizeLeagueSettingsWrite(request, id)')).toBeLessThan(
      source.lastIndexOf('prisma.league.findUnique')
    );
  });

  it('normalizes league settings to the canonical nine-category fantasy contract', () => {
    const source = readSource();

    expect(source).toContain('REAL_DATA_NINE_CATEGORY_PRESET');
    expect(source).toContain("scoringFormat: 'nine-category'");
    expect(source).toContain('normalizeLeagueCategories(prismaLeague.categoriesJson)');
    expect(source).toContain('selected.length === value.length');
    expect(source).toContain('categoriesJson: JSON.stringify(categories)');
  });

  it('persists the durable commissioner settings fields', () => {
    const source = readSource();

    expect(source).toContain('positionLimitsJson: JSON.stringify(positionLimits)');
    expect(source).toContain('autoPickRulesJson: JSON.stringify(autoPickRules)');
    expect(source).toContain("pickOrder: pickOrder === 'manual' ? 'MANUAL' : 'RANDOM'");
    expect(source).toContain('allowAutoPick: autoPickRules.enabled');
    expect(source).toContain('rosterSize: getRosterSizeFromPositionLimits(positionLimits)');
    expect(source).toContain('benchSize: getBenchSizeFromPositionLimits(positionLimits)');
    expect(source).toContain('waiverRule');
    expect(source).toContain('maxTeams: maxTeams ?? prismaLeague.settings.maxTeams');
  });

  it('converges the draft setup after Prisma settings updates', () => {
    const source = readSource();

    expect(source).toContain(
      "import { ensureLeagueDraftSetupConverged } from '@/server/draft/services/DraftSetupConvergenceService'"
    );
    expect(source).toContain('await ensureLeagueDraftSetupConverged({');
    expect(source.indexOf('await prisma.$transaction([')).toBeLessThan(
      source.indexOf('await ensureLeagueDraftSetupConverged({')
    );
    expect(source.indexOf('await ensureLeagueDraftSetupConverged({')).toBeLessThan(
      source.indexOf('const updatedLeague = await prisma.league.findUnique')
    );
  });

  it('keeps the Firestore fallback behind the same normalized response shape', () => {
    const source = readSource();

    expect(source).toContain("adminDb.collection('leagues').doc(id)");
    expect(source).toContain('categories: normalizeLeagueCategories(data.categories)');
    expect(source).toContain('positionLimits: normalizeDraftPositionLimits(data.positionLimits)');
    expect(source).toContain('autoPickRules: normalizeDraftAutoPickRules(data.autoPickRules)');
    expect(source).toContain(
      "waiverRule: String(data.waiverRule ?? data.waiverWire?.waiverResetPolicy ?? 'weekly')"
    );
  });

  it('keeps the local test league fixture explicit, normalized, and development-only', () => {
    const source = readSource();

    expect(source).toContain("const TEST_LEAGUE_ID = 'test-league-id'");
    expect(source).toContain("const TEST_LEAGUE_OWNER_ID = '2qlfdHSCFTPlxoKFSUfNLSlCDRe2'");
    expect(source).toContain("process.env.NODE_ENV !== 'production'");
    expect(source).toContain('toTestLeagueSettingsResponse');
    expect(source).toContain('DEFAULT_DRAFT_POSITION_LIMITS');
    expect(source).toContain('DEFAULT_DRAFT_AUTO_PICK_RULES');
    expect(source).toContain('if (isDevelopmentTestLeague(id))');
    expect(source).toContain('userId !== TEST_LEAGUE_OWNER_ID');
    expect(source).toContain('data: toTestLeagueSettingsResponse(testBody)');
    expect(source.indexOf('if (isDevelopmentTestLeague(id))')).toBeLessThan(
      source.indexOf('authorizeLeagueSettingsRead(request, id)')
    );
  });
});
