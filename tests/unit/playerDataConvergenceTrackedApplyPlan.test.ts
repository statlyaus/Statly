import { promises as fs } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { getPlayers } from '@/lib/data';
import { diagnosePlayerDataConvergence } from '@/server/playerDataConvergenceDiagnostic';
import { planPlayerDataConvergenceApply } from '@/server/playerDataConvergenceApplyPlan';
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

describe('tracked player data convergence apply plan', () => {
  it('produces zero product repairs and keeps null stat rows as skipped evidence', async () => {
    const rawRows = await loadRawStatRows();
    const players = await getPlayers();
    const diagnostic = diagnosePlayerDataConvergence({
      canonicalPlayers: players.map((player) => ({
        id: player.id,
        name: player.name,
        team: player.team,
        position: player.position,
      })),
      sourceRecords: rawRows.map(sourceRecordFromRawRow),
      expectedCategoryKeys: [...REAL_DATA_NINE_CATEGORY_PRESET],
    });
    const convergencePlan = planPlayerDataConvergenceActions({
      diagnostic,
      expectedCategoryKeys: [...REAL_DATA_NINE_CATEGORY_PRESET],
    });
    const applyPlan = planPlayerDataConvergenceApply({ diagnostic, convergencePlan });

    expect(applyPlan).toMatchObject({
      status: 'requiresReview',
      safeForTempDbApplySimulation: true,
      safeForProductApply: false,
      requiresProductDecision: false,
      productMutationCount: 0,
      productMutations: [],
      blockers: [],
    });
    expect(applyPlan.skippedEvidence).toContainEqual(
      expect.objectContaining({
        kind: 'nullStatSourceEvidence',
        count: 4,
        sourceIndexes: [2920, 6140, 6209, 6324],
        sourceIdentities: expect.arrayContaining([
          'tobie travaglia|st kilda',
          'nathan fyfe|fremantle',
          'lachlan mcneil|western bulldogs',
          'mitchell duncan|geelong',
        ]),
      })
    );
    expect(applyPlan.skippedEvidence).toContainEqual(
      expect.objectContaining({
        kind: 'multiRowSourceEvidence',
        count: 614,
      })
    );
  });
});
