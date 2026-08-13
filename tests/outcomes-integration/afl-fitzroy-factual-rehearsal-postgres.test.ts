import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runLocalAflTradeFitzRoyFactualRehearsal } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const unreviewedSchemaName = `afl_fitzroy_unreviewed_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const unreviewedPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${unreviewedSchemaName}`,
  max: 1,
});

function scopedDatabaseUrl(schema = schemaName): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schema);
  return scoped.toString();
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  await adminPool.query(`CREATE SCHEMA "${unreviewedSchemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: scopedDatabaseUrl(unreviewedSchemaName),
  });
});

afterAll(async () => {
  const failures: unknown[] = [];
  for (const pool of [outcomesPool, unreviewedPool]) {
    try {
      await pool.end();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    for (const disposableSchema of [schemaName, unreviewedSchemaName]) {
      try {
        await adminPool.query(`DROP SCHEMA IF EXISTS "${disposableSchema}" CASCADE`);
      } catch (error) {
        failures.push(error);
      }
    }
  } finally {
    try {
      await adminPool.end();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'The factual rehearsal PostgreSQL cleanup failed.');
  }
});

describe('source-independent non-production fitzRoy factual rehearsal', () => {
  it('rejects an unreviewed schema before durable rehearsal mutation', async () => {
    const client = createPgAflOutcomeSqlClient(unreviewedPool);

    await expect(runLocalAflTradeFitzRoyFactualRehearsal(client)).rejects.toThrow(
      /named disposable PostgreSQL database and schema/i
    );
    const stored = await unreviewedPool.query<{ competitions: string }>(
      `SELECT count(*)::text AS competitions FROM outcome_competition_season`
    );
    expect(stored.rows[0]?.competitions).toBe('0');
  });

  it('captures, stages, reconciles, constructs, and exactly replays one private candidate', async () => {
    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const result = await runLocalAflTradeFitzRoyFactualRehearsal(client);

    expect(result).toMatchObject({
      environment: 'non_production',
      publicationEligible: false,
      counts: {
        sourceRows: 1,
        sourceIssues: 0,
        factualRuns: 1,
        candidates: 1,
      },
    });
    expect(result.captureId).toMatch(/^source-capture:/);
    expect(result.normalizationRunId).toMatch(/^provider-normalization-run:/);
    expect(result.factBatchId).toMatch(/^source-fact-batch:/);
    expect(result.factualRunId).toMatch(/^factual-reconciliation-run:/);
    expect(result.candidateId).toMatch(/^factual-release-candidate:/);
    expect(result.idempotentReplay).toBe(false);
    const replay = await runLocalAflTradeFitzRoyFactualRehearsal(client);

    expect(replay.idempotentReplay).toBe(true);
    expect(replay).toMatchObject({
      captureId: result.captureId,
      normalizationRunId: result.normalizationRunId,
      factBatchId: result.factBatchId,
      factualRunId: result.factualRunId,
      candidateId: result.candidateId,
    });
  });

  it('rejects changed decoded evidence under the same capture and field-map identity', async () => {
    const client = createPgAflOutcomeSqlClient(outcomesPool);

    await expect(runLocalAflTradeFitzRoyFactualRehearsal(client, { goals: '3' })).rejects.toThrow(
      /normalized staging failed closed/i
    );

    const stored = await outcomesPool.query<{ runs: string }>(
      `SELECT count(*)::text AS runs FROM outcome_provider_normalization_run`
    );
    expect(stored.rows[0]?.runs).toBe('1');
  });

  it('records exact player, club-side, and provider-native match reviews before fact promotion', async () => {
    const reviewed = await outcomesPool.query<{
      player_id: string | null;
      club_ids: string[] | null;
      match_id: string | null;
      match_outcome: string | null;
      player_revision: number | null;
      match_revision: number | null;
    }>(
      `SELECT
        (SELECT player_id FROM outcome_provider_player_resolution
          WHERE outcome='approved' ORDER BY revision DESC LIMIT 1) AS player_id,
        (SELECT array_agg(DISTINCT club_id ORDER BY club_id)
           FROM outcome_provider_club_resolution WHERE outcome='approved') AS club_ids,
        (SELECT match_id FROM outcome_provider_match_resolution
          WHERE outcome='approved' ORDER BY revision DESC LIMIT 1) AS match_id,
        (SELECT outcome::text FROM outcome_provider_match_resolution
          ORDER BY revision DESC LIMIT 1) AS match_outcome,
        (SELECT max(revision) FROM outcome_provider_player_resolution) AS player_revision,
        (SELECT max(revision) FROM outcome_provider_match_resolution) AS match_revision`
    );

    expect(reviewed.rows[0]).toEqual({
      player_id: 'afl-player:local-rehearsal',
      club_ids: ['afl-club:local-rehearsal', 'afl-club:local-rehearsal-away'],
      match_id: 'afl-match:local-rehearsal-2026-r1',
      match_outcome: 'approved',
      player_revision: 1,
      match_revision: 1,
    });
  });

  it('conserves the admitted row and leaves every publication authority untouched', async () => {
    const stored = await outcomesPool.query<{
      captures: string;
      normalization_runs: string;
      decoded_rows: string;
      normalization_issues: string;
      failed_attempts: string;
      player_resolutions: string;
      club_resolutions: string;
      match_resolutions: string;
      fact_batches: string;
      match_universe_facts: string;
      player_appearance_facts: string;
      metric_facts: string;
      factual_runs: string;
      reconciled_metrics: string;
      factual_candidates: string;
      release_manifests: string;
      registry_revision: number;
      registry_events: string;
    }>(
      `SELECT
        (SELECT count(*)::text FROM outcome_source_capture) AS captures,
        (SELECT count(*)::text FROM outcome_provider_normalization_run) AS normalization_runs,
        (SELECT count(*)::text FROM outcome_provider_decoded_row) AS decoded_rows,
        (SELECT count(*)::text FROM outcome_provider_normalization_issue) AS normalization_issues,
        (SELECT count(*)::text FROM outcome_provider_normalization_attempt) AS failed_attempts,
        (SELECT count(*)::text FROM outcome_provider_player_resolution) AS player_resolutions,
        (SELECT count(*)::text FROM outcome_provider_club_resolution) AS club_resolutions,
        (SELECT count(*)::text FROM outcome_provider_match_resolution) AS match_resolutions,
        (SELECT count(*)::text FROM outcome_provider_fact_batch) AS fact_batches,
        (SELECT count(*)::text FROM outcome_provider_match_universe_fact) AS match_universe_facts,
        (SELECT count(*)::text FROM outcome_provider_player_appearance_fact) AS player_appearance_facts,
        (SELECT count(*)::text FROM outcome_provider_numeric_metric_fact) AS metric_facts,
        (SELECT count(*)::text FROM outcome_factual_reconciliation_run) AS factual_runs,
        (SELECT count(*)::text FROM outcome_reconciled_factual_metric) AS reconciled_metrics,
        (SELECT count(*)::text FROM outcome_factual_release_candidate) AS factual_candidates,
        (SELECT count(*)::text FROM outcome_release_manifest) AS release_manifests,
        (SELECT revision FROM outcome_registry_head WHERE singleton_id=1) AS registry_revision,
        (SELECT count(*)::text FROM outcome_registry_event) AS registry_events`
    );

    expect(stored.rows[0]).toEqual({
      captures: '1',
      normalization_runs: '1',
      decoded_rows: '1',
      normalization_issues: '0',
      failed_attempts: '1',
      player_resolutions: '1',
      club_resolutions: '3',
      match_resolutions: '1',
      fact_batches: '1',
      match_universe_facts: '1',
      player_appearance_facts: '1',
      metric_facts: '1',
      factual_runs: '1',
      reconciled_metrics: '2',
      factual_candidates: '0',
      release_manifests: '0',
      registry_revision: 0,
      registry_events: '0',
    });
  });
});
