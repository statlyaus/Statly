import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradePlayerPavObservationSetSchema,
  createAflTradePlayerPavObservation,
  createAflTradePlayerPavObservationSet,
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
  it('materializes explicitly retrospective historical spells without backdating their recording', () => {
    const { predictions, calculations } = fixture();
    const request = {
      environment: 'test_fixture' as const,
      competition: 'AFLM' as const,
      createdAt: '2026-08-11T00:00:00.000Z',
      knowledgeCutoffAt: '2026-08-10T23:59:59.999Z',
      releaseId,
      policy: createAflTradePlayerPavPolicy({
        ...policy().content,
        schemaVersion: 'afl-trade-player-pav-policy/v2',
        knowledgePolicy: 'retrospective_as_recorded_by_dataset_creation',
      }),
      predictions: predictions.map((row) => ({
        ...row,
        acquisitionSpell: { ...row.acquisitionSpell, recordedAt: '2026-08-10T00:00:00.000Z' },
      })),
      calculations,
    };
    const result = materializeAflTradePlayerPavObservationSet(request);
    expect(result.content.schemaVersion).toBe('afl-trade-player-pav-observation-set/v2');
    expect(result.content.observations[0]).toMatchObject({
      predictionCutoffAt: '2000-12-31T23:59:59.999Z',
      acquisitionSpell: { recordedAt: '2026-08-10T00:00:00.000Z' },
      knowledgeBinding: {
        policy: 'retrospective_as_recorded_by_dataset_creation',
        knowledgeCutoffAt: request.knowledgeCutoffAt,
      },
      outcome: { state: 'mature_observed', contribution: 6 },
    });
    expect(materializeAflTradePlayerPavObservationSet(request)).toEqual(result);
    expect(() =>
      materializeAflTradePlayerPavObservationSet({ ...request, policy: policy() })
    ).toThrow(/release membership/i);
  });

  it.each([
    [
      'future spell recording',
      (request: ReturnType<typeof retrospectiveRequest>) => {
        request.predictions[0]!.acquisitionSpell.recordedAt = '2026-08-11T00:00:00.000Z';
      },
    ],
    [
      'future knowledge cutoff',
      (request: ReturnType<typeof retrospectiveRequest>) => {
        request.knowledgeCutoffAt = '2026-08-12T00:00:00.000Z';
      },
    ],
    [
      'changed policy content address',
      (request: ReturnType<typeof retrospectiveRequest>) => {
        request.policy.content.fixedHorizonSeasons = 2;
      },
    ],
  ] as const)('rejects %s for retrospective materialization', (_label, change) => {
    const request = retrospectiveRequest();
    change(request);
    expect(() => materializeAflTradePlayerPavObservationSet(request)).toThrow();
  });

  it.each([
    [
      'v1 set',
      (content: ReturnType<typeof materializeAflTradePlayerPavObservationSet>['content']) => {
        content.schemaVersion = 'afl-trade-player-pav-observation-set/v1';
      },
    ],
    [
      'missing set knowledge policy',
      (content: ReturnType<typeof materializeAflTradePlayerPavObservationSet>['content']) => {
        delete content.knowledgePolicy;
      },
    ],
    [
      'mixed row cutoff',
      (content: ReturnType<typeof materializeAflTradePlayerPavObservationSet>['content']) => {
        content.observations[0]!.knowledgeBinding!.knowledgeCutoffAt = '2026-08-10T12:00:00.000Z';
      },
    ],
    [
      'missing row binding',
      (content: ReturnType<typeof materializeAflTradePlayerPavObservationSet>['content']) => {
        delete content.observations[0]!.knowledgeBinding;
      },
    ],
  ] as const)('rejects retained retrospective %s substitution', (_label, change) => {
    const set = materializeAflTradePlayerPavObservationSet(retrospectiveRequest());
    change(set.content);
    expect(aflTradePlayerPavObservationSetSchema.safeParse(set).success).toBe(false);
    expect(() =>
      createAflTradePlayerPavObservationSet({
        ...set.content,
        observations: set.content.observations.map(createAflTradePlayerPavObservation),
      })
    ).toThrow();
  });

  it('still purges retrospective labels across partition prediction cutoffs', () => {
    const set = materializeAflTradePlayerPavObservationSet(retrospectiveRequest());
    const observations = set.content.observations.map((row, index) =>
      index === 0
        ? createAflTradePlayerPavObservation({
            ...row,
            outcomeObservedAt: '2004-12-31T23:59:59.999Z',
          })
        : row
    );
    expect(() => createAflTradePlayerPavObservationSet({ ...set.content, observations })).toThrow(
      /label-purged/i
    );
  });

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

function retrospectiveRequest() {
  const { predictions, calculations } = fixture();
  return {
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    createdAt: '2026-08-11T00:00:00.000Z',
    knowledgeCutoffAt: '2026-08-10T23:59:59.999Z',
    releaseId,
    policy: createAflTradePlayerPavPolicy({
      ...policy().content,
      schemaVersion: 'afl-trade-player-pav-policy/v2',
      knowledgePolicy: 'retrospective_as_recorded_by_dataset_creation',
    }),
    predictions: predictions.map((row) => ({
      ...row,
      acquisitionSpell: { ...row.acquisitionSpell, recordedAt: '2026-08-10T00:00:00.000Z' },
    })),
    calculations,
  };
}
