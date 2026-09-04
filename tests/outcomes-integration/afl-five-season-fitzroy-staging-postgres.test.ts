import { createHash } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW,
  assertLocalAflTradeFiveSeasonPostgresStagingCoverage,
  type LocalAflTradeFiveSeasonStagedCapture,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonFitzRoyOutcomeLoad';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_five_season_fitzroy_staging_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 2,
});

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function seedFinalizedSeason(
  client: PoolClient,
  season: number
): Promise<LocalAflTradeFiveSeasonStagedCapture> {
  const recordedAt = new Date(Date.UTC(2026, 7, 14, 0, 0, season - 2022));
  const rawSha256 = digest(`raw:${season}`);
  const captureSha256 = digest(`capture:${season}`);
  const captureId = `source-capture:${captureSha256}`;
  const normalizationSha256 = digest(`normalization:${season}`);
  const normalizationRunId = `provider-normalization-run:${normalizationSha256}`;
  const fieldMapSha256 = digest(`field-map:${season}`);
  const fieldMapId = `provider-field-map:${fieldMapSha256}`;
  const approvalDecisionId = `review-decision:${digest(`field-map-approval:${season}`)}`;
  const attemptId = `source-capture-attempt:${digest(`attempt:${season}`)}`;
  const artifactId = `artifact:${rawSha256}`;

  await client.query(
    `INSERT INTO outcome_competition_season
       (competition,season_year,starts_on,ends_on)
     VALUES ('AFLM',$1,$2::date,$3::date)`,
    [season, `${season}-01-01`, `${season}-12-31`]
  );
  await client.query(
    `INSERT INTO outcome_artifact_custody
       (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
        environment,custody_profile_id,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,'application/x-r-rds',1,'raw_source','non_production',$4,$5,$5,$6::jsonb)`,
    [
      artifactId,
      rawSha256,
      `artifact://sha256/${rawSha256}`,
      `artifact-custody-profile:${digest('local-five-season-custody')}`,
      recordedAt,
      JSON.stringify({ repositoryAssurance: 'local_non_production_filesystem' }),
    ]
  );
  await client.query(
    `INSERT INTO outcome_source_capture_attempt
       (attempt_id,environment,provider,dataset,capability_id,evidence_artifact_id,status,
        started_at,completed_at,attempt_json)
     VALUES ($1,'non_production','afl_tables','player_stats','afl-tables-player-stats',NULL,
             'captured',$2,$2,$3::jsonb)`,
    [attemptId, recordedAt, JSON.stringify({ authorizationSeason: season })]
  );
  await client.query(
    `INSERT INTO outcome_source_capture
       (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
        dataset_version,access_mechanism,capability_id,competition,anchor_season_year,effective_at,
        captured_at,status,manifest_json)
     VALUES ($1,$2,$3,$4,'non_production','afl_tables','player_stats',$5,'fitzRoy',
             'afl-tables-player-stats','AFLM',$6,$7,$7,'approved',$8::jsonb)`,
    [
      captureId,
      attemptId,
      `source-snapshot:${captureSha256}`,
      artifactId,
      String(season),
      season,
      recordedAt,
      JSON.stringify({
        capture: { packageVersion: '1.7.0' },
        authorizationSeason: season,
      }),
    ]
  );
  await client.query(
    `INSERT INTO outcome_review_decision
       (decision_id,subject_type,subject_id,decision,canonical_record_type,canonical_record_id,
        supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,'provider_field_map',$2,'approved',NULL,NULL,NULL,$3,$4::jsonb,
             'local-five-season-rehearsal',$5)`,
    [
      approvalDecisionId,
      fieldMapId,
      `Approve exact AFL Tables ${season} rehearsal map.`,
      JSON.stringify({ fieldMapSha256 }),
      recordedAt,
    ]
  );
  await client.query(
    `INSERT INTO outcome_provider_field_map
       (field_map_id,capability_id,fitzroy_version,source_schema_sha256,field_map_sha256,
        approval_decision_id,approved_at,map_json)
     VALUES ($1,'afl-tables-player-stats','1.7.0',$2,$3,$4,$5,$6::jsonb)`,
    [
      fieldMapId,
      digest(`source-schema:${season}`),
      fieldMapSha256,
      approvalDecisionId,
      recordedAt,
      JSON.stringify({
        mapId: fieldMapId,
        capabilityId: 'afl-tables-player-stats',
        fitzRoyVersion: '1.7.0',
        sourceSchemaSha256: digest(`source-schema:${season}`),
        approvalDecisionId,
        approvedAt: recordedAt.toISOString(),
      }),
    ]
  );
  await client.query(
    `INSERT INTO outcome_provider_normalization_run
       (normalization_run_id,capture_id,field_map_id,decoder_version,normalizer_version,
        source_rds_sha256,decoded_sha256,receipt_sha256,staging_sha256,status,
        source_row_count,accepted_row_count,quarantined_row_count,issue_count,
        identity_candidate_count,match_candidate_count,metric_candidate_count,
        achievement_candidate_count,started_at,completed_at,finalized_at,receipt_json)
     VALUES ($1,$2,$3,'local-docker-rds-decoder-v1','afl-tables-normalizer-v1',
             $4,$5,$6,$7,'needs_review',1,0,1,1,0,0,0,0,$8,$8,NULL,$9::jsonb)`,
    [
      normalizationRunId,
      captureId,
      fieldMapId,
      rawSha256,
      digest(`decoded:${season}`),
      digest(`receipt:${season}`),
      digest(`staging:${season}`),
      recordedAt,
      JSON.stringify({
        normalizerVersion: 'afl-tables-normalizer-v1',
        decodedSha256: digest(`decoded:${season}`),
        sourceRdsSha256: rawSha256,
        sourceRowCount: 1,
        acceptedRowCount: 0,
        quarantinedRowCount: 1,
        issueCount: 1,
      }),
    ]
  );
  await client.query(
    `INSERT INTO outcome_provider_decoded_row
       (provider_decoded_row_id,normalization_run_id,capture_id,competition,season_year,
        source_row_number,source_row_sha256,row_status,typed_payload,recorded_at)
     VALUES ($1,$2,$3,'AFLM',$4,1,$5,'needs_review',$6::jsonb,$7)`,
    [
      `provider-decoded-row:${digest(`row:${season}`)}`,
      normalizationRunId,
      captureId,
      season,
      digest(`source-row:${season}`),
      JSON.stringify({ Season: season }),
      recordedAt,
    ]
  );
  await client.query(
    `INSERT INTO outcome_provider_normalization_issue
       (issue_id,normalization_run_id,source_row_number,issue_code,source_field,
        details_json,detected_at)
     VALUES ($1,$2,1,'fixture-review-required',NULL,$3::jsonb,$4)`,
    [
      `provider-normalization-issue:${digest(`issue:${season}`)}`,
      normalizationRunId,
      JSON.stringify({ season }),
      recordedAt,
    ]
  );
  await client.query(
    `UPDATE outcome_provider_normalization_run SET finalized_at=completed_at
      WHERE normalization_run_id=$1`,
    [normalizationRunId]
  );

  return {
    authorizationSeason: season,
    observedSeasonValues: [String(season)],
    captureId,
    normalizationRunId,
  };
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
});

afterAll(async () => {
  const failures: unknown[] = [];
  try {
    await outcomesPool.end();
  } catch (error) {
    failures.push(error);
  }
  try {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await adminPool.end();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'The five-season staging PostgreSQL cleanup failed.');
  }
});

describe('five-season AFL Tables PostgreSQL staging coverage', () => {
  it('requires one exact finalized normalization run for every season from 2021 through 2025', async () => {
    const client = await outcomesPool.connect();
    let captures: LocalAflTradeFiveSeasonStagedCapture[];
    try {
      await client.query('BEGIN');
      captures = [];
      for (const season of LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW) {
        captures.push(await seedFinalizedSeason(client, season));
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await expect(
      assertLocalAflTradeFiveSeasonPostgresStagingCoverage(
        createPgAflOutcomeSqlClient(outcomesPool),
        captures
      )
    ).resolves.toEqual({
      seasons: LOCAL_AFL_TRADE_FIVE_SEASON_WINDOW,
      captureCount: 5,
      rowCount: 5,
    });
  });
});
