import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeAdmittedPlayerFactualPreparation } from '@/server/aflTradeIntelligence/valuation/postgresAdmittedPlayerFactualPreparation';
import { PostgresAflTradePrivateValuationHpnFactualPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationHpnFactualBinding';
import { admittedPlayerFactualPreparationFixture } from '../testUtils/admittedPlayerFactualPreparationFixture';
import { seedPrivateValuationHpnCurrentAuthorityFixture } from '../testUtils/privateValuationHpnCurrentAuthorityFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const restrictedPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName} -c role=afl_trade_private_evaluation_coordinator`,
});
const client = createPgAflOutcomeSqlClient(pool);
const restricted = createPgAflOutcomeSqlClient(restrictedPool);
const hash = (marker: string) => marker.repeat(64);

beforeAll(async () => {
  await admin.query(`DO $role$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_spell_metric_policy_reviewer') THEN
      CREATE ROLE afl_trade_nonproduction_spell_metric_policy_reviewer NOLOGIN;
    END IF;
  END $role$`);
  await admin.query('GRANT afl_trade_nonproduction_spell_metric_policy_reviewer TO statly_test');
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
  await admin.query(
    `GRANT SELECT,INSERT ON "${schemaName}".outcome_review_decision TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
  // Isolate the seven-lane source review upstream of this binding seam. Actual
  // current-head/custody-digest, admitted-parent, input ancestry and claim checks run.
  // These synthetic fixtures are NOT a genuine-source rehearsal or source admission.
  await pool.query(`CREATE OR REPLACE FUNCTION outcome_private_reviewed_evidence_bundle_is_current(target_evidence_bundle_id TEXT)
    RETURNS BOOLEAN LANGUAGE SQL STABLE AS 'SELECT true'`);
});

afterAll(async () => {
  await restrictedPool.end();
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

async function bindingFixture() {
  const fixture = await admittedPlayerFactualPreparationFixture(client, 'hpn-current-binding');
  // The reusable fixture deliberately has unavailable spell totals. Add synthetic
  // retained membership to its real finalized facts to exercise the ancestry guard;
  // this does not claim that the fixture dataset is genuinely admitted model input.
  await client.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL session_replication_role='replica'`);
    await transaction.query(
      `INSERT INTO outcome_acquisition_spell_metric_version_member
      (spell_metric_version_id,reconciled_fact_id,factual_run_id,ordinal,subject_key,
       head_revision,finalization_id,finalization_sha256,membership_sha256,membership_json)
      SELECT version.spell_metric_version_id,fact.reconciled_fact_id,fact.factual_run_id,1,
        'synthetic-binding-lineage',1,$3,$4,$4,'{}'::jsonb
      FROM outcome_release_spell_metric_member member
      JOIN outcome_acquisition_spell_metric_version version USING (spell_metric_version_id)
      JOIN outcome_reconciled_factual_metric fact ON fact.metric_code=version.metric_code
        AND fact.factual_run_id=$2
      WHERE member.candidate_id=$1 ON CONFLICT DO NOTHING`,
      [
        fixture.candidate.candidateId,
        fixture.base.receipt.factualRunId,
        `factual-finalization:${hash('a')}`,
        hash('a'),
      ]
    );
  });
  const claim = {
    claimId: fixture.staged.claim.claimId,
    leaseToken: fixture.staged.claim.leaseToken,
  };
  const prepared = await new PostgresAflTradeAdmittedPlayerFactualPreparation(restricted).prepare({
    requestId: fixture.staged.requestId,
    claim,
    datasetId: fixture.dataset.datasetId,
    admissionId: fixture.admission.admissionId,
  });
  const { operationId, privateCandidateId } = await seedPrivateValuationHpnCurrentAuthorityFixture(
    client,
    {
      requestId: fixture.staged.requestId,
      scopeKey: fixture.staged.claim.request.scopeKey,
      trigger: fixture.staged.claim.request.trigger,
      captureId: fixture.base.receipt.captureId,
    }
  );
  return {
    fixture,
    prepared,
    claim,
    operationId,
    privateCandidateId,
    leaseSha256: createHash('sha256').update(claim.leaseToken).digest('hex'),
  };
}

