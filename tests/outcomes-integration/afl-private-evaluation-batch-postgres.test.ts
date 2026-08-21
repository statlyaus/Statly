import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createGovernedPrivateEvaluationBatch,
  createGovernedPrivateEvaluationBatchOperationId,
  type GovernedPrivateEvaluationBatch,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationBatch';
import { PostgresGovernedPrivateEvaluationBatchRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationBatchRepository';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_private_evaluation_batch_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const scopeKey = 'afl-men:2026-private-batch';
const preparedInputSetId = `prepared-valuation-input-set:${'1'.repeat(64)}`;
const factualReleaseId = `outcome-release:${'2'.repeat(64)}`;
const modelQualificationId = `model-qualification:${'3'.repeat(64)}`;
const modelQualificationWorkId = `model-qualification-work:${'4'.repeat(64)}`;
const createdAt = '2026-08-20T09:00:00.000Z';

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  const seed = await pool.connect();
  try {
    await seed.query('BEGIN');
    await seed.query(`SET LOCAL session_replication_role='replica'`);
    await seed.query(
      `INSERT INTO outcome_release_manifest
        (release_id,scope_key,environment,created_at,effective_through,manifest_json)
       VALUES ($1,'fixture-release-scope','non_production',$2,$2,'{}'::jsonb)`,
      [factualReleaseId, createdAt]
    );
    await seed.query(
      `INSERT INTO outcome_governed_valuation_model_qualification
        (qualification_id,scope_key,outcome,artifact_id,player_run_id,pick_run_id,
         policy_artifact_id,player_criteria_artifact_id,pick_criteria_artifact_id,
         player_evidence_artifact_id,pick_evidence_artifact_id,evaluated_at,
         content_sha256,content_canonical_json,qualification_json)
       VALUES ($1,$2,'qualified',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{}','{}'::jsonb)`,
      [
        modelQualificationId,
        scopeKey,
        `artifact:${'5'.repeat(64)}`,
        `model-run:${'6'.repeat(64)}`,
        `model-run:${'7'.repeat(64)}`,
        ...['8', '9', 'a', 'b', 'c'].map((value) => `artifact:${value.repeat(64)}`),
        createdAt,
        '3'.repeat(64),
      ]
    );
    await seed.query(
      `INSERT INTO outcome_governed_model_qualification_work
        (work_id,scope_key,qualification_id,player_gate3_decision_id,
         pick_gate3_decision_id,available_at,status,work_json)
       VALUES ($1,$2,$3,$4,$5,$6,'pending','{}'::jsonb)`,
      [
        modelQualificationWorkId,
        scopeKey,
        modelQualificationId,
        `gate-decision:${'d'.repeat(64)}`,
        `gate-decision:${'e'.repeat(64)}`,
        createdAt,
      ]
    );
    await seed.query(
      `INSERT INTO outcome_prepared_valuation_input_set
        (prepared_input_set_id,content_sha256,schema_version,environment,scope_key,
         factual_release_scope_key,factual_release_id,qualification_report_id,trade_count,
         ready_count,blocked_count,prepared_at,content_canonical_json,
         prepared_set_canonical_json,prepared_set_json,finalized_at)
       VALUES ($1,$2,'afl-trade-prepared-valuation-input-set/v3','non_production',$3,
               'fixture-release-scope',$4,$5,2,0,2,$6,'{}','{}','{}'::jsonb,$6)`,
      [
        preparedInputSetId,
        '1'.repeat(64),
        scopeKey,
        factualReleaseId,
        `valuation-source-qualification:${'f'.repeat(64)}`,
        createdAt,
      ]
    );
    for (const [ordinal, tradeId] of ['trade-a', 'trade-b'].entries()) {
      await seed.query(
        `INSERT INTO outcome_prepared_valuation_input_entry
          (prepared_input_set_id,ordinal,trade_id,state,entry_canonical_json,entry_json)
         VALUES ($1,$2,$3,'blocked','{}',$4::jsonb)`,
        [preparedInputSetId, ordinal + 1, tradeId, canonicalizeAflTradeJson({ tradeId })]
      );
    }
    await seed.query(
      `INSERT INTO outcome_active_release(scope_key,release_id,activated_at,revision)
       VALUES ('fixture-release-scope',$1,$2,1)`,
      [factualReleaseId, createdAt]
    );
    await seed.query(
      `INSERT INTO outcome_current_prepared_valuation_input_set
        (scope_key,prepared_input_set_id,revision,activated_at) VALUES ($1,$2,1,$3)`,
      [scopeKey, preparedInputSetId, createdAt]
    );
    await seed.query(
      `INSERT INTO outcome_current_governed_valuation_model_pair
        (scope_key,revision,qualification_id,player_run_id,pick_run_id,
         player_gate3_decision_id,pick_gate3_decision_id,work_id,advanced_at)
       VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        scopeKey,
        modelQualificationId,
        `model-run:${'6'.repeat(64)}`,
        `model-run:${'7'.repeat(64)}`,
        `gate-decision:${'d'.repeat(64)}`,
        `gate-decision:${'e'.repeat(64)}`,
        modelQualificationWorkId,
        createdAt,
      ]
    );
    await seed.query('COMMIT');
  } catch (error) {
    await seed.query('ROLLBACK');
    throw error;
  } finally {
    seed.release();
  }
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

function batch(at: string) {
  return createGovernedPrivateEvaluationBatch({
    scopeKey,
    preparedInputSetId,
    preparedInputSetRevision: 1,
    factualReleaseId,
    modelQualificationId,
    modelQualificationWorkId,
    entries: ['trade-a', 'trade-b'].map((tradeId) => ({
      tradeId,
      state: 'unavailable' as const,
      blockers: [{ code: 'engineering_unavailable' as const, message: 'Fixture isolation.' }],
    })),
    createdAt: at,
  });
}

async function insertBatchParent(retained: GovernedPrivateEvaluationBatch) {
  const contentCanonicalJson = canonicalizeAflTradeJson(retained.content);
  await pool.query(
    `INSERT INTO outcome_private_evaluation_batch
      (batch_id,scope_key,prepared_input_set_id,prepared_input_set_revision,
       factual_release_id,model_qualification_id,model_qualification_work_id,
       trade_count,ready_count,unavailable_count,created_at,content_sha256,
       content_canonical_json,batch_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
    [
      retained.batchId,
      retained.content.scopeKey,
      retained.content.preparedInputSetId,
      retained.content.preparedInputSetRevision,
      retained.content.factualReleaseId,
      retained.content.modelQualificationId,
      retained.content.modelQualificationWorkId,
      retained.content.tradeCount,
      retained.content.readyCount,
      retained.content.unavailableCount,
      retained.content.createdAt,
      retained.batchId.slice('private-evaluation-batch:'.length),
      contentCanonicalJson,
      canonicalizeAflTradeJson(retained),
    ]
  );
}

describe('PostgreSQL atomic private evaluation batches', () => {
  it('registers exhaustively, advances by fenced CAS, replays, and rolls back whole batches', async () => {
    const repository = new PostgresGovernedPrivateEvaluationBatchRepository(
      createPgAflOutcomeSqlClient(pool),
      async () => true
    );
    const first = batch(createdAt);
    const second = batch('2026-08-20T09:00:00.001Z');
    await expect(repository.register(first)).resolves.toEqual(first);
    await expect(repository.register(first)).resolves.toEqual(first);
    await repository.register(second);
    const operation = (batchId: string, expectedRevision: number, action: 'activate' | 'rollback') =>
      createGovernedPrivateEvaluationBatchOperationId({ scopeKey, batchId, expectedRevision, action });
    const activation = await repository.advance({
      scopeKey,
      batchId: first.batchId,
      expectedRevision: 0,
      operationId: operation(first.batchId, 0, 'activate'),
      action: 'activate',
    });
    expect(activation).toMatchObject({ batchId: first.batchId, revision: 1 });
    await expect(repository.advance({
      scopeKey,
      batchId: first.batchId,
      expectedRevision: 0,
      operationId: operation(first.batchId, 0, 'activate'),
      action: 'activate',
    })).resolves.toEqual(activation);
    await expect(repository.advance({
      scopeKey,
      batchId: second.batchId,
      expectedRevision: 0,
      operationId: operation(second.batchId, 0, 'activate'),
      action: 'activate',
    })).rejects.toThrow(/compare-and-swap/i);
    const replacement = await repository.advance({
      scopeKey,
      batchId: second.batchId,
      expectedRevision: 1,
      operationId: operation(second.batchId, 1, 'activate'),
      action: 'activate',
    });
    expect(replacement).toMatchObject({ batchId: second.batchId, revision: 2 });
    const authorityShift = await pool.connect();
    try {
      await authorityShift.query('BEGIN');
      await authorityShift.query(`SET LOCAL session_replication_role='replica'`);
      await authorityShift.query(
        `UPDATE outcome_current_prepared_valuation_input_set
            SET prepared_input_set_id=$2,revision=2 WHERE scope_key=$1`,
        [scopeKey, `prepared-valuation-input-set:${'a'.repeat(64)}`]
      );
      await authorityShift.query(
        `UPDATE outcome_current_governed_valuation_model_pair
            SET qualification_id=$2,work_id=$3,revision=2 WHERE scope_key=$1`,
        [
          scopeKey,
          `model-qualification:${'b'.repeat(64)}`,
          `model-qualification-work:${'c'.repeat(64)}`,
        ]
      );
      await authorityShift.query(
        `UPDATE outcome_active_release SET release_id=$2,revision=2 WHERE scope_key=$1`,
        ['fixture-release-scope', `outcome-release:${'d'.repeat(64)}`]
      );
      await authorityShift.query('COMMIT');
    } finally {
      authorityShift.release();
    }
    await expect(repository.advance({
      scopeKey,
      batchId: second.batchId,
      expectedRevision: 1,
      operationId: operation(second.batchId, 1, 'activate'),
      action: 'activate',
    })).resolves.toEqual(replacement);
    await expect(repository.advance({
      scopeKey,
      batchId: first.batchId,
      expectedRevision: 2,
      operationId: operation(first.batchId, 2, 'rollback'),
      action: 'rollback',
    })).resolves.toMatchObject({ batchId: first.batchId, revision: 3 });
    const authorityRestore = await pool.connect();
    try {
      await authorityRestore.query('BEGIN');
      await authorityRestore.query(`SET LOCAL session_replication_role='replica'`);
      await authorityRestore.query(
        `UPDATE outcome_current_prepared_valuation_input_set
            SET prepared_input_set_id=$2,revision=1 WHERE scope_key=$1`,
        [scopeKey, preparedInputSetId]
      );
      await authorityRestore.query(
        `UPDATE outcome_current_governed_valuation_model_pair
            SET qualification_id=$2,work_id=$3,revision=1 WHERE scope_key=$1`,
        [scopeKey, modelQualificationId, modelQualificationWorkId]
      );
      await authorityRestore.query(
        `UPDATE outcome_active_release SET release_id=$2,revision=1 WHERE scope_key=$1`,
        ['fixture-release-scope', factualReleaseId]
      );
      await authorityRestore.query('COMMIT');
    } finally {
      authorityRestore.release();
    }
    const neverActivated = batch('2026-08-20T09:00:00.002Z');
    await repository.register(neverActivated);
    await expect(repository.advance({
      scopeKey,
      batchId: neverActivated.batchId,
      expectedRevision: 3,
      operationId: operation(neverActivated.batchId, 3, 'rollback'),
      action: 'rollback',
    })).rejects.toThrow(/compare-and-swap/i);
    await expect(
      pool.query(
        `SELECT * FROM advance_outcome_current_private_evaluation_batch($1,$2,$3,$4,$5,$6)`,
        [
          scopeKey,
          second.batchId,
          3,
          operation(second.batchId, 3, 'activate'),
          'activate',
          'system:unauthorized-coordinator',
        ]
      )
    ).rejects.toThrow(/invalid/i);
    await expect(
      pool.query(`DELETE FROM outcome_private_evaluation_batch WHERE batch_id=$1`, [first.batchId])
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects a relational entry that disagrees with its authenticated batch envelope', async () => {
    const retained = batch('2026-08-20T09:00:00.003Z');
    await insertBatchParent(retained);
    await expect(
      pool.query(
        `INSERT INTO outcome_private_evaluation_batch_entry
          (batch_id,ordinal,trade_id,state,generation_id,entry_json)
         VALUES ($1,0,'trade-a','unavailable',NULL,$2::jsonb)`,
        [
          retained.batchId,
          canonicalizeAflTradeJson({
            tradeId: 'trade-a',
            state: 'unavailable',
            blockers: [{ code: 'engineering_unavailable', message: 'Different explanation.' }],
          }),
        ]
      )
    ).rejects.toThrow(/does not match/i);
  });

  it('rejects noncanonical ordering and forged blocker evidence at direct SQL custody', async () => {
    const retained = batch('2026-08-20T09:00:00.004Z');
    const unsortedContent = {
      ...retained.content,
      entries: [...retained.content.entries].reverse(),
    };
    const unsorted = {
      batchId: createAflTradeContentAddress('private-evaluation-batch', unsortedContent),
      content: unsortedContent,
    } as GovernedPrivateEvaluationBatch;
    await expect(insertBatchParent(unsorted)).rejects.toThrow(/identity|ancestry/i);

    const forgedContent = {
      ...retained.content,
      entries: retained.content.entries.map((entry, index) =>
        index === 0 && entry.state === 'unavailable'
          ? { ...entry, blockers: [{ code: 'invented_blocker', message: 'Forged.' }] }
          : entry
      ),
    };
    const forged = {
      batchId: createAflTradeContentAddress('private-evaluation-batch', forgedContent),
      content: forgedContent,
    } as unknown as GovernedPrivateEvaluationBatch;
    await expect(insertBatchParent(forged)).rejects.toThrow(/identity|ancestry/i);
  });
});
