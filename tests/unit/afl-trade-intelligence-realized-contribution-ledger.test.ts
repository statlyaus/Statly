import { describe, expect, it } from 'vitest';

import type { AflTradeLineageGraph } from '@/server/aflTradeIntelligence/domain/lineageTypes';
import {
  aflTradeRealizedContributionLedgerSchema,
  createAflTradeRealizedContributionLedger,
  validateAflTradeRealizedContributionLedger,
  type AflTradeRealizedContributionLedger,
  type AflTradeRealizedContributionLedgerContent,
  type AflTradeRealizedContributionRecord,
} from '@/server/aflTradeIntelligence/valuation/realizedContributionLedger';
import {
  createAflTradeLineageGraphId,
  createAflTradeValuationCase,
  type AflTradeValuationCase,
} from '@/server/aflTradeIntelligence/valuation/valuationCaseContracts';

const TRADE_AT = '2024-10-10T00:00:00.000Z';
const DRAFT_AT = '2025-01-01T00:00:00.000Z';
const DEPARTURE_AT = '2026-01-01T00:00:00.000Z';
const CURRENT_AT = '2026-08-05T00:00:00.000Z';
const BUNDLE_ID = `valuation-bundle:${'1'.repeat(64)}`;
const VALUE_UNIT_ID = 'football-contribution-above-replacement-v1';

function graph(): AflTradeLineageGraph {
  return {
    assets: [
      {
        assetId: 'asset:root-pick-a',
        assetType: 'current_pick_entitlement',
        effectiveFrom: TRADE_AT,
        knownFrom: TRADE_AT,
        knownTo: null,
        evidenceId: 'evidence:root-pick-a',
      },
      {
        assetId: 'asset:selection-a',
        assetType: 'draft_selection',
        effectiveFrom: DRAFT_AT,
        knownFrom: DRAFT_AT,
        knownTo: null,
        evidenceId: 'evidence:selection-a',
      },
      {
        assetId: 'asset:player-a',
        assetType: 'player',
        effectiveFrom: DRAFT_AT,
        knownFrom: DRAFT_AT,
        knownTo: null,
        evidenceId: 'evidence:player-a',
      },
      {
        assetId: 'asset:player-b',
        assetType: 'player',
        effectiveFrom: TRADE_AT,
        knownFrom: TRADE_AT,
        knownTo: null,
        evidenceId: 'evidence:player-b',
      },
    ],
    custodySpells: [
      {
        custodySpellId: 'custody:root-pick-a:club-a',
        assetId: 'asset:root-pick-a',
        aflClubId: 'club-a',
        effectiveFrom: TRADE_AT,
        effectiveTo: DRAFT_AT,
        knownFrom: TRADE_AT,
        knownTo: null,
        evidenceId: 'evidence:custody-root-pick-a',
      },
      {
        custodySpellId: 'custody:player-a:club-a',
        assetId: 'asset:player-a',
        aflClubId: 'club-a',
        effectiveFrom: DRAFT_AT,
        effectiveTo: DEPARTURE_AT,
        knownFrom: DRAFT_AT,
        knownTo: null,
        evidenceId: 'evidence:custody-player-a-club-a',
      },
      {
        custodySpellId: 'custody:player-a:club-c',
        assetId: 'asset:player-a',
        aflClubId: 'club-c',
        effectiveFrom: DEPARTURE_AT,
        effectiveTo: null,
        knownFrom: DEPARTURE_AT,
        knownTo: null,
        evidenceId: 'evidence:custody-player-a-club-c',
      },
      {
        custodySpellId: 'custody:player-b:club-b',
        assetId: 'asset:player-b',
        aflClubId: 'club-b',
        effectiveFrom: TRADE_AT,
        effectiveTo: null,
        knownFrom: TRADE_AT,
        knownTo: null,
        evidenceId: 'evidence:custody-player-b-club-b',
      },
    ],
    edges: [
      {
        edgeId: 'edge:pick-to-selection',
        kind: 'pick_exercised_at_selection',
        sourceAssetId: 'asset:root-pick-a',
        targetAssetId: 'asset:selection-a',
        effectiveAt: DRAFT_AT,
        knownFrom: DRAFT_AT,
        knownTo: null,
        evidenceId: 'evidence:edge-pick-to-selection',
        ruleVersion: 'fabricated-test/v1',
      },
      {
        edgeId: 'edge:selection-to-player',
        kind: 'selection_created_player',
        sourceAssetId: 'asset:selection-a',
        targetAssetId: 'asset:player-a',
        effectiveAt: DRAFT_AT,
        knownFrom: DRAFT_AT,
        knownTo: null,
        evidenceId: 'evidence:edge-selection-to-player',
        ruleVersion: 'fabricated-test/v1',
      },
    ],
    dispositions: [],
    corrections: [],
  };
}

