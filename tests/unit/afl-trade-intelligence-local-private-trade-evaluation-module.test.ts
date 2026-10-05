import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createLocalPrivateTradeEvaluationGeneration } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationContracts';
import { createLocalPrivateTradeEvaluationGenerationV2 } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationGenerationV2';
import { prepareLocalPrivateTradeEvaluationFromConfirmedResult } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationPreparation';
import {
  createInMemoryLocalPrivateTradeEvaluationLifecycle,
  createLocalPrivateTradeEvaluationModule,
  type LocalPrivateTradeEvaluationPreparation,
} from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationModule';
import {
  createAflTradePrivateConfirmedValuationPlanV2,
  createAflTradePrivateConfirmedValuationResultV2,
} from '@/server/aflTradeIntelligence/valuation/privateConfirmedTradeValuationContracts';

const createdAt = '2026-08-17T04:00:00.000Z';
const evidence = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, createdAt);

function confirmed(score: number) {
  const tradeId = 'workbook-2021-e7f7d1484744f855';
  const assetId = `${tradeId}-adelaide-1`;
  const appearanceEvidence = evidence(`appearances-${score}`);
  const calculationEvidence = evidence(`calculation-${score}`);
  const acquisitionSpell = {
    spellId: `acquisition-spell:${'1'.repeat(64)}`,
    spellVersionId: `acquisition-spell-version:${'2'.repeat(64)}`,
    ruleId: `acquisition-spell-rule:${'3'.repeat(64)}`,
    startEventVersionId: `event-version:${'4'.repeat(64)}`,
    startAssetVersionId: `event-asset-version:${'5'.repeat(64)}`,
    startDate: '2021-10-12',
    endDate: null,
  } as const;
  const plan = createAflTradePrivateConfirmedValuationPlanV2({
    authority: {
      kind: 'private_confirmed_nonproduction_calculation',
      evidenceKind: 'retained_private_review',
      decisionId: `private-reviewed-evidence-evaluation-decision:${'a'.repeat(64)}`,
      evidenceBundleId: `private-reviewed-evidence-bundle:${'b'.repeat(64)}`,
      evidenceBundleArtifact: evidence('bundle'),
      publicationEligible: false,
      publicationProhibited: true,
    },
    valuationScopeKey: 'afl-men:2021-trades',
    tradeId,
    transactionPromotionId: `private-workbook-transaction-promotion:${'c'.repeat(64)}`,
    transactionOccurredOn: '2021-10-12',
    transactionOccurrencePrecision: 'date',
    knowledgeCutoffAt: '2022-12-31T23:59:59.000Z',
    transactionArtifact: evidence('transaction'),
    expectedAssetIds: [assetId],
    assets: [
      {
        assetId,
        assetKind: 'player',
        sendingClubId: 'local-afl-club:sydney',
        receivingClubId: 'local-afl-club:adelaide',
        canonicalPlayerId: 'local-afl-player:afl-tables:12516',
        acquisitionSpell,
        appearances: {
          state: 'ready',
          coverage: 'complete',
          evidenceRefs: [appearanceEvidence],
        },
        realizedPav: {
          state: 'ready',
          methodId: 'hpn-season-pav/v1',
          evidenceRefs: [calculationEvidence],
        },
      },
    ],
    plannedAt: createdAt,
  });
  const result = createAflTradePrivateConfirmedValuationResultV2({
    plan,
    planArtifact: createAflTradeCanonicalJsonArtifactRef(plan, createdAt),
    valueUnitId: 'hpn-season-pav/v1',
    assets: [
      {
        assetId,
        assetKind: 'player',
        sendingClubId: 'local-afl-club:sydney',
        receivingClubId: 'local-afl-club:adelaide',
        canonicalPlayerId: 'local-afl-player:afl-tables:12516',
        acquisitionSpell,
        appearances: {
          state: 'observed',
          gamesPlayed: 1,
          coverage: 'complete',
          effectiveThroughSeason: 2022,
          evidenceRefs: [appearanceEvidence],
        },
        realizedPav: {
          state: 'calculated',
          methodId: 'hpn-season-pav/v1',
          score,
          seasons: [2022],
          components: {
            offensiveScore: score,
            midfieldScore: 0,
            defensiveScore: 0,
            offensivePav: score,
            midfieldPav: 0,
            defensivePav: 0,
          },
          calculationArtifacts: [calculationEvidence],
          evidenceRefs: [calculationEvidence],
        },
      },
    ],
    assembledAt: createdAt,
  });
  const artifact = createAflTradeCanonicalJsonArtifactRef(result, createdAt);
  return {
    result,
    artifact,
    preparation: prepareLocalPrivateTradeEvaluationFromConfirmedResult({
      result,
      resultArtifact: artifact,
      workbookSha256: '1'.repeat(64),
      labelsByAssetId: new Map([[assetId, 'Jordan Dawson']]),
    }),
  };
}

