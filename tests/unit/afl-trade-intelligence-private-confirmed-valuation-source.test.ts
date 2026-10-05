import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradePrivateConfirmedValuationPlanV2 } from '@/server/aflTradeIntelligence/valuation/privateConfirmedTradeValuationContracts';
import { createAflTradePrivateConfirmedValuationConstructionSourceV2 } from '@/server/aflTradeIntelligence/valuation/privateConfirmedTradeValuationSource';

const at = '2026-08-17T00:00:00.000Z';
const evidence = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, '2026-08-16T00:00:00.000Z');
const acquisitionSpell = {
  spellId: `acquisition-spell:${'1'.repeat(64)}`,
  spellVersionId: `acquisition-spell-version:${'2'.repeat(64)}`,
  ruleId: `acquisition-spell-rule:${'3'.repeat(64)}`,
  startEventVersionId: `event-version:${'4'.repeat(64)}`,
  startAssetVersionId: `event-asset-version:${'5'.repeat(64)}`,
  startDate: '2021-01-01',
  endDate: null,
} as const;

describe('private confirmed valuation source', () => {
  it('derives Dawson appearances and realized PAV only from exact promoted assets and reviewed rows', async () => {
    const snapshot = {
      trustedAt: at,
      authority: {
        kind: 'private_confirmed_nonproduction_calculation' as const,
        evidenceKind: 'retained_private_review' as const,
        decisionId: `private-reviewed-evidence-evaluation-decision:${'a'.repeat(64)}`,
        evidenceBundleId: `private-reviewed-evidence-bundle:${'b'.repeat(64)}`,
        evidenceBundleArtifact: evidence('bundle'),
        publicationEligible: false as const,
        publicationProhibited: true as const,
      },
      promotion: {
        promotionId: `private-workbook-transaction-promotion:${'c'.repeat(64)}`,
        decisionId: `workbook-transaction-review-decision:${'d'.repeat(64)}`,
        decidedAt: '2026-08-16T10:00:00.000Z',
        decisionDocument: { reviewed: 'dawson-transaction' },
        workbookTradeId: 'workbook-2021-e7f7d1484744f855',
        occurredOn: '2021-01-01',
        occurrencePrecision: 'year' as const,
        assets: [
          {
            assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
            assetKind: 'player' as const,
            sendingClubId: 'local-afl-club:sydney',
            receivingClubId: 'local-afl-club:adelaide',
            canonicalPlayerId: 'local-afl-player:afl-tables:12516',
            acquisitionSpell,
            reviewedRecordedName: 'Jordan Dawson',
            reviewedReceivingClubName: 'Adelaide',
            identityReviewDocument: { reviewed: 'dawson' },
          },
          {
            assetId: 'workbook-2021-e7f7d1484744f855-sydney-2',
            assetKind: 'future_pick' as const,
            sendingClubId: 'local-afl-club:adelaide',
            receivingClubId: 'local-afl-club:sydney',
            canonicalPlayerId: null,
            acquisitionSpell: null,
            reviewedRecordedName: null,
            reviewedReceivingClubName: null,
            identityReviewDocument: null,
          },
        ],
      },
      expectedSeasonYears: [2022, 2023, 2024, 2025],
      appearanceRows: Array.from({ length: 92 }, (_, index) => ({
        providerDecodedRowId: `provider-row:${String(index + 1).padStart(3, '0')}`,
        seasonYear: 2022 + Math.floor(index / 23),
        matchDate: `${2022 + Math.floor(index / 23)}-05-01`,
        canonicalPlayerId: 'local-afl-player:afl-tables:12516',
        playingForClubId: 'local-afl-club:adelaide',
        memberDocument: { index },
      })),
      calculations: [2022, 2023, 2024, 2025].map((seasonYear, index) => ({
        calculationId: `private-reviewed-hpn-calculation:${String(index + 1).repeat(64)}`,
        calculatedAt: `2026-08-16T0${index + 1}:00:00.000Z`,
        seasonYear,
        methodId: 'private-reviewed-hpn-method:method',
        calculationDocument: { seasonYear, kind: 'reviewed-hpn' },
        allocation: {
          canonicalPlayerId: 'local-afl-player:afl-tables:12516',
          clubId: 'local-afl-club:adelaide',
          gamesPlayed: 23,
          sourceRowIds: Array.from({ length: 23 }, (_, rowIndex) =>
            `provider-row:${String(index * 23 + rowIndex + 1).padStart(3, '0')}`
          ),
          offensiveScore: [200, 250, 280, 304][index]!,
          midfieldScore: [3000, 3500, 3900, 4276][index]!,
          defensiveScore: [1500, 1900, 2100, 2455][index]!,
          offensivePav: [5, 6, 6.5, 7.104135356408][index]!,
          midfieldPav: [7, 8, 9, 10.157864473676][index]!,
          defensivePav: [5, 6, 7, 7.338587092906][index]!,
          totalPav: [17, 20, 22.5, 24.60058692299][index]!,
        },
      })),
    };
    const source = createAflTradePrivateConfirmedValuationConstructionSourceV2({
      loadSnapshot: async () => snapshot,
      artifactRepository: createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' }),
      maximumArtifactBytes: 1_000_000,
    });

    const staged = await source.loadStage({
      valuationScopeKey: 'afl-men:2021-trades',
      tradeId: 'workbook-2021-e7f7d1484744f855',
    });
    expect(staged.state).toBe('ready');
    if (staged.state !== 'ready') throw new Error('Expected ready stage input.');
    expect(staged.input).toMatchObject({
      transactionOccurredOn: '2021-01-01',
      transactionOccurrencePrecision: 'year',
    });
    const plan = createAflTradePrivateConfirmedValuationPlanV2(staged.input);
    const assembled = await source.loadAssembly(plan);
    expect(assembled.state).toBe('ready');
    if (assembled.state !== 'ready') throw new Error('Expected ready assembly input.');
    expect(assembled.input.assets[0]).toMatchObject({
      appearances: { state: 'observed', gamesPlayed: 92, coverage: 'right_censored' },
      realizedPav: {
        state: 'calculated',
        score: 84.10058692299,
        components: {
          offensiveScore: 1034,
          midfieldScore: 14676,
          defensiveScore: 7955,
          offensivePav: 24.604135356408,
          midfieldPav: 34.157864473676,
          defensivePav: 25.338587092906,
        },
      },
    });
    expect(assembled.input.assets[1]).toMatchObject({
      realizedPav: { state: 'unavailable', reasons: ['selection_lineage_unresolved'] },
    });

    const incompleteSource = createAflTradePrivateConfirmedValuationConstructionSourceV2({
      loadSnapshot: async () => ({
        ...snapshot,
        appearanceRows: snapshot.appearanceRows.filter(({ seasonYear }) => seasonYear !== 2025),
        calculations: snapshot.calculations.filter(({ seasonYear }) => seasonYear !== 2025),
      }),
      artifactRepository: createAflTradeFixtureArtifactRepository({ artifactClass: 'derived_private' }),
      maximumArtifactBytes: 1_000_000,
    });
    const incomplete = await incompleteSource.loadStage({
      valuationScopeKey: 'afl-men:2021-trades',
      tradeId: 'workbook-2021-e7f7d1484744f855',
    });
    expect(incomplete.state).toBe('ready');
    if (incomplete.state !== 'ready') throw new Error('Expected an unavailable asset plan.');
    expect(incomplete.input.assets[0]).toMatchObject({
      appearances: {
        state: 'unavailable',
        reasons: ['calculation_evidence_incomplete'],
      },
      realizedPav: {
        state: 'unavailable',
        reasons: ['calculation_field_unavailable'],
      },
    });

    const zeroSeasonSource = createAflTradePrivateConfirmedValuationConstructionSourceV2({
      loadSnapshot: async () => ({
        ...snapshot,
        expectedSeasonYears: [],
        appearanceRows: [],
        calculations: [],
      }),
      artifactRepository: createAflTradeFixtureArtifactRepository({
        artifactClass: 'derived_private',
      }),
      maximumArtifactBytes: 1_000_000,
    });
    const zeroSeason = await zeroSeasonSource.loadStage({
      valuationScopeKey: 'afl-men:2021-trades',
      tradeId: 'workbook-2021-e7f7d1484744f855',
    });
    expect(zeroSeason.state).toBe('ready');
    if (zeroSeason.state !== 'ready') throw new Error('Expected an unavailable zero-season plan.');
    expect(zeroSeason.input.assets[0]).toMatchObject({
      appearances: {
        state: 'unavailable',
        reasons: ['calculation_evidence_incomplete'],
      },
      realizedPav: {
        state: 'unavailable',
        reasons: ['calculation_field_unavailable'],
      },
    });

    const currentSeasonAppearanceSource =
      createAflTradePrivateConfirmedValuationConstructionSourceV2({
        loadSnapshot: async () => ({
          ...snapshot,
          expectedSeasonYears: [],
          appearanceRows: Array.from({ length: 12 }, (_, index) => ({
            providerDecodedRowId: `official-row:${index + 1}`,
            seasonYear: 2026,
            matchDate: `2026-05-${String(index + 1).padStart(2, '0')}`,
            canonicalPlayerId: 'local-afl-player:afl-tables:12516',
            playingForClubId: 'local-afl-club:adelaide',
            memberDocument: { provider: 'official_afl', index },
          })),
          calculations: [],
        }),
        artifactRepository: createAflTradeFixtureArtifactRepository({
          artifactClass: 'derived_private',
        }),
        maximumArtifactBytes: 1_000_000,
      });
    const currentSeason = await currentSeasonAppearanceSource.loadStage({
      valuationScopeKey: 'afl-men:2021-trades',
      tradeId: 'workbook-2021-e7f7d1484744f855',
    });
    expect(currentSeason.state).toBe('ready');
    if (currentSeason.state !== 'ready') throw new Error('Expected current-season appearance plan.');
    const currentSeasonPlan = createAflTradePrivateConfirmedValuationPlanV2(currentSeason.input);
    const currentSeasonAssembly = await currentSeasonAppearanceSource.loadAssembly(currentSeasonPlan);
    expect(currentSeasonAssembly.state).toBe('ready');
    if (currentSeasonAssembly.state !== 'ready') {
      throw new Error('Expected current-season appearance assembly.');
    }
    expect(currentSeasonAssembly.input.assets[0]).toMatchObject({
      appearances: {
        state: 'observed',
        gamesPlayed: 12,
        coverage: 'right_censored',
        effectiveThroughSeason: 2026,
      },
      realizedPav: {
        state: 'unavailable',
        reasons: ['calculation_field_unavailable'],
      },
    });
  });
});