function observedRecord(
  overrides: Partial<Extract<AflTradeRealizedContributionRecord, { state: 'observed' }>> = {}
): Extract<AflTradeRealizedContributionRecord, { state: 'observed' }> {
  return {
    contributionRecordId: 'contribution:player-a-2025',
    rootAssetId: 'asset:root-pick-a',
    contributorPlayerAssetId: 'asset:player-a',
    aflClubId: 'club-a',
    custodySpellId: 'custody:player-a:club-a',
    periodStartAt: '2025-03-01T00:00:00.000Z',
    periodEndAt: '2025-10-01T00:00:00.000Z',
    knownFrom: '2025-10-01T00:00:00.000Z',
    knownTo: null,
    evidenceId: 'evidence:player-a-2025',
    sourceObservationId: 'observation:player-a-2025',
    contributionDefinitionId: 'contribution-definition:v1',
    transformationVersion: 'transformation:v1',
    state: 'observed',
    contribution: 12,
    ...overrides,
  };
}

function unavailableRecord(): Extract<
  AflTradeRealizedContributionRecord,
  { state: 'unavailable' }
> {
  return {
    contributionRecordId: 'contribution:player-b-2025-unavailable',
    rootAssetId: 'asset:player-b',
    contributorPlayerAssetId: 'asset:player-b',
    aflClubId: 'club-b',
    custodySpellId: 'custody:player-b:club-b',
    periodStartAt: '2025-03-01T00:00:00.000Z',
    periodEndAt: '2025-10-01T00:00:00.000Z',
    knownFrom: '2025-10-01T00:00:00.000Z',
    knownTo: null,
    evidenceId: 'evidence:player-b-2025-missing',
    sourceObservationId: 'observation:player-b-2025',
    contributionDefinitionId: 'contribution-definition:v1',
    transformationVersion: 'transformation:v1',
    state: 'unavailable',
    reasonCode: 'source-missing',
    explanation: 'The fabricated source observation is intentionally unavailable.',
  };
}

function ledgerContent(
  lineageGraph = graph(),
  records: AflTradeRealizedContributionRecord[] = [observedRecord(), unavailableRecord()]
): AflTradeRealizedContributionLedgerContent {
  return {
    schemaVersion: 'afl-trade-realized-contribution-ledger/v1',
    publicAssetBoundary: 'source_native_afl_players_no_user_or_fantasy_ownership',
    valuationBundleId: BUNDLE_ID,
    lineageGraphId: createAflTradeLineageGraphId(lineageGraph),
    valueUnitId: VALUE_UNIT_ID,
    records,
    missingnessPolicy: 'unavailable_is_explicit_and_never_coerced_to_zero',
    contributionCreditPolicy: 'receiving_afl_club_only_during_verified_custody',
    limitation:
      'Source-independent ledger contract only; records require lawfully approved evidence before any real valuation run.',
  };
}

function valuationCase(
  ledger: AflTradeRealizedContributionLedger,
  lineageGraph = graph(),
  overrides: Partial<{
    valuationBundleId: string;
    lineageGraphId: string;
    valueUnitId: string;
    realizedContributionLedgerId: string;
  }> = {}
): AflTradeValuationCase {
  const current = {
    modelVintage: 'current' as const,
    effectiveAt: CURRENT_AT,
    knowledgeCutoffAt: CURRENT_AT,
    valuationAsOf: CURRENT_AT,
  };
  return createAflTradeValuationCase({
    schemaVersion: 'afl-trade-valuation-case/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    calculationUnit: 'complete_multi_party_trade',
    tradeId: 'trade:realized-ledger-fixture',
    tradeEffectiveAt: TRADE_AT,
    valuationBundleId: BUNDLE_ID,
    lineageGraphId: createAflTradeLineageGraphId(lineageGraph),
    componentDrawSetId: `component-draw-set:${'2'.repeat(64)}`,
    realizedContributionLedgerId: ledger.realizedContributionLedgerId,
    packagePolicyId: `package-policy:${'3'.repeat(64)}`,
    valueUnitId: VALUE_UNIT_ID,
    parties: [
      { aflClubId: 'club-a', clubName: 'Club A', receivedRootAssetIds: ['asset:root-pick-a'] },
      { aflClubId: 'club-b', clubName: 'Club B', receivedRootAssetIds: ['asset:player-b'] },
    ],
    viewContexts: [
      {
        view: 'at_trade',
        modelVintage: 'historical_restatement',
        effectiveAt: TRADE_AT,
        knowledgeCutoffAt: TRADE_AT,
        valuationAsOf: TRADE_AT,
      },
      { view: 'realized', ...current },
      { view: 'remaining', ...current },
      { view: 'current', ...current },
    ],
    legacySourceMetricsTreatment:
      'excluded_from_calculation_retained_only_by_separate_legacy_projection',
    ...overrides,
  });
}