function preparation(score: number): LocalPrivateTradeEvaluationPreparation {
  return confirmed(score).preparation;
}

function governedUnavailableGeneration(bundle: ReturnType<typeof confirmed>) {
  const asset = bundle.result.content.assets[0]!;
  const unavailable = {
    state: 'unavailable' as const,
    reasons: ['gate_3_model_run_not_approved' as const],
    evidenceRefs: [bundle.artifact],
  };
  const unavailableViews = {
    atTrade: unavailable,
    realized: unavailable,
    remaining: unavailable,
    current: unavailable,
  };
  return createLocalPrivateTradeEvaluationGenerationV2({
    valuationScopeKey: bundle.result.content.valuationScopeKey,
    tradeId: bundle.result.content.tradeId,
    workbookSha256: '1'.repeat(64),
    dependencyRefs: [bundle.artifact],
    confirmedResultArtifact: bundle.artifact,
    valueUnitId: bundle.result.content.valueUnitId,
    assets: [
      {
        assetId: asset.assetId,
        assetKind: 'player',
        canonicalPlayerId: asset.canonicalPlayerId,
        sendingClubId: asset.sendingClubId,
        receivingClubId: asset.receivingClubId,
        label: 'Jordan Dawson',
        evidenceHorizons: [],
        views: unavailableViews,
      },
    ],
    clubTotals: [asset.receivingClubId, asset.sendingClubId]
      .sort()
      .map((clubId) => ({ clubId, views: unavailableViews })),
    overallGrades: [asset.receivingClubId, asset.sendingClubId]
      .sort()
      .map((clubId) => ({ ...unavailable, clubId })),
    tradeVerdict: {
      ...unavailable,
      reasons: ['asset_values_incomplete'],
    },
    generatedAt: createdAt,
  });
}

