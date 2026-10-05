import { describe, expect, it, vi } from 'vitest';

import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createGovernedPrivateTradeEvaluationWorkspace } from '@/server/aflTradeIntelligence/valuation/governedPrivateTradeEvaluation';
import {
  createPrivateEvaluationAuthoritySnapshot,
  createPrivateEvaluationInspectionReceipt,
  type PrivateEvaluationInspectionStore,
} from '@/server/aflTradeIntelligence/valuation/governedPrivateTradeEvaluationContracts';
import { createLocalPrivateTradeEvaluationGenerationV2 } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationGenerationV2';
import { createLocalPrivateTradeEvaluationGenerationV3 } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationGenerationV3';
import {
  createPostgresPrivateEvaluationExecutionStore,
  type PostgresPrivateEvaluationExecutionPersistence,
} from '@/server/aflTradeIntelligence/valuation/postgresPrivateEvaluationExecutionStore';
import { createPrivateEvaluationTransitionIntent } from '@/server/aflTradeIntelligence/valuation/privateEvaluationTransitionContracts';

const selector = {
  valuationScopeKey: 'afl-men:2025-trades',
  tradeId: 'workbook-2025-sam-flanders',
};
const expectedHead = { generationId: null, revision: 0, status: 'absent' as const };
const evidence = createAflTradeCanonicalJsonArtifactRef(
  { evidence: 'exact-authenticated-authority' },
  '2026-08-18T00:59:00.000Z'
);

function summary(score: number, reference: AflTradeArtifactRef) {
  return {
    score,
    distribution: { mean: score, median: score, p10: score - 1, p90: score + 1 },
    evidenceRefs: [reference],
  };
}

function calculated(score: number, reference: AflTradeArtifactRef) {
  return {
    state: 'calculated' as const,
    ...summary(score, reference),
    components: [
      {
        componentId: 'governed:value',
        label: 'Governed value',
        score,
        evidenceRefs: [reference],
      },
    ],
    calculationRefs: [reference],
  };
}

function completeProjection(generatedAt: string) {
  const assetA = { atTrade: 10, realized: 4, remaining: 6, current: 10 };
  const assetB = { atTrade: 8, realized: 3, remaining: 5, current: 8 };
  const views = (scores: typeof assetA) => ({
    atTrade: calculated(scores.atTrade, evidence),
    realized: calculated(scores.realized, evidence),
    remaining: calculated(scores.remaining, evidence),
    current: calculated(scores.current, evidence),
  });
  const clubView = (received: number, givenUp: number) => ({
      state: 'calculated' as const,
      received: summary(received, evidence),
      givenUp: summary(givenUp, evidence),
      net: summary(received - givenUp, evidence),
    });
  const clubViews = (received: typeof assetA, givenUp: typeof assetA) => ({
    atTrade: clubView(received.atTrade, givenUp.atTrade),
    realized: clubView(received.realized, givenUp.realized),
    remaining: clubView(received.remaining, givenUp.remaining),
    current: clubView(received.current, givenUp.current),
  });
  const horizon = {
    kind: 'completed_season' as const,
    season: 2025,
    gamesPlayed: 20,
    effectiveThrough: '2025-12-31',
    evidenceRefs: [evidence],
  };
  return createLocalPrivateTradeEvaluationGenerationV2({
    valuationScopeKey: selector.valuationScopeKey,
    tradeId: selector.tradeId,
    workbookSha256: '8'.repeat(64),
    dependencyRefs: [evidence],
    confirmedResultArtifact: evidence,
    valueUnitId: 'fixed_horizon_pav',
    assets: [
      {
        assetId: 'asset:a',
        assetKind: 'player',
        canonicalPlayerId: 'player:a',
        sendingClubId: 'club:a',
        receivingClubId: 'club:b',
        label: 'Player A',
        evidenceHorizons: [horizon],
        views: views(assetA),
      },
      {
        assetId: 'asset:b',
        assetKind: 'player',
        canonicalPlayerId: 'player:b',
        sendingClubId: 'club:b',
        receivingClubId: 'club:a',
        label: 'Player B',
        evidenceHorizons: [horizon],
        views: views(assetB),
      },
    ],
    clubTotals: [
      { clubId: 'club:a', views: clubViews(assetB, assetA) },
      { clubId: 'club:b', views: clubViews(assetA, assetB) },
    ],
    overallGrades: [
      {
        clubId: 'club:a',
        state: 'graded',
        grade: 'C',
        normalizedPerformance: 0.4,
        finishesAheadProbability: 0.4,
        evidenceRefs: [evidence],
      },
      {
        clubId: 'club:b',
        state: 'graded',
        grade: 'B',
        normalizedPerformance: 0.6,
        finishesAheadProbability: 0.6,
        evidenceRefs: [evidence],
      },
    ],
    tradeVerdict: {
      state: 'calculated',
      kind: 'favours_club',
      clubIds: ['club:b'],
      practicalEquivalenceProbability: 0,
      evidenceRefs: [evidence],
    },
    generatedAt,
  });
}