function validSet(lineageGraph = graph()) {
  const ledger = createAflTradeRealizedContributionLedger(ledgerContent(lineageGraph));
  return { ledger, caseValue: valuationCase(ledger, lineageGraph), lineageGraph };
}

describe('AFL trade-intelligence realized contribution ledger', () => {
  it('canonicalizes records and validates observed and explicitly unavailable evidence', () => {
    const lineageGraph = graph();
    const forward = createAflTradeRealizedContributionLedger(ledgerContent(lineageGraph));
    const reversedContent = ledgerContent(lineageGraph);
    reversedContent.records.reverse();
    const reversed = createAflTradeRealizedContributionLedger(reversedContent);
    const caseValue = valuationCase(forward, lineageGraph);

    expect(reversed).toEqual(forward);
    expect(validateAflTradeRealizedContributionLedger(forward, caseValue, lineageGraph)).toEqual({
      valid: true,
      issues: [],
    });
    expect(
      forward.content.records.find((record) => record.state === 'unavailable')
    ).not.toHaveProperty('contribution');
  });

  it('keeps observed zero distinct from unavailable evidence', () => {
    const lineageGraph = graph();
    const zero = observedRecord({ contribution: 0 });
    const ledger = createAflTradeRealizedContributionLedger(
      ledgerContent(lineageGraph, [zero, unavailableRecord()])
    );

    expect(ledger.content.records.find((record) => record.state === 'observed')).toMatchObject({
      state: 'observed',
      contribution: 0,
    });
    expect(
      ledger.content.records.find((record) => record.state === 'unavailable')
    ).not.toHaveProperty('contribution');
  });

  it('rejects duplicate source use and overlapping contribution periods', () => {
    const duplicateSource = observedRecord({ contributionRecordId: 'contribution:duplicate' });
    const overlap = observedRecord({
      contributionRecordId: 'contribution:overlap',
      sourceObservationId: 'observation:overlap',
      periodStartAt: '2025-09-01T00:00:00.000Z',
      periodEndAt: '2025-11-01T00:00:00.000Z',
      knownFrom: '2025-11-01T00:00:00.000Z',
    });

    expect(() =>
      createAflTradeRealizedContributionLedger(
        ledgerContent(graph(), [observedRecord(), duplicateSource])
      )
    ).toThrow(/source observation/i);
    expect(() =>
      createAflTradeRealizedContributionLedger(ledgerContent(graph(), [observedRecord(), overlap]))
    ).toThrow(/cannot overlap/i);
  });

  it('rejects evidence known before its period ends and invalid knowledge intervals', () => {
    expect(() =>
      createAflTradeRealizedContributionLedger(
        ledgerContent(graph(), [observedRecord({ knownFrom: '2025-09-30T00:00:00.000Z' })])
      )
    ).toThrow(/cannot be known/i);
    expect(() =>
      createAflTradeRealizedContributionLedger(
        ledgerContent(graph(), [observedRecord({ knownTo: '2025-09-01T00:00:00.000Z' })])
      )
    ).toThrow(/knowledge interval/i);
  });

  it('detects case, bundle, graph, and value-unit reference mismatches', () => {
    const { ledger, caseValue, lineageGraph } = validSet();
    const otherLedger = createAflTradeRealizedContributionLedger(
      ledgerContent(lineageGraph, [observedRecord()])
    );
    const wrongCaseReference = valuationCase(ledger, lineageGraph, {
      realizedContributionLedgerId: otherLedger.realizedContributionLedgerId,
    });
    expect(
      validateAflTradeRealizedContributionLedger(
        ledger,
        wrongCaseReference,
        lineageGraph
      ).issues.map((issue) => issue.code)
    ).toContain('case_reference_mismatch');

    const wrongLedger = createAflTradeRealizedContributionLedger({
      ...ledger.content,
      valuationBundleId: `valuation-bundle:${'a'.repeat(64)}`,
      lineageGraphId: `lineage-graph:${'b'.repeat(64)}`,
      valueUnitId: 'other-unit',
    });
    expect(
      validateAflTradeRealizedContributionLedger(wrongLedger, caseValue, lineageGraph).issues.map(
        (issue) => issue.code
      )
    ).toEqual(
      expect.arrayContaining([
        'case_reference_mismatch',
        'bundle_mismatch',
        'lineage_graph_mismatch',
        'value_unit_mismatch',
      ])
    );
  });

  it('rejects wrong roots, clubs, contributors, and lineage paths', () => {
    const lineageGraph = graph();
    const invalidRecords = [
      observedRecord({
        contributionRecordId: 'contribution:unknown-root',
        rootAssetId: 'asset:unknown',
      }),
      observedRecord({
        contributionRecordId: 'contribution:wrong-club',
        sourceObservationId: 'observation:wrong-club',
        aflClubId: 'club-b',
      }),
      observedRecord({
        contributionRecordId: 'contribution:not-player',
        sourceObservationId: 'observation:not-player',
        contributorPlayerAssetId: 'asset:root-pick-a',
        custodySpellId: 'custody:root-pick-a:club-a',
      }),
      observedRecord({
        contributionRecordId: 'contribution:not-descendant',
        sourceObservationId: 'observation:not-descendant',
        contributorPlayerAssetId: 'asset:player-b',
        custodySpellId: 'custody:player-b:club-b',
      }),
    ];

    for (const record of invalidRecords) {
      const ledger = createAflTradeRealizedContributionLedger(
        ledgerContent(lineageGraph, [record])
      );
      const result = validateAflTradeRealizedContributionLedger(
        ledger,
        valuationCase(ledger, lineageGraph),
        lineageGraph
      );
      expect(result.valid).toBe(false);
    }
    const codes = invalidRecords.flatMap((record) => {
      const ledger = createAflTradeRealizedContributionLedger(
        ledgerContent(lineageGraph, [record])
      );
      return validateAflTradeRealizedContributionLedger(
        ledger,
        valuationCase(ledger, lineageGraph),
        lineageGraph
      ).issues.map((issue) => issue.code);
    });
    expect(codes).toEqual(
      expect.arrayContaining([
        'unknown_root',
        'root_club_mismatch',
        'contributor_not_player',
        'contributor_not_descendant',
      ])
    );
  });

  it('rejects contribution after departure, before trade, or beyond the current cutoff', () => {
    const lineageGraph = graph();
    const records = [
      observedRecord({
        contributionRecordId: 'contribution:after-departure',
        sourceObservationId: 'observation:after-departure',
        periodStartAt: '2026-02-01T00:00:00.000Z',
        periodEndAt: '2026-03-01T00:00:00.000Z',
        knownFrom: '2026-03-01T00:00:00.000Z',
      }),
      observedRecord({
        contributionRecordId: 'contribution:before-trade',
        sourceObservationId: 'observation:before-trade',
        contributorPlayerAssetId: 'asset:player-b',
        rootAssetId: 'asset:player-b',
        aflClubId: 'club-b',
        custodySpellId: 'custody:player-b:club-b',
        periodStartAt: '2024-09-01T00:00:00.000Z',
        periodEndAt: '2024-10-01T00:00:00.000Z',
        knownFrom: '2024-10-01T00:00:00.000Z',
      }),
      observedRecord({
        contributionRecordId: 'contribution:after-cutoff',
        sourceObservationId: 'observation:after-cutoff',
        contributorPlayerAssetId: 'asset:player-b',
        rootAssetId: 'asset:player-b',
        aflClubId: 'club-b',
        custodySpellId: 'custody:player-b:club-b',
        periodStartAt: '2026-08-06T00:00:00.000Z',
        periodEndAt: '2026-09-01T00:00:00.000Z',
        knownFrom: '2026-09-01T00:00:00.000Z',
      }),
    ];

    const codes = records.flatMap((record) => {
      const ledger = createAflTradeRealizedContributionLedger(
        ledgerContent(lineageGraph, [record])
      );
      return validateAflTradeRealizedContributionLedger(
        ledger,
        valuationCase(ledger, lineageGraph),
        lineageGraph
      ).issues.map((issue) => issue.code);
    });
    expect(codes).toEqual(
      expect.arrayContaining([
        'contribution_outside_custody',
        'contribution_before_trade',
        'contribution_after_view_cutoff',
        'record_not_known_at_cutoff',
      ])
    );
  });

  it('rejects ownership fields and content-address tampering', () => {
    const valid = createAflTradeRealizedContributionLedger(ledgerContent());
    const forbidden = [
      { ...valid.content, userId: 'user-1' },
      { ...valid.content, fantasyLeagueId: 'league-1' },
      {
        ...valid.content,
        records: [
          { ...valid.content.records[0], ownerId: 'owner-1' },
          ...valid.content.records.slice(1),
        ],
      },
    ];
    for (const invalidContent of forbidden) {
      expect(
        aflTradeRealizedContributionLedgerSchema.safeParse({
          realizedContributionLedgerId: valid.realizedContributionLedgerId,
          content: invalidContent,
        }).success
      ).toBe(false);
    }
    expect(
      aflTradeRealizedContributionLedgerSchema.safeParse({
        ...valid,
        content: { ...valid.content, valueUnitId: 'tampered-unit' },
      }).success
    ).toBe(false);
  });
});
