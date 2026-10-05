import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import {
  createAflTradePrivateConfirmedValuationConstructionV2,
  createInMemoryAflTradePrivateConfirmedValuationLifecycle,
} from '@/server/aflTradeIntelligence/valuation/privateConfirmedTradeValuationConstruction';
import { prepareLocalPrivateTradeEvaluationFromConfirmedResult } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationPreparation';

const parentAt = '2026-08-16T02:00:00.000Z';
const plannedAt = '2026-08-17T00:00:00.000Z';
const assembledAt = '2026-08-17T00:01:00.000Z';
const evidence = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, parentAt);
const acquisitionSpell = {
  spellId: `acquisition-spell:${'1'.repeat(64)}`,
  spellVersionId: `acquisition-spell-version:${'2'.repeat(64)}`,
  ruleId: `acquisition-spell-rule:${'3'.repeat(64)}`,
  startEventVersionId: `event-version:${'4'.repeat(64)}`,
  startAssetVersionId: `event-asset-version:${'5'.repeat(64)}`,
  startDate: '2021-10-12',
  endDate: null,
} as const;

const authority = {
  kind: 'private_confirmed_nonproduction_calculation' as const,
  evidenceKind: 'retained_private_review' as const,
  decisionId: `private-reviewed-evidence-evaluation-decision:${'a'.repeat(64)}`,
  evidenceBundleId: `private-reviewed-evidence-bundle:${'b'.repeat(64)}`,
  evidenceBundleArtifact: evidence('reviewed-bundle'),
  publicationEligible: false as const,
  publicationProhibited: true as const,
};

