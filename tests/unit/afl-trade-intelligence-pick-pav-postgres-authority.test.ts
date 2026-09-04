// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
  aflTradeFinalizedHpnPavCalculationSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { calculateAflTradeHpnPavCore } from '@/server/aflTradeIntelligence/modeling/hpnPavCore';
import { createAflTradePickPavPolicy } from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';
import type { AflTradePickPavObservationError } from '@/server/aflTradeIntelligence/modeling/pickPavObservationRepository';
import { PostgresAflTradePickPavObservationRepository } from '@/server/aflTradeIntelligence/modeling/postgresPickPavObservationRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const migrationUrl = new URL(
  '../../prisma/afl-trade-outcomes/migrations/0034_pick_pav_observation_authority/migration.sql',
  import.meta.url
);
const draftYears = [2000, 2004, 2008, 2012] as const;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const releaseId = addressed('outcome-release', 'released-draft-history');
const methodId = addressed('hpn-pav-method', 'hpn-v1');

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

function selectionNumber(draftYear: number) {
  return draftYear === 2000 ? 14 : 20 + draftYears.indexOf(draftYear as never);
}

function calculation(draftYear: number) {
  const seasonYear = draftYear + 1;
  const selectedSpell = addressed('acquisition-spell-version', `selected:${draftYear}`);
  const fillerSpell = addressed('acquisition-spell-version', `filler:${draftYear}`);
  const selectedRows = Array.from(
    { length: 18 },
    (_, index) => `row:${draftYear}:selected:${index + 1}`
  );
  const fillerRows = Array.from(
    { length: 20 },
    (_, index) => `row:${draftYear}:filler:${index + 1}`
  );
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
          sourceRowIds: selectedRows,
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
          sourceRowIds: fillerRows,
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

class PgliteSqlClient implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  constructor(private readonly db: PGlite) {}

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    const result = await this.db.query<Row>(sql, [...parameters]);
    return {
      rows: result.rows,
      rowCount: result.rows.length > 0 ? result.rows.length : (result.affectedRows ?? 0),
    };
  }

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    await this.db.exec('BEGIN');
    try {
      const result = await work(this);
      await this.db.exec('COMMIT');
      return result;
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

async function createDatabase(tamperStoredGames = false) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TYPE "OutcomeEnvironment" AS ENUM ('test_fixture','non_production','production');
    CREATE TYPE "OutcomeEventKind" AS ENUM ('trade','national_draft','rookie_draft','mid_season_draft','preseason_draft','supplemental_selection','free_agency','delisted_free_agency','other_acquisition','administrative_adjustment');
    CREATE TYPE "OutcomeRecordStatus" AS ENUM ('staged','approved','rejected','superseded','withdrawn');
    CREATE TABLE outcome_hpn_pav_method (method_id text PRIMARY KEY);
    CREATE TABLE outcome_hpn_pav_calculation (
      calculation_id text PRIMARY KEY,calculation_sha256 char(64),input_set_id text,method_id text,
      environment "OutcomeEnvironment",competition text,season_year integer,
      effective_through timestamptz(3),calculated_at timestamptz(3),status text,
      finalized_at timestamptz(3),calculation_json jsonb);
    CREATE TABLE outcome_hpn_pav_calculation_team (
      calculation_id text,team_id text,PRIMARY KEY(calculation_id,team_id));
    CREATE TABLE outcome_hpn_pav_calculation_player (
      calculation_id text,spell_version_id text,player_id text,team_id text,ordinal integer,
      player_sha256 char(64),total_pav double precision,player_canonical_json text,
      PRIMARY KEY(calculation_id,spell_version_id));
    CREATE TABLE outcome_review_decision (
      decision_id text PRIMARY KEY,subject_type text,subject_id text,decision text,
      supersedes_decision_id text,rationale text,evidence_json jsonb,decided_by text,
      decided_at timestamptz(3));
    CREATE TABLE outcome_release_manifest (
      release_id text PRIMARY KEY,scope_key text,environment text,effective_through timestamptz(3));
    CREATE TABLE outcome_active_release (
      scope_key text PRIMARY KEY,release_id text UNIQUE,activated_at timestamptz(3),revision integer);
    CREATE TABLE outcome_event (
      event_id text PRIMARY KEY,competition text,season_year integer,stable_key text);
    CREATE TABLE outcome_event_version (
      event_version_id text PRIMARY KEY,event_id text,kind "OutcomeEventKind",event_date date,
      status "OutcomeRecordStatus",recorded_at timestamptz(3));
    CREATE TABLE outcome_draft_pick (
      pick_id text PRIMARY KEY,nominal_pick integer,nominal_round integer);
    CREATE TABLE outcome_draft_selection (
      selection_id text PRIMARY KEY,event_version_id text,selection_number integer,pick_id text,
      player_id text,club_id text,status "OutcomeRecordStatus");
    CREATE TABLE outcome_release_draft_selection (
      release_id text,selection_id text,ordinal bigint,PRIMARY KEY(release_id,selection_id));
    CREATE FUNCTION reject_outcome_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'append only'; END $$;
  `);

  await db.query(`INSERT INTO outcome_hpn_pav_method VALUES ($1)`, [methodId]);
  for (const draftYear of draftYears) {
    const value = calculation(draftYear);
    await db.query(
      `INSERT INTO outcome_hpn_pav_calculation
        (calculation_id,calculation_sha256,input_set_id,method_id,environment,competition,
         season_year,effective_through,calculated_at,status,finalized_at,calculation_json)
       VALUES ($1,$2,$3,$4,'test_fixture','AFLM',$5,$6,$7,'finalized',$7,$8::jsonb)`,
      [
        value.calculationId,
        value.calculationId.replace('hpn-pav-season:', ''),
        value.content.inputSetId,
        value.content.methodId,
        value.content.seasonYear,
        value.content.effectiveThrough,
        value.content.calculatedAt,
        canonicalizeAflTradeJson(value),
      ]
    );
    for (const team of value.content.teams) {
      await db.query(`INSERT INTO outcome_hpn_pav_calculation_team VALUES ($1,$2)`, [
        value.calculationId,
        team.teamId,
      ]);
    }
    for (const [ordinal, player] of value.content.players.entries()) {
      const storedPlayer =
        tamperStoredGames && player.playerId === `player:${draftYear}`
          ? { ...player, source: { ...player.source, gamesPlayed: 17 } }
          : player;
      await db.query(
        `INSERT INTO outcome_hpn_pav_calculation_player
          (calculation_id,spell_version_id,player_id,team_id,ordinal,player_sha256,total_pav,
           player_canonical_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          value.calculationId,
          player.spellVersionId,
          player.playerId,
          player.teamId,
          ordinal,
          sha256AflTradeCanonicalJson(player),
          player.totalPav,
          canonicalizeAflTradeJson(storedPlayer),
        ]
      );
    }
  }

  await db.exec(await readFile(migrationUrl, 'utf8'));
  await db.query(`INSERT INTO outcome_release_manifest VALUES ($1,'AFLM:test','test_fixture',$2)`, [
    releaseId,
    '2014-12-31T23:59:59.000Z',
  ]);
  await db.query(`INSERT INTO outcome_active_release VALUES ('AFLM:test',$1,$2,1)`, [
    releaseId,
    '2015-01-01T00:00:00.000Z',
  ]);
  for (const [ordinal, draftYear] of draftYears.entries()) {
    const number = selectionNumber(draftYear);
    const eventId = `draft:${draftYear}:national`;
    const eventVersionId = addressed('event-version', eventId);
    const selectionId = addressed('draft-selection', `${draftYear}:${number}`);
    const pickId = `pick:${draftYear}:national:${number}`;
    await db.query(`INSERT INTO outcome_event VALUES ($1,'AFLM',$2,$1)`, [eventId, draftYear]);
    await db.query(
      `INSERT INTO outcome_event_version VALUES ($1,$2,'national_draft',$3,'approved',$4)`,
      [eventVersionId, eventId, `${draftYear}-11-20`, `${draftYear}-11-21T00:00:00.000Z`]
    );
    await db.query(`INSERT INTO outcome_draft_pick VALUES ($1,$2,$3)`, [
      pickId,
      number,
      number <= 20 ? 1 : 2,
    ]);
    await db.query(`INSERT INTO outcome_draft_selection VALUES ($1,$2,$3,$4,$5,$6,'approved')`, [
      selectionId,
      eventVersionId,
      number,
      pickId,
      `player:${draftYear}`,
      `club:${draftYear}`,
    ]);
    await db.query(`INSERT INTO outcome_release_draft_selection VALUES ($1,$2,$3)`, [
      releaseId,
      selectionId,
      ordinal + 1,
    ]);
  }
  return db;
}

