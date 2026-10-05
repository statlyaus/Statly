import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createLocalPrivateTradeEvaluationGeneration } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationContracts';
import { createLocalPrivateTradeEvaluationGenerationV2 } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationGenerationV2';
import { createLocalPrivateTradeEvaluationGenerationV3 } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationGenerationV3';
import {
  createPrivateEvaluationAuthoritySnapshot,
  createPrivateEvaluationInspectionReceipt,
} from '@/server/aflTradeIntelligence/valuation/governedPrivateTradeEvaluationContracts';
import { createPrivateEvaluationTransitionIntent } from '@/server/aflTradeIntelligence/valuation/privateEvaluationTransitionContracts';
import { PostgresLocalPrivateTradeEvaluationLifecycle } from '@/server/aflTradeIntelligence/valuation/postgresLocalPrivateTradeEvaluationLifecycle';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const at = '2026-08-17T05:00:00.000Z';
const evidence = createAflTradeCanonicalJsonArtifactRef({ source: 'confirmed' }, at);
const generation = createLocalPrivateTradeEvaluationGeneration({
  valuationScopeKey: 'afl-men:2021-trades',
  tradeId: 'workbook-2021-e7f7d1484744f855',
  workbookSha256: '1'.repeat(64),
  dependencyRefs: [evidence],
  confirmedResultArtifact: evidence,
  valueUnitId: 'hpn-season-pav/v1',
  assets: [
    {
      assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
      assetKind: 'player',
      canonicalPlayerId: 'local-afl-player:afl-tables:12516',
      sendingClubId: 'local-afl-club:sydney',
      receivingClubId: 'local-afl-club:adelaide',
      label: 'Jordan Dawson',
      appearances: {
        state: 'observed',
        gamesPlayed: 1,
        coverage: 'right_censored',
        effectiveThroughSeason: 2022,
        evidenceRefs: [evidence],
      },
      views: {
        atTrade: {
          state: 'unavailable',
          reasons: ['source_rights_not_approved'],
          evidenceRefs: [],
        },
        realized: { state: 'calculated', score: 84.1, evidenceRefs: [evidence] },
        remaining: {
          state: 'unavailable',
          reasons: ['predictive_model_not_authorized'],
          evidenceRefs: [],
        },
        current: {
          state: 'unavailable',
          reasons: ['predictive_model_not_authorized'],
          evidenceRefs: [],
        },
      },
    },
  ],
  clubTotals: null,
  overallGrade: { state: 'unavailable', reasons: ['asset_values_incomplete'], evidenceRefs: [] },
  generatedAt: at,
});
const artifact = createAflTradeCanonicalJsonArtifactRef(generation, at);
const unavailableV2 = {
  state: 'unavailable' as const,
  reasons: ['calculation_evidence_incomplete' as const],
  evidenceRefs: [evidence],
};
const generationV2 = createLocalPrivateTradeEvaluationGenerationV2({
  valuationScopeKey: 'afl-men:2021-trades',
  tradeId: 'workbook-2021-v2-unavailable',
  workbookSha256: '2'.repeat(64),
  dependencyRefs: [evidence],
  confirmedResultArtifact: evidence,
  valueUnitId: 'season_pav',
  assets: [
    {
      assetId: 'asset:v2-player',
      assetKind: 'player',
      canonicalPlayerId: null,
      sendingClubId: 'local-afl-club:a',
      receivingClubId: 'local-afl-club:b',
      label: 'Unavailable governed player',
      evidenceHorizons: [],
      views: {
        atTrade: unavailableV2,
        realized: unavailableV2,
        remaining: unavailableV2,
        current: unavailableV2,
      },
    },
  ],
  clubTotals: ['local-afl-club:a', 'local-afl-club:b'].map((clubId) => ({
    clubId,
    views: {
      atTrade: unavailableV2,
      realized: unavailableV2,
      remaining: unavailableV2,
      current: unavailableV2,
    },
  })),
  overallGrades: ['local-afl-club:a', 'local-afl-club:b'].map((clubId) => ({
    clubId,
    ...unavailableV2,
  })),
  tradeVerdict: unavailableV2,
  generatedAt: at,
});
const artifactV2 = createAflTradeCanonicalJsonArtifactRef(generationV2, at);

function v3Generation() {
  const selector = {
    valuationScopeKey: generationV2.content.valuationScopeKey,
    tradeId: generationV2.content.tradeId,
  };
  const expectedHead = { generationId: null, revision: 0, status: 'absent' as const };
  const authoritySnapshot = createPrivateEvaluationAuthoritySnapshot({
    selector,
    promotedWorkbookSha256: generationV2.content.workbookSha256,
    capturedAt: '2026-08-17T04:50:00.000Z',
    validThrough: '2026-08-17T05:10:00.000Z',
    expectedHead,
    dependencies: [{ role: 'confirmed_result', artifact: evidence }],
  });
  const inspectionReceipt = createPrivateEvaluationInspectionReceipt({
    selector,
    promotedWorkbookSha256: generationV2.content.workbookSha256,
    authoritySnapshotId: authoritySnapshot.snapshotId,
    inspectedAt: authoritySnapshot.content.capturedAt,
    validThrough: authoritySnapshot.content.validThrough,
    expectedHead,
    observedDependencies: authoritySnapshot.content.dependencies,
    blockers: [],
  });
  const transitionIntent = createPrivateEvaluationTransitionIntent({
    action: 'construct_and_activate',
    selector,
    expectedHead,
    targetGenerationId: null,
    authoritySnapshotId: authoritySnapshot.snapshotId,
    inspectionReceiptId: inspectionReceipt.receiptId,
    reason: null,
    operator: { principalId: 'local:test', rationale: 'Exercise v3 persistence.' },
    requestedAt: '2026-08-17T04:55:00.000Z',
  });
  return createLocalPrivateTradeEvaluationGenerationV3({
    projection: generationV2,
    authoritySnapshot,
    inspectionReceipt,
    transitionIntent,
    derivation: {
      calculationInputId: `governed-private-valuation-calculation-input:${'1'.repeat(64)}`,
      calculationInputArtifact: evidence,
      valuationCalculationId: `valuation-calculation:${'2'.repeat(64)}`,
      calculationArtifact: evidence,
      directionEvidenceId: evidence.artifactId,
      directionEvidenceArtifact: evidence,
      explanationArtifact: evidence,
      projectorVersion: 'governed-private-evaluation-projector/v3',
    },
  });
}

