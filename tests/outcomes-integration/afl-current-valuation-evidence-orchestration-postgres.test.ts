import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createLocalAflTradeCurrentValuationReconciliationAuthority } from '@/server/aflTradeIntelligence/development/localCurrentValuationReconciliationAuthority';
import { LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256 } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesReview';
import { LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256 } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Review';
import {
  AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES,
  createAflTradeCurrentValuationEvidenceCoordinator,
  createAflTradeCurrentValuationEvidenceFactualHandoffKey,
} from '@/server/aflTradeIntelligence/valuation/currentValuationEvidenceOrchestration';
import { createAflTradeCurrentValuationRefresh } from '@/server/aflTradeIntelligence/valuation/currentValuationRefresh';
import { PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository } from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationEvidenceOrchestration';
import { PostgresAflTradePrivateReviewedEvidenceEvaluationAuthority } from '@/server/aflTradeIntelligence/valuation/postgresPrivateReviewedEvidenceEvaluationAuthority';
import { loadExactLocalReviewedProviderEvidenceBundle } from '@/server/aflTradeIntelligence/development/localReviewedProviderEvidence';
import { createGovernedCurrentValuationEvidenceSourceFixture } from '../helpers/aflCurrentValuationEvidenceProviderFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_current_valuation_evidence_${process.pid}_${Date.now()}`;
const governedSchemaName = `afl_current_valuation_evidence_e2e_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  options: `-c search_path=${schemaName}`,
});
const governedPool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  options: `-c search_path=${governedSchemaName}`,
});
let governedArtifactRoot = '';

function expectedFieldMapId(
  source: (typeof AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES)[number]
): string {
  if (source.capabilityId === 'official-afl-player-stats') {
    return 'official-afl-player-stats-local-2026-v1';
  }
  if (source.capabilityId === 'afl-tables-results') {
    return 'afl-tables-results-local-2026-v2';
  }
  return `afl-tables-player-stats-local-${source.seasonYear}-v1`;
}

function sourceCaptureId(index: number): string {
  return `source-capture:${String(index).padStart(64, '0')}`;
}

function sourceContentSha256(index: number): string {
  return (index + 1).toString(16).repeat(64);
}

async function retainTestObservedCapture(input: {
  request: {
    scopeKey: string;
    trigger: 'weekly' | 'model_qualified' | 'ad_hoc';
    stableOperationKey: string;
  };
  source: (typeof AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES)[number];
  index: number;
}): Promise<string> {
  const captureId = sourceCaptureId(input.index);
  const authoritySha256 = (input.index + 8).toString(16).repeat(64);
  await pool.query(
    'SELECT retain_outcome_current_valuation_evidence_observed_capture($1,$2,$3,$4,$5,$6,$7)',
    [
      input.request.scopeKey,
      input.request.trigger,
      input.request.stableOperationKey,
      input.source.sourceKey,
      captureId,
      sourceContentSha256(input.index),
      authoritySha256,
    ]
  );
  return authoritySha256;
}

async function retainTestSourceCustody(input: Parameters<typeof retainTestObservedCapture>[0]) {
  const authoritySha256 = await retainTestObservedCapture(input);
  const captureId = sourceCaptureId(input.index);
  await pool.query(
    'SELECT * FROM claim_outcome_current_valuation_evidence_normalization($1,$2,$3,$4,$5)',
    [
      input.source.sourceKey,
      sourceContentSha256(input.index),
      authoritySha256,
      captureId,
      `provider-normalization-run:${String(input.index).padStart(64, '0')}`,
    ]
  );
}

async function seedCurrentReviewSetAuthority(): Promise<void> {
  const fixtureClient = await governedPool.connect();
  try {
    await fixtureClient.query('BEGIN');
    // The production runtime finalizes one representative row per capture. Expand those immutable
    // runs only while constructing the disposable full-size corpus; all reviewed-evidence guards
    // and authority functions execute afterward under the normal origin role.
    await fixtureClient.query(`SET LOCAL session_replication_role='replica'`);
    await fixtureClient.query(`
    WITH template AS (
      SELECT decoded.*
        FROM outcome_provider_decoded_row decoded
        JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
       WHERE capture.provider='afl_tables'
         AND capture.capability_id='afl-tables-player-stats'
       ORDER BY decoded.provider_decoded_row_id
       LIMIT 1
    )
    INSERT INTO outcome_provider_decoded_row
      (provider_decoded_row_id,normalization_run_id,capture_id,competition,season_year,
       source_row_number,source_row_sha256,row_status,typed_payload,recorded_at)
    SELECT 'fixture-historical-decoded:'||lpad(series.value::text,8,'0'),
           template.normalization_run_id,template.capture_id,template.competition,
           template.season_year,series.value,repeat('a',64),template.row_status,
           template.typed_payload,template.recorded_at
      FROM template CROSS JOIN generate_series(2,48765) series(value)
  `);
    await fixtureClient.query(`
    INSERT INTO outcome_provider_identity_candidate
      (identity_candidate_id,provider_decoded_row_id,provider,entity_kind,native_entity_id,
       recorded_name,recorded_club_id,recorded_club_name,locator_sha256,candidate_sha256,
       candidate_canonical_json,candidate_json)
    SELECT 'fixture-historical-identity:'||right(decoded.provider_decoded_row_id,8),
           decoded.provider_decoded_row_id,'afl_tables','player',
           'fixture-player-'||right(decoded.provider_decoded_row_id,8),'Fixture Player',NULL,
           'Carlton',repeat('b',64),encode(sha256(convert_to('{}','UTF8')),'hex'),
           '{}','{}'::jsonb
      FROM outcome_provider_decoded_row decoded
     WHERE decoded.provider_decoded_row_id LIKE 'fixture-historical-decoded:%'
  `);
    await fixtureClient.query(`
    INSERT INTO outcome_provider_match_candidate
      (match_candidate_id,provider_decoded_row_id,provider,native_match_id,round_label,
       match_date_text,home_club_native_id,home_club_name,away_club_native_id,away_club_name,
       provider_status,order_independent_sha256,candidate_sha256,candidate_canonical_json,
       candidate_json)
    SELECT 'fixture-historical-match:'||right(decoded.provider_decoded_row_id,8),
           decoded.provider_decoded_row_id,'afl_tables',NULL,'Round 1','2021-03-20',NULL,
           'Carlton',NULL,'Richmond','CONCLUDED',repeat('d',64),
           encode(sha256(convert_to('{}','UTF8')),'hex'),'{}','{}'::jsonb
      FROM outcome_provider_decoded_row decoded
     WHERE decoded.provider_decoded_row_id LIKE 'fixture-historical-decoded:%'
  `);
    await fixtureClient.query(`
    WITH template_metric AS (
      SELECT metric.*
        FROM outcome_provider_metric_candidate metric
        JOIN outcome_provider_decoded_row decoded USING (provider_decoded_row_id)
        JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
       WHERE capture.provider='afl_tables'
         AND capture.capability_id='afl-tables-player-stats'
         AND metric.metric_code='goals'
       LIMIT 1
    )
    INSERT INTO outcome_provider_metric_candidate
      (provider_decoded_row_id,metric_code,definition_version,availability,numeric_value,
       unit,source_field,missing_reason,candidate_json)
    SELECT decoded.provider_decoded_row_id,template_metric.metric_code,
           template_metric.definition_version,template_metric.availability,
           template_metric.numeric_value,template_metric.unit,template_metric.source_field,
           template_metric.missing_reason,template_metric.candidate_json
      FROM outcome_provider_decoded_row decoded CROSS JOIN template_metric
     WHERE decoded.provider_decoded_row_id LIKE 'fixture-historical-decoded:%'
  `);

    await fixtureClient.query(`
    WITH template AS (
      SELECT decoded.*
        FROM outcome_provider_decoded_row decoded
        JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
       WHERE capture.provider='official_afl'
         AND capture.capability_id='official-afl-player-stats'
       LIMIT 1
    )
    INSERT INTO outcome_provider_decoded_row
      (provider_decoded_row_id,normalization_run_id,capture_id,competition,season_year,
       source_row_number,source_row_sha256,row_status,typed_payload,recorded_at)
    SELECT 'fixture-official-decoded:'||lpad(series.value::text,2,'0'),
           template.normalization_run_id,template.capture_id,template.competition,
           template.season_year,series.value,repeat('1',64),template.row_status,
           template.typed_payload,template.recorded_at
      FROM template CROSS JOIN generate_series(2,12) series(value)
  `);
    await fixtureClient.query(`
    INSERT INTO outcome_provider_identity_candidate
      (identity_candidate_id,provider_decoded_row_id,provider,entity_kind,native_entity_id,
       recorded_name,recorded_club_id,recorded_club_name,locator_sha256,candidate_sha256,
       candidate_canonical_json,candidate_json)
    SELECT 'fixture-official-identity:'||right(decoded.provider_decoded_row_id,2),
           decoded.provider_decoded_row_id,'official_afl','player',
           'fixture-official-player-'||right(decoded.provider_decoded_row_id,2),'Fixture Player',
           NULL,'Carlton',repeat('2',64),encode(sha256(convert_to('{}','UTF8')),'hex'),
           '{}','{}'::jsonb
      FROM outcome_provider_decoded_row decoded
     WHERE decoded.provider_decoded_row_id LIKE 'fixture-official-decoded:%'
  `);
    await fixtureClient.query(`
    INSERT INTO outcome_provider_match_candidate
      (match_candidate_id,provider_decoded_row_id,provider,native_match_id,round_label,
       match_date_text,home_club_native_id,home_club_name,away_club_native_id,away_club_name,
       provider_status,order_independent_sha256,candidate_sha256,candidate_canonical_json,
       candidate_json)
    SELECT 'fixture-official-match:'||right(decoded.provider_decoded_row_id,2),
           decoded.provider_decoded_row_id,'official_afl',NULL,'Round 1','2026-03-20',NULL,
           'Carlton',NULL,'Richmond','CONCLUDED',repeat('4',64),
           encode(sha256(convert_to('{}','UTF8')),'hex'),'{}','{}'::jsonb
      FROM outcome_provider_decoded_row decoded
     WHERE decoded.provider_decoded_row_id LIKE 'fixture-official-decoded:%'
  `);
    await fixtureClient.query(`
    WITH template_metric AS (
      SELECT metric.*
        FROM outcome_provider_metric_candidate metric
        JOIN outcome_provider_decoded_row decoded USING (provider_decoded_row_id)
        JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
       WHERE capture.provider='official_afl'
         AND capture.capability_id='official-afl-player-stats'
         AND metric.metric_code='goals'
       LIMIT 1
    )
    INSERT INTO outcome_provider_metric_candidate
      (provider_decoded_row_id,metric_code,definition_version,availability,numeric_value,
       unit,source_field,missing_reason,candidate_json)
    SELECT decoded.provider_decoded_row_id,template_metric.metric_code,
           template_metric.definition_version,template_metric.availability,
           template_metric.numeric_value,template_metric.unit,template_metric.source_field,
           template_metric.missing_reason,template_metric.candidate_json
      FROM outcome_provider_decoded_row decoded CROSS JOIN template_metric
     WHERE decoded.provider_decoded_row_id LIKE 'fixture-official-decoded:%'
  `);

    await fixtureClient.query(
      `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     SELECT 'local-afl-tables-review:identity:'||identity.identity_candidate_id,
            'provider_identity_candidate',identity.identity_candidate_id,'approved',$2,
            jsonb_build_object('evidenceSetSha256',$1::text),$3,$4::timestamptz
       FROM outcome_provider_identity_candidate identity
       JOIN outcome_provider_decoded_row decoded USING (provider_decoded_row_id)
       JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
      WHERE capture.provider='afl_tables'
        AND capture.capability_id='afl-tables-player-stats'
     UNION ALL
     SELECT 'local-afl-tables-review:match:'||match.match_candidate_id,
            'provider_match_candidate',match.match_candidate_id,'approved',$2,
            jsonb_build_object('evidenceSetSha256',$1::text),$3,$4::timestamptz
       FROM outcome_provider_match_candidate match
       JOIN outcome_provider_decoded_row decoded USING (provider_decoded_row_id)
       JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
      WHERE capture.provider='afl_tables'
        AND capture.capability_id='afl-tables-player-stats'
     UNION ALL
     SELECT 'local-afl-tables-review:fact:'||decoded.provider_decoded_row_id,
            'local_reconciled_player_match_fact',decoded.provider_decoded_row_id,'approved',$2,
            jsonb_build_object(
              'evidenceSetSha256',$1::text,'identityCandidateId',identity.identity_candidate_id,
              'matchCandidateId',match.match_candidate_id,'metricCode',metric.metric_code,
              'definitionVersion',metric.definition_version,
              'metricAvailability',metric.availability::text,'numericValue',metric.numeric_value
            ),$3,$4::timestamptz
       FROM outcome_provider_decoded_row decoded
       JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
       JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
       JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
       JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
      WHERE capture.provider='afl_tables'
        AND capture.capability_id='afl-tables-player-stats'
        AND metric.metric_code='goals'`,
      [
        LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
        'Disposable exact historical review fixture.',
        'local-five-season-evidence-reviewer',
        '2026-08-29T12:00:00.000Z',
      ]
    );
    await fixtureClient.query(
      `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     SELECT 'fixture-official-review:identity:'||identity.identity_candidate_id,
            'provider_identity_candidate',identity.identity_candidate_id,'approved',$2,
            jsonb_build_object('evidenceSetSha256',$1::text),$3,$4::timestamptz
       FROM outcome_provider_identity_candidate identity
       JOIN outcome_provider_decoded_row decoded USING (provider_decoded_row_id)
       JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
      WHERE capture.provider='official_afl'
        AND capture.capability_id='official-afl-player-stats'
     UNION ALL
     SELECT 'fixture-official-review:match:'||match.match_candidate_id,
            'provider_match_candidate',match.match_candidate_id,'approved',$2,
            jsonb_build_object('evidenceSetSha256',$1::text),$3,$4::timestamptz
       FROM outcome_provider_match_candidate match
       JOIN outcome_provider_decoded_row decoded USING (provider_decoded_row_id)
       JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
      WHERE capture.provider='official_afl'
        AND capture.capability_id='official-afl-player-stats'
     UNION ALL
     SELECT 'fixture-official-review:fact:'||decoded.provider_decoded_row_id,
            'local_reconciled_player_match_fact',decoded.provider_decoded_row_id,'approved',$2,
            jsonb_build_object(
              'evidenceSetSha256',$1::text,'identityCandidateId',identity.identity_candidate_id,
              'matchCandidateId',match.match_candidate_id,'metricCode',metric.metric_code,
              'definitionVersion',metric.definition_version,
              'metricAvailability',metric.availability::text,'numericValue',metric.numeric_value
            ),$3,$4::timestamptz
       FROM outcome_provider_decoded_row decoded
       JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
       JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
       JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
       JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
      WHERE capture.provider='official_afl'
        AND capture.capability_id='official-afl-player-stats'
        AND metric.metric_code='goals'`,
      [
        LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
        'Disposable exact official review fixture.',
        'local-workbook-evidence-reviewer',
        '2026-08-29T12:00:00.000Z',
      ]
    );

    for (const reviewSet of [
      {
        decisionId: `local-afl-tables-review:set:${LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256}`,
        evidenceSetSha256: LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
        reviewerId: 'local-five-season-evidence-reviewer',
        appearanceCount: 48_769,
        decisionCount: 146_307,
      },
      {
        decisionId: `local-official-afl-review:set:${LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256}`,
        evidenceSetSha256: LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
        reviewerId: 'local-workbook-evidence-reviewer',
        appearanceCount: 12,
        decisionCount: 36,
      },
    ]) {
      await fixtureClient.query(
        `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,canonical_record_type,
         canonical_record_id,supersedes_decision_id,rationale,evidence_json,
         decided_by,decided_at)
       VALUES ($1,'local_review_set',$2,'approved','local_review_set',$2,NULL,$3,
               jsonb_build_object(
                 'evidenceSetSha256',$2::text,'appearanceCount',$6::integer,
                 'decisionCount',$7::integer,'decisionIds',
                 CASE WHEN $6::integer=12 THEN (
                   SELECT jsonb_agg(decision_id ORDER BY decision_id)
                     FROM outcome_review_decision
                    WHERE evidence_json->>'evidenceSetSha256'=$2
                      AND subject_type<>'local_review_set'
                 ) ELSE NULL END
               ),$4,$5)`,
        [
          reviewSet.decisionId,
          reviewSet.evidenceSetSha256,
          'Explicit test-owned human reconciliation authority transition.',
          reviewSet.reviewerId,
          '2026-08-29T12:00:00.000Z',
          reviewSet.appearanceCount,
          reviewSet.decisionCount,
        ]
      );
    }
    await fixtureClient.query(`ANALYZE outcome_review_decision,
      outcome_provider_decoded_row,outcome_provider_identity_candidate,
      outcome_provider_match_candidate,outcome_provider_metric_candidate`);
    await fixtureClient.query('COMMIT');
  } catch (error) {
    await fixtureClient.query('ROLLBACK');
    throw error;
  } finally {
    fixtureClient.release();
  }
}

beforeAll(async () => {
  await pool.query(`DO $roles$ BEGIN
    BEGIN CREATE ROLE afl_trade_private_evaluation_coordinator NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN CREATE ROLE afl_trade_current_valuation_refresh_owner NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    GRANT afl_trade_private_evaluation_coordinator TO CURRENT_USER;
    GRANT afl_trade_current_valuation_refresh_owner TO CURRENT_USER;
  END $roles$`);
  await pool.query(`CREATE SCHEMA "${schemaName}"`);
  await pool.query(
    `GRANT USAGE,CREATE ON SCHEMA "${schemaName}"
       TO afl_trade_current_valuation_refresh_owner`
  );
  const canonicalFunction = readFileSync(
    join(
      process.cwd(),
      'prisma/afl-trade-outcomes/migrations/0037_valuation_publication_custody_index/migration.sql'
    ),
    'utf8'
  ).match(
    /CREATE FUNCTION "outcome_afl_trade_canonical_json"[\s\S]*?\$\$ LANGUAGE plpgsql IMMUTABLE STRICT;/
  )?.[0];
  if (canonicalFunction === undefined) {
    throw new Error('Canonical JSON SQL function was not found.');
  }
  await pool.query(canonicalFunction);
  await pool.query(`
    CREATE TABLE outcome_current_valuation_refresh_operation (
      operation_id text NOT NULL,scope_key text NOT NULL,trigger_kind text NOT NULL,
      stable_operation_key text PRIMARY KEY,result_json jsonb NOT NULL
    );
    CREATE TABLE outcome_current_valuation_factual_refresh_operation (
      operation_id text NOT NULL,scope_key text NOT NULL,trigger_kind text NOT NULL,
      stable_operation_key text PRIMARY KEY,result_json jsonb NOT NULL
    );
    CREATE TABLE outcome_private_reviewed_evaluation_head (
      valuation_scope_key text NOT NULL,evidence_scope_key text NOT NULL,
      status text NOT NULL,PRIMARY KEY (valuation_scope_key,evidence_scope_key)
    );
    CREATE TABLE outcome_artifact_custody (
      artifact_id text PRIMARY KEY,content_sha256 char(64) NOT NULL
    );
    CREATE TABLE outcome_source_capture (
      capture_id text PRIMARY KEY,provider text NOT NULL,capability_id text NOT NULL,
      anchor_season_year smallint NOT NULL,status text NOT NULL,environment text NOT NULL,
      source_artifact_id text NOT NULL,source_snapshot_id text NOT NULL,manifest_json jsonb NOT NULL
    );
    CREATE TABLE outcome_provider_normalization_run (
      normalization_run_id text PRIMARY KEY,capture_id text NOT NULL,
      field_map_id text NOT NULL,status text NOT NULL,finalized_at timestamptz
    );
  `);
  await pool.query(
    readFileSync(
      join(
        process.cwd(),
        'prisma/afl-trade-outcomes/migrations/0084_current_valuation_evidence_orchestration/migration.sql'
      ),
      'utf8'
    )
  );
  await adminPool.query(`CREATE SCHEMA "${governedSchemaName}"`);
  const governedDatabaseUrl = new URL(databaseUrl);
  governedDatabaseUrl.searchParams.set('schema', governedSchemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: governedDatabaseUrl.toString(),
  });
  governedArtifactRoot = await mkdtemp(join(tmpdir(), 'statly-current-valuation-evidence-e2e-'));
});

afterAll(async () => {
  await governedPool.end();
  await pool.query(`SET search_path TO public`);
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${governedSchemaName}" CASCADE`);
  await adminPool.end();
  await rm(governedArtifactRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await pool.query(`TRUNCATE outcome_current_valuation_evidence_orchestration_operation,
    outcome_current_valuation_evidence_orchestration_stage_receipt,
    outcome_current_valuation_evidence_normalization_claim,
    outcome_current_valuation_evidence_source_work,
    outcome_current_valuation_refresh_operation,
    outcome_current_valuation_factual_refresh_operation,
    outcome_private_reviewed_evaluation_head,
    outcome_provider_normalization_run,outcome_source_capture,outcome_artifact_custody`);
  for (const [index, source] of AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.entries()) {
    await pool.query(
      'INSERT INTO outcome_artifact_custody (artifact_id,content_sha256) VALUES ($1,$2)',
      [`artifact-${index}`, sourceContentSha256(index)]
    );
    await pool.query(
      `INSERT INTO outcome_source_capture
        (capture_id,provider,capability_id,anchor_season_year,status,environment,
         source_artifact_id,source_snapshot_id,manifest_json)
       VALUES ($1,$2,$3,$4,'staged','non_production',$5,$6,'{}'::jsonb)`,
      [
        sourceCaptureId(index),
        source.provider,
        source.capabilityId,
        source.seasonYear,
        `artifact-${index}`,
        `source-snapshot-${index}`,
      ]
    );
    await pool.query(
      `INSERT INTO outcome_provider_normalization_run
        (normalization_run_id,capture_id,field_map_id,status,finalized_at)
       VALUES ($1,$2,$3,'needs_review',statement_timestamp())`,
      [
        `provider-normalization-run:${String(index).padStart(64, '0')}`,
        sourceCaptureId(index),
        expectedFieldMapId(source),
      ]
    );
  }
});

