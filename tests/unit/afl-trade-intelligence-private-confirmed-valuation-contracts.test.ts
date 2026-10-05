import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradePrivateConfirmedValuationPlan,
  createAflTradePrivateConfirmedValuationPlanV2,
  createAflTradePrivateConfirmedValuationReader,
  createAflTradePrivateConfirmedValuationResult,
  createAflTradePrivateConfirmedValuationResultV2,
  type AflTradePrivateConfirmedValuationAdmission,
} from '@/server/aflTradeIntelligence/valuation/privateConfirmedTradeValuationContracts';

const at = '2026-08-16T02:00:00.000Z';
const evidence = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, at);
const acquisitionSpell = (seed: string, startDate: string) => ({
  spellId: `acquisition-spell:${seed.repeat(64)}`,
  spellVersionId: `acquisition-spell-version:${seed.repeat(64)}`,
  ruleId: `acquisition-spell-rule:${seed.repeat(64)}`,
  startEventVersionId: `event-version:${seed.repeat(64)}`,
  startAssetVersionId: `event-asset-version:${seed.repeat(64)}`,
  startDate,
  endDate: null,
});

const authority = {
  kind: 'private_confirmed_nonproduction_calculation' as const,
  evidenceKind: 'retained_private_review' as const,
  decisionId: `private-reviewed-evidence-evaluation-decision:${'a'.repeat(64)}`,
  evidenceBundleId: `private-reviewed-evidence-bundle:${'b'.repeat(64)}`,
  evidenceBundleArtifact: evidence('reviewed-bundle'),
  publicationEligible: false as const,
  publicationProhibited: true as const,
};

const assets = [
  {
    assetId: 'asset:pick-18',
    assetKind: 'pick' as const,
    sendingClubId: 'club:west-coast',
    receivingClubId: 'club:hawthorn',
    state: 'ready' as const,
    methodId: 'hpn-realized-pick/v1',
    evidenceRefs: [evidence('pick-18')],
  },
  {
    assetId: 'asset:pick-19',
    assetKind: 'pick' as const,
    sendingClubId: 'club:hawthorn',
    receivingClubId: 'club:west-coast',
    state: 'ready' as const,
    methodId: 'hpn-realized-pick/v1',
    evidenceRefs: [evidence('pick-19')],
  },
];

function planInput() {
  return {
    authority,
    valuationScopeKey: 'workbook:2025',
    tradeId: 'trade:2025:1',
    transactionArtifact: evidence('transaction'),
    expectedAssetIds: ['asset:pick-18', 'asset:pick-19'],
    assets,
    plannedAt: at,
  };
}

