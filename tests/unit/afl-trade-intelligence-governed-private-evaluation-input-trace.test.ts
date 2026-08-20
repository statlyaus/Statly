import { describe, expect, it } from 'vitest';

import {
  GOVERNED_PRIVATE_EVALUATION_INPUT_TRACE_SCHEMA_VERSION,
  createGovernedPrivateEvaluationInputTrace,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationInputTrace';
import { createGovernedPrivateEvaluationExplanationPolicy } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationExplanationPolicy';
import { authenticateGovernedPrivateEvaluationExplanationSource } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationExplanationSource';
import { deriveGovernedPrivateEvaluationTransaction } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationTransaction';

const digest = (character: string) =>
  character.charCodeAt(0).toString(16).padStart(2, '0').repeat(32);
const addressed = (kind: string, character: string) => `${kind}:${digest(character)}`;

function artifact(character: string, createdAt = '2026-08-19T09:00:00.000Z') {
  return {
    artifactId: addressed('artifact', character),
    contentSha256: digest(character),
    storageUri: `artifact://sha256/${digest(character)}`,
    mediaType: 'application/json',
    byteLength: 512,
    createdAt,
  };
}

function component(
  role:
    | 'player_contribution_and_availability'
    | 'draft_pick_and_future_pick_distribution',
  character: string
) {
  return {
    role,
    runId: addressed('model-run', character),
    protocolId: addressed('model-protocol', character),
    datasetId: addressed('dataset', character),
    datasetAdmissionId: addressed('dataset-admission', character),
    gate3DecisionId: addressed('gate-decision', character),
    evidence: {
      runManifest: artifact(character),
      protocol: artifact(String.fromCharCode(character.charCodeAt(0) + 2)),
      datasetAdmission: artifact(String.fromCharCode(character.charCodeAt(0) + 4)),
      gate3Decision: artifact(String.fromCharCode(character.charCodeAt(0) + 6)),
    },
  };
}

function inputTrace() {
  return {
    schemaVersion: GOVERNED_PRIVATE_EVALUATION_INPUT_TRACE_SCHEMA_VERSION,
    environment: 'non_production' as const,
    selector: {
      valuationScopeKey: 'afl-men:2023-trades',
      tradeId: 'trade:carlton-fremantle-gold-coast',
    },
    factualReleaseId: addressed('outcome-release', '1'),
    valuationInputBundleId: addressed('valuation-input-bundle', '2'),
    components: [
      component('player_contribution_and_availability', '3'),
      component('draft_pick_and_future_pick_distribution', '4'),
    ],
    transaction: {
      effectiveAt: '2023-10-18T00:00:00.000Z',
      clubs: [
        { aflClubId: 'club:carlton', clubName: 'Carlton' },
        { aflClubId: 'club:fremantle', clubName: 'Fremantle' },
        { aflClubId: 'club:gold-coast', clubName: 'Gold Coast' },
      ],
      transfers: [
        {
          transferId: 'transfer:pick-12',
          assetId: 'asset:pick-12',
          assetKind: 'current_pick_entitlement' as const,
          fromClubId: 'club:carlton',
          toClubId: 'club:fremantle',
          displayLabel: '2023 pick 12',
          evidenceRef: artifact('b', '2023-10-18T00:00:00.000Z'),
        },
        {
          transferId: 'transfer:pick-future',
          assetId: 'asset:pick-future',
          assetKind: 'future_pick_entitlement' as const,
          fromClubId: 'club:fremantle',
          toClubId: 'club:gold-coast',
          displayLabel: 'Fremantle 2024 second-round pick',
          evidenceRef: artifact('c', '2023-10-18T00:00:00.000Z'),
        },
        {
          transferId: 'transfer:player-a',
          assetId: 'asset:player-a',
          assetKind: 'player' as const,
          fromClubId: 'club:gold-coast',
          toClubId: 'club:carlton',
          displayLabel: 'Player A',
          evidenceRef: artifact('a', '2023-10-18T00:00:00.000Z'),
        },
      ],
    },
    seasonUniverse: [
      {
        season: 2024,
        status: 'complete' as const,
        startsAt: '2024-03-01T00:00:00.000Z',
        endsAt: '2024-09-30T23:59:59.999Z',
        evidenceRef: artifact('d', '2024-10-01T00:00:00.000Z'),
      },
      {
        season: 2025,
        status: 'complete' as const,
        startsAt: '2025-03-01T00:00:00.000Z',
        endsAt: '2025-09-30T23:59:59.999Z',
        evidenceRef: artifact('e', '2025-10-01T00:00:00.000Z'),
      },
      {
        season: 2026,
        status: 'right_censored' as const,
        startsAt: '2026-03-01T00:00:00.000Z',
        endsAt: '2026-09-30T23:59:59.999Z',
        evidenceRef: artifact('f'),
      },
    ],
    playerHorizons: [
      {
        assetId: 'asset:player-a',
        playerId: 'player:a',
        playerName: 'Player A',
        playerObservationId: addressed('player-pav-observation', '7'),
        playerObservationArtifact: artifact('p'),
        receivingClubId: 'club:carlton',
        acquisitionSpells: [
          {
            spellVersionId: 'acquisition-spell-version:player-a-carlton',
            clubId: 'club:carlton',
            clubName: 'Carlton',
            joinedAt: '2023-10-18T00:00:00.000Z',
            departedAt: null,
            evidenceRef: artifact('g', '2023-10-18T00:00:00.000Z'),
          },
        ],
        requiredSeasons: [
          { season: 2024, status: 'complete' as const, evidenceRef: artifact('h') },
          { season: 2025, status: 'complete' as const, evidenceRef: artifact('i') },
          { season: 2026, status: 'right_censored' as const, evidenceRef: artifact('j') },
        ],
      },
    ],
    pickLineages: [
      {
        rootAssetId: 'asset:pick-12',
        pickIdentityId: 'pick-identity:2023-round-1-carlton',
        pickIdentityLabel: 'Carlton 2023 first-round pick',
        receivingClubId: 'club:fremantle',
        pickObservationSetId: addressed('pick-pav-observation-set', '5'),
        pickModelExecutionId: addressed('pick-pav-model-execution', '6'),
        pickBenchmarkId: addressed('pick-pav-benchmark', '7'),
        pickBenchmarkArtifact: artifact('q'),
        resolvedSelectionNumber: 18,
        custody: [
          {
            ordinal: 0,
            clubId: 'club:fremantle',
            clubName: 'Fremantle',
            heldFrom: '2023-10-18T00:00:00.000Z',
            heldThrough: '2024-10-15T00:00:00.000Z',
            evidenceRef: artifact('k'),
          },
          {
            ordinal: 1,
            clubId: 'club:hawthorn',
            clubName: 'Hawthorn',
            heldFrom: '2024-10-15T00:00:00.000Z',
            heldThrough: null,
            evidenceRef: artifact('l'),
          },
        ],
        transformations: [
          {
            ordinal: 0,
            kind: 'renumbered' as const,
            fromAssetIds: ['asset:pick-12'],
            toAssetIds: ['asset:pick-18'],
            effectiveAt: '2024-11-01T00:00:00.000Z',
            economicAllocationDecisionId: null,
            assetLabels: [
              { assetId: 'asset:pick-12', displayLabel: '2023 pick 12' },
              { assetId: 'asset:pick-18', displayLabel: '2023 pick 18' },
            ],
            evidenceRef: artifact('m'),
          },
          {
            ordinal: 1,
            kind: 'selected_player' as const,
            fromAssetIds: ['asset:pick-18'],
            toAssetIds: ['asset:selected-player'],
            effectiveAt: '2024-11-20T00:00:00.000Z',
            economicAllocationDecisionId: null,
            assetLabels: [
              { assetId: 'asset:pick-18', displayLabel: '2023 pick 18' },
              { assetId: 'asset:selected-player', displayLabel: 'Selected Player' },
            ],
            evidenceRef: artifact('n'),
          },
        ],
      },
      {
        rootAssetId: 'asset:pick-future',
        pickIdentityId: 'pick-identity:2024-round-2-fremantle',
        pickIdentityLabel: 'Fremantle 2024 second-round pick',
        receivingClubId: 'club:gold-coast',
        pickObservationSetId: addressed('pick-pav-observation-set', '5'),
        pickModelExecutionId: addressed('pick-pav-model-execution', '6'),
        pickBenchmarkId: addressed('pick-pav-benchmark', '7'),
        pickBenchmarkArtifact: artifact('r'),
        resolvedSelectionNumber: null,
        custody: [
          {
            ordinal: 0,
            clubId: 'club:gold-coast',
            clubName: 'Gold Coast',
            heldFrom: '2023-10-18T00:00:00.000Z',
            heldThrough: null,
            evidenceRef: artifact('o'),
          },
        ],
        transformations: [],
      },
    ],
    derivedAt: '2026-08-19T10:00:00.000Z',
    publicationEligible: false as const,
    limitation:
      'Authenticated calculation-input trace only; contains no caller-supplied values, grades, publication approval, or activation authority.' as const,
  };
}

function explanationPolicy(createdAt = '2026-08-19T09:30:00.000Z') {
  return createGovernedPrivateEvaluationExplanationPolicy({
    schemaVersion: 'private-evaluation-explanation-policy/v1',
    environment: 'non_production',
    valueUnitId: 'fixed_horizon_pav',
    selectedLayer: 'scarcityAdjusted',
    practicalEquivalence: {
      basis: 'absolute club package net difference in fixed_horizon_pav',
      bandByView: [
        { view: 'at_trade', maximumDifference: 2 },
        { view: 'realized', maximumDifference: 1 },
        { view: 'remaining', maximumDifference: 2 },
        { view: 'current', maximumDifference: 2 },
      ],
    },
    createdAt,
    publicationEligible: false,
    limitation:
      'Private calculation explanation policy only; not model, grade, publication, or activation authority.',
  });
}

describe('governed private evaluation input trace', () => {
  it('authenticates one complete three-club transaction with player horizons and pick lineage', () => {
    const trace = createGovernedPrivateEvaluationInputTrace(inputTrace());
    const transaction = deriveGovernedPrivateEvaluationTransaction(trace);

    expect(trace.inputTraceId).toMatch(/^private-evaluation-input-trace:[a-f0-9]{64}$/);
    expect(trace.content.transaction.clubs.map(({ clubName }) => clubName)).toEqual([
      'Carlton',
      'Fremantle',
      'Gold Coast',
    ]);
    expect(trace.content.playerHorizons[0]?.requiredSeasons.map(({ season }) => season)).toEqual([
      2024, 2025, 2026,
    ]);
    expect(trace.content.playerHorizons[0]?.playerObservationId).toMatch(
      /^player-pav-observation:[a-f0-9]{64}$/
    );
    expect(trace.content.pickLineages.map(({ resolvedSelectionNumber }) => resolvedSelectionNumber))
      .toEqual([18, null]);
    expect(trace.content.pickLineages[0]?.custody.map(({ clubId }) => clubId)).toEqual([
      'club:fremantle',
      'club:hawthorn',
    ]);
    expect(transaction.transfers).toEqual([
      expect.objectContaining({
        assetId: 'asset:pick-12',
        fromClubId: 'club:carlton',
        toClubId: 'club:fremantle',
        assetKind: 'current_pick',
        displayLabel: '2023 pick 12',
      }),
      expect.objectContaining({
        assetId: 'asset:pick-future',
        fromClubId: 'club:fremantle',
        toClubId: 'club:gold-coast',
        assetKind: 'future_pick',
      }),
      expect.objectContaining({
        assetId: 'asset:player-a',
        fromClubId: 'club:gold-coast',
        toClubId: 'club:carlton',
        assetKind: 'player',
      }),
    ]);
    expect(transaction.clubs).toEqual([
      expect.objectContaining({
        aflClubId: 'club:carlton',
        receivedAssetIds: ['asset:player-a'],
        givenUpAssetIds: ['asset:pick-12'],
      }),
      expect.objectContaining({
        aflClubId: 'club:fremantle',
        receivedAssetIds: ['asset:pick-12'],
        givenUpAssetIds: ['asset:pick-future'],
      }),
      expect.objectContaining({
        aflClubId: 'club:gold-coast',
        receivedAssetIds: ['asset:pick-future'],
        givenUpAssetIds: ['asset:player-a'],
      }),
    ]);
  });

  it('normalizes exact archive directions and retained four-view policy without grade authority', () => {
    const trace = createGovernedPrivateEvaluationInputTrace(inputTrace());
    const policy = explanationPolicy();

    expect(authenticateGovernedPrivateEvaluationExplanationSource({ trace, policy })).toEqual({
      authority: {
        kind: 'authenticated_non_production',
        inputTraceId: trace.inputTraceId,
        explanationPolicyId: policy.policyId,
        publicationProhibited: true,
      },
      selector: trace.content.selector,
      effectiveAt: trace.content.transaction.effectiveAt,
      valueUnitId: 'fixed_horizon_pav',
      selectedLayer: 'scarcityAdjusted',
      practicalEquivalence: {
        basis: 'absolute club package net difference in fixed_horizon_pav',
        bandByView: { at_trade: 2, realized: 1, remaining: 2, current: 2 },
      },
      clubs: expect.arrayContaining([
        expect.objectContaining({ aflClubId: 'club:carlton', clubName: 'Carlton' }),
      ]),
      transfers: expect.arrayContaining([
        expect.objectContaining({
          assetId: 'asset:pick-12',
          fromClubId: 'club:carlton',
          toClubId: 'club:fremantle',
          directionBasis: 'archive_recorded_transfer',
        }),
      ]),
    });
  });

  it('rejects an explanation policy created after its authenticated input trace', () => {
    const trace = createGovernedPrivateEvaluationInputTrace(inputTrace());

    expect(() =>
      authenticateGovernedPrivateEvaluationExplanationSource({
        trace,
        policy: explanationPolicy('2026-08-19T10:00:00.001Z'),
      })
    ).toThrow(/policy.*before|trace/i);
  });

  it('rejects an omitted completed player season', () => {
    const input = inputTrace();
    input.playerHorizons[0]!.requiredSeasons.splice(1, 1);

    expect(() => createGovernedPrivateEvaluationInputTrace(input)).toThrow(
      'Player horizon must contain every applicable season from the authenticated universe.'
    );
  });

  it('rejects an omitted season from the post-trade season universe', () => {
    const input = inputTrace();
    input.seasonUniverse.splice(1, 1);
    input.playerHorizons[0]!.requiredSeasons.splice(1, 1);

    expect(() => createGovernedPrivateEvaluationInputTrace(input)).toThrow(
      'Season universe must contain every consecutive post-trade season through the current cutoff.'
    );
  });

  it('rejects a transaction club without a directed transfer', () => {
    const input = inputTrace();
    input.transaction.clubs.push({ aflClubId: 'club:melbourne', clubName: 'Melbourne' });

    expect(() => createGovernedPrivateEvaluationInputTrace(input)).toThrow(
      'Transaction clubs must equal the exact clubs participating in directed transfers.'
    );
  });

  it('rejects ambiguous split lineage without an approved economic allocation', () => {
    const input = inputTrace();
    input.pickLineages[0]!.transformations[0] = {
      ...input.pickLineages[0]!.transformations[0]!,
      kind: 'split',
      toAssetIds: ['asset:pick-18', 'asset:pick-35'],
    };

    expect(() => createGovernedPrivateEvaluationInputTrace(input)).toThrow(
      'Split or merged transformations require one approved economic-allocation decision.'
    );
  });

  it('rejects caller-supplied values or grades', () => {
    const input = inputTrace() as ReturnType<typeof inputTrace> & { score?: number };
    input.score = 18.4;

    expect(() => createGovernedPrivateEvaluationInputTrace(input)).toThrow();
  });

  it('rejects a lineage transformation without labels for its complete frontier', () => {
    const input = inputTrace();
    input.pickLineages[0]!.transformations[0]!.assetLabels.pop();

    expect(() => createGovernedPrivateEvaluationInputTrace(input)).toThrow(
      /lineage|label|transformation/i
    );
  });
});
