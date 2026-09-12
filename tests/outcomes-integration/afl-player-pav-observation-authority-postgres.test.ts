import { createHash } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
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
import { createAflTradePlayerPavPolicy } from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import { PostgresAflTradePlayerPavObservationRepository } from '@/server/aflTradeIntelligence/modeling/postgresPlayerPavObservationRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradePrivatePlayerPavPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivatePlayerPavPreparation';
import { seedPrivateValuationCohortBindingFixture } from '../testUtils/privateValuationCohortBindingFixture';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const schemaName = `afl_player_pav_authority_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const predictionSeasons = [2000, 2004, 2008, 2012] as const;
const methodId = addressed('hpn-pav-method', 'player-pav-integration-method');
const releaseId = addressed('outcome-release', 'player-pav-integration-release');

function policy() {
  return createAflTradePlayerPavPolicy({
    schemaVersion: 'afl-trade-player-pav-policy/v1',
    authorityBoundary:
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'non_production',
    competition: 'AFLM',
    policyVersion: 'player-pav-postgres-lifecycle-v1',
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
      id: addressed('review-decision', 'player-pav-integration-policy'),
      sha256: sha('player-pav-integration-policy'),
    },
    createdAt: '1999-01-01T00:00:00.000Z',
  });
}

function spell(predictionSeason: number) {
  return {
    spellVersionId: addressed('acquisition-spell-version', `spell:${predictionSeason}`),
    spellId: `spell:${predictionSeason}`,
    playerId: `player:${predictionSeason}`,
    clubId: `club:${predictionSeason}`,
    startDate: `${predictionSeason - 1}-01-01`,
    endDate: `${predictionSeason}-12-31`,
    recordedAt: `${predictionSeason - 1}-01-01T00:00:00.000Z`,
  };
}

function calculation(seasonYear: number, selectedSpell: ReturnType<typeof spell> | null) {
  const teamId = selectedSpell?.clubId ?? `club:filler:${seasonYear}`;
  const stats = {
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
  const player = {
    spellVersionId:
      selectedSpell?.spellVersionId ??
      addressed('acquisition-spell-version', `filler:${seasonYear}`),
    playerId: selectedSpell?.playerId ?? `player:filler:${seasonYear}`,
    sourceRowIds: Array.from({ length: 18 }, (_, index) => `row:${seasonYear}:${index + 1}`),
    ...stats,
  };
  const core = calculateAflTradeHpnPavCore([
    {
      teamId,
      pointsFor: 100,
      pointsAgainst: 80,
      inside50sFor: 50,
      inside50sAgainst: 40,
      players: [player],
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
          ...stats,
        },
      ],
    },
  ]);
  const content = {
    schemaVersion: AFL_TRADE_HPN_PAV_FINALIZED_CALCULATION_SCHEMA_VERSION,
    authorityBoundary:
      'private_finalized_hpn_input_exact_method_bytes_no_publication_or_fantasy_ownership' as const,
    publicationEligible: false as const,
    environment: 'non_production' as const,
    competition: 'AFLM' as const,
    seasonYear,
    effectiveThrough: `${seasonYear}-09-30T23:59:59.000Z`,
    calculatedAt: '2025-12-01T00:00:00.000Z',
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
    players: core.players.map((value) => ({
      ...value,
      source: { ...value.source, gamesPlayed: 18 },
    })),
  };
  return aflTradeFinalizedHpnPavCalculationSchema.parse({
    calculationId: createAflTradeContentAddress('hpn-pav-season', content),
    content,
  });
}

async function seedLifecycleFixture() {
  const reviewedPolicy = policy();
  const spells = predictionSeasons.map(spell);
  const calculations = predictionSeasons.flatMap((predictionSeason) => [
    calculation(
      predictionSeason,
      spells.find(({ playerId }) => playerId.endsWith(`${predictionSeason}`))!
    ),
    calculation(
      predictionSeason + 1,
      predictionSeason === 2012
        ? null
        : spells.find(({ playerId }) => playerId.endsWith(`${predictionSeason}`))!
    ),
  ]);
  const fixtureClient = await pool.connect();
  await fixtureClient.query('BEGIN');
  try {
    await fixtureClient.query(`SET LOCAL session_replication_role='replica'`);
    const { approvalDecision: _approvalDecision, ...policyEvidence } = reviewedPolicy.content;
    await fixtureClient.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,canonical_record_type,
         canonical_record_id,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'player_pav_policy',$2,'approved',NULL,NULL,NULL,$3,$4::jsonb,$5,$6)`,
      [
        reviewedPolicy.content.approvalDecision.id,
        `AFLM:${reviewedPolicy.content.policyVersion}`,
        'Integration fixture policy approval.',
        canonicalizeAflTradeJson(policyEvidence),
        'integration-fixture-reviewer',
        '1998-12-31T00:00:00.000Z',
      ]
    );
    await fixtureClient.query(
      `INSERT INTO outcome_hpn_pav_method
        (method_id,method_sha256,environment,source_artifact_id,captured_at,registered_at,
         method_canonical_json,method_json)
       VALUES ($1,$2,'non_production',$3,$4,$4,$5,$6::jsonb)`,
      [
        methodId,
        methodId.slice('hpn-pav-method:'.length),
        addressed('artifact', 'player-pav-method-source'),
        '1998-01-01T00:00:00.000Z',
        '{}',
        '{}',
      ]
    );
    await fixtureClient.query(
      `INSERT INTO outcome_release_manifest
        (release_id,scope_key,environment,created_at,effective_through,manifest_json,
         manifest_canonical_json)
       VALUES ($1,$2,'non_production',$3,$3,$4::jsonb,$5)`,
      [
        releaseId,
        'player-pav-integration-history',
        '2026-08-10T23:59:59.999Z',
        '{"content":{"competition":"AFLM"}}',
        '{"competition":"AFLM"}',
      ]
    );
    await fixtureClient.query(
      `INSERT INTO outcome_active_release(scope_key,release_id,activated_at,revision)
       VALUES ($1,$2,$3,1)`,
      ['player-pav-integration-history', releaseId, '2026-08-10T23:59:59.999Z']
    );
    for (const [ordinal, member] of spells.entries()) {
      await fixtureClient.query(
        `INSERT INTO outcome_club
          (club_id,current_name,abbreviation,active_from_year,active_through_year,status)
         VALUES ($1,$2,NULL,NULL,NULL,'approved')`,
        [member.clubId, member.clubId]
      );
      await fixtureClient.query(
        `INSERT INTO outcome_player(player_id,display_name,birth_date,status)
         VALUES ($1,$2,NULL,'approved')`,
        [member.playerId, member.playerId]
      );
      await fixtureClient.query(
        `INSERT INTO outcome_acquisition_spell_version
          (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,
           start_asset_version_id,start_date,end_date,end_reason,rule_id,status,
           supersedes_spell_version_id,recorded_at)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,NULL,$9,'approved',NULL,$10)`,
        [
          member.spellVersionId,
          member.spellId,
          member.playerId,
          member.clubId,
          addressed('event-version', member.spellId),
          addressed('event-asset-version', member.spellId),
          member.startDate,
          member.endDate,
          addressed('acquisition-spell-rule', 'integration-rule'),
          member.recordedAt,
        ]
      );
      await fixtureClient.query(
        `INSERT INTO outcome_release_acquisition_spell
          (release_id,spell_version_id,ordinal,record_sha256,membership_json)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [releaseId, member.spellVersionId, ordinal + 1, sha(member.spellVersionId), '{}']
      );
    }
    for (const retained of calculations) {
      const content = retained.content;
      await fixtureClient.query(
        `INSERT INTO outcome_hpn_pav_calculation
          (calculation_id,calculation_sha256,schema_version,input_set_id,method_id,
           environment,competition,season_year,effective_through,calculated_at,value_unit,
           status,team_count,player_count,calculation_canonical_json,calculation_json,finalized_at)
         VALUES ($1,$2,$3,$4,$5,'non_production','AFLM',$6,$7,$8,'season_pav',
           'finalized',$9,$10,$11,$12::jsonb,$8)`,
        [
          retained.calculationId,
          retained.calculationId.slice('hpn-pav-season:'.length),
          content.schemaVersion,
          content.inputSetId,
          methodId,
          content.seasonYear,
          content.effectiveThrough,
          content.calculatedAt,
          content.teams.length,
          content.players.length,
          canonicalizeAflTradeJson(content),
          canonicalizeAflTradeJson(retained),
        ]
      );
      for (const [ordinal, team] of content.teams.entries()) {
        await fixtureClient.query(
          `INSERT INTO outcome_hpn_pav_calculation_team
            (calculation_id,team_id,ordinal,team_sha256,offensive_pav,midfield_pav,
             defensive_pav,total_pav,team_canonical_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            retained.calculationId,
            team.teamId,
            ordinal + 1,
            sha(canonicalizeAflTradeJson(team)),
            team.offensivePav,
            team.midfieldPav,
            team.defensivePav,
            team.totalPav,
            canonicalizeAflTradeJson(team),
          ]
        );
      }
      for (const [ordinal, player] of content.players.entries()) {
        await fixtureClient.query(
          `INSERT INTO outcome_hpn_pav_calculation_player
            (calculation_id,spell_version_id,player_id,team_id,ordinal,player_sha256,
             offensive_pav,midfield_pav,defensive_pav,total_pav,player_canonical_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            retained.calculationId,
            player.spellVersionId,
            player.playerId,
            player.teamId,
            ordinal + 1,
            sha(canonicalizeAflTradeJson(player)),
            player.offensivePav,
            player.midfieldPav,
            player.defensivePav,
            player.totalPav,
            canonicalizeAflTradeJson(player),
          ]
        );
      }
      await fixtureClient.query(
        `INSERT INTO outcome_hpn_pav_calculation_head
          (environment,competition,season_year,method_id,calculation_id,revision,updated_at)
         VALUES ('non_production','AFLM',$1,$2,$3,1,$4)`,
        [content.seasonYear, methodId, retained.calculationId, content.calculatedAt]
      );
    }
    await fixtureClient.query('COMMIT');
  } catch (error) {
    await fixtureClient.query('ROLLBACK');
    throw error;
  } finally {
    fixtureClient.release();
  }
  return { reviewedPolicy };
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await pool.query(
    'CREATE TABLE synthetic_cohort_hpn_authority(request_id TEXT PRIMARY KEY,binding_json JSONB)'
  );
  await pool.query(
    `GRANT SELECT ON synthetic_cohort_hpn_authority TO afl_trade_private_valuation_scheduler_owner`
  );
  await pool.query(`CREATE OR REPLACE FUNCTION load_outcome_private_valuation_hpn_factual_input(
    target_request_id TEXT,target_output_id TEXT) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $fn$
    DECLARE request RECORD; result JSONB; BEGIN
      SELECT * INTO request FROM outcome_private_valuation_dispatch_request WHERE request_id=target_request_id;
      PERFORM load_outcome_private_valuation_dispatch_request_for_claim(target_request_id,request.claim_id,request.lease_token_sha256);
      SELECT binding_json INTO result FROM synthetic_cohort_hpn_authority WHERE request_id=target_request_id;
      IF result->>'factualOutputId' IS DISTINCT FROM target_output_id THEN RAISE EXCEPTION 'Synthetic HPN authority mismatch'; END IF;
      RETURN result; END $fn$`);
});

afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

describe.sequential('player-PAV PostgreSQL authority store', () => {
  let reviewedPolicy: ReturnType<typeof policy>;
  let privateFixture: Awaited<ReturnType<typeof seedPrivateValuationCohortBindingFixture>>;
  let privateSelection: {
    requestId: string;
    claim: { claimId: string; leaseToken: string };
    policyId: string;
    lineageAdmissionId: string;
  };

  async function rejectsPrivateMutation(
    sql: string,
    parameters: readonly unknown[],
    message: RegExp
  ) {
    const mutationClient = await pool.connect();
    await mutationClient.query('BEGIN');
    try {
      await mutationClient.query(`SET LOCAL session_replication_role='replica'`);
      const changed = await mutationClient.query(sql, parameters);
      expect(changed.rowCount, 'private authority mutation must affect its target').toBeGreaterThan(
        0
      );
      const transactionClient: AflOutcomeSqlClient = {
        query: async <Row = Record<string, unknown>>(
          query: string,
          queryParameters?: readonly unknown[]
        ) => {
          const result = await mutationClient.query(query, queryParameters && [...queryParameters]);
          return { rows: result.rows as Row[], rowCount: result.rowCount };
        },
        transaction: async (work) => work(transactionClient),
      };
      await expect(
        new PostgresAflTradePrivatePlayerPavPreparation(transactionClient).prepare(privateSelection)
      ).rejects.toThrow(message);
    } finally {
      await mutationClient.query('ROLLBACK');
      mutationClient.release();
    }
  }
  it('migrates the complete durable store and private dispatch binding', async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema=$1 AND table_name=ANY($2::text[]) ORDER BY table_name`,
      [
        schemaName,
        [
          'outcome_player_pav_policy',
          'outcome_player_pav_observation_set',
          'outcome_player_pav_calculation_member',
          'outcome_player_pav_observation',
          'outcome_player_pav_value',
          'outcome_private_player_pav_authority',
        ],
      ]
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      'outcome_player_pav_calculation_member',
      'outcome_player_pav_observation',
      'outcome_player_pav_observation_set',
      'outcome_player_pav_policy',
      'outcome_player_pav_value',
      'outcome_private_player_pav_authority',
    ]);
  });

  it('keeps policy writes outside the private coordinator while permitting observation custody', async () => {
    const privileges = await pool.query<{
      public_policy_select: boolean;
      coordinator_policy_insert: boolean;
      coordinator_policy_select: boolean;
      coordinator_set_insert: boolean;
      coordinator_set_update: boolean;
      coordinator_value_insert: boolean;
    }>(
      `SELECT
        has_table_privilege('public',$1,'select') AS public_policy_select,
        has_table_privilege('afl_trade_private_evaluation_coordinator',$1,'insert')
          AS coordinator_policy_insert,
        has_table_privilege('afl_trade_private_evaluation_coordinator',$1,'select')
          AS coordinator_policy_select,
        has_table_privilege('afl_trade_private_evaluation_coordinator',$2,'insert')
          AS coordinator_set_insert,
        has_table_privilege('afl_trade_private_evaluation_coordinator',$2,'update')
          AS coordinator_set_update,
        has_table_privilege('afl_trade_private_evaluation_coordinator',$3,'insert')
          AS coordinator_value_insert`,
      [
        `${schemaName}.outcome_player_pav_policy`,
        `${schemaName}.outcome_player_pav_observation_set`,
        `${schemaName}.outcome_player_pav_value`,
      ]
    );
    expect(privileges.rows).toEqual([
      {
        public_policy_select: false,
        coordinator_policy_insert: false,
        coordinator_policy_select: true,
        coordinator_set_insert: true,
        coordinator_set_update: false,
        coordinator_value_insert: true,
      },
    ]);
  });

  it('prepares and exactly replays an inactive, request-bound private lifecycle', async () => {
    ({ reviewedPolicy } = await seedLifecycleFixture());
    const repository = new PostgresAflTradePlayerPavObservationRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    await expect(
      repository.registerPolicy(reviewedPolicy, { environment: 'non_production' })
    ).resolves.toEqual(reviewedPolicy);
    privateFixture = await seedPrivateValuationCohortBindingFixture(
      createPgAflOutcomeSqlClient(pool)
    );
    const fixtureClient = await pool.connect();
    await fixtureClient.query('BEGIN');
    try {
      await fixtureClient.query(`SET LOCAL session_replication_role='replica'`);
      await fixtureClient.query(
        `UPDATE outcome_corpus_factual_lineage
         SET valid_from_season=$2,valid_through_season=$3 WHERE lineage_id=$1`,
        [privateFixture.lineageId, predictionSeasons[0], predictionSeasons.at(-1)! + 1]
      );
      for (const [ordinal, predictionSeason] of predictionSeasons.entries()) {
        await fixtureClient.query(
          `INSERT INTO outcome_release_acquisition_spell
            (release_id,spell_version_id,ordinal,record_sha256,membership_json)
           VALUES ($1,$2,$3,$4,'{}'::jsonb)`,
          [
            privateFixture.releaseId,
            spell(predictionSeason).spellVersionId,
            ordinal + 1,
            sha(`private:${predictionSeason}`),
          ]
        );
      }
      await fixtureClient.query('COMMIT');
    } catch (error) {
      await fixtureClient.query('ROLLBACK');
      throw error;
    } finally {
      fixtureClient.release();
    }
    const preparation = new PostgresAflTradePrivatePlayerPavPreparation(
      createPgAflOutcomeSqlClient(pool)
    );
    privateSelection = {
      requestId: privateFixture.requestId,
      claim: {
        claimId: privateFixture.claim.claimId,
        leaseToken: privateFixture.claim.leaseToken,
      },
      policyId: reviewedPolicy.policyId,
      lineageAdmissionId: privateFixture.admissionId,
    };
    const first = await preparation.prepare(privateSelection);
    const replay = await preparation.prepare(privateSelection);

    expect(first).toMatchObject({
      state: 'prepared',
      requestId: privateFixture.requestId,
      policyId: reviewedPolicy.policyId,
      lineageAdmissionId: privateFixture.admissionId,
      releaseId: privateFixture.releaseId,
      publicationEligible: false,
    });
    expect(replay).toEqual({ ...first, state: 'already_prepared' });
    expect(
      await pool.query(
        `SELECT binding_json->>'releaseId' AS release_id FROM outcome_private_player_pav_authority
         WHERE request_id=$1`,
        [privateFixture.requestId]
      )
    ).toMatchObject({ rows: [{ release_id: privateFixture.releaseId }] });
    expect(
      await pool.query(`SELECT count(*)::int AS count FROM outcome_active_release`)
    ).toMatchObject({ rows: [{ count: 1 }] });
  });

  it('fails closed for stale policy, incomplete measurements, cross-scope lineage, late spells, and stale claims', async () => {
    await rejectsPrivateMutation(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,canonical_record_type,
         canonical_record_id,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'player_pav_policy',$2,'withdrawn',NULL,NULL,$3,$4,'{}'::jsonb,$5,$6)`,
      [
        addressed('review-decision', 'private-player-pav-policy-withdrawal'),
        `AFLM:${reviewedPolicy.content.policyVersion}`,
        reviewedPolicy.content.approvalDecision.id,
        'Private integration fixture policy withdrawal.',
        'integration-fixture-reviewer-2',
        '2026-01-02T00:00:00.000Z',
      ],
      /policy.*unavailable|not current/i
    );
    await rejectsPrivateMutation(
      `DELETE FROM outcome_hpn_pav_calculation_head
       WHERE environment='non_production' AND competition='AFLM'
         AND method_id=$1 AND season_year=$2`,
      [methodId, predictionSeasons.at(-1)! + 1],
      /measurement coverage.*incomplete/i
    );
    await rejectsPrivateMutation(
      `UPDATE outcome_corpus_factual_lineage SET scope_key='afl-men:foreign-scope'
       WHERE lineage_id=$1`,
      [privateFixture.lineageId],
      /historical release.*unavailable|mismatched/i
    );
    await rejectsPrivateMutation(
      `UPDATE outcome_acquisition_spell_version
       SET recorded_at=make_timestamptz($2,12,31,23,59,59,'UTC')+interval '1 second'
       WHERE spell_version_id=$1`,
      [spell(predictionSeasons[0]).spellVersionId, predictionSeasons[0]],
      /spell membership.*incomplete|late/i
    );
    await rejectsPrivateMutation(
      `UPDATE outcome_private_valuation_dispatch_request
       SET lease_expires_at=now()-interval '1 second' WHERE request_id=$1`,
      [privateFixture.requestId],
      /claim|dispatch/i
    );
  });

  it('materializes retrospective private history with real recording dates and replays without replacing them', async () => {
    const recordedAt = '2026-01-01T00:00:00.000Z';
    const retrospectivePolicy = createAflTradePlayerPavPolicy({
      ...reviewedPolicy.content,
      schemaVersion: 'afl-trade-player-pav-policy/v2',
      knowledgePolicy: 'retrospective_as_recorded_by_dataset_creation',
      policyVersion: 'player-pav-postgres-retrospective-v2',
      createdAt: recordedAt,
      approvalDecision: {
        id: addressed('review-decision', 'retrospective-player-pav-fixture'),
        sha256: sha('retrospective-player-pav-fixture'),
      },
    });
    const fixtureClient = await pool.connect();
    await fixtureClient.query('BEGIN');
    try {
      // Replace only synthetic setup inside a rolled-back fixture transaction. No genuine custody.
      await fixtureClient.query(`SET LOCAL session_replication_role='replica'`);
      await fixtureClient.query(
        'DELETE FROM outcome_private_player_pav_authority WHERE request_id=$1',
        [privateSelection.requestId]
      );
      await fixtureClient.query(
        'UPDATE outcome_acquisition_spell_version SET recorded_at=$1 WHERE spell_version_id=ANY($2::text[])',
        [recordedAt, predictionSeasons.map((season) => spell(season).spellVersionId)]
      );
      const { approvalDecision: _approval, ...evidence } = retrospectivePolicy.content;
      await fixtureClient.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,canonical_record_type,
           canonical_record_id,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
         VALUES ($1,'player_pav_policy',$2,'approved',NULL,NULL,NULL,$3,$4::jsonb,$5,$6)`,
        [
          retrospectivePolicy.content.approvalDecision.id,
          `AFLM:${retrospectivePolicy.content.policyVersion}`,
          'Synthetic retrospective policy review; not genuine method approval.',
          canonicalizeAflTradeJson(evidence),
          'integration-fixture-reviewer',
          recordedAt,
        ]
      );
      await fixtureClient.query(`SET LOCAL session_replication_role='origin'`);
      const client: AflOutcomeSqlClient = {
        query: async <Row = Record<string, unknown>>(
          query: string,
          parameters?: readonly unknown[]
        ) => {
          const result = await fixtureClient.query(query, parameters && [...parameters]);
          return { rows: result.rows as Row[], rowCount: result.rowCount };
        },
        transaction: async (work) => work(client),
      };
      const repository = new PostgresAflTradePlayerPavObservationRepository(client);
      await repository.registerPolicy(retrospectivePolicy, { environment: 'non_production' });
      const selection = { ...privateSelection, policyId: retrospectivePolicy.policyId };
      const first = await new PostgresAflTradePrivatePlayerPavPreparation(client).prepare(
        selection
      );
      const replay = await new PostgresAflTradePrivatePlayerPavPreparation(client).prepare(
        selection
      );
      expect(first.state).toBe('prepared');
      expect(replay).toEqual({ ...first, state: 'already_prepared' });
      const retained = await new PostgresAflTradePlayerPavObservationRepository(
        client
      ).materializePrivateAndPersist({ requestId: selection.requestId });
      expect(retained.idempotentReplay).toBe(true);
      expect(retained.observationSet.content.schemaVersion).toBe(
        'afl-trade-player-pav-observation-set/v2'
      );
      expect(retained.observationSet.content.observations).toHaveLength(4);
      for (const observation of retained.observationSet.content.observations) {
        expect(observation.acquisitionSpell.recordedAt).toBe(recordedAt);
        expect(Date.parse(observation.predictionCutoffAt)).toBeLessThan(Date.parse(recordedAt));
        expect(observation).toMatchObject({
          knowledgeBinding: {
            policy: 'retrospective_as_recorded_by_dataset_creation',
            knowledgeCutoffAt: recordedAt,
          },
        });
      }
      await fixtureClient.query('SAVEPOINT substituted_spell');
      try {
        await fixtureClient.query('RESET ROLE');
        await fixtureClient.query(`SET LOCAL session_replication_role='replica'`);
        // Alter only synthetic durable evidence, leaving retained JSON and its hashes intact.
        // The earlier valid start date still passes historical membership selection.
        await fixtureClient.query(
          `UPDATE outcome_acquisition_spell_version SET start_date='1998-01-01'
           WHERE spell_version_id=$1`,
          [spell(predictionSeasons[0]).spellVersionId]
        );
        await fixtureClient.query(
          `UPDATE outcome_player_pav_observation_set SET status='building',finalized_at=NULL
           WHERE observation_set_id=$1`,
          [retained.observationSet.observationSetId]
        );
        await fixtureClient.query(`SET LOCAL session_replication_role='origin'`);
        await expect(
          fixtureClient.query(
            `UPDATE outcome_player_pav_observation_set SET status='finalized',finalized_at=created_at
           WHERE observation_set_id=$1`,
            [retained.observationSet.observationSetId]
          )
        ).rejects.toThrow(/spell or observation custody is mismatched/i);
      } finally {
        await fixtureClient.query('ROLLBACK TO SAVEPOINT substituted_spell');
      }
      for (const mutation of [
        { calculatedAt: '2026-01-02T00:00:00.000Z' },
        { effectiveThrough: '2000-09-29T23:59:59.000Z' },
        { seasonYear: 2001 },
      ]) {
        await fixtureClient.query('SAVEPOINT substituted_value');
        try {
          const forged = structuredClone(retained.observationSet);
          const observation = forged.content.observations[0]!;
          const originalObservationId = observation.observationId;
          Object.assign(observation.featureValues[0]!, mutation);
          const { observationId: _oldId, ...observationContent } = observation;
          observation.observationId = createAflTradeContentAddress(
            'player-pav-observation',
            observationContent
          );
          forged.content.observationSetSha256 = sha256AflTradeCanonicalJson(
            forged.content.observations.map(({ observationId: _id, ...content }) => content)
          );
          forged.observationSetId = createAflTradeContentAddress(
            'player-pav-observation-set',
            forged.content
          );
          await fixtureClient.query('RESET ROLE');
          await fixtureClient.query(`SET LOCAL session_replication_role='replica'`);
          // Simulate a malicious but internally rehashed SQL writer; keep every custody copy aligned.
          await fixtureClient.query(
            `UPDATE outcome_player_pav_observation_set
             SET observation_set_id=$1,observation_set_sha256=$2,observation_set_json=$3::jsonb,
               status='building',finalized_at=NULL WHERE observation_set_id=$4`,
            [
              forged.observationSetId,
              forged.observationSetId.split(':')[1],
              canonicalizeAflTradeJson(forged),
              retained.observationSet.observationSetId,
            ]
          );
          for (const table of [
            'outcome_player_pav_calculation_member',
            'outcome_player_pav_observation',
            'outcome_player_pav_value',
          ] as const) {
            await fixtureClient.query(
              `UPDATE ${table} SET observation_set_id=$1 WHERE observation_set_id=$2`,
              [forged.observationSetId, retained.observationSet.observationSetId]
            );
          }
          await fixtureClient.query(
            `UPDATE outcome_player_pav_observation SET observation_id=$1,
              observation_sha256=$2,observation_json=$3::jsonb
             WHERE observation_set_id=$4 AND observation_id=$5`,
            [
              observation.observationId,
              observation.observationId.split(':')[1],
              canonicalizeAflTradeJson(observation),
              forged.observationSetId,
              originalObservationId,
            ]
          );
          await fixtureClient.query(
            `UPDATE outcome_player_pav_value SET observation_id=$1,
              value_json=CASE WHEN value_role='feature' AND ordinal=0 THEN $2::jsonb ELSE value_json END
             WHERE observation_set_id=$3 AND observation_id=$4`,
            [
              observation.observationId,
              canonicalizeAflTradeJson(observation.featureValues[0]),
              forged.observationSetId,
              originalObservationId,
            ]
          );
          await fixtureClient.query(`SET LOCAL session_replication_role='origin'`);
          await expect(
            fixtureClient.query(
              `UPDATE outcome_player_pav_observation_set SET status='finalized',finalized_at=created_at
             WHERE observation_set_id=$1`,
              [forged.observationSetId]
            )
          ).rejects.toThrow(/value custody is mismatched/i);
        } finally {
          await fixtureClient.query('ROLLBACK TO SAVEPOINT substituted_value');
        }
      }
      await fixtureClient.query('RESET ROLE');
      await fixtureClient.query(`SET LOCAL session_replication_role='replica'`);
      await fixtureClient.query(
        'UPDATE outcome_acquisition_spell_version SET recorded_at=$1 WHERE spell_version_id=$2',
        ['2026-01-02T00:00:00.000Z', spell(predictionSeasons[0]).spellVersionId]
      );
      await fixtureClient.query(`SET LOCAL session_replication_role='origin'`);
      await expect(
        new PostgresAflTradePrivatePlayerPavPreparation(client).prepare(selection)
      ).rejects.toThrow(/spell membership.*incomplete|late/i);
    } finally {
      await fixtureClient.query('ROLLBACK');
      fixtureClient.release();
    }
  });

  it('finalizes, replays, reads back, and reauthenticates the public PostgreSQL lifecycle', async () => {
    const repository = new PostgresAflTradePlayerPavObservationRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const request = {
      environment: 'non_production' as const,
      competition: 'AFLM' as const,
      releaseId,
      policyId: reviewedPolicy.policyId,
      knowledgeCutoffAt: '2026-08-10T23:59:59.999Z',
    };

    const first = await repository.materializeAndPersist(request, {
      environment: 'non_production',
    });
    const replay = await repository.materializeAndPersist(request, {
      environment: 'non_production',
    });
    const loaded = await repository.loadFinalized(
      {
        observationSetId: first.observationSet.observationSetId,
        environment: 'non_production',
      },
      { environment: 'non_production' }
    );

    expect(first.idempotentReplay).toBe(false);
    expect(replay).toEqual({ observationSet: first.observationSet, idempotentReplay: true });
    expect(loaded).toEqual(first.observationSet);
    expect(
      await pool.query(
        `SELECT status,finalized_at IS NOT NULL AS finalized FROM outcome_player_pav_observation_set
         WHERE observation_set_id=$1`,
        [first.observationSet.observationSetId]
      )
    ).toMatchObject({ rows: [{ status: 'finalized', finalized: true }] });

    const withdrawalClient = await pool.connect();
    try {
      await withdrawalClient.query(`SET session_replication_role='replica'`);
      await withdrawalClient.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,canonical_record_type,
           canonical_record_id,supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
         VALUES ($1,'player_pav_policy',$2,'withdrawn',NULL,NULL,$3,$4,'{}'::jsonb,$5,$6)`,
        [
          addressed('review-decision', 'withdraw-player-pav-integration-policy'),
          `AFLM:${reviewedPolicy.content.policyVersion}`,
          reviewedPolicy.content.approvalDecision.id,
          'Integration fixture withdrawal.',
          'integration-fixture-reviewer-2',
          '2026-08-12T00:00:00.000Z',
        ]
      );
    } finally {
      await withdrawalClient.query(`RESET session_replication_role`);
      withdrawalClient.release();
    }
    await expect(
      repository.loadFinalized(
        {
          observationSetId: first.observationSet.observationSetId,
          environment: 'non_production',
        },
        { environment: 'non_production' }
      )
    ).rejects.toMatchObject({ code: 'POLICY_NOT_CURRENT' });
  });
});