async function registerAuthority(
  repository: PostgresAflTradePickPavObservationRepository,
  db: PGlite
) {
  const reviewedPolicy = policy();
  await db.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,
       evidence_json,decided_by,decided_at)
     VALUES ($1,'pick_pav_policy','AFLM:fixture-v1','approved',NULL,'fixture',$2::jsonb,
       'fixture-reviewer','1998-12-31T00:00:00.000Z')`,
    [
      reviewedPolicy.content.approvalDecision.id,
      canonicalizeAflTradeJson(
        Object.fromEntries(
          Object.entries(reviewedPolicy.content).filter(([key]) => key !== 'approvalDecision')
        )
      ),
    ]
  );
  await repository.registerPolicy(reviewedPolicy, { environment: 'test_fixture' });
  for (const draftYear of draftYears) {
    const selectionId = addressed('draft-selection', `${draftYear}:${selectionNumber(draftYear)}`);
    const reviewedAccess = access(draftYear);
    const { decision: _decision, ...evidence } = reviewedAccess;
    await db.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,
         evidence_json,decided_by,decided_at)
       VALUES ($1,'pick_pav_selection_access',$2,'approved',NULL,'fixture',$3::jsonb,
         'fixture-reviewer',$4)`,
      [
        reviewedAccess.decision.id,
        selectionId,
        canonicalizeAflTradeJson(evidence),
        reviewedAccess.recordedAt,
      ]
    );
    await repository.registerSelectionAccess(
      { selectionId, access: reviewedAccess },
      { environment: 'test_fixture' }
    );
  }
  return reviewedPolicy;
}