describe('current valuation evidence orchestration PostgreSQL authority', () => {
  it('retains and exactly replays review-required under one stable operation identity', async () => {
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'weekly' as const,
      stableOperationKey: 'evidence-review-required',
    };
    for (const [index, source] of AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.entries()) {
      await retainTestSourceCustody({ request, source, index });
      await repository.retainNormalizedSource({
        request,
        state: 'ready',
        sourceKey: source.sourceKey,
        observedCaptureId: sourceCaptureId(index),
        effectiveCaptureId: sourceCaptureId(index),
        normalizationRunId: `provider-normalization-run:${String(index).padStart(64, '0')}`,
      });
    }

    const first = await repository.retainUnavailable(request, {
      stage: 'reviewed_authority',
      cause: 'review_required',
    });
    await expect(
      repository.retainUnavailable(request, {
        stage: 'reviewed_authority',
        cause: 'review_required',
      })
    ).resolves.toEqual(first);
    expect(first).toMatchObject({
      state: 'unavailable',
      stage: 'reviewed_authority',
      cause: 'review_required',
    });
    await expect(
      pool.query(
        `SELECT count(*)::integer AS count
           FROM outcome_current_valuation_evidence_orchestration_operation`
      )
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });

    await expect(
      repository.retainUnavailable(
        { ...request, scopeKey: 'afl-men:2025-trades' },
        { stage: 'reviewed_authority', cause: 'review_required' }
      )
    ).rejects.toThrow('conflicts with retained custody');
  });

  it('retains a non-review-required failure at the reviewed-authority boundary', async () => {
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'reviewed-authority-stale',
    };
    for (const [index, source] of AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.entries()) {
      await retainTestSourceCustody({ request, source, index });
      await repository.retainNormalizedSource({
        request,
        state: 'ready',
        sourceKey: source.sourceKey,
        observedCaptureId: sourceCaptureId(index),
        effectiveCaptureId: sourceCaptureId(index),
        normalizationRunId: `provider-normalization-run:${String(index).padStart(64, '0')}`,
      });
    }

    await expect(
      repository.retainUnavailable(request, {
        stage: 'reviewed_authority',
        cause: 'stale',
      })
    ).resolves.toMatchObject({
      state: 'unavailable',
      stage: 'reviewed_authority',
      cause: 'stale',
    });
  });

  it('cannot retain a reviewed-authority result before all seven source receipts', async () => {
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(
      createPgAflOutcomeSqlClient(pool)
    );

    await expect(
      repository.retainUnavailable(
        {
          scopeKey: 'afl-men:2026-trades',
          trigger: 'ad_hoc',
          stableOperationKey: 'review-boundary-without-sources',
        },
        { stage: 'reviewed_authority', cause: 'review_required' }
      )
    ).rejects.toThrow(/requires all seven source receipts/i);
  });

  it('durably resumes an exact operation after observation and before normalization', async () => {
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'restart-after-observed-capture',
    };
    const source = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES[0]!;

    await retainTestObservedCapture({ request, source, index: 0 });
    await retainTestObservedCapture({ request, source, index: 0 });

    await expect(
      pool.query('SELECT * FROM load_outcome_current_valuation_evidence_source_work($1,$2,$3,$4)', [
        request.scopeKey,
        request.trigger,
        request.stableOperationKey,
        source.sourceKey,
      ])
    ).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          observed_capture_id: sourceCaptureId(0),
          source_content_sha256: sourceContentSha256(0),
        }),
      ],
    });
    await expect(
      pool.query(
        `SELECT count(*)::integer AS count
           FROM outcome_current_valuation_evidence_source_work
          WHERE stable_operation_key=$1 AND source_key=$2`,
        [request.stableOperationKey, source.sourceKey]
      )
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      pool.query('SELECT * FROM load_outcome_current_valuation_evidence_source_work($1,$2,$3,$4)', [
        'afl-men:2025-trades',
        request.trigger,
        request.stableOperationKey,
        source.sourceKey,
      ])
    ).rejects.toThrow(/source work conflicts with retained custody/i);
  });

  it('keeps a fresh observation while reusing the exact historical normalization claim', async () => {
    const source = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES[0]!;
    const firstRequest = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'equivalent-source-first-dispatch',
    };
    await retainTestSourceCustody({ request: firstRequest, source, index: 0 });

    const observedCaptureId = `source-capture:${'8'.repeat(64)}`;
    await pool.query(
      'INSERT INTO outcome_artifact_custody (artifact_id,content_sha256) VALUES ($1,$2)',
      ['artifact-equivalent-observation', sourceContentSha256(0)]
    );
    await pool.query(
      `INSERT INTO outcome_source_capture
        (capture_id,provider,capability_id,anchor_season_year,status,environment,
         source_artifact_id,source_snapshot_id,manifest_json)
       VALUES ($1,$2,$3,$4,'staged','non_production',$5,$6,'{}'::jsonb)`,
      [
        observedCaptureId,
        source.provider,
        source.capabilityId,
        source.seasonYear,
        'artifact-equivalent-observation',
        'source-snapshot-equivalent-observation',
      ]
    );
    const nextRequest = {
      ...firstRequest,
      stableOperationKey: 'equivalent-source-next-dispatch',
    };
    await pool.query(
      'SELECT retain_outcome_current_valuation_evidence_observed_capture($1,$2,$3,$4,$5,$6,$7)',
      [
        nextRequest.scopeKey,
        nextRequest.trigger,
        nextRequest.stableOperationKey,
        source.sourceKey,
        observedCaptureId,
        sourceContentSha256(0),
        '8'.repeat(64),
      ]
    );
    const claim = await pool.query<{
      effective_capture_id: string;
      normalization_run_id: string;
    }>('SELECT * FROM load_outcome_current_valuation_evidence_normalization_claim($1,$2,$3)', [
      source.sourceKey,
      sourceContentSha256(0),
      '8'.repeat(64),
    ]);
    const effective = claim.rows[0]!;
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    await repository.retainNormalizedSource({
      request: nextRequest,
      state: 'ready',
      sourceKey: source.sourceKey,
      observedCaptureId,
      effectiveCaptureId: effective.effective_capture_id,
      normalizationRunId: effective.normalization_run_id,
    });

    await expect(
      pool.query(
        `SELECT observed_capture_id,effective_capture_id,normalization_run_id
           FROM outcome_current_valuation_evidence_orchestration_stage_receipt
          WHERE stable_operation_key=$1 AND source_key=$2`,
        [nextRequest.stableOperationKey, source.sourceKey]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          observed_capture_id: observedCaptureId,
          effective_capture_id: sourceCaptureId(0),
          normalization_run_id: `provider-normalization-run:${'0'.repeat(64)}`,
        },
      ],
    });
  });

  it('retains each normalized source stage and resumes without invoking captured work twice', async () => {
    const client = createPgAflOutcomeSqlClient(pool);
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(client);
    const calls: string[] = [];
    const coordinator = createAflTradeCurrentValuationEvidenceCoordinator({
      repository,
      source: {
        ensureCurrent: async (source, retainedRequest) => {
          calls.push(source.sourceKey);
          const index = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.indexOf(source);
          await retainTestSourceCustody({ request: retainedRequest, source, index });
          return {
            state: 'ready',
            sourceKey: source.sourceKey,
            observedCaptureId: sourceCaptureId(index),
            effectiveCaptureId: sourceCaptureId(index),
            normalizationRunId: `provider-normalization-run:${String(index).padStart(64, '0')}`,
          };
        },
      },
      reconciliationAuthority: { assessCurrent: async () => ({ state: 'ready' }) },
      reviewedAuthority: {
        assessCurrent: async () => ({
          state: 'unavailable',
          stage: 'reviewed_authority',
          cause: 'review_required',
        }),
      },
      factualRefresh: {
        refreshCurrent: async () => {
          throw new Error('Factual refresh must not run before human review.');
        },
      },
    });
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'weekly' as const,
      stableOperationKey: 'retained-normalized-sources',
    };

    const first = await coordinator.refreshCurrent(request);
    await expect(coordinator.refreshCurrent(request)).resolves.toEqual(first);

    expect(calls).toEqual(
      AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.map(({ sourceKey }) => sourceKey)
    );
    await expect(
      pool.query(
        `SELECT source_key,observed_capture_id,effective_capture_id,normalization_run_id
           FROM outcome_current_valuation_evidence_orchestration_stage_receipt
          WHERE stable_operation_key=$1 ORDER BY source_key`,
        [request.stableOperationKey]
      )
    ).resolves.toMatchObject({ rows: expect.arrayContaining(Array(7).fill(expect.anything())) });
  });

  it('rejects a finalized normalization retained under another field-map authority', async () => {
    const source = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES[0]!;
    await pool.query(
      `UPDATE outcome_provider_normalization_run SET field_map_id='unreviewed-field-map'
        WHERE normalization_run_id=$1`,
      [`provider-normalization-run:${'0'.repeat(64)}`]
    );
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'reject-wrong-field-map',
    };
    await retainTestObservedCapture({ request, source, index: 0 });

    await expect(
      repository.retainNormalizedSource({
        request,
        state: 'ready',
        sourceKey: source.sourceKey,
        observedCaptureId: sourceCaptureId(0),
        effectiveCaptureId: sourceCaptureId(0),
        normalizationRunId: `provider-normalization-run:${'0'.repeat(64)}`,
      })
    ).rejects.toThrow(/normalized source custody is missing or mismatched/i);
  });

  it('retains an authenticated private factual handoff after every source stage', async () => {
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'complete-private-factual-handoff',
    };
    for (const [index, source] of AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.entries()) {
      await retainTestSourceCustody({ request, source, index });
      await repository.retainNormalizedSource({
        request,
        state: 'ready',
        sourceKey: source.sourceKey,
        observedCaptureId: sourceCaptureId(index),
        effectiveCaptureId: sourceCaptureId(index),
        normalizationRunId: `provider-normalization-run:${String(index).padStart(64, '0')}`,
      });
    }
    const factualRefresh = {
      schemaVersion: 'afl-current-valuation-refresh-result-v2' as const,
      operationId: `current-valuation-factual-refresh-operation:${'d'.repeat(64)}`,
      scopeKey: request.scopeKey,
      trigger: request.trigger,
      stableOperationKey: createAflTradeCurrentValuationEvidenceFactualHandoffKey(request),
      state: 'factual_refresh_complete' as const,
      factualStage: 'advanced' as const,
      privateFactualAuthority: {
        valuationScopeKey: request.scopeKey,
        candidateId: `private-factual-candidate:${'e'.repeat(64)}`,
        evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
        evidenceBundleId: `private-reviewed-evidence-bundle:${'f'.repeat(64)}`,
        reviewDecisionId: `private-reviewed-evidence-evaluation-decision:${'1'.repeat(64)}`,
        normalizedReconciledCustodySha256: '2'.repeat(64),
        revision: 1,
      },
      capturedAt: '2026-08-29T12:00:00.000Z',
      completedAt: '2026-08-29T12:00:01.000Z',
      executionLocation: 'local' as const,
      visibility: 'private' as const,
      environment: 'non_production' as const,
      publicationEligible: false as const,
      publicationProhibited: true as const,
      limitation:
        'Private local non-production factual refresh authority only; no public release, registry, production, activation, or publication authority is granted.' as const,
    };
    await pool.query(
      `INSERT INTO outcome_current_valuation_factual_refresh_operation
        (operation_id,scope_key,trigger_kind,stable_operation_key,result_json)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        factualRefresh.operationId,
        factualRefresh.scopeKey,
        factualRefresh.trigger,
        factualRefresh.stableOperationKey,
        factualRefresh,
      ]
    );

    const first = await repository.retainComplete(request, factualRefresh);
    await expect(repository.retainComplete(request, factualRefresh)).resolves.toEqual(first);
    expect(first).toMatchObject({
      state: 'complete',
      stage: 'private_factual_authority',
      currentValuationRefresh: factualRefresh,
      publicationEligible: false,
      publicationProhibited: true,
    });
  });

  it('crosses all seven governed lanes through the unchanged reviewed-evidence guard', async () => {
    const client = createPgAflOutcomeSqlClient(governedPool);
    const capturedSourceKeys: string[] = [];
    const source = await createGovernedCurrentValuationEvidenceSourceFixture({
      client,
      artifactRoot: governedArtifactRoot,
      capturedSourceKeys,
    });
    const publicAuthorityBefore = await governedPool.query<{
      active_releases: number;
      registry_events: number;
    }>(
      `SELECT
          (SELECT count(*)::integer FROM outcome_active_release) AS active_releases,
          (SELECT count(*)::integer FROM outcome_registry_event) AS registry_events`
    );
    const coordinator = createAflTradeCurrentValuationEvidenceCoordinator({
      repository: new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(client),
      source,
      reconciliationAuthority: createLocalAflTradeCurrentValuationReconciliationAuthority(client),
      reviewedAuthority: {
        assessCurrent: async () => {
          throw new Error('Reviewed authority must not run before reconciliation review.');
        },
      },
      factualRefresh: {
        refreshCurrent: async () => {
          throw new Error('Factual refresh must not run before reconciliation review.');
        },
      },
    });
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'governed-provider-evidence-e2e',
    };

    const first = await coordinator.refreshCurrent(request);
    await expect(coordinator.refreshCurrent(request)).resolves.toEqual(first);

    expect(first).toMatchObject({
      state: 'unavailable',
      stage: 'reconciliation_authority',
      cause: 'missing',
      publicationEligible: false,
      publicationProhibited: true,
    });

    await seedCurrentReviewSetAuthority();
    await client.transaction((transaction) =>
      loadExactLocalReviewedProviderEvidenceBundle(
        transaction,
        '2026-08-30T08:00:00.000Z',
        request.stableOperationKey
      )
    );
    const health = await governedPool.query<{
      historical_candidates: number;
      historical_reviews: number;
      official_reviews: number;
      official_expected: number;
      historical_identity: number;
      historical_match: number;
      historical_facts: number;
      official_identity: number;
      official_match: number;
      official_facts: number;
      capture_count: number;
    }>(
      `SELECT
         (SELECT count(*)::integer
            FROM outcome_provider_decoded_row decoded
            JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
            JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
            JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
           WHERE capture.provider='afl_tables'
             AND capture.capability_id='afl-tables-player-stats'
             AND identity.native_entity_id IS NOT NULL AND metric.metric_code='goals')
           AS historical_candidates,
         (SELECT count(*)::integer FROM outcome_review_decision
           WHERE evidence_json->>'evidenceSetSha256'=$1
             AND subject_type<>'local_review_set') AS historical_reviews,
         (SELECT count(*)::integer FROM outcome_review_decision
           WHERE evidence_json->>'evidenceSetSha256'=$2
             AND subject_type<>'local_review_set') AS official_reviews,
         (SELECT jsonb_array_length(evidence_json->'decisionIds')
            FROM outcome_review_decision WHERE decision_id=$3) AS official_expected,
         count(*) FILTER (WHERE evidence_json->>'evidenceSetSha256'=$1
           AND subject_type='provider_identity_candidate')::integer AS historical_identity,
         count(*) FILTER (WHERE evidence_json->>'evidenceSetSha256'=$1
           AND subject_type='provider_match_candidate')::integer AS historical_match,
         count(*) FILTER (WHERE evidence_json->>'evidenceSetSha256'=$1
           AND subject_type='local_reconciled_player_match_fact')::integer AS historical_facts,
         count(*) FILTER (WHERE evidence_json->>'evidenceSetSha256'=$2
           AND subject_type='provider_identity_candidate')::integer AS official_identity,
         count(*) FILTER (WHERE evidence_json->>'evidenceSetSha256'=$2
           AND subject_type='provider_match_candidate')::integer AS official_match,
         count(*) FILTER (WHERE evidence_json->>'evidenceSetSha256'=$2
           AND subject_type='local_reconciled_player_match_fact')::integer AS official_facts,
         (SELECT count(*)::integer FROM outcome_source_capture capture
            JOIN outcome_provider_normalization_run run ON run.capture_id=capture.capture_id
           WHERE run.finalized_at IS NOT NULL
             AND ((capture.provider='afl_tables'
               AND capture.capability_id='afl-tables-player-stats'
               AND capture.anchor_season_year BETWEEN 2021 AND 2025)
              OR (capture.provider='official_afl'
               AND capture.capability_id='official-afl-player-stats'
               AND capture.anchor_season_year=2026)
              OR (capture.provider='afl_tables'
               AND capture.capability_id='afl-tables-results'
               AND capture.anchor_season_year=2026))) AS capture_count
        FROM outcome_review_decision`,
      [
        LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
        LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
        `local-official-afl-review:set:${LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256}`,
      ]
    );
    expect(health.rows).toEqual([
      {
        historical_candidates: 48_769,
        historical_reviews: 146_307,
        official_reviews: 36,
        official_expected: 36,
        historical_identity: 48_769,
        historical_match: 48_769,
        historical_facts: 48_769,
        official_identity: 12,
        official_match: 12,
        official_facts: 12,
        capture_count: 7,
      },
    ]);
    await expect(
      governedPool.query<{ current: boolean }>(
        `SELECT outcome_private_reviewed_evidence_is_current() AS current`
      )
    ).resolves.toMatchObject({ rows: [{ current: true }] });
    const reviewedAuthority = new PostgresAflTradePrivateReviewedEvidenceEvaluationAuthority(
      client
    );
    const reconciliationAuthority =
      createLocalAflTradeCurrentValuationReconciliationAuthority(client);
    const resumedCoordinator = createAflTradeCurrentValuationEvidenceCoordinator({
      repository: new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(client),
      source,
      reconciliationAuthority,
      reviewedAuthority: {
        assessCurrent: async ({ valuationScopeKey, stableOperationKey }) => {
          const assessment = await reviewedAuthority.assessCurrent({
            valuationScopeKey,
            stableOperationKey,
          });
          return assessment.state === 'authorized'
            ? { state: 'ready' as const }
            : {
                state: 'unavailable' as const,
                stage: 'reviewed_authority' as const,
                cause: 'review_required' as const,
              };
        },
      },
      factualRefresh: createAflTradeCurrentValuationRefresh({ client }),
    });
    const awaitingReviewedAuthority = await resumedCoordinator.refreshCurrent({
      ...request,
      stableOperationKey: 'governed-provider-evidence-e2e-awaiting-reviewed-authority',
    });
    expect(awaitingReviewedAuthority).toMatchObject({
      state: 'unavailable',
      stage: 'reviewed_authority',
      cause: 'review_required',
    });

    const decisionInput = {
      status: 'authorized' as const,
      valuationScopeKey: request.scopeKey,
      expectedCurrentDecisionId: null,
      reviewerId: 'current-valuation-e2e-human-reviewer',
      rationale:
        'Explicitly authorize the exact newly captured fixture bundle for private factual evaluation.',
    };
    const reviewedDecision = await reviewedAuthority.recordDecision(decisionInput);
    const completed = await resumedCoordinator.refreshCurrent({
      ...request,
      stableOperationKey: 'governed-provider-evidence-e2e-reviewed',
    });
    await expect(
      resumedCoordinator.refreshCurrent({
        ...request,
        stableOperationKey: 'governed-provider-evidence-e2e-reviewed',
      })
    ).resolves.toEqual(completed);
    expect(completed).toMatchObject({
      state: 'complete',
      stage: 'private_factual_authority',
      currentValuationRefresh: { state: 'factual_refresh_complete', factualStage: 'advanced' },
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(completed).toMatchObject({
      currentValuationRefresh: {
        privateFactualAuthority: {
          evidenceBundleId: reviewedDecision.content.evidenceBundleId,
          reviewDecisionId: reviewedDecision.decisionId,
        },
      },
    });
    expect(capturedSourceKeys).toEqual(
      Array.from({ length: 3 }, () =>
        AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.map(({ sourceKey }) => sourceKey)
      ).flat()
    );
    await expect(
      governedPool.query(
        `SELECT
            (SELECT count(*)::integer FROM outcome_source_capture) AS captures,
            (SELECT count(*)::integer FROM outcome_provider_normalization_run
              WHERE finalized_at IS NOT NULL) AS normalizations,
            (SELECT count(*)::integer
               FROM outcome_current_valuation_evidence_orchestration_stage_receipt) AS receipts`
      )
    ).resolves.toMatchObject({
      rows: [{ captures: 21, normalizations: 7, receipts: 21 }],
    });
    await expect(
      governedPool.query(
        `SELECT reviewed.decision_id,reviewed.evidence_bundle_id,
                factual.revision AS factual_revision
           FROM outcome_private_reviewed_evaluation_head reviewed
           JOIN outcome_current_private_factual_authority factual
             ON factual.valuation_scope_key=reviewed.valuation_scope_key
          WHERE reviewed.valuation_scope_key=$1`,
        [request.scopeKey]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          decision_id: reviewedDecision.decisionId,
          evidence_bundle_id: reviewedDecision.content.evidenceBundleId,
          factual_revision: 1,
        },
      ],
    });
    await expect(
      governedPool.query(
        `SELECT
            (SELECT count(*)::integer FROM outcome_active_release) AS active_releases,
            (SELECT count(*)::integer FROM outcome_registry_event) AS registry_events`
      )
    ).resolves.toEqual(publicAuthorityBefore);

    const loserCaptureId = `source-capture:${'e'.repeat(64)}`;
    const loserAttemptId = `source-capture-attempt:${'e'.repeat(64)}`;
    const loserSnapshotId = `source-snapshot:${'e'.repeat(64)}`;
    const loserNormalizationRunId = `provider-normalization-run:${'e'.repeat(64)}`;
    const winner = await governedPool.query<{
      capture_id: string;
      attempt_id: string;
      normalization_run_id: string;
      source_key: string;
      source_content_sha256: string;
      authority_sha256: string;
    }>(
      `SELECT capture.capture_id,capture.attempt_id,run.normalization_run_id,
              claim.source_key,claim.source_content_sha256,claim.authority_sha256
         FROM outcome_current_valuation_evidence_normalization_claim claim
         JOIN outcome_source_capture capture ON capture.capture_id=claim.effective_capture_id
         JOIN outcome_provider_normalization_run run
           ON run.normalization_run_id=claim.normalization_run_id
        ORDER BY claim.source_key LIMIT 1`
    );
    const winnerRow = winner.rows[0]!;
    await governedPool.query(
      `INSERT INTO outcome_source_capture_attempt
        (attempt_id,environment,provider,dataset,capability_id,evidence_artifact_id,status,
         started_at,completed_at,attempt_json)
       SELECT $1,environment,provider,dataset,capability_id,evidence_artifact_id,status,
              started_at,completed_at,attempt_json
         FROM outcome_source_capture_attempt WHERE attempt_id=$2`,
      [loserAttemptId, winnerRow.attempt_id]
    );
    await governedPool.query(
      `INSERT INTO outcome_source_capture
        (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
         dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
         captured_at,status,manifest_json)
       SELECT $1,$2,$3,source_artifact_id,environment,provider,dataset,dataset_version,
              access_mechanism,capability_id,competition,anchor_season_year,effective_at,
              captured_at,status,manifest_json
         FROM outcome_source_capture WHERE capture_id=$4`,
      [loserCaptureId, loserAttemptId, loserSnapshotId, winnerRow.capture_id]
    );
    await client.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO outcome_provider_normalization_run
          (normalization_run_id,capture_id,field_map_id,decoder_version,normalizer_version,
           source_rds_sha256,decoded_sha256,receipt_sha256,staging_sha256,status,source_row_count,
           accepted_row_count,quarantined_row_count,issue_count,identity_candidate_count,
           match_candidate_count,metric_candidate_count,achievement_candidate_count,started_at,
           completed_at,finalized_at,receipt_json)
         SELECT $1,$2,field_map_id,decoder_version,normalizer_version,source_rds_sha256,
                decoded_sha256,receipt_sha256,staging_sha256,status,0,0,0,0,0,0,0,0,
                started_at,completed_at,NULL,
                receipt_json ||
                  '{"sourceRowCount":0,"acceptedRowCount":0,"quarantinedRowCount":0,"issueCount":0}'::jsonb
           FROM outcome_provider_normalization_run WHERE normalization_run_id=$3`,
        [loserNormalizationRunId, loserCaptureId, winnerRow.normalization_run_id]
      );
      await transaction.query(
        `UPDATE outcome_provider_normalization_run
            SET finalized_at=completed_at
          WHERE normalization_run_id=$1`,
        [loserNormalizationRunId]
      );
      await transaction.query(
        `INSERT INTO outcome_current_valuation_evidence_normalization_claim
          (source_key,source_content_sha256,authority_sha256,effective_capture_id,
           normalization_run_id,claimed_at)
         VALUES ($1,$2,$3,$4,$5,statement_timestamp())`,
        [
          winnerRow.source_key,
          winnerRow.source_content_sha256,
          winnerRow.authority_sha256 === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64),
          loserCaptureId,
          loserNormalizationRunId,
        ]
      );
    });
    const claimedBundle = await client.transaction(async (transaction) => {
      const healthBypass: AflOutcomeSqlTransaction = {
        query: async <Row = Record<string, unknown>>(
          sql: string,
          parameters?: readonly unknown[]
        ) => {
          if (sql.includes('WITH candidates AS MATERIALIZED')) {
            return {
              rows: [
                {
                  candidate_count: 48_769,
                  identity_count: 48_769,
                  match_count: 48_769,
                  factual_count: 48_769,
                } as unknown as Row,
              ],
              rowCount: 1,
            };
          }
          if (sql.includes('WITH marker AS MATERIALIZED')) {
            return {
              rows: [
                {
                  expected_count: 36,
                  approved_count: 36,
                  identity_count: 12,
                  match_count: 12,
                  factual_count: 12,
                  candidate_count: 12,
                } as unknown as Row,
              ],
              rowCount: 1,
            };
          }
          return transaction.query<Row>(sql, parameters);
        },
      };
      return loadExactLocalReviewedProviderEvidenceBundle(
        healthBypass,
        '2026-08-30T08:00:00.000Z',
        'governed-provider-evidence-e2e-reviewed'
      );
    });
    expect(claimedBundle.content.sourceCaptures).toHaveLength(7);
    expect(claimedBundle.content.sourceCaptures).not.toContainEqual(
      expect.objectContaining({ captureId: loserCaptureId })
    );
  }, 180_000);
});
