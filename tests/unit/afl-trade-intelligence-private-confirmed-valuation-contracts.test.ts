import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradePrivateConfirmedValuationPlan,
  createAflTradePrivateConfirmedValuationReader,
  createAflTradePrivateConfirmedValuationResult,
  type AflTradePrivateConfirmedValuationAdmission,
} from '@/server/aflTradeIntelligence/valuation/privateConfirmedTradeValuationContracts';

const at = '2026-08-16T02:00:00.000Z';
const evidence = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, at);

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
});
