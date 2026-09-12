import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prepareLocalAflTradeFitzRoyFactualReleaseCandidate } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePrivateFactualPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationFactualPreparation';
import { PostgresAflTradePrivateValuationHpnFactualPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationHpnFactualBinding';
import {
  persistPrivateValuationFactualCandidateFixture,
  seedPrivateValuationAcquisitionSpellFixture,
  stageAcceptedPrivateValuationCaptureFixture,
} from '../testUtils/privateValuationFactualPreparationFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import { stageSourceFirstSupplementalHpnFixture } from '../testUtils/sourceFirstSupplementalHpnFixture';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 4 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);

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
});

afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

// This tests the source-first factual authentication seam, not the fixed historical
// reviewed-bundle authority or a genuine-source rehearsal. No SQL validator is replaced.
describe.sequential('source-first private HPN factual parent', () => {
  let requestId: string;
  let output: unknown;
  let outputId: string;
  let claimId: string;
  let leaseToken: string;
  let leaseSha256: string;
  let factualRunId: string;
  let supplementalRunId: string;
  let preparation: PostgresAflTradePrivateFactualPreparation;
  beforeAll(async () => {
    const supplemental = await stageSourceFirstSupplementalHpnFixture(client);
    supplementalRunId = supplemental.factualRunId;
    expect(supplemental.auxiliaryRequest.status).toBe('pending');
    expect(supplemental.sourceAdmission.state).toBe('admitted');
    const staged = await stageAcceptedPrivateValuationCaptureFixture(client, 'source-first-hpn');
    const source = createLocalAflTradeFitzRoyFactualRehearsalFixture().command.capture;
    const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
    await ledger.appendBatch({
      expectedRevision: (await ledger.load()).revision,
      records: [
        {
          sourceRights: source.sourceRights,
          proposal: source.ledger.proposals[0]!,
          decision: source.ledger.decisions[0]!,
        },
      ],
    });
    let factual: Awaited<ReturnType<typeof prepareLocalAflTradeFitzRoyFactualReleaseCandidate>>;
    preparation = new PostgresAflTradePrivateFactualPreparation(client, {
      prepareSourceEvidence: async () => {
        factual = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client);
      },
      prepareCandidate: async () => {
        const spell = await seedPrivateValuationAcquisitionSpellFixture(
          client,
          staged.binding.content.sourceCaptureId,
          factual.candidate
        );
        const candidate = await persistPrivateValuationFactualCandidateFixture(
          client,
          factual.candidate,
          spell,
          staged.claim.request.scopeKey,
          { supplementalSources: [supplemental.supplementalSource] }
        );
        return { candidateId: candidate.candidateId };
      },
    });
    const prepared = await preparation.prepare({
      requestId: staged.requestId,
      claim: { claimId: staged.claim.claimId, leaseToken: staged.claim.leaseToken },
    });
    requestId = staged.requestId;
    output = prepared.output;
    outputId = prepared.output.outputId;
    claimId = staged.claim.claimId;
    leaseToken = staged.claim.leaseToken;
    leaseSha256 = createHash('sha256').update(staged.claim.leaseToken).digest('hex');
    factualRunId = prepared.output.content.reconciliation.factualRunId;
  });

  it('accepts the source-first branch but still requires independently current reviewed factual authority', async () => {
    await expect(
      client.transaction(async (transaction) => {
        await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
        await transaction.query(
          'SELECT bind_outcome_private_valuation_hpn_factual_input($1,$2,$3,$4,$5,$6)',
          [
            requestId,
            claimId,
            leaseSha256,
            outputId,
            `current-valuation-factual-refresh-operation:${'b'.repeat(64)}`,
            factualRunId,
          ]
        );
      })
    ).rejects.toThrow(/requires exact current factual authority/);
  });

  it('composes source-first preparation through the HPN adapter without bypassing reviewed factual authority', async () => {
    const adapter = new PostgresAflTradePrivateValuationHpnFactualPreparation(
      client,
      {
        factualOperationId: `current-valuation-factual-refresh-operation:${'b'.repeat(64)}`,
        hpnFactualRunId: factualRunId,
      },
      preparation
    );
    await expect(adapter.prepare({ requestId, claim: { claimId, leaseToken } })).rejects.toThrow(
      /requires exact current factual authority/
    );
    await expect(
      preparation.prepare({ requestId, claim: { claimId, leaseToken } })
    ).resolves.toEqual({
      state: 'already_prepared',
      output,
    });
  });

  it('authenticates an ordinarily prepared source-first output without a model dataset', async () => {
    const authenticated = await client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      return transaction.query<{ output_json: unknown }>(
        'SELECT authenticate_outcome_private_valuation_source_factual_output($1,$2) AS output_json',
        [requestId, outputId]
      );
    });
    expect(authenticated.rows[0]!.output_json).toEqual(output);
    expect(
      (
        await pool.query(
          'SELECT count(*)::integer AS count FROM outcome_valuation_dataset_candidate'
        )
      ).rows[0].count
    ).toBe(0);
  });

  it('binds a separately reconciled provider declared in the primary finalized release without the legacy corpus', async () => {
    expect(supplementalRunId).not.toBe(factualRunId);
    const adapter = new PostgresAflTradePrivateValuationHpnFactualPreparation(
      client,
      { authorityKind: 'source_first', hpnFactualRunId: supplementalRunId },
      preparation
    );
    await expect(adapter.prepare({ requestId, claim: { claimId, leaseToken } })).resolves.toEqual({
      state: 'already_prepared',
      output,
    });
    const result = await client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      return transaction.query<{ binding_json: unknown }>(
        'SELECT load_outcome_private_valuation_hpn_factual_input($1,$2) AS binding_json',
        [requestId, outputId]
      );
    });
    expect(result.rows[0]?.binding_json).toMatchObject({
      authorityKind: 'source_first',
      requestId,
      factualOutputId: outputId,
      hpnFactualRunId: supplementalRunId,
    });
  });

  it.each([
    ['primary', 'factual_reconciliation_policy'],
    ['supplemental', 'factual_reconciliation_policy'],
    ['primary', 'provider_field_map'],
    ['supplemental', 'provider_field_map'],
  ] as const)(
    'acquires the %s %s review key before the row lock under a concurrent review writer',
    async (sourceKind, subjectType) => {
      const runId = sourceKind === 'primary' ? factualRunId : supplementalRunId;
      const policy = await pool.query<{ subject_id: string }>(
        subjectType === 'factual_reconciliation_policy'
          ? 'SELECT policy_id AS subject_id FROM outcome_factual_reconciliation_run WHERE factual_run_id=$1'
          : `SELECT DISTINCT normalization.field_map_id AS subject_id
             FROM outcome_factual_reconciliation_match_input input
             JOIN outcome_provider_match_universe_fact fact USING(match_fact_id)
             JOIN outcome_provider_normalization_run normalization USING(normalization_run_id)
             WHERE input.factual_run_id=$1`,
        [runId]
      );
      const subjectId = policy.rows[0]!.subject_id;
      const writer = await pool.connect();
      const reader = await pool.connect();
      let pending: Promise<unknown> | undefined;
      try {
        await writer.query('BEGIN');
        await writer.query("SET LOCAL statement_timeout='3s'");
        await writer.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `outcome-review-subject:${subjectType}:${subjectId}`,
        ]);
        await reader.query('BEGIN');
        await reader.query("SET LOCAL statement_timeout='5s'");
        const pid = (await reader.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
          .pid;
        await reader.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
        pending = reader.query('SELECT load_outcome_private_valuation_hpn_factual_input($1,$2)', [
          requestId,
          outputId,
        ]);
        void pending.catch(() => undefined);
        // Observe the actual database lock wait, not an assumed timer or mocked owner.
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
          waiting = (
            await pool.query<{ waiting: boolean }>(
              "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) AS waiting",
              [pid]
            )
          ).rows[0]!.waiting;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        // A row-before-review reader deadlocks here against the review writer.
        await writer.query(
          subjectType === 'factual_reconciliation_policy'
            ? 'SELECT policy_id FROM outcome_factual_reconciliation_policy WHERE policy_id=$1 FOR UPDATE'
            : 'SELECT field_map_id FROM outcome_provider_field_map WHERE field_map_id=$1 FOR UPDATE',
          [subjectId]
        );
        await writer.query('COMMIT');
        await expect(pending).resolves.toBeDefined();
        await reader.query('COMMIT');
      } finally {
        await writer.query('ROLLBACK');
        await pending?.catch(() => undefined);
        await reader.query('ROLLBACK');
        writer.release();
        reader.release();
      }
    }
  );

  it('rejects substituting the primary run after the separate HPN run was bound', async () => {
    const substituted = new PostgresAflTradePrivateValuationHpnFactualPreparation(
      client,
      { authorityKind: 'source_first', hpnFactualRunId: factualRunId },
      preparation
    );
    await expect(
      substituted.prepare({ requestId, claim: { claimId, leaseToken } })
    ).rejects.toThrow(/cannot substitute retained authority/);
  });

  it('rejects a current review withdrawing the supplemental decoder', async () => {
    await expect(
      client.transaction(async (transaction) => {
        await transaction.query(`INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,supersedes_decision_id)
        SELECT 'review-decision:'||repeat('b',64),review.subject_type,review.subject_id,'rejected',
          'Synthetic supplemental currentness regression',review.evidence_json,'synthetic-source-first-reviewer',clock_timestamp(),review.decision_id
        FROM outcome_review_decision review JOIN outcome_provider_field_map map ON map.approval_decision_id=review.decision_id
        WHERE map.field_map_id='afl-tables-player-stats-local-rehearsal-v1'`);
        await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
        await transaction.query('SELECT load_outcome_private_valuation_hpn_factual_input($1,$2)', [
          requestId,
          outputId,
        ]);
      })
    ).rejects.toThrow(/decode review is no longer current/);
  });

  it('rejects a supplemental capture removed from the exact finalized release', async () => {
    await expect(
      client.transaction(async (transaction) => {
        // Deliberate upstream corruption only; the authenticating binding getter is unchanged.
        await transaction.query("SET LOCAL session_replication_role='replica'");
        const removed = await transaction.query(
          `DELETE FROM outcome_release_source_capture membership
        USING outcome_private_valuation_factual_output output, outcome_source_capture capture
        WHERE membership.release_id=output.factual_release_id AND output.request_id=$1
          AND membership.capture_id=capture.capture_id AND capture.provider='afl_tables'`,
          [requestId]
        );
        expect(removed.rowCount).toBe(1);
        await transaction.query("SET LOCAL session_replication_role='origin'");
        await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
        await transaction.query('SELECT load_outcome_private_valuation_hpn_factual_input($1,$2)', [
          requestId,
          outputId,
        ]);
      })
    ).rejects.toThrow(/release source custody|parent custody/);
  });

  it.each([
    [
      'withdrawn capture',
      `UPDATE outcome_source_capture SET status='rejected' WHERE capture_id=(SELECT source_capture_id FROM outcome_private_valuation_source_admission WHERE request_id=$1)`,
      /source or policy is unavailable/,
    ],
    [
      'rejected factual policy',
      `UPDATE outcome_factual_reconciliation_policy SET status='rejected' WHERE policy_id=(SELECT run.policy_id FROM outcome_factual_reconciliation_run run JOIN outcome_private_valuation_factual_output output USING(factual_run_id) WHERE output.request_id=$1)`,
      /source or policy is unavailable/,
    ],
    [
      'expired Gate 0A',
      `UPDATE outcome_gate_decision SET revalidate_at=effective_at+interval '1 second' WHERE decision_id=(SELECT capture.manifest_json#>>'{gate0aReceipt,content,result,decisionId}' FROM outcome_source_capture capture JOIN outcome_private_valuation_source_admission admission ON admission.source_capture_id=capture.capture_id WHERE admission.request_id=$1)`,
      /source rights are no longer current/,
    ],
    [
      'unpermitted consumed source field',
      `UPDATE outcome_provider_numeric_metric_fact SET fact_json=jsonb_set(fact_json,'{source,consumedSourceFields}','["unreviewed_field"]') WHERE fact_batch_id=(SELECT fact_batch_id FROM outcome_private_valuation_factual_output WHERE request_id=$1)`,
      /source rights are no longer current/,
    ],
    [
      'missing consumed source fields',
      `UPDATE outcome_provider_numeric_metric_fact SET fact_json=fact_json#-'{source,consumedSourceFields}' WHERE fact_batch_id=(SELECT fact_batch_id FROM outcome_private_valuation_factual_output WHERE request_id=$1)`,
      /consumed source fields are incomplete/,
    ],
    [
      'rejected factual candidate',
      `UPDATE outcome_factual_release_candidate SET status='rejected' WHERE candidate_id=(SELECT candidate_id FROM outcome_private_valuation_factual_output WHERE request_id=$1)`,
      /parent custody is invalid/,
    ],
    [
      'substituted output bytes',
      `UPDATE outcome_private_valuation_factual_output SET output_json=jsonb_set(output_json,'{content,candidate,memberSetSha256}',to_jsonb(repeat('f',64))) WHERE request_id=$1`,
      /output content is invalid/,
    ],
    [
      'foreign Gate scope',
      `UPDATE outcome_gate_proposal SET proposal_json=jsonb_set(proposal_json,'{content,scope,dimensions}','[]') WHERE proposal_id IN (SELECT gate.proposal_id FROM outcome_gate_decision gate JOIN outcome_source_capture capture ON gate.decision_id=capture.manifest_json#>>'{gate0aReceipt,content,result,decisionId}' JOIN outcome_private_valuation_source_admission admission ON admission.source_capture_id=capture.capture_id WHERE admission.request_id=$1)`,
      /source rights are no longer current/,
    ],
    [
      'expired live claim',
      `UPDATE outcome_private_valuation_dispatch_request SET lease_expires_at=claimed_at WHERE request_id=$1`,
      /claim|lease/i,
    ],
  ])('rejects %s on current authentication', async (_label, mutation, message) => {
    await expect(
      client.transaction(async (transaction) => {
        // Deliberately corrupt isolated upstream state; target validation remains enabled.
        await transaction.query("SET LOCAL session_replication_role='replica'");
        expect((await transaction.query(mutation as string, [requestId])).rowCount).toBeGreaterThan(
          0
        );
        await transaction.query("SET LOCAL session_replication_role='origin'");
        await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
        await transaction.query(
          'SELECT authenticate_outcome_private_valuation_source_factual_output($1,$2)',
          [requestId, outputId]
        );
      })
    ).rejects.toThrow(message as RegExp);
  });

  it('rejects a legitimate successor withdrawing the decode-map review', async () => {
    await expect(
      client.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at,supersedes_decision_id)
        SELECT 'review-decision:'||repeat('a',64),review.subject_type,review.subject_id,'rejected',
          'Synthetic currentness regression',review.evidence_json,'synthetic-source-first-reviewer',clock_timestamp(),review.decision_id
        FROM outcome_review_decision review JOIN outcome_provider_field_map map ON map.approval_decision_id=review.decision_id
        JOIN outcome_provider_normalization_run run USING(field_map_id)
        JOIN outcome_private_valuation_factual_output output ON output.normalization_run_id=run.normalization_run_id
        WHERE output.request_id=$1`,
          [requestId]
        );
        await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
        await transaction.query(
          'SELECT authenticate_outcome_private_valuation_source_factual_output($1,$2)',
          [requestId, outputId]
        );
      })
    ).rejects.toThrow(/review is no longer current/);
  });
});