describe('PostgreSQL local private trade evaluation lifecycle', () => {
  it('persists exact v3 review and derivation ancestry as authenticated columns', async () => {
    const generationV3 = v3Generation();
    const artifactV3 = createAflTradeCanonicalJsonArtifactRef(
      generationV3,
      generationV3.content.generatedAt
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ generation_json: generationV3, artifact_json: artifactV3 }],
        rowCount: 1,
      });
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async work => work({ query }),
    };

    await expect(
      new PostgresLocalPrivateTradeEvaluationLifecycle(client).saveGeneration({
        generation: generationV3,
        artifact: artifactV3,
      })
    ).resolves.toBeUndefined();
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO outcome_local_private_trade_evaluation_generation')
    );
    expect(insert?.[1]).toEqual(
      expect.arrayContaining([
        generationV3.content.authorityReview.authoritySnapshotId,
        generationV3.content.authorityReview.inspectionReceiptId,
        generationV3.content.authorityReview.transitionIntentId,
        generationV3.content.derivationFingerprint,
      ])
    );
  });

  it('coexists with exact v2 generations in the append-only lifecycle', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ generation_json: generationV2, artifact_json: artifactV2 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ generation_json: generationV2, artifact_json: artifactV2 }],
        rowCount: 1,
      });
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async (work) => work({ query }),
    };
    const lifecycle = new PostgresLocalPrivateTradeEvaluationLifecycle(client);

    await expect(
      lifecycle.saveGeneration({ generation: generationV2, artifact: artifactV2 })
    ).resolves.toBeUndefined();
    await expect(lifecycle.loadGeneration(generationV2.generationId)).resolves.toEqual({
      generation: generationV2,
      artifact: artifactV2,
    });
  });

  it('authenticates exact retained generations and compare-and-set heads', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ generation_json: generation, artifact_json: artifact }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ trade_id: generation.content.tradeId }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async (work) => work({ query }),
    };
    const lifecycle = new PostgresLocalPrivateTradeEvaluationLifecycle(client);

    await expect(lifecycle.saveGeneration({ generation, artifact })).resolves.toBeUndefined();
    await expect(
      lifecycle.compareAndSetHead({
        tradeId: generation.content.tradeId,
        expectedGenerationId: null,
        expectedRevision: null,
        generationId: generation.generationId,
        withdrawalReason: null,
        action: 'activate',
      })
    ).resolves.toEqual({ state: 'updated' });
    expect(query.mock.calls.at(-1)?.[1]?.[3]).toBe('activate');
  });

  it('returns the retained current generation on a stale compare-and-set', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ generation_id: generation.generationId, revision: 4 }],
        rowCount: 1,
      });
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async (work) => work({ query }),
    };

    await expect(
      new PostgresLocalPrivateTradeEvaluationLifecycle(client).compareAndSetHead({
        tradeId: generation.content.tradeId,
        expectedGenerationId: null,
        expectedRevision: null,
        generationId: generation.generationId,
        withdrawalReason: null,
        action: 'activate',
      })
    ).resolves.toEqual({
      state: 'conflict',
      currentGenerationId: generation.generationId,
      currentRevision: 4,
    });
  });

  it('records rollback as a distinct durable transition action', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            trade_id: generation.content.tradeId,
            generation_id: null,
            revision: 2,
            withdrawal_reason: 'withdrawn for rehearsal',
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ trade_id: generation.content.tradeId }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ was_active: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async (work) => work({ query }),
    };

    await expect(
      new PostgresLocalPrivateTradeEvaluationLifecycle(client).compareAndSetHead({
        tradeId: generation.content.tradeId,
        expectedGenerationId: null,
        expectedRevision: 2,
        generationId: generation.generationId,
        withdrawalReason: null,
        action: 'rollback',
      })
    ).resolves.toEqual({ state: 'updated' });
    expect(query.mock.calls.at(-1)?.[1]).toEqual([
      generation.content.tradeId,
      null,
      generation.generationId,
      'rollback',
      null,
    ]);
  });

  it('rejects rollback to a retained generation that was never active', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            trade_id: generation.content.tradeId,
            generation_id: null,
            revision: 2,
            withdrawal_reason: 'withdrawn for rehearsal',
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ trade_id: generation.content.tradeId }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ was_active: false }], rowCount: 1 });
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async (work) => work({ query }),
    };

    await expect(
      new PostgresLocalPrivateTradeEvaluationLifecycle(client).compareAndSetHead({
        tradeId: generation.content.tradeId,
        expectedGenerationId: null,
        expectedRevision: 2,
        generationId: generation.generationId,
        withdrawalReason: null,
        action: 'rollback',
      })
    ).resolves.toEqual({
      state: 'invalid_rollback',
      reason: 'target_was_not_previously_active',
    });
    expect(query).toHaveBeenCalledTimes(4);
  });
});