function reviewedParents() {
  const authoritySnapshot = createPrivateEvaluationAuthoritySnapshot({
    selector,
    promotedWorkbookSha256: '8'.repeat(64),
    capturedAt: '2026-08-18T01:00:00.000Z',
    validThrough: '2026-08-18T01:10:00.000Z',
    expectedHead,
    dependencies: [{ role: 'confirmed_result', artifact: evidence }],
  });
  const inspectionReceipt = createPrivateEvaluationInspectionReceipt({
    selector,
    promotedWorkbookSha256: '8'.repeat(64),
    authoritySnapshotId: authoritySnapshot.snapshotId,
    inspectedAt: authoritySnapshot.content.capturedAt,
    validThrough: authoritySnapshot.content.validThrough,
    expectedHead,
    observedDependencies: authoritySnapshot.content.dependencies,
    blockers: [],
  });
  return { authoritySnapshot, inspectionReceipt };
}

async function retainReviewParents(
  artifacts: ReturnType<typeof createAflTradeFixtureArtifactRepository>,
  parents: ReturnType<typeof reviewedParents>
) {
  for (const [document, createdAt] of [
    [parents.authoritySnapshot, parents.authoritySnapshot.content.capturedAt],
    [parents.inspectionReceipt, parents.inspectionReceipt.content.inspectedAt],
  ] as const) {
    const reference = createAflTradeCanonicalJsonArtifactRef(document, createdAt);
    await artifacts.putIfAbsent(
      reference,
      new TextEncoder().encode(canonicalizeAflTradeJson(document))
    );
  }
}