describe.sequential('explicit private HPN factual authority binding', () => {
  let context: Awaited<ReturnType<typeof bindingFixture>>;
  beforeAll(async () => {
    context = await bindingFixture();
  });

  async function rejectsMutation(sql: string, parameters: readonly unknown[], message: RegExp) {
    await client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL session_replication_role='replica'`);
      const changed = await transaction.query(sql, parameters);
      expect(changed.rowCount, 'synthetic tamper must affect retained custody').toBeGreaterThan(0);
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      // The rejected statement aborts this synthetic mutation transaction; no tamper is retained.
      await expect(
        transaction.query('SELECT load_outcome_private_valuation_hpn_factual_input($1,$2)', [
          context.fixture.staged.requestId,
          context.prepared.output.outputId,
        ])
      ).rejects.toThrow(message);
    });
  }

  it('binds the admitted player and explicit HPN run to exact current custody and replays', async () => {
    const { fixture, prepared, claim, operationId, privateCandidateId, leaseSha256 } = context;
    const args = [
      fixture.staged.requestId,
      claim.claimId,
      leaseSha256,
      prepared.output.outputId,
      operationId,
      fixture.base.receipt.factualRunId,
    ];
    const unbound = await restricted.query<{ binding: unknown }>(
      'SELECT load_outcome_private_valuation_hpn_factual_input($1,$2) AS binding',
      [args[0], args[3]]
    );
    expect(unbound.rows[0]?.binding).toBeNull();
    const adapter = new PostgresAflTradePrivateValuationHpnFactualPreparation(restricted, {
      datasetId: fixture.dataset.datasetId,
      admissionId: fixture.admission.admissionId,
      factualOperationId: operationId,
      hpnFactualRunId: fixture.base.receipt.factualRunId,
    });
    const parallel = await Promise.all(
      Array.from({ length: 4 }, () =>
        restricted.query<{ binding: unknown }>(
          'SELECT bind_outcome_private_valuation_hpn_factual_input($1,$2,$3,$4,$5,$6) AS binding',
          args
        )
      )
    );
    expect(parallel.map((result) => result.rows)).toEqual(
      Array.from({ length: 4 }, () => parallel[0]!.rows)
    );
    await expect(adapter.prepare({ requestId: fixture.staged.requestId, claim })).resolves.toEqual({
      state: 'already_prepared',
      output: prepared.output,
    });
    const publicReplay = await Promise.all(
      Array.from({ length: 4 }, () =>
        adapter.prepare({
          requestId: fixture.staged.requestId,
          claim,
        })
      )
    );
    expect(publicReplay).toEqual(
      Array.from({ length: 4 }, () => ({ state: 'already_prepared', output: prepared.output }))
    );
    const first = await restricted.query<{ binding: unknown }>(
      'SELECT bind_outcome_private_valuation_hpn_factual_input($1,$2,$3,$4,$5,$6) AS binding',
      args
    );
    expect(first.rows[0]?.binding).toMatchObject({
      requestId: args[0],
      factualOutputId: args[3],
      factualOperationId: operationId,
      privateFactualCandidateId: privateCandidateId,
      privateFactualRevision: 1,
      hpnFactualRunId: fixture.base.receipt.factualRunId,
    });
    const replay = await restricted.query<{ binding: unknown }>(
      'SELECT bind_outcome_private_valuation_hpn_factual_input($1,$2,$3,$4,$5,$6) AS binding',
      args
    );
    expect(replay.rows).toEqual(first.rows);
    const loaded = await restricted.query<{ binding: unknown }>(
      'SELECT load_outcome_private_valuation_hpn_factual_input($1,$2) AS binding',
      [args[0], args[3]]
    );
    expect(loaded.rows).toEqual(first.rows);
  });

  it('rejects substituted output or operation and incorrect claim credentials', async () => {
    const { fixture, prepared, claim, operationId, leaseSha256 } = context;
    await expect(
      restricted.query('SELECT load_outcome_private_valuation_hpn_factual_input($1,$2)', [
        fixture.staged.requestId,
        `private-valuation-factual-output:${hash('0')}`,
      ])
    ).rejects.toThrow(/substitute/);
    await expect(
      restricted.query(
        'SELECT bind_outcome_private_valuation_hpn_factual_input($1,$2,$3,$4,$5,$6)',
        [
          fixture.staged.requestId,
          claim.claimId,
          hash('0'),
          prepared.output.outputId,
          operationId,
          fixture.base.receipt.factualRunId,
        ]
      )
    ).rejects.toThrow(/claim|dispatch/i);
    await expect(
      restricted.query(
        'SELECT bind_outcome_private_valuation_hpn_factual_input($1,$2,$3,$4,$5,$6)',
        [
          fixture.staged.requestId,
          claim.claimId,
          leaseSha256,
          prepared.output.outputId,
          `current-valuation-factual-refresh-operation:${hash('0')}`,
          fixture.base.receipt.factualRunId,
        ]
      )
    ).rejects.toThrow(/current factual authority/);
  });

  it('rejects stale current heads and changed normalization custody on reads', async () => {
    await rejectsMutation(
      'UPDATE outcome_current_private_factual_authority SET revision=revision+1 WHERE candidate_id=$1',
      [context.privateCandidateId],
      /current factual authority/
    );
    await rejectsMutation(
      'UPDATE outcome_provider_normalization_run SET receipt_sha256=$1 WHERE normalization_run_id=$2',
      [hash('0'), context.fixture.base.receipt.normalizationRunId],
      /current factual authority/
    );
  });

  it('rejects a foreign match among valid HPN inputs and foreign retained player sources', async () => {
    await rejectsMutation(
      `WITH foreign_fact AS (
      INSERT INTO outcome_provider_match_universe_fact
      SELECT (jsonb_populate_record(NULL::outcome_provider_match_universe_fact,to_jsonb(fact)
        ||jsonb_build_object('match_fact_id',$2::text,'fact_sha256',$3::text,
          'normalization_run_id',$4::text,'provider_decoded_row_id',$4::text))).*
      FROM outcome_provider_match_universe_fact fact
      JOIN outcome_factual_reconciliation_match_input input USING (match_fact_id)
      WHERE input.factual_run_id=$1 LIMIT 1 RETURNING match_fact_id
    ) INSERT INTO outcome_factual_reconciliation_match_input
      SELECT $1,match_fact_id,99,$3,'{}'::jsonb FROM foreign_fact`,
      [
        context.fixture.base.receipt.factualRunId,
        `provider-match-fact:${hash('0')}`,
        hash('0'),
        `provider-normalization-run:${hash('0')}`,
      ],
      /exact current normalized custody/
    );
    await rejectsMutation(
      `UPDATE outcome_provider_numeric_metric_fact SET normalization_run_id=$1
      WHERE metric_fact_id IN (SELECT member.metric_fact_id FROM outcome_reconciled_factual_metric_member member
        JOIN outcome_acquisition_spell_metric_version_member spell USING (reconciled_fact_id)
        JOIN outcome_release_spell_metric_member release_member USING (spell_metric_version_id)
        WHERE release_member.candidate_id=$2)`,
      [`provider-normalization-run:${hash('0')}`, context.fixture.candidate.candidateId],
      /exact current normalized custody/
    );
  });

  it('rejects missing measured player lineage without inventing unavailable source facts', async () => {
    await rejectsMutation(
      `DELETE FROM outcome_reconciled_factual_metric_member WHERE reconciled_fact_id IN (
      SELECT member.reconciled_fact_id FROM outcome_acquisition_spell_metric_version_member member
      JOIN outcome_release_spell_metric_member release_member USING (spell_metric_version_id)
      WHERE release_member.candidate_id=$1)`,
      [context.fixture.candidate.candidateId],
      /player.*lineage/i
    );
  });

  it('rejects expired claims and disallows coordinator table writes or public function access', async () => {
    await rejectsMutation(
      `UPDATE outcome_private_valuation_dispatch_request SET lease_expires_at=now()-interval '1 second'
      WHERE request_id=$1`,
      [context.fixture.staged.requestId],
      /claim|dispatch/i
    );
    await expect(
      restricted.query(
        'DELETE FROM outcome_private_valuation_hpn_factual_binding WHERE request_id=$1',
        [context.fixture.staged.requestId]
      )
    ).rejects.toThrow(/permission denied/);
    const privileges = await pool.query<{ public_execute: boolean }>(
      `SELECT EXISTS (
      SELECT 1 FROM pg_proc function JOIN pg_namespace namespace ON namespace.oid=function.pronamespace,
        LATERAL aclexplode(function.proacl) privilege
      WHERE namespace.nspname=$1 AND function.proname IN (
        'bind_outcome_private_valuation_hpn_factual_input','load_outcome_private_valuation_hpn_factual_input',
        'authenticate_outcome_private_valuation_hpn_factual_input')
        AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE') AS public_execute`,
      [schemaName]
    );
    expect(privileges.rows).toEqual([{ public_execute: false }]);
  });
});