describe('pick-PAV PostgreSQL authority', () => {
  it('rejects a self-addressed policy whose fixed-horizon mathematics are invalid', async () => {
    const db = await createDatabase();
    const validPolicy = policy();
    const invalidContent = {
      ...validPolicy.content,
      firstOutcomeSeasonOffset: 0,
      approvalDecision: {
        id: addressed('review-decision', 'invalid-pick-pav-policy'),
        sha256: sha('invalid-pick-pav-policy'),
      },
    };
    const canonicalContent = canonicalizeAflTradeJson(invalidContent);
    const policySha256 = sha(canonicalContent);
    const policyId = `pick-pav-policy:${policySha256}`;
    const { approvalDecision: _approvalDecision, ...reviewEvidence } = invalidContent;

    await db.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,
         evidence_json,decided_by,decided_at)
       VALUES ($1,'pick_pav_policy','AFLM:fixture-v1','approved',NULL,'fixture',$2::jsonb,
         'fixture-reviewer','1998-12-31T00:00:00.000Z')`,
      [invalidContent.approvalDecision.id, canonicalizeAflTradeJson(reviewEvidence)]
    );

    await expect(
      db.query(
        `INSERT INTO outcome_pick_pav_policy
          (policy_id,policy_sha256,environment,competition,policy_version,method_id,
           approval_decision_id,created_at,policy_canonical_json,policy_json)
         VALUES ($1,$2,'test_fixture','AFLM','fixture-v1',$3,$4,$5,$6,$7::jsonb)`,
        [
          policyId,
          policySha256,
          invalidContent.methodId,
          invalidContent.approvalDecision.id,
          invalidContent.createdAt,
          canonicalContent,
          canonicalizeAflTradeJson({ policyId, content: invalidContent }),
        ]
      )
    ).rejects.toThrow(/policy content mismatch/i);
    const remaining = await db.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM outcome_pick_pav_policy`
    );
    expect(remaining.rows[0]?.count).toBe(0);
    await db.close();
  });

  it('finalizes exact HPN-v3 games evidence and freezes all durable children', async () => {
    const db = await createDatabase();
    const repository = new PostgresAflTradePickPavObservationRepository(new PgliteSqlClient(db));
    const reviewedPolicy = await registerAuthority(repository, db);

    const persisted = await repository.materializeAndPersist(
      {
        environment: 'test_fixture',
        competition: 'AFLM',
        releaseId,
        policyId: reviewedPolicy.policyId,
        knowledgeCutoffAt: '2015-01-01T00:00:00.000Z',
      },
      { environment: 'test_fixture' }
    );
    const pick14 = persisted.observationSet.content.observations.find(
      ({ selection }) => selection.actualSelectionNumber === 14
    );

    expect(pick14?.outcome).toMatchObject({ state: 'mature_observed', gamesPlayed: 18 });
    await expect(
      db.query(
        `INSERT INTO outcome_pick_pav_draft_class
          (observation_set_id,draft_year,pathway,ordinal,expected_selection_count,observation_count)
         VALUES ($1,2013,'national',99,1,1)`,
        [persisted.observationSet.observationSetId]
      )
    ).rejects.toThrow(/append-only|open parent/i);
    await db.close();
  });

  it('rolls back a self-consistent repository write when durable HPN games evidence differs', async () => {
    const db = await createDatabase(true);
    const repository = new PostgresAflTradePickPavObservationRepository(new PgliteSqlClient(db));
    const reviewedPolicy = await registerAuthority(repository, db);

    const expectedError = {
      code: 'PERSISTENCE_REJECTED',
    } satisfies Pick<AflTradePickPavObservationError, 'code'>;

    await expect(
      repository.materializeAndPersist(
        {
          environment: 'test_fixture',
          competition: 'AFLM',
          releaseId,
          policyId: reviewedPolicy.policyId,
          knowledgeCutoffAt: '2015-01-01T00:00:00.000Z',
        },
        { environment: 'test_fixture' }
      )
    ).rejects.toMatchObject(expectedError);
    const remaining = await db.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM outcome_pick_pav_observation_set`
    );
    expect(remaining.rows[0]?.count).toBe(0);
    await db.close();
  });
});