function completeGenerationV3(
  parents: ReturnType<typeof reviewedParents>,
  transitionIntent: ReturnType<typeof createPrivateEvaluationTransitionIntent>,
  generatedAt: string
) {
  return createLocalPrivateTradeEvaluationGenerationV3({
    projection: completeProjection(generatedAt),
    ...parents,
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

describe('PostgreSQL private evaluation execution store', () => {
  it.each([
    { kind: 'construct_and_activate' as const, expectedState: 'activated' as const },
    { kind: 'recover' as const, expectedState: 'recovered' as const },
  ])('$kind stages and activates one exact v3 generation after two authority checks', async ({
    kind,
    expectedState,
  }) => {
    const artifacts = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    await artifacts.putIfAbsent(evidence, new TextEncoder().encode('{"evidence":"exact-authenticated-authority"}'));
    const parents = reviewedParents();
    await retainReviewParents(artifacts, parents);
    const inspectionStore: PrivateEvaluationInspectionStore = {
      capture: vi.fn(),
      load: vi.fn(async id =>
        id === parents.inspectionReceipt.receiptId ? parents.inspectionReceipt : null
      ),
      loadAuthoritySnapshot: vi.fn(async id =>
        id === parents.authoritySnapshot.snapshotId ? parents.authoritySnapshot : null
      ),
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ trusted_at: '2026-08-18T01:01:00.000Z' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ trusted_at: '2026-08-18T01:02:00.000Z' }], rowCount: 1 });
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async work => work({ query }),
    };
    const authenticateAuthority = vi.fn(async () => ({
      chain: { authenticated: 'v3-chain' } as never,
      inspection: {
        promotedWorkbookSha256: '8'.repeat(64),
        expectedHead,
        validThrough: parents.authoritySnapshot.content.validThrough,
        evidence: [
          { role: 'confirmed_result' as const, source: 'retained_artifact' as const, artifact: evidence },
        ],
        blockers: [],
      },
    }));
    const persistence: PostgresPrivateEvaluationExecutionPersistence = {
      retainIntent: vi.fn(async () => undefined),
      loadHeadForUpdate: vi.fn(async () => ({ head: expectedHead, latestReceiptId: null })),
      loadRollbackTarget: vi.fn(),
      commitTransition: vi.fn(async () => undefined),
    };
    const saveGeneration = vi.fn(async () => undefined);
    const construct = vi.fn(async ({ transitionIntent, constructedAt }) =>
      completeGenerationV3(parents, transitionIntent, constructedAt)
    );
    const executionStore = createPostgresPrivateEvaluationExecutionStore({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 1_000_000,
      inspectionStore,
      authenticateAuthority,
      construct,
      saveGeneration,
      persistence,
    });
    const workspace = createGovernedPrivateTradeEvaluationWorkspace({
      inspectionStore,
      executionStore,
    });

    const result = await workspace.execute({
      kind,
      selector,
      expected: {
        authoritySnapshotId: parents.authoritySnapshot.snapshotId,
        inspectionReceiptId: parents.inspectionReceipt.receiptId,
        expectedHead,
        validThrough: parents.authoritySnapshot.content.validThrough,
      },
      operator: {
        principalId: 'local-operator:robert',
        rationale: 'Construct and activate the exact reviewed evaluation.',
      },
    });

    expect(result).toMatchObject({
      state: expectedState,
      selector,
      head: { status: 'active', revision: 1 },
    });
    expect(authenticateAuthority).toHaveBeenCalledTimes(2);
    expect(saveGeneration).toHaveBeenCalledOnce();
    expect(persistence.retainIntent).toHaveBeenCalledOnce();
    expect(persistence.commitTransition).toHaveBeenCalledOnce();
  });

  it('returns all current blockers without invoking construction', async () => {
    const artifacts = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
    const parents = reviewedParents();
    await retainReviewParents(artifacts, parents);
    const inspectionStore: PrivateEvaluationInspectionStore = {
      capture: vi.fn(),
      load: vi.fn(async () => parents.inspectionReceipt),
      loadAuthoritySnapshot: vi.fn(async () => parents.authoritySnapshot),
    };
    const query = vi.fn(async () => ({
      rows: [{ trusted_at: '2026-08-18T01:01:00.000Z' }],
      rowCount: 1,
    }));
    const client: AflOutcomeSqlClient = { query, transaction: async work => work({ query }) };
    const construct = vi.fn();
    const blocker = {
      code: 'pick_forecast_unavailable' as const,
      authorityClass: 'pick_forecast' as const,
      classification: 'internal_evidence' as const,
      assetId: 'asset:pick',
      message: 'The governed pick forecast has not been materialized.',
      evidenceRefs: [],
    };
    const executionStore = createPostgresPrivateEvaluationExecutionStore({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 1_000_000,
      inspectionStore,
      authenticateAuthority: vi.fn(async () => ({
        chain: null,
        inspection: {
          promotedWorkbookSha256: '8'.repeat(64),
          expectedHead,
          validThrough: null,
          evidence: [],
          blockers: [blocker],
        },
      })),
      construct,
      saveGeneration: vi.fn(),
      persistence: {
        retainIntent: vi.fn(),
        loadHeadForUpdate: vi.fn(),
        loadRollbackTarget: vi.fn(),
        commitTransition: vi.fn(),
      },
    });

    await expect(
      executionStore.execute({
        kind: 'construct_and_activate',
        selector,
        expected: {
          authoritySnapshotId: parents.authoritySnapshot.snapshotId,
          inspectionReceiptId: parents.inspectionReceipt.receiptId,
          expectedHead,
          validThrough: parents.authoritySnapshot.content.validThrough,
        },
        operator: { principalId: 'local:test', rationale: 'Inspect unavailable execution.' },
      })
    ).resolves.toEqual({ state: 'unavailable', selector, blockers: [blocker] });
    expect(construct).not.toHaveBeenCalled();
  });

  it('withdraws the exact active head without reusing valuation authority or falling back', async () => {
    const artifacts = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const activeGenerationId = `local-private-trade-evaluation-generation:${'a'.repeat(64)}`;
    const activeHead = {
      generationId: activeGenerationId,
      revision: 7,
      status: 'active' as const,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ trusted_at: '2026-08-18T01:05:00.000Z' }],
        rowCount: 1,
      });
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async work => work({ query }),
    };
    const authenticateAuthority = vi.fn();
    const construct = vi.fn();
    const persistence: PostgresPrivateEvaluationExecutionPersistence = {
      retainIntent: vi.fn(async () => undefined),
      loadHeadForUpdate: vi.fn(async () => ({
        head: activeHead,
        latestReceiptId: `private-evaluation-transition-receipt:${'b'.repeat(64)}`,
      })),
      loadRollbackTarget: vi.fn(),
      commitTransition: vi.fn(async () => undefined),
    };
    const executionStore = createPostgresPrivateEvaluationExecutionStore({
      client,
      artifactRepository: artifacts,
      maximumArtifactBytes: 1_000_000,
      inspectionStore: {
        capture: vi.fn(),
        load: vi.fn(),
        loadAuthoritySnapshot: vi.fn(),
      },
      authenticateAuthority,
      construct,
      saveGeneration: vi.fn(),
      persistence,
    });

    await expect(
      executionStore.execute({
        kind: 'withdraw',
        selector,
        expected: activeHead,
        reason: 'Withdraw the private result after operator review.',
        operator: {
          principalId: 'local-operator:robert',
          rationale: 'Remove the current private evaluation without fallback.',
        },
      })
    ).resolves.toEqual({
      state: 'withdrawn',
      selector,
      head: { generationId: null, revision: 8, status: 'withdrawn' },
    });
    expect(authenticateAuthority).not.toHaveBeenCalled();
    expect(construct).not.toHaveBeenCalled();
    expect(persistence.retainIntent).toHaveBeenCalledOnce();
    expect(persistence.commitTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ generation: null })
    );
  });

  it('returns a conflict instead of withdrawing a changed head', async () => {
    const artifacts = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    const expected = {
      generationId: `local-private-trade-evaluation-generation:${'a'.repeat(64)}`,
      revision: 7,
      status: 'active' as const,
    };
    const actual = {
      generationId: `local-private-trade-evaluation-generation:${'c'.repeat(64)}`,
      revision: 8,
      status: 'active' as const,
    };
    const query = vi.fn();
    const persistence: PostgresPrivateEvaluationExecutionPersistence = {
      retainIntent: vi.fn(),
      loadHeadForUpdate: vi.fn(async () => ({ head: actual, latestReceiptId: null })),
      loadRollbackTarget: vi.fn(),
      commitTransition: vi.fn(),
    };
    const executionStore = createPostgresPrivateEvaluationExecutionStore({
      client: { query, transaction: async work => work({ query }) },
      artifactRepository: artifacts,
      maximumArtifactBytes: 1_000_000,
      inspectionStore: {
        capture: vi.fn(),
        load: vi.fn(),
        loadAuthoritySnapshot: vi.fn(),
      },
      authenticateAuthority: vi.fn(),
      construct: vi.fn(),
      saveGeneration: vi.fn(),
      persistence,
    });

    await expect(
      executionStore.execute({
        kind: 'withdraw',
        selector,
        expected,
        reason: 'Withdraw the reviewed private result.',
        operator: {
          principalId: 'local-operator:robert',
          rationale: 'Remove the current private evaluation.',
        },
      })
    ).resolves.toMatchObject({
      state: 'conflict',
      selector,
      expectedHead: expected,
      actualHead: actual,
    });
    expect(persistence.retainIntent).not.toHaveBeenCalled();
    expect(persistence.commitTransition).not.toHaveBeenCalled();
  });

  it('rolls back only to a previously active v3 generation with current exact authority', async () => {
    const artifacts = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    await artifacts.putIfAbsent(
      evidence,
      new TextEncoder().encode('{"evidence":"exact-authenticated-authority"}')
    );
    const parents = reviewedParents();
    await retainReviewParents(artifacts, parents);
    const originalIntent = createPrivateEvaluationTransitionIntent({
      action: 'construct_and_activate',
      selector,
      expectedHead,
      targetGenerationId: null,
      authoritySnapshotId: parents.authoritySnapshot.snapshotId,
      inspectionReceiptId: parents.inspectionReceipt.receiptId,
      reason: null,
      operator: {
        principalId: 'local-operator:robert',
        rationale: 'Construct the original reviewed generation.',
      },
      requestedAt: '2026-08-18T01:01:00.000Z',
    });
    const target = completeGenerationV3(
      parents,
      originalIntent,
      '2026-08-18T01:02:00.000Z'
    );
    for (const [document, createdAt] of [
      [originalIntent, originalIntent.content.requestedAt],
      [target, target.content.generatedAt],
    ] as const) {
      const reference = createAflTradeCanonicalJsonArtifactRef(document, createdAt);
      await artifacts.putIfAbsent(
        reference,
        new TextEncoder().encode(canonicalizeAflTradeJson(document))
      );
    }
    const currentHead = {
      generationId: `local-private-trade-evaluation-generation:${'c'.repeat(64)}`,
      revision: 4,
      status: 'active' as const,
    };
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ trusted_at: '2026-08-18T01:05:00.000Z' }],
      rowCount: 1,
    });
    const authenticateAuthority = vi.fn(async () => ({
      chain: { authenticated: 'v3-chain' } as never,
      inspection: {
        promotedWorkbookSha256: '8'.repeat(64),
        expectedHead: currentHead,
        validThrough: parents.authoritySnapshot.content.validThrough,
        evidence: [
          {
            role: 'confirmed_result' as const,
            source: 'retained_artifact' as const,
            artifact: evidence,
          },
        ],
        blockers: [],
      },
    }));
    const persistence: PostgresPrivateEvaluationExecutionPersistence = {
      retainIntent: vi.fn(async () => undefined),
      loadHeadForUpdate: vi.fn(async () => ({
        head: currentHead,
        latestReceiptId: `private-evaluation-transition-receipt:${'d'.repeat(64)}`,
      })),
      loadRollbackTarget: vi.fn(async () => ({
        generation: target,
        artifact: createAflTradeCanonicalJsonArtifactRef(target, target.content.generatedAt),
        wasActive: true,
      })),
      commitTransition: vi.fn(async () => undefined),
    };
    const executionStore = createPostgresPrivateEvaluationExecutionStore({
      client: { query, transaction: async work => work({ query }) },
      artifactRepository: artifacts,
      maximumArtifactBytes: 1_000_000,
      inspectionStore: {
        capture: vi.fn(),
        load: vi.fn(async id =>
          id === parents.inspectionReceipt.receiptId ? parents.inspectionReceipt : null
        ),
        loadAuthoritySnapshot: vi.fn(async id =>
          id === parents.authoritySnapshot.snapshotId ? parents.authoritySnapshot : null
        ),
      },
      authenticateAuthority,
      construct: vi.fn(),
      saveGeneration: vi.fn(),
      persistence,
    });

    await expect(
      executionStore.execute({
        kind: 'rollback',
        selector,
        targetGenerationId: target.generationId,
        expected: currentHead,
        operator: {
          principalId: 'local-operator:robert',
          rationale: 'Restore the previously active reviewed generation.',
        },
      })
    ).resolves.toEqual({
      state: 'rolled_back',
      selector,
      generationId: target.generationId,
      head: { generationId: target.generationId, revision: 5, status: 'active' },
    });
    expect(authenticateAuthority).toHaveBeenCalledOnce();
    expect(persistence.commitTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ generation: target })
    );
  });

  it('rejects rollback when the target generation was never active', async () => {
    const artifacts = createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' });
    const currentHead = {
      generationId: `local-private-trade-evaluation-generation:${'c'.repeat(64)}`,
      revision: 4,
      status: 'active' as const,
    };
    const targetGenerationId = `local-private-trade-evaluation-generation:${'a'.repeat(64)}`;
    const query = vi.fn();
    const persistence: PostgresPrivateEvaluationExecutionPersistence = {
      retainIntent: vi.fn(),
      loadHeadForUpdate: vi.fn(async () => ({ head: currentHead, latestReceiptId: null })),
      loadRollbackTarget: vi.fn(async () => ({
        generation: { generationId: targetGenerationId } as never,
        artifact: evidence,
        wasActive: false,
      })),
      commitTransition: vi.fn(),
    };
    const executionStore = createPostgresPrivateEvaluationExecutionStore({
      client: { query, transaction: async work => work({ query }) },
      artifactRepository: artifacts,
      maximumArtifactBytes: 1_000_000,
      inspectionStore: { capture: vi.fn(), load: vi.fn(), loadAuthoritySnapshot: vi.fn() },
      authenticateAuthority: vi.fn(),
      construct: vi.fn(),
      saveGeneration: vi.fn(),
      persistence,
    });

    await expect(
      executionStore.execute({
        kind: 'rollback',
        selector,
        targetGenerationId,
        expected: currentHead,
        operator: {
          principalId: 'local-operator:robert',
          rationale: 'Attempt the requested rollback.',
        },
      })
    ).resolves.toMatchObject({ state: 'invalid_transition', reason: 'never_active' });
    expect(persistence.retainIntent).not.toHaveBeenCalled();
    expect(persistence.commitTransition).not.toHaveBeenCalled();
  });
});
