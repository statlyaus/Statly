import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradePlayerPavPolicy,
  type AflTradePlayerPavObservation,
} from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import { materializeAflTradePlayerPavObservationSet } from '@/server/aflTradeIntelligence/modeling/playerPavObservationService';

const digest = (marker: string) => marker.repeat(64);
const releaseId = `outcome-release:${digest('d')}`;

function policy() {
  return createAflTradePlayerPavPolicy({
    schemaVersion: 'afl-trade-player-pav-policy/v1',
    authorityBoundary:
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    policyVersion: 'player-pav-service-fixture-v1',
    featureHistorySeasons: 1,
    fixedHorizonSeasons: 1,
    methodId: `hpn-pav-method:${digest('a')}`,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    partitions: [
      { role: 'train', fromPredictionSeason: 2000, throughPredictionSeason: 2000 },
      { role: 'calibration', fromPredictionSeason: 2004, throughPredictionSeason: 2004 },
      { role: 'validation', fromPredictionSeason: 2008, throughPredictionSeason: 2008 },
      { role: 'final_test', fromPredictionSeason: 2012, throughPredictionSeason: 2012 },
    ],
    approvalDecision: {
      id: `review-decision:${digest('b')}`,
      sha256: digest('b'),
    },
    createdAt: '2026-08-11T00:00:00.000Z',
  });
}

function calculationId(seasonYear: number) {
  return `hpn-pav-season:${seasonYear.toString(16).padStart(64, '0')}`;
}

function value(seasonYear: number, playerId: string, spellVersionId: string, clubId: string) {
  const id = calculationId(seasonYear);
  return {
    calculationId: id,
    calculationSha256: id.slice(id.indexOf(':') + 1),
    seasonYear,
    effectiveThrough: `${seasonYear}-09-30T23:59:59.000Z`,
    calculatedAt: '2026-08-10T00:00:00.000Z',
    spellVersionId,
    playerId,
    playerSha256: digest('c'),
    clubId,
    sourceRowIds: [`provider-row:${seasonYear}:${spellVersionId.slice(-1)}`],
    gamesPlayed: 1,
    offensivePav: 1,
    midfieldPav: 2,
    defensivePav: 3,
    totalPav: 6,
  };
}

function calculation(seasonYear: number, values: ReturnType<typeof value>[]) {
  const id = calculationId(seasonYear);
  return {
    calculation: {
      calculationId: id,
      calculationSha256: id.slice(id.indexOf(':') + 1),
      inputSetId: createAflTradeContentAddress('hpn-pav-input-set', { seasonYear }),
      methodId: `hpn-pav-method:${digest('a')}`,
      seasonYear,
      effectiveThrough: `${seasonYear}-09-30T23:59:59.000Z`,
      calculatedAt: '2026-08-10T00:00:00.000Z',
    },
    playerValues: values,
  };
}

function prediction(
  partition: AflTradePlayerPavObservation['partition'],
  predictionSeason: number,
  options: { departed?: boolean } = {}
) {
  const playerId = `afl-player:${partition}`;
  const spellVersionId = `acquisition-spell-version:${digest(String(predictionSeason % 10))}`;
  return {
    releaseId,
    partition,
    predictionSeason,
    playerId,
    acquisitionSpell: {
      spellId: `acquisition-spell:${partition}`,
      spellVersionId,
      clubId: `afl-club:${partition}`,
      effectiveFrom: `${predictionSeason - 1}-01-01`,
      effectiveThrough: options.departed ? `${predictionSeason}-12-31` : null,
      recordedAt: `${predictionSeason - 1}-01-01T00:00:00.000Z`,
    },
  };
}

function fixture() {
  const predictions = [
    prediction('train', 2000),
    prediction('calibration', 2004),
    prediction('validation', 2008),
    prediction('final_test', 2012, { departed: true }),
  ];
  const calculations = predictions.flatMap((row) => {
    const feature = value(
      row.predictionSeason,
      row.playerId,
      row.acquisitionSpell.spellVersionId,
      row.acquisitionSpell.clubId
    );
    const targetValues =
      row.acquisitionSpell.effectiveThrough === null
        ? [
            value(
              row.predictionSeason + 1,
              row.playerId,
              row.acquisitionSpell.spellVersionId,
              row.acquisitionSpell.clubId
            ),
          ]
        : [];
    return [
      calculation(row.predictionSeason, [feature]),
      calculation(row.predictionSeason + 1, targetValues),
    ];
  });
  calculations[0]!.playerValues.push(
    value(
      2000,
      predictions[0]!.playerId,
      `acquisition-spell-version:${digest('e')}`,
      'afl-club:previous'
    )
  );
  return { predictions, calculations };
}

describe('player-PAV observation materialization', () => {
  it('derives exact spell-year outcomes, preserving feature spells and departure zero', () => {
    const { predictions, calculations } = fixture();
    const result = materializeAflTradePlayerPavObservationSet({
      environment: 'test_fixture',
      competition: 'AFLM',
      createdAt: '2026-08-11T00:00:00.000Z',
      knowledgeCutoffAt: '2026-08-10T23:59:59.999Z',
      releaseId,
      policy: policy(),
      predictions,
      calculations,
    });

    expect(result.content.observations.map(({ partition }) => partition)).toEqual([
      'train',
      'calibration',
      'validation',
      'final_test',
    ]);
    expect(result.content.observations[0]?.featureValues).toHaveLength(2);
    expect(result.content.observations.at(-1)?.outcome).toEqual({
      state: 'mature_observed',
      contribution: 0,
      gamesPlayed: 0,
      seasonsObserved: 1,
    });
  });

  it('rejects mixed release membership instead of dropping the row', () => {
    const { predictions, calculations } = fixture();
    expect(() =>
      materializeAflTradePlayerPavObservationSet({
        environment: 'test_fixture',
        competition: 'AFLM',
        createdAt: '2026-08-11T00:00:00.000Z',
        knowledgeCutoffAt: '2026-08-10T23:59:59.999Z',
        releaseId,
        policy: policy(),
        predictions: [
          { ...predictions[0]!, releaseId: `outcome-release:${digest('f')}` },
          ...predictions.slice(1),
        ],
        calculations,
      })
    ).toThrow(/release membership/i);
  });
});
