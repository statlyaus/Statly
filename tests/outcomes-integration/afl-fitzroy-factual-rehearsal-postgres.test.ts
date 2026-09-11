import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runLocalAflTradeFitzRoyFactualRehearsal } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeFactualReconciliationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresFactualReconciliationRepository';
import {
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradeFactualReconciliationRunSchema } from '@/server/aflTradeIntelligence/outcomes/factualReconciliationContracts';
import { reconcileAflTradeFactualFacts } from '@/server/aflTradeIntelligence/outcomes/factualReconciliationService';
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

// Exercise SQL storage guards with an unfinalized rollback-only receipt. This is
// not a domain-valid factual run and cannot pass child/finalization validation.
async function withStagedReceipt(
  bytes: number,
  work: (connection: PoolClient, id: string) => Promise<void>,
  invalid: 'neither' | 'both' | 'checksum' | null = null
) {
  const connection = await outcomesPool.connect();
  const id = `factual-reconciliation-run:${'a'.repeat(64)}`;
  try {
    await connection.query('BEGIN');
    await connection.query(
      `WITH receipt AS MATERIALIZED (SELECT '{"payload":"'||repeat('x',$1)||'"}' AS bytes)
       INSERT INTO outcome_factual_reconciliation_run
         (factual_run_id,policy_id,environment,competition,season_year,algorithm_version,
          input_set_sha256,output_set_sha256,run_sha256,status,source_fact_count,
          reconciled_fact_count,conflict_count,started_at,receipt_json,
          receipt_canonical_json,receipt_canonical_sha256)
       SELECT $2,policy_id,environment,competition,season_year,algorithm_version,
              repeat('a',64),output_set_sha256,repeat('a',64),'staged',source_fact_count,
              reconciled_fact_count,conflict_count,started_at,
              CASE WHEN $3='both' THEN '{}'::jsonb ELSE NULL END,
              CASE WHEN $3='neither' THEN NULL ELSE receipt.bytes END,
              CASE WHEN $3='neither' THEN NULL WHEN $3='checksum' THEN repeat('0',64)
                   ELSE encode(sha256(convert_to(receipt.bytes,'UTF8')),'hex') END
         FROM outcome_factual_reconciliation_run CROSS JOIN receipt LIMIT 1`,
      [bytes, id, invalid]
    );
    await work(connection, id);
  } finally {
    await connection.query('ROLLBACK');
    connection.release();
  }
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
    const retained = await outcomesPool.query<{
      receipt_json: unknown;
      receipt_canonical_json: string;
      receipt_canonical_sha256: string;
    }>(
      `SELECT receipt_json,receipt_canonical_json,receipt_canonical_sha256
         FROM outcome_factual_reconciliation_run WHERE factual_run_id=$1`,
      [result.factualRunId]
    );
    const receipt = retained.rows[0]!;
    expect(receipt.receipt_json).toBeNull();
    const run = JSON.parse(receipt.receipt_canonical_json);
    expect(receipt.receipt_canonical_json).toBe(canonicalizeAflTradeJson(run));
    expect(receipt.receipt_canonical_sha256).toBe(
      createHash('sha256').update(receipt.receipt_canonical_json).digest('hex')
    );
    expect(
      await new PostgresAflTradeFactualReconciliationRepository(client).persistRun(run, {
        environment: 'non_production',
      })
    ).toMatchObject({ factualRunId: result.factualRunId, idempotentReplay: true });
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

  it('replays a finalized legacy JSONB run with authentic normalized input membership', async () => {
    const connection = await outcomesPool.connect();
    try {
      await connection.query('BEGIN');
      const source = await connection.query<{ receipt_canonical_json: string }>(
        `SELECT receipt_canonical_json FROM outcome_factual_reconciliation_run LIMIT 1`
      );
      const original = aflTradeFactualReconciliationRunSchema.parse(
        JSON.parse(source.rows[0]!.receipt_canonical_json)
      );
      const match = original.content.sourceMemberships.find(
        ({ fact }) => fact.content.factKind === 'match_universe'
      )!;
      const legacy = reconcileAflTradeFactualFacts({
        policy: original.content.policy,
        sourceMemberships: [match],
        currentHeadRevisions: [],
        startedAt: original.content.startedAt,
        completedAt: original.content.completedAt,
      });
      const c = legacy.content;
      // The pre-0139 writer retained this complete JSONB wrapper, then its typed children.
      await connection.query(
        `INSERT INTO outcome_factual_reconciliation_run
          (factual_run_id,policy_id,environment,competition,season_year,algorithm_version,
           input_set_sha256,output_set_sha256,run_sha256,status,source_fact_count,
           reconciled_fact_count,conflict_count,started_at,receipt_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'staged',1,0,0,$10,$11::jsonb)`,
        [
          legacy.factualRunId,
          c.policy.policyId,
          c.environment,
          c.competition,
          c.seasonYear,
          c.algorithmVersion,
          c.inputSetSha256,
          c.outputSetSha256,
          legacy.runSha256,
          c.startedAt,
          canonicalizeAflTradeJson(legacy),
        ]
      );
      await connection.query(
        `INSERT INTO outcome_factual_reconciliation_match_input
          (factual_run_id,match_fact_id,ordinal,membership_sha256,membership_json)
         VALUES ($1,$2,1,$3,$4::jsonb)`,
        [
          legacy.factualRunId,
          match.fact.factId,
          sha256AflTradeCanonicalJson(match),
          canonicalizeAflTradeJson(match),
        ]
      );
      await connection.query(
        `UPDATE outcome_factual_reconciliation_run SET status='approved',completed_at=$2,finalized_at=$2
          WHERE factual_run_id=$1`,
        [legacy.factualRunId, c.completedAt]
      );
      const client = createPgAflOutcomeSqlClient({
        query: connection.query.bind(connection),
        connect: async () => ({
          query: connection.query.bind(connection),
          release: () => {},
        }),
      });
      // Reuse the open test transaction instead of committing the rollback-only fixture.
      const owner = new PostgresAflTradeFactualReconciliationRepository({
        query: client.query.bind(client),
        transaction: async (work) => work(client),
      });
      await expect(
        owner.persistRun(legacy, { environment: 'non_production' })
      ).resolves.toMatchObject({
        factualRunId: legacy.factualRunId,
        idempotentReplay: true,
        sourceFactCount: 1,
      });
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
  });

  it.each(['transfer', 'conversion'] as const)(
    'rolls back receipt storage after a failure during %s',
    async (stage) => {
      const retained = await outcomesPool.query<{ receipt_canonical_json: string }>(
        'SELECT receipt_canonical_json FROM outcome_factual_reconciliation_run LIMIT 1'
      );
      const run = JSON.parse(retained.rows[0]!.receipt_canonical_json);
      const beforeObjects = await outcomesPool.query(
        'SELECT oid FROM pg_largeobject_metadata ORDER BY oid'
      );
      const beforeRuns = await outcomesPool.query(
        'SELECT factual_run_id FROM outcome_factual_reconciliation_run ORDER BY factual_run_id'
      );
      const client = createPgAflOutcomeSqlClient(outcomesPool);
      let interrupted = false;
      const owner = new PostgresAflTradeFactualReconciliationRepository({
        query: client.query.bind(client),
        transaction: (work) =>
          client.transaction(async (transaction) =>
            work({
              query: async <Row>(sql: string, parameters?: readonly unknown[]) => {
                const result = await transaction.query<Row>(sql, parameters);
                if (
                  (stage === 'transfer' && sql === 'SELECT lo_put($1,$2,$3)') ||
                  (stage === 'conversion' && sql.includes('convert_from(lo_get($1)'))
                ) {
                  interrupted = true;
                  throw new Error(`Synthetic receipt ${stage} interruption`);
                }
                return result;
              },
            })
          ),
      });
      await expect(owner.persistRun(run, { environment: 'non_production' })).rejects.toThrow(
        `Synthetic receipt ${stage} interruption`
      );
      expect(interrupted).toBe(true);
      expect(
        (await outcomesPool.query('SELECT oid FROM pg_largeobject_metadata ORDER BY oid')).rows
      ).toEqual(beforeObjects.rows);
      expect(
        (
          await outcomesPool.query(
            'SELECT factual_run_id FROM outcome_factual_reconciliation_run ORDER BY factual_run_id'
          )
        ).rows
      ).toEqual(beforeRuns.rows);
    }
  );

  it('leaves no transfer objects after successful persistence and exact replay', async () => {
    expect((await outcomesPool.query('SELECT oid FROM pg_largeobject_metadata')).rows).toEqual([]);
  });

  it.each(['neither', 'both', 'checksum'] as const)(
    'rejects a %s receipt representation',
    async (invalid) => {
      await expect(withStagedReceipt(32, async () => {}, invalid)).rejects.toThrow(
        /receipt_representation_check/i
      );
    }
  );

  it('rejects changed receipt bytes before finalization even with a new valid checksum', async () => {
    await expect(
      withStagedReceipt(32, async (connection, id) => {
        await connection.query(
          `UPDATE outcome_factual_reconciliation_run
            SET receipt_canonical_json='{}',
                receipt_canonical_sha256=encode(sha256(convert_to('{}','UTF8')),'hex')
          WHERE factual_run_id=$1`,
          [id]
        );
      })
    ).rejects.toThrow(/receipt bytes are immutable/i);
  });

  it('still rejects incomplete children when finalizing a text-backed receipt', async () => {
    await expect(
      withStagedReceipt(32, async (connection, id) => {
        await connection.query(
          `UPDATE outcome_factual_reconciliation_run
            SET status='approved',completed_at=started_at,finalized_at=started_at
          WHERE factual_run_id=$1`,
          [id]
        );
      })
    ).rejects.toThrow(/input membership is not exhaustive/i);
  });

  it('keeps finalized canonical receipt bytes append-only', async () => {
    await expect(
      outcomesPool.query(
        `UPDATE outcome_factual_reconciliation_run SET receipt_canonical_json='{}'
        WHERE finalized_at IS NOT NULL`
      )
    ).rejects.toThrow(/finalized factual reconciliation runs are append-only/i);
  });

  it('updates mutable fields without converting a receipt above the JSONB ceiling', async () => {
    await withStagedReceipt(268_435_456, async (connection, id) => {
      await connection.query(
        `UPDATE outcome_factual_reconciliation_run SET status='needs_review'
          WHERE factual_run_id=$1`,
        [id]
      );
      const measured = await connection.query<{ bytes: number; status: string }>(
        `SELECT octet_length(receipt_canonical_json) AS bytes,status
           FROM outcome_factual_reconciliation_run WHERE factual_run_id=$1`,
        [id]
      );
      expect(measured.rows[0]).toEqual({ bytes: 268_435_470, status: 'needs_review' });
    });
  }, 120_000);

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
