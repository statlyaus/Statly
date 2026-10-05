import { describe, expect, it, vi } from 'vitest';

import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { loadPostgresPrivateValuationPickLineage } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationPickLineage';
import type { PrivateValuationPickLineageFacts } from '@/server/aflTradeIntelligence/valuation/privateValuationPickLineageMaterialization';

const releaseId = `outcome-release:${'a'.repeat(64)}`;
const admittedAt = '2026-08-18T00:00:00.000Z';

function facts(): Omit<PrivateValuationPickLineageFacts, 'root' | 'knowledgeCutoffAt'> {
  return {
    transfers: [
      {
        assetVersionId: 'event-asset-version:root',
        eventVersionId: 'event-version:trade',
        eventDate: '2021-10-15T00:00:00.000Z',
        recordedAt: '2021-10-15T00:00:00.000Z',
        assetKind: 'future_pick',
        playerId: null,
        pickId: 'pick:future-first',
        draftYear: 2021,
        fromClubId: 'club:giver',
        toClubId: 'club:receiver',
        evidenceId: 'release-member:root',
      },
    ],
    pickTransformations: [],
    custodyObservations: [
      {
        custodyObservationId: 'custody:root',
        pickId: 'pick:future-first',
        observedAt: '2021-10-15T00:00:00.000Z',
        currentClubId: 'club:receiver',
        recordedAt: '2021-10-15T00:00:00.000Z',
        evidenceId: 'release-member:custody',
      },
    ],
    realizations: [],
    selections: [],
    acquisitionSpells: [],
  };
}

describe('PostgreSQL private pick lineage', () => {
  it('loads one exact release-scoped fact bundle and materializes its conserved frontier', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          facts_json: facts(),
          membership_json: {
            schemaVersion: 'private-pick-lineage-postgres-readback/v1',
            releaseId,
            rootAssetVersionId: 'event-asset-version:root',
            members: [
              {
                kind: 'event_asset',
                id: 'event-asset-version:root',
                recordSha256: 'b'.repeat(64),
              },
              {
                kind: 'pick_custody',
                id: 'custody:root',
                recordSha256: 'c'.repeat(64),
              },
            ],
          },
        },
      ],
      rowCount: 1,
    }));
    const transaction = { query } satisfies AflOutcomeSqlTransaction;

    const result = await loadPostgresPrivateValuationPickLineage(transaction, {
      factualReleaseId: releaseId,
      assetId: 'asset:root',
      assetVersionId: 'event-asset-version:root',
      assetKind: 'future_pick',
      receivingClubId: 'club:receiver',
      tradeEffectiveAt: '2021-10-15T00:00:00.000Z',
      knowledgeCutoffAt: admittedAt,
      admittedAt,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('/* private-pick-lineage-exact-release-readback */'),
      [releaseId, 'event-asset-version:root', admittedAt]
    );
    const sql = query.mock.calls[0]![0];
    for (const table of [
      'outcome_release_event_asset',
      'outcome_release_event_version',
      'outcome_draft_pick',
      'outcome_release_pick_lineage',
      'outcome_release_pick_custody',
      'outcome_release_pick_realization',
      'outcome_release_draft_selection',
      'outcome_release_acquisition_spell',
    ]) {
      expect(sql).toContain(table);
    }
    expect(result).toMatchObject({
      state: 'ready',
      facts: {
        transfers: [
          expect.objectContaining({
            assetVersionId: 'event-asset-version:root',
            pickId: 'pick:future-first',
            draftYear: 2021,
          }),
        ],
      },
      membership: {
        schemaVersion: 'private-pick-lineage-postgres-readback/v1',
        releaseId,
        rootAssetVersionId: 'event-asset-version:root',
      },
      materialization: {
        state: 'ready',
        attribution: { frontierAssetIds: ['asset:root'] },
      },
      evidence: {
        role: 'pick_evidence',
        source: 'postgres_json',
        createdAt: admittedAt,
      },
    });
  });

  it('keeps a missing exact root release member unavailable', async () => {
    const transaction = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    } satisfies AflOutcomeSqlTransaction;

    expect(
      await loadPostgresPrivateValuationPickLineage(transaction, {
        factualReleaseId: releaseId,
        assetId: 'asset:root',
        assetVersionId: 'event-asset-version:root',
        assetKind: 'future_pick',
        receivingClubId: 'club:receiver',
        tradeEffectiveAt: '2021-10-15T00:00:00.000Z',
        knowledgeCutoffAt: admittedAt,
        admittedAt,
      })
    ).toEqual({
      state: 'unavailable',
      assetId: 'asset:root',
      reasons: ['exact_release_pick_lineage_missing'],
      evidence: [],
    });
  });
});