describe('local private trade evaluation module', () => {
  it('rejects numerical generation content that drifts from the exact confirmed result', async () => {
    const bundle = confirmed(84.1);
    const artifactRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    await artifactRepository.putIfAbsent(
      bundle.artifact,
      new TextEncoder().encode(canonicalizeAflTradeJson(bundle.result))
    );
    const preparation = {
      ...bundle.preparation,
      assets: bundle.preparation.assets.map((asset) => ({
        ...asset,
        views: {
          ...asset.views,
          realized:
            asset.views.realized.state === 'calculated'
              ? { ...asset.views.realized, score: 999 }
              : asset.views.realized,
        },
      })),
    };
    const evaluationModule = createLocalPrivateTradeEvaluationModule({
      prepare: async () => ({ state: 'ready', preparation }),
      lifecycle: createInMemoryLocalPrivateTradeEvaluationLifecycle(),
      artifactRepository,
      maximumArtifactBytes: 1_000_000,
    });

    await expect(evaluationModule.refresh(preparation.tradeId)).rejects.toThrow(
      'player calculation drifted'
    );
  });

  it('rejects an overall grade until every asset and club-total view is calculated', () => {
    expect(() =>
      createLocalPrivateTradeEvaluationGeneration({
        ...preparation(84.1),
        overallGrade: {
          state: 'calculated',
          grade: 'A',
          expectedNet: 12.5,
          evidenceRefs: [evidence('grade')],
        },
      })
    ).toThrow('A calculated overall grade requires every asset and club-total view');
  });

  it('rejects a calculated grade when the club totals omit a transaction party', () => {
    const calculated = (score: number) => ({
      state: 'calculated' as const,
      score,
      evidenceRefs: [evidence(`view-${score}`)],
    });
    const base = preparation(84.1);
    expect(() =>
      createLocalPrivateTradeEvaluationGeneration({
        ...base,
        assets: base.assets.map((asset) => ({
          ...asset,
          views: {
            atTrade: calculated(84.1),
            realized: calculated(84.1),
            remaining: calculated(10),
            current: calculated(94.1),
          },
        })),
        clubTotals: [
          {
            clubId: 'local-afl-club:adelaide',
            views: {
              atTrade: calculated(84.1),
              realized: calculated(84.1),
              remaining: calculated(10),
              current: calculated(94.1),
            },
          },
        ],
        overallGrade: {
          state: 'calculated',
          grade: 'A',
          expectedNet: 94.1,
          evidenceRefs: [evidence('grade')],
        },
      })
    ).toThrow('A calculated overall grade requires every asset and club-total view');
  });

  it('does not let a legacy refresh replace an active governed v2 generation', async () => {
    const bundle = confirmed(84.1);
    const generation = governedUnavailableGeneration(bundle);
    const generationArtifact = createAflTradeCanonicalJsonArtifactRef(generation, createdAt);
    const lifecycle = createInMemoryLocalPrivateTradeEvaluationLifecycle();
    const artifactRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    await artifactRepository.putIfAbsent(
      bundle.artifact,
      new TextEncoder().encode(canonicalizeAflTradeJson(bundle.result))
    );
    await artifactRepository.putIfAbsent(
      generationArtifact,
      new TextEncoder().encode(canonicalizeAflTradeJson(generation))
    );
    await lifecycle.saveGeneration({ generation, artifact: generationArtifact });
    await lifecycle.compareAndSetHead({
      tradeId: generation.content.tradeId,
      expectedGenerationId: null,
      expectedRevision: null,
      generationId: generation.generationId,
      withdrawalReason: null,
      action: 'activate',
    });
    const evaluationModule = createLocalPrivateTradeEvaluationModule({
      prepare: async () => ({ state: 'ready', preparation: bundle.preparation }),
      lifecycle,
      artifactRepository,
      maximumArtifactBytes: 1_000_000,
    });

    await expect(evaluationModule.refresh(generation.content.tradeId)).resolves.toMatchObject({
      state: 'blocked',
      reasons: ['governed_generation_requires_governed_refresh'],
    });
    await expect(lifecycle.loadHead(generation.content.tradeId)).resolves.toMatchObject({
      generationId: generation.generationId,
      revision: 1,
    });
  });

  it('refreshes by dependency fingerprint, reads exact generations, and proves rollback/withdrawal', async () => {
    let preparedBundle = confirmed(84.1);
    let prepared = preparedBundle.preparation;
    const lifecycle = createInMemoryLocalPrivateTradeEvaluationLifecycle();
    const artifactRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'derived_private',
    });
    await artifactRepository.putIfAbsent(
      preparedBundle.artifact,
      new TextEncoder().encode(canonicalizeAflTradeJson(preparedBundle.result))
    );
    const evaluationModule = createLocalPrivateTradeEvaluationModule({
      prepare: async (tradeId) => {
        expect(tradeId).toBe(prepared.tradeId);
        return { state: 'ready', preparation: prepared };
      },
      lifecycle,
      artifactRepository,
      maximumArtifactBytes: 1_000_000,
    });

    const first = await evaluationModule.refresh(prepared.tradeId);
    expect(first.state).toBe('refreshed');
    if (first.state !== 'refreshed') throw new Error('Expected first generation.');
    expect(first.generation.content.assets[0]?.views).toMatchObject({
      atTrade: { state: 'unavailable' },
      realized: { state: 'calculated', score: 84.1 },
      remaining: { state: 'unavailable' },
      current: { state: 'unavailable' },
    });
    expect(first.generation.content.publicationProhibited).toBe(true);

    await expect(evaluationModule.refresh(prepared.tradeId)).resolves.toMatchObject({
      state: 'unchanged',
      generation: { generationId: first.generation.generationId },
    });
    await expect(
      evaluationModule.read({ kind: 'generation', generationId: first.generation.generationId })
    ).resolves.toEqual(first.generation);

    preparedBundle = confirmed(90.5);
    prepared = preparedBundle.preparation;
    await artifactRepository.putIfAbsent(
      preparedBundle.artifact,
      new TextEncoder().encode(canonicalizeAflTradeJson(preparedBundle.result))
    );
    const second = await evaluationModule.refresh(prepared.tradeId);
    expect(second.state).toBe('refreshed');
    if (second.state !== 'refreshed') throw new Error('Expected changed generation.');
    expect(second.generation.generationId).not.toBe(first.generation.generationId);

    await expect(
      evaluationModule.transition({
        tradeId: prepared.tradeId,
        expectedGenerationId: first.generation.generationId,
        expectedRevision: 1,
        action: { kind: 'rollback', generationId: first.generation.generationId },
      })
    ).resolves.toEqual({
      state: 'conflict',
      currentGenerationId: second.generation.generationId,
      currentRevision: 2,
    });
    await expect(
      evaluationModule.transition({
        tradeId: prepared.tradeId,
        expectedGenerationId: second.generation.generationId,
        expectedRevision: 2,
        action: { kind: 'rollback', generationId: first.generation.generationId },
      })
    ).resolves.toEqual({ state: 'transitioned', generationId: first.generation.generationId });
    await expect(
      evaluationModule.read({ kind: 'current', tradeId: prepared.tradeId })
    ).resolves.toEqual(first.generation);
    await expect(
      evaluationModule.transition({
        tradeId: prepared.tradeId,
        expectedGenerationId: first.generation.generationId,
        expectedRevision: 3,
        action: { kind: 'rollback', generationId: first.generation.generationId },
      })
    ).resolves.toEqual({ state: 'invalid_rollback', reason: 'target_is_current' });
    await expect(
      evaluationModule.transition({
        tradeId: prepared.tradeId,
        expectedGenerationId: first.generation.generationId,
        expectedRevision: 3,
        action: { kind: 'withdraw', reason: 'Operator withdrew the local rehearsal.' },
      })
    ).resolves.toEqual({ state: 'withdrawn', generationId: null });
    await expect(
      evaluationModule.read({ kind: 'current', tradeId: prepared.tradeId })
    ).resolves.toBeNull();
  });
});
