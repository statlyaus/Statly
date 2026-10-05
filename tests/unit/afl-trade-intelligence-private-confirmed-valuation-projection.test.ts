import { describe, expect, it } from 'vitest';

import type { DraftTradeDetail } from '@/lib/draftTrades/read';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { projectPrivateConfirmedValuationResult } from '@/server/aflTradeIntelligence/development/privateConfirmedValuationProjection';
import {
  createAflTradePrivateConfirmedValuationPlanV2,
  createAflTradePrivateConfirmedValuationResultV2,
} from '@/server/aflTradeIntelligence/valuation/privateConfirmedTradeValuationContracts';

const at = '2026-08-17T00:00:00.000Z';
const evidence = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, at);
const acquisitionSpell = {
  spellId: `acquisition-spell:${'1'.repeat(64)}`,
  spellVersionId: `acquisition-spell-version:${'2'.repeat(64)}`,
  ruleId: `acquisition-spell-rule:${'3'.repeat(64)}`,
  startEventVersionId: `event-version:${'4'.repeat(64)}`,
  startAssetVersionId: `event-asset-version:${'5'.repeat(64)}`,
  startDate: '2021-10-12',
  endDate: null,
} as const;

describe('private confirmed valuation workbook projection', () => {
  it('shows the exact asset calculation while keeping unresolved assets and the grade unavailable', () => {
    const unavailable = {
      state: 'unavailable' as const,
      reasons: ['selection_lineage_unresolved' as const],
      evidenceRefs: [evidence('future-pick')],
    };
    const appearanceEvidence = evidence('appearances');
    const pavEvidence = evidence('pav');
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
      tradeId: 'workbook-2021-e7f7d1484744f855',
      transactionPromotionId: `private-workbook-transaction-promotion:${'c'.repeat(64)}`,
      transactionOccurredOn: '2021-10-12',
      transactionOccurrencePrecision: 'date',
      knowledgeCutoffAt: at,
      transactionArtifact: evidence('transaction'),
      expectedAssetIds: ['asset:dawson', 'asset:future-pick'],
      assets: [
        {
          assetId: 'asset:dawson',
          assetKind: 'player',
          sendingClubId: 'local-afl-club:sydney',
          receivingClubId: 'local-afl-club:adelaide',
          canonicalPlayerId: 'local-afl-player:afl-tables:12516',
          acquisitionSpell,
          appearances: { state: 'ready', coverage: 'complete', evidenceRefs: [appearanceEvidence] },
          realizedPav: {
            state: 'ready',
            methodId: 'private-reviewed-hpn-method:method',
            evidenceRefs: [pavEvidence],
          },
        },
        {
          assetId: 'asset:future-pick',
          assetKind: 'future_pick',
          sendingClubId: 'local-afl-club:adelaide',
          receivingClubId: 'local-afl-club:sydney',
          canonicalPlayerId: null,
          acquisitionSpell: null,
          appearances: unavailable,
          realizedPav: unavailable,
        },
      ],
      plannedAt: at,
    });
    const planArtifact = createAflTradeCanonicalJsonArtifactRef(plan, at);
    const result = createAflTradePrivateConfirmedValuationResultV2({
      plan,
      planArtifact,
      valueUnitId: 'hpn-season-pav/v1',
      assets: [
        {
          ...plan.content.assets[0],
          appearances: {
            state: 'observed',
            gamesPlayed: 92,
            coverage: 'complete',
            effectiveThroughSeason: 2025,
            evidenceRefs: [appearanceEvidence],
          },
          realizedPav: {
            state: 'calculated',
            methodId: 'private-reviewed-hpn-method:method',
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
              evidence('2022'),
              evidence('2023'),
              evidence('2024'),
              evidence('2025'),
            ],
            evidenceRefs: [pavEvidence],
          },
        },
        plan.content.assets[1],
      ],
      assembledAt: at,
    });
    const detail = {
      trade: { tradeId: result.content.tradeId, year: 2021 },
      assets: [
        {
          id: 'asset:dawson',
          assetText: 'Jordan Dawson',
          assetType: 'player',
          clubName: 'Adelaide',
          clubSlug: 'adelaide',
          pick: { numberActual: null },
          draftedPlayer: null,
        },
        {
          id: 'asset:future-pick',
          assetText: 'Future 2022 R1 (Melbourne)',
          assetType: 'future_pick',
          clubName: 'Sydney',
          clubSlug: 'sydney',
          pick: { numberActual: null },
          draftedPlayer: null,
        },
      ],
    } as DraftTradeDetail;

    const projection = projectPrivateConfirmedValuationResult({
      detail,
      authenticatedWorkbookSha256: 'd'.repeat(64),
      result,
    });

    expect(projection.assets[0]).toMatchObject({
      state: 'calculated',
      postTradeGames: { state: 'observed', gamesPlayed: 92 },
      realized: { state: 'available', score: 84.10058692299 },
    });
    expect(projection.assets[1]).toMatchObject({
      state: 'unavailable',
      reason: 'selection_lineage_not_reviewed',
    });
    expect(projection.overallGrade.state).toBe('unavailable');
    expect(projection.projectionId).toBe(result.resultId);
  });
});