describe('private confirmed trade valuation contracts', () => {
  it('retains confirmed appearances and exact realized components without inventing a pick value or grade', () => {
    const plannedAt = '2026-08-17T00:00:00.000Z';
    const transactionArtifact = createAflTradeCanonicalJsonArtifactRef(
      {
        tradeId: 'workbook-2021-e7f7d1484744f855',
        occurredOn: '2021-10-12',
        parties: ['local-afl-club:adelaide', 'local-afl-club:sydney'],
      },
      at
    );
    const plan = createAflTradePrivateConfirmedValuationPlanV2({
      authority,
      valuationScopeKey: 'afl-men:2021-trades',
      tradeId: 'workbook-2021-e7f7d1484744f855',
      transactionPromotionId: `private-workbook-transaction-promotion:${'c'.repeat(64)}`,
      transactionOccurredOn: '2021-10-12',
      transactionOccurrencePrecision: 'date',
      knowledgeCutoffAt: '2026-08-16T13:00:13.568Z',
      transactionArtifact,
      expectedAssetIds: [
        'workbook-2021-e7f7d1484744f855-adelaide-1',
        'workbook-2021-e7f7d1484744f855-sydney-2',
      ],
      assets: [
        {
          assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
          assetKind: 'player',
          sendingClubId: 'local-afl-club:sydney',
          receivingClubId: 'local-afl-club:adelaide',
          canonicalPlayerId: 'local-afl-player:afl-tables:12516',
          acquisitionSpell: acquisitionSpell('1', '2021-10-12'),
          appearances: {
            state: 'ready',
            coverage: 'complete',
            evidenceRefs: [evidence('dawson-appearance-rows')],
          },
          realizedPav: {
            state: 'ready',
            methodId: 'hpn-private-reviewed/v1',
            evidenceRefs: [evidence('dawson-hpn-parents')],
          },
        },
        {
          assetId: 'workbook-2021-e7f7d1484744f855-sydney-2',
          assetKind: 'future_pick',
          sendingClubId: 'local-afl-club:adelaide',
          receivingClubId: 'local-afl-club:sydney',
          canonicalPlayerId: null,
          acquisitionSpell: null,
          appearances: {
            state: 'unavailable',
            reasons: ['selection_lineage_unresolved'],
            evidenceRefs: [evidence('dawson-trade-future-pick')],
          },
          realizedPav: {
            state: 'unavailable',
            reasons: ['selection_lineage_unresolved'],
            evidenceRefs: [evidence('dawson-trade-future-pick')],
          },
        },
      ],
      plannedAt,
    });
    const result = createAflTradePrivateConfirmedValuationResultV2({
      plan,
      planArtifact: createAflTradeCanonicalJsonArtifactRef(plan, plannedAt),
      valueUnitId: 'hpn-season-pav/v1',
      assets: [
        {
          assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
          assetKind: 'player',
          sendingClubId: 'local-afl-club:sydney',
          receivingClubId: 'local-afl-club:adelaide',
          canonicalPlayerId: 'local-afl-player:afl-tables:12516',
          acquisitionSpell: acquisitionSpell('1', '2021-10-12'),
          appearances: {
            state: 'observed',
            gamesPlayed: 92,
            coverage: 'complete',
            effectiveThroughSeason: 2025,
            evidenceRefs: [evidence('dawson-appearance-rows')],
          },
          realizedPav: {
            state: 'calculated',
            methodId: 'hpn-private-reviewed/v1',
            score: 84.10058692299,
            seasons: [2022, 2023, 2024, 2025],
            components: {
              offensiveScore: 1034,
              midfieldScore: 14676,
              defensiveScore: 7955,
              offensivePav: 24.604135356408,
              midfieldPav: 34.157864473676,
              defensivePav: 25.338587092906,
            },
            calculationArtifacts: [
              evidence('dawson-hpn-2022'),
              evidence('dawson-hpn-2023'),
              evidence('dawson-hpn-2024'),
              evidence('dawson-hpn-2025'),
            ],
            evidenceRefs: [evidence('dawson-hpn-parents')],
          },
        },
        {
          assetId: 'workbook-2021-e7f7d1484744f855-sydney-2',
          assetKind: 'future_pick',
          sendingClubId: 'local-afl-club:adelaide',
          receivingClubId: 'local-afl-club:sydney',
          canonicalPlayerId: null,
          acquisitionSpell: null,
          appearances: {
            state: 'unavailable',
            reasons: ['selection_lineage_unresolved'],
            evidenceRefs: [evidence('dawson-trade-future-pick')],
          },
          realizedPav: {
            state: 'unavailable',
            reasons: ['selection_lineage_unresolved'],
            evidenceRefs: [evidence('dawson-trade-future-pick')],
          },
        },
      ],
      assembledAt: plannedAt,
    });

    expect(result.content).toMatchObject({
      schemaVersion: 'afl-trade-private-confirmed-valuation-result/v2',
      transactionPromotionId: `private-workbook-transaction-promotion:${'c'.repeat(64)}`,
      transactionOccurredOn: '2021-10-12',
      transactionOccurrencePrecision: 'date',
      knowledgeCutoffAt: '2026-08-16T13:00:13.568Z',
      planId: plan.planId,
      clubTotals: null,
      overallGrade: {
        state: 'unavailable',
        reason: 'private_realized_only_grade_prohibited',
      },
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(result.content.assets[0]).toMatchObject({
      appearances: { state: 'observed', gamesPlayed: 92 },
      realizedPav: {
        state: 'calculated',
        score: 84.10058692299,
        components: {
          offensivePav: 24.604135356408,
          midfieldPav: 34.157864473676,
          defensivePav: 25.338587092906,
        },
      },
    });
    expect(() =>
      createAflTradePrivateConfirmedValuationResultV2({
        plan,
        planArtifact: createAflTradeCanonicalJsonArtifactRef(plan, plannedAt),
        valueUnitId: 'hpn-season-pav/v1',
        assets: result.content.assets.map((asset, index) =>
          index === 0
            ? {
                ...asset,
                appearances: {
                  ...asset.appearances,
                  evidenceRefs: [evidence('unplanned-appearance-evidence')],
                },
              }
            : asset
        ),
        assembledAt: plannedAt,
      })
    ).toThrow(/evidence/i);
    expect(() =>
      createAflTradePrivateConfirmedValuationResultV2({
        plan,
        planArtifact: createAflTradeCanonicalJsonArtifactRef(plan, plannedAt),
        valueUnitId: 'hpn-season-pav/v1',
        assets: result.content.assets.map((asset, index) =>
          index === 0
            ? {
                ...asset,
                appearances: {
                  state: 'unavailable' as const,
                  reasons: ['calculation_evidence_incomplete' as const],
                  evidenceRefs: asset.appearances.evidenceRefs,
                },
              }
            : asset
        ),
        assembledAt: plannedAt,
      })
    ).toThrow('Calculated realized PAV requires observed appearances');
  });

  it('records Flanders as 12 right-censored appearances while realized PAV remains unavailable', () => {
    const plannedAt = '2026-08-17T00:00:00.000Z';
    const assetId = 'workbook-2025-c64962fd1891b951-st-kilda-2';
    const appearanceEvidence = [evidence('flanders-official-2026-reviewed-match-set')];
    const realizedBlockerEvidence = [evidence('flanders-missing-completed-result-fields')];
    const plan = createAflTradePrivateConfirmedValuationPlanV2({
      authority,
      valuationScopeKey: 'afl-men:2025-trades',
      tradeId: 'workbook-2025-c64962fd1891b951',
      transactionPromotionId: `private-workbook-transaction-promotion:${'d'.repeat(64)}`,
      transactionOccurredOn: '2025-10-15',
      transactionOccurrencePrecision: 'date',
      knowledgeCutoffAt: '2026-05-28T23:59:59.999Z',
      transactionArtifact: evidence('flanders-transaction'),
      expectedAssetIds: [assetId],
      assets: [
        {
          assetId,
          assetKind: 'player',
          sendingClubId: 'local-afl-club:gold-coast',
          receivingClubId: 'local-afl-club:st-kilda',
          canonicalPlayerId: 'local-afl-player:afl-tables:12824',
          acquisitionSpell: acquisitionSpell('2', '2025-10-15'),
          appearances: {
            state: 'ready',
            coverage: 'right_censored',
            evidenceRefs: appearanceEvidence,
          },
          realizedPav: {
            state: 'unavailable',
            reasons: ['calculation_field_unavailable'],
            evidenceRefs: realizedBlockerEvidence,
          },
        },
      ],
      plannedAt,
    });
    const result = createAflTradePrivateConfirmedValuationResultV2({
      plan,
      planArtifact: createAflTradeCanonicalJsonArtifactRef(plan, plannedAt),
      valueUnitId: 'hpn-season-pav/v1',
      assets: [
        {
          assetId,
          assetKind: 'player',
          sendingClubId: 'local-afl-club:gold-coast',
          receivingClubId: 'local-afl-club:st-kilda',
          canonicalPlayerId: 'local-afl-player:afl-tables:12824',
          acquisitionSpell: acquisitionSpell('2', '2025-10-15'),
          appearances: {
            state: 'observed',
            gamesPlayed: 12,
            coverage: 'right_censored',
            effectiveThroughSeason: 2026,
            evidenceRefs: appearanceEvidence,
          },
          realizedPav: {
            state: 'unavailable',
            reasons: ['calculation_field_unavailable'],
            evidenceRefs: realizedBlockerEvidence,
          },
        },
      ],
      assembledAt: plannedAt,
    });

    expect(result.content.assets[0]).toMatchObject({
      appearances: {
        state: 'observed',
        gamesPlayed: 12,
        coverage: 'right_censored',
      },
      realizedPav: {
        state: 'unavailable',
        reasons: ['calculation_field_unavailable'],
      },
    });
    expect(result.content.clubTotals).toBeNull();
    expect(result.content.overallGrade).toEqual({
      state: 'unavailable',
      reason: 'private_realized_only_grade_prohibited',
      evidenceRefs: [createAflTradeCanonicalJsonArtifactRef(plan, plannedAt)],
    });
  });

  it('creates a deterministic realized-only plan that classifies every trade asset exactly once', () => {
    const first = createAflTradePrivateConfirmedValuationPlan(planInput());
    const second = createAflTradePrivateConfirmedValuationPlan({
      ...planInput(),
      expectedAssetIds: [...planInput().expectedAssetIds].reverse(),
      assets: [...assets].reverse(),
    });

    expect(first).toEqual(second);
    expect(first.planId).toMatch(/^private-confirmed-valuation-plan:[a-f0-9]{64}$/);
    expect(first.content).toMatchObject({
      environment: 'non_production',
      requestedViews: ['realized'],
      publicationEligible: false,
      publicationProhibited: true,
    });
  });

  it('rejects incomplete, duplicate, and synthetic asset classifications', () => {
    expect(() =>
      createAflTradePrivateConfirmedValuationPlan({
        ...planInput(),
        assets: assets.slice(0, 1),
      })
    ).toThrow();
    expect(() =>
      createAflTradePrivateConfirmedValuationPlan({
        ...planInput(),
        assets: [assets[0]!, assets[0]!],
      })
    ).toThrow();
    expect(() =>
      createAflTradePrivateConfirmedValuationPlan({
        ...planInput(),
        authority: {
          kind: 'fabricated_test_fixture',
          evidenceClassification: 'fabricated_test_evidence_not_real_afl_data',
          publicationProhibited: true,
        },
      } as unknown as Parameters<typeof createAflTradePrivateConfirmedValuationPlan>[0])
    ).toThrow();
  });

  it('keeps missing evidence distinct from an evidence-backed observed zero', () => {
    const plan = createAflTradePrivateConfirmedValuationPlan(planInput());
    const complete = createAflTradePrivateConfirmedValuationResult({
      plan,
      planArtifact: createAflTradeCanonicalJsonArtifactRef(plan, at),
      valueUnitId: 'hpn-pav/v1',
      assets: [
        {
          ...assets[0]!,
          state: 'observed' as const,
          score: 13,
          calculationArtifact: evidence('pick-18-calculation'),
          evidenceRefs: [evidence('pick-18-result')],
        },
        {
          ...assets[1]!,
          state: 'observed_zero' as const,
          score: 0 as const,
          calculationArtifact: evidence('pick-19-calculation'),
          evidenceRefs: [evidence('pick-19-zero-proof')],
        },
      ],
      overallGrade: {
        state: 'unavailable' as const,
        reason: 'distribution_evidence_unavailable' as const,
        evidenceRefs: [evidence('grade-blocker')],
      },
      assembledAt: at,
    });

    expect(complete.content.clubTotals).toEqual([
      { clubId: 'club:hawthorn', received: 13, givenUp: 0, net: 13 },
      { clubId: 'club:west-coast', received: 0, givenUp: 13, net: -13 },
    ]);

    const unavailable = createAflTradePrivateConfirmedValuationResult({
      plan,
      planArtifact: createAflTradeCanonicalJsonArtifactRef(plan, at),
      valueUnitId: 'hpn-pav/v1',
      assets: [
        {
          ...assets[0]!,
          state: 'observed' as const,
          score: 13,
          calculationArtifact: evidence('pick-18-calculation'),
          evidenceRefs: [evidence('pick-18-result')],
        },
        {
          assetId: assets[1]!.assetId,
          assetKind: assets[1]!.assetKind,
          sendingClubId: assets[1]!.sendingClubId,
          receivingClubId: assets[1]!.receivingClubId,
          state: 'unavailable' as const,
          reasons: ['selection_lineage_unresolved' as const],
          evidenceRefs: [evidence('pick-19-blocker')],
        },
      ],
      overallGrade: {
        state: 'unavailable' as const,
        reason: 'asset_values_incomplete' as const,
        evidenceRefs: [evidence('grade-blocker')],
      },
      assembledAt: at,
    });

    expect(unavailable.content.clubTotals).toBeNull();
    expect(unavailable.content.assets[1]).toMatchObject({
      state: 'unavailable',
      reasons: ['selection_lineage_unresolved'],
    });

    expect(() =>
      createAflTradePrivateConfirmedValuationResult({
        ...complete.content,
        plan,
        planArtifact: createAflTradeCanonicalJsonArtifactRef(plan, at),
        assets: [
          complete.content.assets[0]!,
          {
            ...complete.content.assets[1]!,
            state: 'observed_zero',
            evidenceRefs: [],
          },
        ],
      })
    ).toThrow();
  });

  it('checks current private authority before reading and hides withdrawn results', async () => {
    const plan = createAflTradePrivateConfirmedValuationPlan(planInput());
    const result = createAflTradePrivateConfirmedValuationResult({
      plan,
      planArtifact: createAflTradeCanonicalJsonArtifactRef(plan, at),
      valueUnitId: 'hpn-pav/v1',
      assets: plan.content.assets.map((asset, index) => ({
        ...asset,
        state: 'observed' as const,
        score: index + 1,
        calculationArtifact: evidence(`calculation-${index}`),
        evidenceRefs: [evidence(`result-${index}`)],
      })),
      overallGrade: {
        state: 'unavailable' as const,
        reason: 'distribution_evidence_unavailable' as const,
        evidenceRefs: [evidence('grade-blocker')],
      },
      assembledAt: at,
    });
    const loadCurrentAdmission = vi.fn<() => Promise<AflTradePrivateConfirmedValuationAdmission>>(
      async () => ({ state: 'blocked', reason: 'withdrawn', decisionId: authority.decisionId })
    );
    const loadResult = vi.fn(async () => result);
    const reader = createAflTradePrivateConfirmedValuationReader({
      loadCurrentAdmission,
      loadResult,
    });

    await expect(reader.get('workbook:2025', 'trade:2025:1')).resolves.toBeNull();
    expect(loadCurrentAdmission).toHaveBeenCalledWith('workbook:2025');
    expect(loadResult).not.toHaveBeenCalled();
  });

  it('reads authenticated v2 results while retaining v1 compatibility', async () => {
    const plannedAt = '2026-08-17T00:00:00.000Z';
    const assetId = 'asset:confirmed-player';
    const appearanceEvidence = [evidence('confirmed-player-appearances')];
    const blockerEvidence = [evidence('confirmed-player-pav-blocker')];
    const plan = createAflTradePrivateConfirmedValuationPlanV2({
      authority,
      valuationScopeKey: 'workbook:2025',
      tradeId: 'trade:2025:confirmed-player',
      transactionPromotionId: `private-workbook-transaction-promotion:${'e'.repeat(64)}`,
      transactionOccurredOn: '2025-10-15',
      transactionOccurrencePrecision: 'date',
      knowledgeCutoffAt: '2026-05-28T23:59:59.999Z',
      transactionArtifact: evidence('confirmed-player-transaction'),
      expectedAssetIds: [assetId],
      assets: [
        {
          assetId,
          assetKind: 'player',
          sendingClubId: 'club:sending',
          receivingClubId: 'club:receiving',
          canonicalPlayerId: 'player:confirmed',
          acquisitionSpell: acquisitionSpell('3', '2025-10-15'),
          appearances: {
            state: 'ready',
            coverage: 'right_censored',
            evidenceRefs: appearanceEvidence,
          },
          realizedPav: {
            state: 'unavailable',
            reasons: ['calculation_field_unavailable'],
            evidenceRefs: blockerEvidence,
          },
        },
      ],
      plannedAt,
    });
    const result = createAflTradePrivateConfirmedValuationResultV2({
      plan,
      planArtifact: createAflTradeCanonicalJsonArtifactRef(plan, plannedAt),
      valueUnitId: 'hpn-season-pav/v1',
      assets: [
        {
          ...plan.content.assets[0]!,
          appearances: {
            state: 'observed',
            gamesPlayed: 12,
            coverage: 'right_censored',
            effectiveThroughSeason: 2026,
            evidenceRefs: appearanceEvidence,
          },
        },
      ],
      assembledAt: plannedAt,
    });
    const reader = createAflTradePrivateConfirmedValuationReader({
      loadCurrentAdmission: async () => ({ state: 'authorized', authority }),
      loadResult: async () => result,
    });

    await expect(reader.get('workbook:2025', 'trade:2025:confirmed-player')).resolves.toEqual(
      result
    );
  });
});