describe('private confirmed valuation construction', () => {
  it('stages and assembles the exact Dawson facts through immutable private custody', async () => {
    const appearanceEvidence = evidence('dawson-appearances');
    const pavEvidence = evidence('dawson-hpn-parents');
    const futurePickEvidence = evidence('dawson-future-pick');
    let stageLoads = 0;
    let assemblyLoads = 0;
    const source = {
      loadStage: async () => {
        stageLoads += 1;
        return {
          state: 'ready' as const,
          input: {
          authority,
          valuationScopeKey: 'afl-men:2021-trades',
          tradeId: 'workbook-2021-e7f7d1484744f855',
          transactionPromotionId: `private-workbook-transaction-promotion:${'c'.repeat(64)}`,
          transactionOccurredOn: '2021-10-12',
          transactionOccurrencePrecision: 'date',
          knowledgeCutoffAt: '2026-08-16T13:00:13.568Z',
          transactionArtifact: evidence('reviewed-transaction'),
          expectedAssetIds: [
            'workbook-2021-e7f7d1484744f855-adelaide-1',
            'workbook-2021-e7f7d1484744f855-sydney-2',
          ],
          assets: [
            {
              assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
              assetKind: 'player' as const,
              sendingClubId: 'local-afl-club:sydney',
              receivingClubId: 'local-afl-club:adelaide',
              canonicalPlayerId: 'local-afl-player:afl-tables:12516',
              acquisitionSpell,
              appearances: { state: 'ready' as const, coverage: 'complete' as const, evidenceRefs: [appearanceEvidence] },
              realizedPav: { state: 'ready' as const, methodId: 'hpn-private-reviewed/v1', evidenceRefs: [pavEvidence] },
            },
            {
              assetId: 'workbook-2021-e7f7d1484744f855-sydney-2',
              assetKind: 'future_pick' as const,
              sendingClubId: 'local-afl-club:adelaide',
              receivingClubId: 'local-afl-club:sydney',
              canonicalPlayerId: null,
              acquisitionSpell: null,
              appearances: { state: 'unavailable' as const, reasons: ['selection_lineage_unresolved' as const], evidenceRefs: [futurePickEvidence] },
              realizedPav: { state: 'unavailable' as const, reasons: ['selection_lineage_unresolved' as const], evidenceRefs: [futurePickEvidence] },
            },
          ],
            plannedAt,
          },
        };
      },
      loadAssembly: async () => {
        assemblyLoads += 1;
        return {
          state: 'ready' as const,
          input: {
          valueUnitId: 'hpn-season-pav/v1',
          assets: [
            {
              assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
              assetKind: 'player' as const,
              sendingClubId: 'local-afl-club:sydney',
              receivingClubId: 'local-afl-club:adelaide',
              canonicalPlayerId: 'local-afl-player:afl-tables:12516',
              acquisitionSpell,
              appearances: { state: 'observed' as const, gamesPlayed: 92, coverage: 'complete' as const, effectiveThroughSeason: 2025, evidenceRefs: [appearanceEvidence] },
              realizedPav: {
                state: 'calculated' as const,
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
                evidenceRefs: [pavEvidence],
              },
            },
            {
              assetId: 'workbook-2021-e7f7d1484744f855-sydney-2',
              assetKind: 'future_pick' as const,
              sendingClubId: 'local-afl-club:adelaide',
              receivingClubId: 'local-afl-club:sydney',
              canonicalPlayerId: null,
              acquisitionSpell: null,
              appearances: { state: 'unavailable' as const, reasons: ['selection_lineage_unresolved' as const], evidenceRefs: [futurePickEvidence] },
              realizedPav: { state: 'unavailable' as const, reasons: ['selection_lineage_unresolved' as const], evidenceRefs: [futurePickEvidence] },
            },
          ],
            assembledAt,
          },
        };
      },
    };
    const lifecycle = createInMemoryAflTradePrivateConfirmedValuationLifecycle();
    const construction = createAflTradePrivateConfirmedValuationConstructionV2({
      source,
      lifecycle,
      artifactRepository: createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' }),
      maximumArtifactBytes: 1_000_000,
    });

    const staged = await construction.stage({
      valuationScopeKey: 'afl-men:2021-trades',
      tradeId: 'workbook-2021-e7f7d1484744f855',
    });
    expect(staged.state).toBe('planned');
    if (staged.state !== 'planned') throw new Error('Expected a plan.');

    const assembled = await construction.assemble(staged.plan.planId);
    expect(assembled.state).toBe('assembled');
    if (assembled.state !== 'assembled') throw new Error('Expected a result.');
    expect(assembled.result.content.assets[0]).toMatchObject({
      appearances: { state: 'observed', gamesPlayed: 92 },
      realizedPav: { state: 'calculated', score: 84.10058692299 },
    });
    expect(assembled.result.content.clubTotals).toBeNull();
    expect(assembled.result.content.overallGrade).toMatchObject({
      state: 'unavailable',
      reason: 'private_realized_only_grade_prohibited',
    });
    expect(
      prepareLocalPrivateTradeEvaluationFromConfirmedResult({
        result: assembled.result,
        resultArtifact: assembled.resultArtifact,
        workbookSha256: '1'.repeat(64),
        labelsByAssetId: new Map([
          ['workbook-2021-e7f7d1484744f855-adelaide-1', 'Jordan Dawson'],
          [
            'workbook-2021-e7f7d1484744f855-sydney-2',
            '#2022R1 (Melbourne) (#18 - Weddle - 60 games)',
          ],
        ]),
      }).assets
    ).toMatchObject([
      {
        views: {
          realized: { state: 'calculated', score: 84.10058692299, gamesPlayed: 92 },
        },
      },
      {
        views: {
          realized: { state: 'unavailable', reasons: ['pick_selection_not_confirmed'] },
        },
      },
    ]);
    expect(
      prepareLocalPrivateTradeEvaluationFromConfirmedResult({
        result: assembled.result,
        resultArtifact: assembled.resultArtifact,
        workbookSha256: '1'.repeat(64),
        labelsByAssetId: new Map([
          ['workbook-2021-e7f7d1484744f855-adelaide-1', 'Jordan Dawson'],
          [
            'workbook-2021-e7f7d1484744f855-sydney-2',
            '#2022R1 (Melbourne) (#18 - Weddle - 60 games)',
          ],
        ]),
        pickEvidenceByAssetId: new Map([
          [
            'workbook-2021-e7f7d1484744f855-sydney-2',
            {
              state: 'selection_confirmed' as const,
              canonicalPlayerId: 'local-afl-player:afl-tables:13864',
              evidenceRefs: [futurePickEvidence],
            },
          ],
        ]),
      }).assets[1]
    ).toMatchObject({
      canonicalPlayerId: 'local-afl-player:afl-tables:13864',
      views: {
        realized: {
          state: 'unavailable',
          reasons: ['canonical_pick_realization_unavailable'],
          evidenceRefs: [futurePickEvidence],
        },
      },
    });
    await expect(lifecycle.loadResult(assembled.result.resultId)).resolves.toEqual({
      result: assembled.result,
      artifact: assembled.resultArtifact,
    });
    const replayedPlan = await construction.stage({
      valuationScopeKey: 'afl-men:2021-trades',
      tradeId: 'workbook-2021-e7f7d1484744f855',
    });
    expect(replayedPlan).toEqual(staged);
    const replayedResult = await construction.assemble(staged.plan.planId);
    expect(replayedResult).toEqual(assembled);
    expect({ stageLoads, assemblyLoads }).toEqual({ stageLoads: 2, assemblyLoads: 1 });
  });
});
