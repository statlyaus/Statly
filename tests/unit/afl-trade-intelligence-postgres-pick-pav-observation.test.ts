import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import { createAflTradePickPavPolicy } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import { AflTradePickPavObservationError } from '@/server/aflTradeIntelligence/modeling/pickPavObservationRepository';
import { PostgresAflTradePickPavObservationRepository } from '@/server/aflTradeIntelligence/modeling/postgresPickPavObservationRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const draftYears = [2000, 2004, 2008, 2012] as const;
const releaseId = addressed('outcome-release', 'released-draft-history');
const methodId = addressed('hpn-pav-method', 'hpn-v1');

function policy() {
  return createAflTradePickPavPolicy({
    schemaVersion: 'afl-trade-pick-pav-policy/v1',
    authorityBoundary:
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    policyVersion: 'fixture-v1',
    supportedPathway: 'national',
    supportedAccess: 'open',
    firstOutcomeSeasonOffset: 1,
    fixedHorizonSeasons: 1,
    methodId,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    categoryMinimums: {
      replacementLevel: 10,
      regularContributor: 30,
      highQuality: 60,
      elite: 90,
    },
    partitions: ['train', 'calibration', 'validation', 'final_test'].map((role, index) => ({
      role: role as 'train' | 'calibration' | 'validation' | 'final_test',
      fromDraftYear: draftYears[index]!,
      throughDraftYear: draftYears[index]!,
    })),
    approvalDecision: {
      id: addressed('review-decision', 'pick-pav-policy'),
      sha256: sha('pick-pav-policy'),
    },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
}

function access(draftYear: number) {
  return {
    state: 'open' as const,
    decision: {
      id: addressed('review-decision', `access:${draftYear}`),
      sha256: sha(`access:${draftYear}`),
    },
    recordedAt: `${draftYear}-11-22T00:00:00.000Z`,
  };
}

function selectionRow(draftYear: number) {
  const number = draftYear === 2000 ? 14 : 20 + draftYears.indexOf(draftYear as never);
  return {
    selection_id: addressed('draft-selection', `${draftYear}:${number}`),
    event_id: `draft:${draftYear}:national`,
    event_version_id: addressed('event-version', `draft:${draftYear}:national`),
    event_date: `${draftYear}-11-20T00:00:00.000Z`,
    recorded_at: `${draftYear}-11-21T00:00:00.000Z`,
    draft_year: draftYear,
    selection_number: number,
    nominal_pick: number,
    nominal_round: number <= 20 ? 1 : 2,
    pick_id: `pick:${draftYear}:national:${number}`,
    player_id: `player:${draftYear}`,
    club_id: `club:${draftYear}`,
    access_json: access(draftYear),
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

function calculation(draftYear: number) {
  const seasonYear = draftYear + 1;
  const selectedSpell = addressed('acquisition-spell-version', `selected:${draftYear}`);
  const fillerSpell = addressed('acquisition-spell-version', `filler:${draftYear}`);
  const core = calculateAflTradeHpnPavCore([
    {
      teamId: `club:${draftYear}`,
      pointsFor: 100,
      pointsAgainst: 80,
      inside50sFor: 50,
      inside50sAgainst: 40,
      players: [
        {
          spellVersionId: selectedSpell,
          playerId: `player:${draftYear}`,
          sourceRowIds: Array.from(
            { length: 18 },
            (_, index) => `row:${draftYear}:selected:${index + 1}`
          ),
          ...playerStats,
        },
      ],
    },
    {
      teamId: `club:filler:${draftYear}`,
      pointsFor: 80,
      pointsAgainst: 100,
      inside50sFor: 40,
      inside50sAgainst: 50,
      players: [
        {
          spellVersionId: fillerSpell,
          playerId: `player:filler:${draftYear}`,
          sourceRowIds: Array.from(
            { length: 20 },
            (_, index) => `row:${draftYear}:filler:${index + 1}`
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
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    seasonYear,
    effectiveThrough: `${seasonYear}-12-31T23:59:59.000Z`,
    calculatedAt: `${seasonYear + 1}-01-01T00:00:00.000Z`,
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
      source: {
        ...player.source,
        gamesPlayed: player.playerId === `player:${draftYear}` ? 18 : 20,
      },
    })),
  };
  return aflTradeFinalizedHpnPavCalculationSchema.parse({
    calculationId: createAflTradeContentAddress('hpn-pav-season', content),
    content,
  });
}

class FakePickPavSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  readonly policy = policy();
  readonly selections = draftYears.map(selectionRow);
  readonly calculations = draftYears.map(calculation);
  policyCurrent = true;
  activeRelease = true;
  withdrawnAccessSelectionId: string | null = null;
  staleCalculationId: string | null = null;
  storedSet: unknown | null = null;
  finalizedAt: string | null = null;
  calculationCount = 0;
  draftClassCount = 0;
  observationCount = 0;
  trustedTimeReads = 0;
  readonly accessByDecision = new Map<string, { selectionId: string; access: unknown }>();

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.includes('pg_advisory_xact_lock')) return this.result([]);
    if (sql.includes('SELECT policy_json FROM outcome_pick_pav_policy')) {
      return this.result([{ policy_json: this.policy }]);
    }
    if (sql.includes('JOIN outcome_review_decision decision ON decision.decision_id=policy')) {
      return this.result([
        {
          policy_json: this.policy,
          decision: 'approved',
          has_successor: !this.policyCurrent,
        },
      ]);
    }
    if (sql.includes('SELECT selection.selection_id,event.event_id')) {
      return this.result(
        this.activeRelease
          ? this.selections.map((selection) => ({
              ...selection,
              access_json:
                selection.selection_id === this.withdrawnAccessSelectionId
                  ? null
                  : selection.access_json,
            }))
          : []
      );
    }
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
    if (sql.includes('FROM outcome_pick_pav_observation_set parent')) {
      return this.result(
        this.storedSet === null
          ? []
          : [
              {
                observation_set_json: this.storedSet,
                finalized_at: this.finalizedAt,
                calculation_count: this.calculationCount,
                draft_class_count: this.draftClassCount,
                observation_count: this.observationCount,
                actual_calculation_count: this.calculationCount,
                actual_draft_class_count: this.draftClassCount,
                actual_observation_count: this.observationCount,
              },
            ]
      );
    }
    if (sql.includes('SELECT member.calculation_id')) {
      if (this.storedSet === null) return this.result([]);
      const set = this.storedSet as {
        content: { calculations: Array<{ calculationId: string }> };
      };
      return this.result(
        set.content.calculations
          .map(({ calculationId }) => calculationId)
          .filter((calculationId) => calculationId !== this.staleCalculationId)
          .sort()
          .map((calculation_id) => ({ calculation_id }))
      );
    }
    if (sql.includes("date_trunc('milliseconds',transaction_timestamp()) AS trusted_at")) {
      this.trustedTimeReads += 1;
      return this.result([{ trusted_at: '2015-01-02T00:00:00.000Z' }]);
    }
    if (sql.includes('INSERT INTO outcome_pick_pav_observation_set')) {
      this.storedSet = JSON.parse(String(parameters[12]));
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_pick_pav_calculation_member')) {
      this.calculationCount = (JSON.parse(String(parameters[0])) as unknown[]).length;
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_pick_pav_draft_class')) {
      this.draftClassCount = (JSON.parse(String(parameters[0])) as unknown[]).length;
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_pick_pav_observation\n')) {
      this.observationCount = (JSON.parse(String(parameters[0])) as unknown[]).length;
      return this.result([]);
    }
    if (
      sql.includes('INSERT INTO outcome_pick_pav_observation_calculation') ||
      sql.includes('INSERT INTO outcome_pick_pav_player_value')
    ) {
      return this.result([]);
    }
    if (sql.includes('UPDATE outcome_pick_pav_observation_set')) {
      this.finalizedAt = '2015-01-02T00:00:00.000Z';
      return { rows: [] as Row[], rowCount: 1 };
    }
    if (sql.includes('SELECT 1 FROM outcome_active_release active')) {
      return this.result(this.activeRelease ? [{ value: 1 }] : []);
    }
    if (sql.includes('SELECT selection_id,access_json FROM outcome_pick_pav_selection_access')) {
      const stored = this.accessByDecision.get(String(parameters[0]));
      return this.result(
        stored ? [{ selection_id: stored.selectionId, access_json: stored.access }] : []
      );
    }
    if (sql.includes('INSERT INTO outcome_pick_pav_selection_access')) {
      this.accessByDecision.set(String(parameters[0]), {
        selectionId: String(parameters[1]),
        access: JSON.parse(String(parameters[7])),
      });
      return this.result([]);
    }
    throw new Error(`Unhandled SQL in fake: ${sql}`);
  }

  private result<Row>(rows: readonly unknown[]): AflOutcomeSqlQueryResult<Row> {
    return { rows: rows as Row[], rowCount: rows.length };
  }
}

const execution = { environment: 'test_fixture' as const };
const materializationRequest = (policyId: string) => ({
  environment: 'test_fixture' as const,
  competition: 'AFLM' as const,
  releaseId,
  policyId,
  knowledgeCutoffAt: '2015-01-01T00:00:00.000Z',
});

describe('PostgreSQL pick-PAV observation repository', () => {
  it('materializes exact pick outcomes and replays before reading a new trusted time', async () => {
    const sql = new FakePickPavSql();
    const repository = new PostgresAflTradePickPavObservationRepository(sql);
    const request = materializationRequest(sql.policy.policyId);

    const first = await repository.materializeAndPersist(request, execution);
    const replay = await repository.materializeAndPersist(request, execution);
    const pick14 = first.observationSet.content.observations.find(
      ({ selection }) => selection.actualSelectionNumber === 14
    );

    expect(first.idempotentReplay).toBe(false);
    expect(replay).toEqual({ observationSet: first.observationSet, idempotentReplay: true });
    expect(sql.trustedTimeReads).toBe(1);
    expect(pick14?.playerValues[0]?.gamesPlayed).toBe(18);
    expect(pick14?.outcome.state).toBe('mature_observed');
  });

  it('rejects finalized reuse after policy, release, access, or calculation authority changes', async () => {
    const sql = new FakePickPavSql();
    const repository = new PostgresAflTradePickPavObservationRepository(sql);
    const persisted = await repository.materializeAndPersist(
      materializationRequest(sql.policy.policyId),
      execution
    );
    const load = () =>
      repository.loadFinalized(
        {
          observationSetId: persisted.observationSet.observationSetId,
          environment: 'test_fixture',
        },
        execution
      );

    sql.policyCurrent = false;
    await expect(load()).rejects.toMatchObject({ code: 'POLICY_NOT_CURRENT' });
    sql.policyCurrent = true;
    sql.activeRelease = false;
    await expect(load()).rejects.toMatchObject({ code: 'SELECTION_MEMBERSHIP_INCOMPLETE' });
    sql.activeRelease = true;
    sql.withdrawnAccessSelectionId = sql.selections[0]!.selection_id;
    await expect(load()).rejects.toMatchObject({ code: 'RELEASE_NOT_CURRENT' });
    sql.withdrawnAccessSelectionId = null;
    sql.staleCalculationId = persisted.observationSet.content.calculations[0]!.calculationId;
    await expect(load()).rejects.toMatchObject({ code: 'CALCULATION_EVIDENCE_INCOMPLETE' });
  });

  it('rejects invalid requests and decision replay across a different selection', async () => {
    const sql = new FakePickPavSql();
    const repository = new PostgresAflTradePickPavObservationRepository(sql);
    await expect(repository.materializeAndPersist({}, execution)).rejects.toBeInstanceOf(
      AflTradePickPavObservationError
    );

    const firstSelection = sql.selections[0]!;
    const secondSelection = sql.selections[1]!;
    const reviewedAccess = firstSelection.access_json;
    await repository.registerSelectionAccess(
      { selectionId: firstSelection.selection_id, access: reviewedAccess },
      execution
    );
    await expect(
      repository.registerSelectionAccess(
        { selectionId: secondSelection.selection_id, access: reviewedAccess },
        execution
      )
    ).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' });
  });
});
