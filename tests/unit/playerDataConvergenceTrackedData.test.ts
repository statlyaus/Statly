import { promises as fs } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { getPlayers } from '@/lib/data';
import { diagnosePlayerDataConvergence } from '@/server/playerDataConvergenceDiagnostic';
import { planPlayerDataConvergenceActions } from '@/server/playerDataConvergencePlanner';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

type RawStatRow = Record<string, unknown>;

const rawStatCategoryKeys: Record<(typeof REAL_DATA_NINE_CATEGORY_PRESET)[number], string> = {
  goals: 'G',
  tackles: 'T',
  inside50s: 'I50',
  intercepts: 'ITC',
  contestedMarks: 'CM',
  rebound50s: 'R50',
  contestedPossessions: 'CP',
  effectiveDisposals: 'ED',
  scoreInvolvements: 'SI',
};

async function loadRawStatRows(): Promise<RawStatRow[]> {
  return JSON.parse(await fs.readFile('player_stats_2025.json', 'utf8')) as RawStatRow[];
}

function sourceRecordFromRawRow(row: RawStatRow) {
  return {
    player_name: typeof row.Player === 'string' ? row.Player : undefined,
    team: typeof row.Team === 'string' ? row.Team : undefined,
    stats: Object.fromEntries(
      REAL_DATA_NINE_CATEGORY_PRESET.map((category) => [
        category,
        row[rawStatCategoryKeys[category]],
      ])
    ),
  };
}

async function diagnoseTrackedPlayerData() {
  const rawRows = await loadRawStatRows();
  const players = await getPlayers();

  return diagnosePlayerDataConvergence({
    canonicalPlayers: players.map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      position: player.position,
    })),
    sourceRecords: rawRows.map(sourceRecordFromRawRow),
    expectedCategoryKeys: [...REAL_DATA_NINE_CATEGORY_PRESET],
  });
}

describe('tracked player data convergence diagnostic', () => {
  it('keeps current tracked player stats identity-converged and documents null stat rows', async () => {
    const result = await diagnoseTrackedPlayerData();

    expect(result.summary).toMatchObject({
      totalCanonicalPlayers: 642,
      totalSourceStatRecords: 7544,
      totalRankingRecords: 0,
      matchedRecordsByDirectId: 0,
      matchedRecordsByCanonicalId: 0,
      matchedRecordsByNormalizedNameTeam: 7544,
      unmatchedCanonicalPlayers: 0,
      unmatchedSourceRecords: 0,
      ambiguousNameMatches: 0,
      duplicateSourceIdentities: 614,
      missingExpectedCategoryValues: 36,
      deprecatedCategoryKeys: 0,
      severity: 'warning',
    });
    expect(result.categoryCoverage).toEqual(
      REAL_DATA_NINE_CATEGORY_PRESET.map((category) => ({
        category,
        present: 7540,
        missing: 4,
      }))
    );
    expect(result.missingExpectedCategoryValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceIndex: 2920,
          sourceIdentity: 'tobie travaglia|st kilda',
          category: 'goals',
        }),
        expect.objectContaining({
          sourceIndex: 6140,
          sourceIdentity: 'nathan fyfe|fremantle',
          category: 'goals',
        }),
        expect.objectContaining({
          sourceIndex: 6209,
          sourceIdentity: 'lachlan mcneil|western bulldogs',
          category: 'goals',
        }),
        expect.objectContaining({
          sourceIndex: 6324,
          sourceIdentity: 'mitchell duncan|geelong',
          category: 'goals',
        }),
      ])
    );
    expect(result.recommendedNextAction).toContain('Review warnings with source evidence');
  });

  it('keeps tracked null stat rows as skipped source evidence in planner output', async () => {
    const diagnostic = await diagnoseTrackedPlayerData();
    const plan = planPlayerDataConvergenceActions({
      diagnostic,
      expectedCategoryKeys: [...REAL_DATA_NINE_CATEGORY_PRESET],
    });
    const actionKinds = plan.actions.map((action) => action.kind);
    const skippedSourceEvidence = plan.actions.find(
      (action) => action.kind === 'skippedNullStatSourceEvidence'
    );

    expect(diagnostic.summary.severity).toBe('warning');
    expect(skippedSourceEvidence).toMatchObject({
      severity: 'warning',
      count: 4,
      sourceIndexes: [2920, 6140, 6209, 6324],
    });
    expect(skippedSourceEvidence?.sourceIdentities).toEqual(
      expect.arrayContaining([
        'tobie travaglia|st kilda',
        'nathan fyfe|fremantle',
        'lachlan mcneil|western bulldogs',
        'mitchell duncan|geelong',
      ])
    );
    expect(actionKinds).not.toEqual(
      expect.arrayContaining([
        'identityReviewRequired',
        'sourceRecordReviewRequired',
        'unsafeForWritePlanning',
        'blockedPendingProductDecision',
      ])
    );
    expect(actionKinds).toContain('safeForNextReadOnlyDryRun');
    expect(plan).toMatchObject({
      status: 'readOnlyFollowUpSafe',
      safeForNextReadOnlyDryRun: true,
      safeForWritePlanning: false,
      requiresProductDecision: false,
    });
  });
});
