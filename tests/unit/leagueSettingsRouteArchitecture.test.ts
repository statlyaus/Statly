import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league settings route architecture', () => {
  const readSource = () =>
    readFileSync(join(process.cwd(), 'src/app/api/leagues/[id]/settings/route.ts'), 'utf8');

  it('authorizes active members for reads and commissioners for writes before data access', () => {
    const source = readSource();

    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain(
      "import { getLeagueMembershipAccess } from '@/server/leagues/membership'"
    );
    expect(source).toContain('authorizeLeagueSettingsRead(request, id)');
    expect(source).toContain('authorizeLeagueSettingsWrite(request, id)');
    expect(source).toContain('const userId = await getAuthenticatedUserId(request);');
    expect(source).toContain('const access = await getLeagueMembershipAccess(leagueId, userId);');
    expect(source).toContain('if (!access.isMember)');
    expect(source).toContain('if (!access.canManage)');
    expect(source).not.toContain('isLeagueManagerRole(membership.data?.role)');
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

  it('normalizes league settings through the complete fantasy category registry', () => {
    const source = readSource();

    expect(source).toContain('REAL_DATA_NINE_CATEGORY_PRESET');
    expect(source).toContain('normalizeFantasyCategoryKeys');
    expect(source).toContain("scoringFormat: 'nine-category'");
    expect(source).toContain('normalizeLeagueCategories(prismaLeague.categoriesJson)');
    expect(source).not.toContain('REAL_DATA_CATEGORY_KEYS');
    expect(source).toContain('categoriesJson: JSON.stringify(categories)');
    expect(source).toContain('scoringMode');
    expect(source).toContain('fixtureGenerationMode');
    expect(source).toContain('lineupSlotsJson');
    expect(source).toContain('categoryDirectionsJson');
    expect(source).toContain(
      'parseCategoryDirectionsJson(categories, prismaLeague.settings.categoryDirectionsJson)'
    );
    expect(source).toContain('scoringSettingsLockedAt');
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
    expect(source).toContain('lineupSlotsJson: JSON.stringify(lineupSlots)');
    expect(source).toContain('fixtureGenerationMode');
    expect(source).toContain('categoryDirectionsJson: JSON.stringify(categoryDirections)');
    expect(source).toContain("error: 'Scoring settings are locked'");
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
