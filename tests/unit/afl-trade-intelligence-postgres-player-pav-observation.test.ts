import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import { createAflTradePlayerPavCalculationEvidence } from '@/server/aflTradeIntelligence/modeling/playerPavCalculationEvidence';
import { createAflTradePlayerPavPolicy } from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import { PostgresAflTradePlayerPavObservationRepository } from '@/server/aflTradeIntelligence/modeling/postgresPlayerPavObservationRepository';
import { PostgresAflTradePrivatePlayerPavPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivatePlayerPavPreparation';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const predictionSeasons = [2000, 2004, 2008, 2012] as const;
const releaseId = addressed('outcome-release', 'released-acquisition-spells');
const methodId = addressed('hpn-pav-method', 'hpn-v1');

function policy(environment: 'test_fixture' | 'non_production' = 'test_fixture') {
  return createAflTradePlayerPavPolicy({
    schemaVersion: 'afl-trade-player-pav-policy/v1',
    authorityBoundary:
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment,
    competition: 'AFLM',
    policyVersion: 'player-pav-postgres-fixture-v1',
    featureHistorySeasons: 1,
    fixedHorizonSeasons: 1,
    methodId,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    partitions: ['train', 'calibration', 'validation', 'final_test'].map((role, index) => ({
      role: role as 'train' | 'calibration' | 'validation' | 'final_test',
      fromPredictionSeason: predictionSeasons[index]!,
      throughPredictionSeason: predictionSeasons[index]!,
    })),
    approvalDecision: {
      id: addressed('review-decision', 'player-pav-policy'),
      sha256: sha('player-pav-policy'),
    },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
}

function spellRow(predictionSeason: number) {
  return {
    spell_version_id: addressed('acquisition-spell-version', `spell:${predictionSeason}`),
    spell_id: `spell:${predictionSeason}`,
    player_id: `player:${predictionSeason}`,
    club_id: `club:${predictionSeason}`,
    start_date: `${predictionSeason - 1}-01-01`,
    end_date: predictionSeason === 2012 ? '2012-12-31' : null,
    recorded_at: `${predictionSeason - 1}-01-01T00:00:00.000Z`,
    prediction_season: predictionSeason,
  };
}

const playerStats = {
  totalPoints: 10,
  hitOuts: 1,
  goalAssists: 1,
  inside50s: 2,
  marks: 3,
  marksInside50: 1,
  freeKicksFor: 2,
  freeKicksAgainst: 1,
  rebound50s: 1,
  onePercenters: 1,
  clearances: 2,
  tackles: 3,
};

function calculation(
  seasonYear: number,
  rows: ReturnType<typeof spellRow>[],
  environment: 'test_fixture' | 'non_production' = 'test_fixture'
) {
  const teamId = rows[0]?.club_id ?? `club:filler:${seasonYear}`;
  const players = rows.map((row, index) => ({
    spellVersionId: row.spell_version_id,
    playerId: row.player_id,
    sourceRowIds: Array.from(
      { length: 18 },
      (_, gameIndex) => `row:${seasonYear}:${index + 1}:${gameIndex + 1}`
    ),
    ...playerStats,
  }));
  const core = calculateAflTradeHpnPavCore([
    {
      teamId,
      pointsFor: 100,
      pointsAgainst: 80,
      inside50sFor: 50,
      inside50sAgainst: 40,
      players:
        players.length > 0
          ? players
          : [
              {
                spellVersionId: addressed('acquisition-spell-version', `filler:${seasonYear}`),
                playerId: `player:filler:${seasonYear}`,
                sourceRowIds: Array.from(
                  { length: 18 },
                  (_, index) => `row:${seasonYear}:filler:${index + 1}`
                ),
                ...playerStats,
              },
            ],
    },
    {
      teamId: `club:comparison:${seasonYear}`,
      pointsFor: 80,
      pointsAgainst: 100,
      inside50sFor: 40,
      inside50sAgainst: 50,
      players: [
        {
          spellVersionId: addressed('acquisition-spell-version', `comparison:${seasonYear}`),
          playerId: `player:comparison:${seasonYear}`,
          sourceRowIds: Array.from(
            { length: 18 },
            (_, index) => `row:${seasonYear}:comparison:${index + 1}`
          ),
          ...playerStats,
        },
      ],
    },
  ]);
  const content = {
    schemaVersion: AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
    authorityBoundary:
      'private_finalized_hpn_input_exact_method_bytes_no_publication_or_fantasy_ownership' as const,
    publicationEligible: false as const,
    environment,
    competition: 'AFLM' as const,
    seasonYear,
    effectiveThrough: `${seasonYear}-09-30T23:59:59.000Z`,
    calculatedAt: '2026-08-10T00:00:00.000Z',
    methodId,
    inputSetId: addressed('hpn-pav-input-set', `input:${seasonYear}`),
    inputSetSha256: sha(`input:${seasonYear}`),
    factualRunId: addressed('factual-reconciliation-run', `run:${seasonYear}`),
    factualInputSetSha256: sha(`facts:${seasonYear}`),
    primaryProviders: ['afl_tables'],
    corroboratingProviders: ['footywire'],
    resultSourceRowIds: [`row:${seasonYear}:result`],
    valueUnit: 'season_pav' as const,
    ...core,
    players: core.players.map((player) => ({
      ...player,
      source: { ...player.source, gamesPlayed: 18 },
    })),
  };
  return aflTradeFinalizedHpnPavCalculationSchema.parse({
    calculationId: createAflTradeContentAddress('hpn-pav-season', content),
    content,
  });
}

class FakePlayerPavSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  readonly policy;
  readonly spells = predictionSeasons.map(spellRow);
  readonly calculations;
  storedSet: unknown | null = null;
  finalizedAt: string | null = null;
  calculationCount = 0;
  observationCount = 0;
  trustedTimeReads = 0;
  privateAuthorityMeasurementSeasons: number[] | null = null;

  constructor(environment: 'test_fixture' | 'non_production' = 'test_fixture') {
    this.policy = policy(environment);
    this.calculations = predictionSeasons.flatMap((predictionSeason) => [
      calculation(
        predictionSeason,
        this.spells.filter((row) => row.prediction_season === predictionSeason),
        environment
      ),
      calculation(
        predictionSeason + 1,
        predictionSeason === 2012
          ? []
          : this.spells.filter((row) => row.prediction_season === predictionSeason),
        environment
      ),
    ]);
  }

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql === 'SET LOCAL ROLE afl_trade_private_evaluation_coordinator') {
      return this.result([]);
    }
    if (
      sql.includes('bind_outcome_private_player_pav_authority') ||
      sql.includes('load_outcome_private_player_pav_authority')
    ) {
      const binding = sql.includes('bind_outcome_private_player_pav_authority');
      return this.result([
        {
          binding_json: {
            requestId: parameters[0],
            factualOutputId: addressed('private-valuation-factual-output', 'private-factual'),
            policyId: binding ? parameters[3] : this.policy.policyId,
            policyApprovalDecisionId: addressed('review-decision', 'private-policy'),
            lineageAdmissionId: binding
              ? parameters[4]
              : addressed('corpus-factual-lineage-admission', 'private-lineage-admission'),
            lineageId: addressed('corpus-factual-lineage', 'private-lineage'),
            corpusId: addressed('corpus', 'private-corpus'),
            releaseId,
            methodId,
            knowledgeCutoffAt: '2026-08-10T23:59:59.999Z',
            featureHistorySeasons: 1,
            fixedHorizonSeasons: 1,
            predictionSeasons: [...predictionSeasons],
            requiredMeasurementSeasons:
              this.privateAuthorityMeasurementSeasons ??
              this.calculations.map(({ content }) => content.seasonYear),
            sourceMemberSetSha256: sha('private-source-members'),
            canonicalMemberSetSha256: sha('private-canonical-members'),
          },
        },
      ]);
    }
    if (sql.includes('pg_advisory_xact_lock')) return this.result([]);
    if (sql.includes('SELECT policy_json FROM outcome_player_pav_policy')) {
      return this.result([{ policy_json: this.policy }]);
    }
    if (sql.includes('JOIN outcome_review_decision decision')) {
      return this.result([
        { policy_json: this.policy, decision: 'approved', has_successor: false },
      ]);
    }
    if (sql.includes('SELECT spell.spell_version_id')) return this.result(this.spells);
    if (sql.includes('FROM outcome_hpn_pav_calculation_head head')) {
      return this.result(
        this.calculations.map((value) => ({
          calculation_json: value,
          finalized_at: value.content.calculatedAt,
          actual_team_count: value.content.teams.length,
          actual_player_count: value.content.players.length,
        }))
      );
    }
    if (sql.includes('FROM outcome_player_pav_observation_set parent')) {
      return this.result(
        this.storedSet === null
          ? []
          : [
              {
                observation_set_json: this.storedSet,
                finalized_at: this.finalizedAt,
                calculation_count: this.calculationCount,
                observation_count: this.observationCount,
                actual_calculation_count: this.calculationCount,
                actual_observation_count: this.observationCount,
              },
            ]
      );
    }
    if (sql.includes('SELECT member.calculation_id')) {
      const set = this.storedSet as { content: { calculations: Array<{ calculationId: string }> } };
      return this.result(
        set.content.calculations
          .map(({ calculationId }) => calculationId)
          .sort()
          .map((calculation_id) => ({ calculation_id }))
      );
    }
    if (sql.includes("date_trunc('milliseconds',transaction_timestamp()) AS trusted_at")) {
      this.trustedTimeReads += 1;
      return this.result([{ trusted_at: '2026-08-11T00:00:00.000Z' }]);
    }
    if (sql.includes('INSERT INTO outcome_player_pav_observation_set')) {
      this.storedSet = JSON.parse(String(parameters[10]));
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_player_pav_calculation_member')) {
      this.calculationCount = (JSON.parse(String(parameters[0])) as unknown[]).length;
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_player_pav_observation\n')) {
      this.observationCount = (JSON.parse(String(parameters[0])) as unknown[]).length;
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_player_pav_value')) return this.result([]);
    if (sql.includes('UPDATE outcome_player_pav_observation_set')) {
      this.finalizedAt = '2026-08-11T00:00:00.000Z';
      return { rows: [] as Row[], rowCount: 1 };
    }
    throw new Error(`Unhandled SQL in fake: ${sql}`);
  }

  private result<Row>(rows: readonly unknown[]): AflOutcomeSqlQueryResult<Row> {
    return { rows: rows as Row[], rowCount: rows.length };
  }
}

describe('finalized HPN to player-PAV evidence conversion', () => {
  function input() {
    return {
      calculation: calculation(2000, [spellRow(2000)]),
      environment: 'test_fixture' as const,
      competition: 'AFLM' as const,
      methodId,
      seasonYears: [2000],
      knowledgeCutoffAt: '2026-08-10T23:59:59.999Z',
    };
  }

  it.each([
    ['method', { methodId: addressed('hpn-pav-method', 'another-method') }],
    ['season', { seasonYears: [2001] }],
    ['calculation cutoff', { knowledgeCutoffAt: '2026-08-09T23:59:59.999Z' }],
    ['invalid cutoff', { knowledgeCutoffAt: 'not-a-date' }],
  ])('rejects evidence outside the selected %s', (_label, selection) => {
    expect(() =>
      createAflTradePlayerPavCalculationEvidence({ ...input(), ...selection })
    ).toThrowError(/calculation evidence failed/);
  });

  it('preserves measured components, games and source membership without rounding or zero filling', () => {
    const request = input();
    const content = request.calculation.content;
    Object.assign(content.players[0]!, {
      offensivePav: -1.125,
      midfieldPav: 2.25,
      defensivePav: 3.5,
      totalPav: 4.625,
    });
    request.calculation.calculationId = createAflTradeContentAddress('hpn-pav-season', content);
    const result = createAflTradePlayerPavCalculationEvidence(request);

    expect(result.calculation).toMatchObject({
      calculationId: request.calculation.calculationId,
      methodId,
      seasonYear: 2000,
      effectiveThrough: '2000-09-30T23:59:59.000Z',
      calculatedAt: '2026-08-10T00:00:00.000Z',
    });
    expect(result.playerValues).toHaveLength(2);
    expect(result.playerValues[0]).toMatchObject({
      playerId: 'player:2000',
      clubId: 'club:2000',
      gamesPlayed: 18,
      offensivePav: -1.125,
      midfieldPav: 2.25,
      defensivePav: 3.5,
      totalPav: 4.625,
    });
    expect(result.playerValues[0]?.sourceRowIds).toEqual(
      Array.from({ length: 18 }, (_, index) => `row:2000:1:${index + 1}`)
    );
    content.players[0]!.source.sourceRowIds[0] = 'row:changed-after-conversion';
    expect(result.playerValues[0]?.sourceRowIds[0]).toBe('row:2000:1:1');
  });

  it('rejects changed calculation bytes under the retained content address', () => {
    const request = input();
    request.calculation.content.players[0]!.totalPav += 1;
    expect(() => createAflTradePlayerPavCalculationEvidence(request)).toThrowError(
      /calculation evidence failed/
    );
  });

  type CalculationContent = ReturnType<typeof calculation>['content'];
  it.each([
    [
      'input digest',
      (content: CalculationContent) => {
        content.inputSetSha256 = '0'.repeat(64);
      },
    ],
    [
      'duplicate spell',
      (content: CalculationContent) => {
        content.players[1] = structuredClone(content.players[0]!);
      },
    ],
    [
      'duplicate game row',
      (content: CalculationContent) => {
        content.players[0]!.source.sourceRowIds[1] = content.players[0]!.source.sourceRowIds[0]!;
      },
    ],
    [
      'game count',
      (content: CalculationContent) => {
        content.players[0]!.source.gamesPlayed = 17;
      },
    ],
    [
      'component total',
      (content: CalculationContent) => {
        content.players[0]!.totalPav += 1;
      },
    ],
    [
      'season cutoff',
      (content: CalculationContent) => {
        content.effectiveThrough = '2001-01-01T00:00:00.000Z';
      },
    ],
  ])('rejects a re-addressed calculation with inconsistent %s', (_label, mutate) => {
    const request = input();
    mutate(request.calculation.content);
    request.calculation.calculationId = createAflTradeContentAddress(
      'hpn-pav-season',
      request.calculation.content
    );
    expect(() => createAflTradePlayerPavCalculationEvidence(request)).toThrowError(
      /calculation evidence failed/
    );
  });
});

describe('PostgreSQL player-PAV observation repository', () => {
  it('prepares only through exact live private authority and returns retained ancestry', async () => {
    const sql = new FakePlayerPavSql('non_production');
    const preparation = new PostgresAflTradePrivatePlayerPavPreparation(sql);
    const selection = {
      requestId: addressed('private-valuation-dispatch', 'private-request'),
      claim: {
        claimId: addressed('private-valuation-dispatch-claim', 'private-claim'),
        leaseToken: sha('private-lease'),
      },
      policyId: sql.policy.policyId,
      lineageAdmissionId: addressed(
        'corpus-factual-lineage-admission',
        'private-lineage-admission'
      ),
    };

    const first = await preparation.prepare(selection);
    const replay = await preparation.prepare(selection);

    expect(first).toMatchObject({
      state: 'prepared',
      requestId: selection.requestId,
      policyId: selection.policyId,
      releaseId,
      publicationEligible: false,
    });
    expect(replay).toMatchObject({
      state: 'already_prepared',
      observationSetId: first.observationSetId,
    });
  });

  it('materializes an authenticated inactive private historical release without public selection', async () => {
    const sql = new FakePlayerPavSql('non_production');
    const repository = new PostgresAflTradePlayerPavObservationRepository(sql);
    const authority = {
      requestId: addressed('private-valuation-dispatch', 'private-request'),
    };

    const first = await repository.materializePrivateAndPersist(authority);
    const replay = await repository.materializePrivateAndPersist(authority);

    expect(first.observationSet.content.environment).toBe('non_production');
    expect(first.idempotentReplay).toBe(false);
    expect(replay).toEqual({ observationSet: first.observationSet, idempotentReplay: true });
  });

  it('reads retained private observations without rematerializing or selecting a public release', async () => {
    const sql = new FakePlayerPavSql('non_production');
    const repository = new PostgresAflTradePlayerPavObservationRepository(sql);
    const requestId = addressed('private-valuation-dispatch', 'private-request');
    const retained = await repository.materializePrivateAndPersist({ requestId });
    const readOnlyClient: AflOutcomeSqlClient = {
      async query(query, parameters) {
        if (/\b(INSERT|UPDATE|DELETE)\b|FROM outcome_active_release/iu.test(query)) {
          throw new Error('Private admission reads may not mutate or select the public release.');
        }
        return sql.query(query, parameters);
      },
      async transaction(work) {
        return work(readOnlyClient);
      },
    };
    const loaded = await new PostgresAflTradePlayerPavObservationRepository(
      readOnlyClient
    ).loadFinalizedPrivate({
      requestId,
      observationSetId: retained.observationSet.observationSetId,
    });
    expect(loaded).toEqual(retained.observationSet);
  });

  it('rejects private measurement seasons that differ from durable calculations', async () => {
    const sql = new FakePlayerPavSql('non_production');
    const repository = new PostgresAflTradePlayerPavObservationRepository(sql);
    sql.privateAuthorityMeasurementSeasons = [2000];

    await expect(
      repository.materializePrivateAndPersist({
        requestId: addressed('private-valuation-dispatch', 'private-request'),
      })
    ).rejects.toMatchObject({ code: 'CALCULATION_EVIDENCE_INCOMPLETE' });
    expect(sql.storedSet).toBeNull();
  });

  it('reauthenticates measurement seasons on private replay', async () => {
    const sql = new FakePlayerPavSql('non_production');
    const repository = new PostgresAflTradePlayerPavObservationRepository(sql);
    const authority = {
      requestId: addressed('private-valuation-dispatch', 'private-request'),
    };
    await repository.materializePrivateAndPersist(authority);

    sql.privateAuthorityMeasurementSeasons = [2000];
    await expect(repository.materializePrivateAndPersist(authority)).rejects.toMatchObject({
      code: 'CALCULATION_EVIDENCE_INCOMPLETE',
    });
  });

  it('rejects a content-addressed calculation from another environment before retaining observations', async () => {
    const sql = new FakePlayerPavSql();
    const content = { ...sql.calculations[0]!.content, environment: 'non_production' as const };
    sql.calculations[0] = {
      calculationId: createAflTradeContentAddress('hpn-pav-season', content),
      content,
    };
    const repository = new PostgresAflTradePlayerPavObservationRepository(sql);

    await expect(
      repository.materializeAndPersist(
        {
          environment: 'test_fixture',
          competition: 'AFLM',
          releaseId,
          policyId: sql.policy.policyId,
          knowledgeCutoffAt: '2026-08-10T23:59:59.999Z',
        },
        { environment: 'test_fixture' }
      )
    ).rejects.toMatchObject({ code: 'CALCULATION_EVIDENCE_INCOMPLETE' });
    expect(sql.storedSet).toBeNull();
  });

  it('derives released spell observations and replays before reading another trusted time', async () => {
    const sql = new FakePlayerPavSql();
    const repository = new PostgresAflTradePlayerPavObservationRepository(sql);
    const request = {
      environment: 'test_fixture' as const,
      competition: 'AFLM' as const,
      releaseId,
      policyId: sql.policy.policyId,
      knowledgeCutoffAt: '2026-08-10T23:59:59.999Z',
    };

    const first = await repository.materializeAndPersist(request, { environment: 'test_fixture' });
    const replay = await repository.materializeAndPersist(request, { environment: 'test_fixture' });

    expect(first.idempotentReplay).toBe(false);
    expect(replay).toEqual({ observationSet: first.observationSet, idempotentReplay: true });
    expect(sql.trustedTimeReads).toBe(1);
    expect(first.observationSet.content.observations.at(-1)?.outcome).toEqual({
      state: 'mature_observed',
      contribution: 0,
      gamesPlayed: 0,
      seasonsObserved: 1,
    });
  });
});
