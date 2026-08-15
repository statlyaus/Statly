import { describe, expect, it } from 'vitest';

import { createLocalSyntheticValuationScenario } from '@/server/aflTradeIntelligence/development/localSyntheticValuationScenario';
import { validateAflTradeValuationArtifactChain } from '@/server/aflTradeIntelligence/valuation/tradeValuationValidation';

const valuationBundleId = `valuation-bundle:${'a'.repeat(64)}`;

function twoPartyPlayerDefinition() {
  return {
    schemaVersion: 'local-synthetic-trade-definition/v1' as const,
    basis: {
      kind: 'private_workbook' as const,
      basisId: `workbook:${'b'.repeat(64)}`,
    },
    tradeId: 'workbook-2025-two-party-player-swap',
    effectiveAt: '2025-10-01T00:00:00.000Z',
    effectiveThrough: '2026-05-28T00:00:00.000Z',
    parties: [
      { aflClubId: 'afl-club:adelaide', clubName: 'Adelaide' },
      { aflClubId: 'afl-club:st-kilda', clubName: 'St Kilda' },
    ],
    transfers: [
      {
        transferId: 'transfer:adelaide-player',
        fromClubId: 'afl-club:st-kilda',
        toClubId: 'afl-club:adelaide',
        assetId: 'asset:adelaide-player',
        assetKind: 'player' as const,
        displayLabel: 'Adelaide player scenario asset',
        directionBasis: 'two_party_other_club_assumption' as const,
      },
      {
        transferId: 'transfer:st-kilda-player',
        fromClubId: 'afl-club:adelaide',
        toClubId: 'afl-club:st-kilda',
        assetId: 'asset:st-kilda-player',
        assetKind: 'player' as const,
        displayLabel: 'St Kilda player scenario asset',
        directionBasis: 'two_party_other_club_assumption' as const,
      },
    ],
  };
}

describe('local synthetic AFL trade valuation scenario', () => {
  it('deterministically exercises the production-shaped valuation chain without release ancestry', () => {
    const input = {
      environment: 'test_fixture' as const,
      definition: twoPartyPlayerDefinition(),
      valuationBundleId,
      scenario: 'baseline' as const,
      assessedAt: '2026-05-28T01:00:00.000Z',
    };

    const first = createLocalSyntheticValuationScenario(input);
    const replay = createLocalSyntheticValuationScenario(structuredClone(input));

    expect(replay.scenarioId).toBe(first.scenarioId);
    expect(replay.calculation.valuationCalculationId).toBe(
      first.calculation.valuationCalculationId
    );
    expect(first.evidenceClassification).toBe('fabricated_test_evidence_not_real_afl_data');
    expect(first.authority).toEqual({
      kind: 'private_scenario',
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(first.assumptionSet.content.transferDirections).toHaveLength(2);
    expect(first.valuationCase.content.viewContexts.map(({ view }) => view)).toEqual([
      'at_trade',
      'realized',
      'remaining',
      'current',
    ]);
    expect(
      validateAflTradeValuationArtifactChain({
        valuationCase: first.valuationCase,
        lineageGraph: first.lineageGraph,
        componentDrawSet: first.componentDrawSet,
        realizedContributionLedger: first.realizedContributionLedger,
        packagePolicy: first.packagePolicy,
        calculation: first.calculation,
        snapshotSet: first.snapshotSet,
        explanation: first.explanation,
      }).structurallyValid
    ).toBe(true);
    expect(first).not.toHaveProperty('archive');
    expect(first).not.toHaveProperty('releaseId');
    expect(first).not.toHaveProperty('assessmentVerification');
  });

  it('rejects archive publication fixtures at the private scenario boundary', () => {
    const definition = twoPartyPlayerDefinition();

    expect(() =>
      createLocalSyntheticValuationScenario({
        environment: 'test_fixture',
        definition: {
          ...definition,
          basis: {
            kind: 'test_fixture_archive',
            basisId: `archive:${'c'.repeat(64)}`,
          },
        },
        valuationBundleId,
        scenario: 'baseline',
        assessedAt: '2026-05-28T01:00:00.000Z',
      })
    ).toThrow('Private synthetic valuation scenarios require private_workbook evidence.');
  });
});
