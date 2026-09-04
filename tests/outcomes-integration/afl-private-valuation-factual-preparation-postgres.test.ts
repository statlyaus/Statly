import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prepareLocalAflTradeFitzRoyFactualReleaseCandidate } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { materializeAflTradePrivateValuationFactualOutput } from '@/server/aflTradeIntelligence/valuation/internal/privateValuationFactualOutputMaterializer';
import { PostgresAflTradePrivateFactualPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationFactualPreparation';
import {
  persistPrivateValuationFactualCandidateFixture,
  seedPrivateValuationAcquisitionSpellFixture,
  stageAcceptedPrivateValuationCaptureFixture,
} from '../testUtils/privateValuationFactualPreparationFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

function transactionalClient(transaction: AflOutcomeSqlTransaction): AflOutcomeSqlClient {
  return {
    query: transaction.query.bind(transaction),
    transaction: async (work) => work(transaction),
  };
}

beforeAll(async () => {
  await adminPool.query(`DO $role$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_spell_metric_policy_reviewer') THEN
      CREATE ROLE afl_trade_nonproduction_spell_metric_policy_reviewer NOLOGIN;
    END IF;
  END $role$`);
  await adminPool.query(
    'GRANT afl_trade_nonproduction_spell_metric_policy_reviewer TO statly_test'
  );
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
  await adminPool.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
  await adminPool.query(
    `GRANT SELECT,INSERT ON "${schemaName}".outcome_review_decision TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
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
  }
  try {
    await adminPool.end();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Private factual-preparation PostgreSQL cleanup failed.');
  }
});

describe.sequential('private valuation factual preparation in PostgreSQL', () => {
  it('prepares and exactly replays one accepted capture without changing public authority', async () => {
    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const staged = await stageAcceptedPrivateValuationCaptureFixture(
      client,
      'private-factual-preparation-tracer'
    );
    const before = await outcomesPool.query<{
      revision: number;
      events: string;
      active_releases: string;
      projections: string;
    }>(
      `SELECT
        (SELECT revision FROM outcome_registry_head WHERE singleton_id=1) AS revision,
        (SELECT count(*)::text FROM outcome_registry_event) AS events,
        (SELECT count(*)::text FROM outcome_active_release) AS active_releases,
        (SELECT count(*)::text FROM outcome_projection_manifest) AS projections`
    );

    let factual: Awaited<ReturnType<typeof prepareLocalAflTradeFitzRoyFactualReleaseCandidate>>;
    let sourcePreparationCalls = 0;
    let candidatePreparationCalls = 0;
    const preparation = new PostgresAflTradePrivateFactualPreparation(client, {
      prepareSourceEvidence: async () => {
        sourcePreparationCalls += 1;
        factual = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client);
      },
      prepareCandidate: async ({ admission }) => {
        candidatePreparationCalls += 1;
        expect(admission.content).toMatchObject({
          requestId: staged.requestId,
          captureBindingId: staged.binding.bindingId,
          sourceCaptureId: staged.binding.content.sourceCaptureId,
        });
        const spell = await seedPrivateValuationAcquisitionSpellFixture(
          client,
          staged.binding.content.sourceCaptureId,
          factual.candidate
        );
        const candidate = await persistPrivateValuationFactualCandidateFixture(
          client,
          factual.candidate,
          spell,
          staged.claim.request.scopeKey
        );
        return { candidateId: candidate.candidateId };
      },
    });
    const preparationInput = {
      requestId: staged.requestId,
      claim: { claimId: staged.claim.claimId, leaseToken: staged.claim.leaseToken },
    };
    const concurrent = await Promise.all([
      preparation.prepare(preparationInput),
      preparation.prepare(preparationInput),
    ]);
    expect(concurrent.map(({ state }) => state).sort()).toEqual(['already_prepared', 'prepared']);
    expect(sourcePreparationCalls).toBe(1);
    expect(candidatePreparationCalls).toBe(1);
    const result = concurrent.find(({ state }) => state === 'prepared');
    if (!result) throw new TypeError('Concurrent preparation did not retain one created result.');
    expect(concurrent[0]?.output).toEqual(concurrent[1]?.output);
    await expect(
      materializeAflTradePrivateValuationFactualOutput(client, {
        requestId: staged.requestId,
        candidateId: `factual-release-candidate:${'0'.repeat(64)}`,
      })
    ).rejects.toThrow(/exact finalized fact, reconciliation, and candidate chain/);

    expect(result).toMatchObject({
      state: 'prepared',
      output: {
        content: {
          requestId: staged.requestId,
          captureBindingId: staged.binding.bindingId,
          sourceAdmissionId: expect.stringMatching(/^private-valuation-source-admission:/),
          normalizationRunId: staged.binding.content.normalizationRunId,
          factBatch: { batchId: expect.stringMatching(/^source-fact-batch:/) },
          reconciliation: { factualRunId: expect.stringMatching(/^factual-reconciliation-run:/) },
          spellMetricBatches: [
            { batchId: expect.stringMatching(/^acquisition-spell-metric-batch:/) },
          ],
          candidate: { candidateId: expect.stringMatching(/^factual-release-candidate:/) },
          factualRelease: { releaseId: expect.stringMatching(/^outcome-release:/) },
          publicationEligible: false,
          publicationProhibited: true,
        },
      },
    });

    const restarted = await new PostgresAflTradePrivateFactualPreparation(client, {
      prepareSourceEvidence: async () => {
        throw new Error('Restart replay must not rebuild factual evidence.');
      },
      prepareCandidate: async () => {
        throw new Error('Restart replay must not rebuild the factual candidate.');
      },
    }).prepare({
      requestId: staged.requestId,
      claim: { claimId: staged.claim.claimId, leaseToken: staged.claim.leaseToken },
    });
    expect(restarted).toEqual({
      state: 'already_prepared',
      output: result.output,
    });
    const wrongLeaseToken = `${staged.claim.leaseToken[0] === 'f' ? 'e' : 'f'}${staged.claim.leaseToken.slice(1)}`;
    await expect(
      new PostgresAflTradePrivateFactualPreparation(client, {
        prepareSourceEvidence: async () => {
          throw new Error('Invalid replay authority must fail before source preparation.');
        },
        prepareCandidate: async () => {
          throw new Error('Invalid replay authority must fail before candidate preparation.');
        },
      }).prepare({
        requestId: staged.requestId,
        claim: { claimId: staged.claim.claimId, leaseToken: wrongLeaseToken },
      })
    ).rejects.toThrow(/lost its live dispatch claim fence/);

    await client.transaction(async (transaction) => {
      await transaction.query('SAVEPOINT mixed_run_attack');
      await transaction.query(`SET LOCAL session_replication_role='replica'`);
      const mutated = await transaction.query(
        `UPDATE outcome_acquisition_spell_metric_version_member
            SET factual_run_id=$2
          WHERE (spell_metric_version_id,reconciled_fact_id)=(
            SELECT metric_member.spell_metric_version_id,metric_member.reconciled_fact_id
              FROM outcome_release_spell_metric_member release_member
              JOIN outcome_acquisition_spell_metric_version_member metric_member
                ON metric_member.spell_metric_version_id=release_member.spell_metric_version_id
             WHERE release_member.candidate_id=$1
             ORDER BY metric_member.reconciled_fact_id
             LIMIT 1)`,
        [
          result.output.content.candidate.candidateId,
          `factual-reconciliation-run:${'f'.repeat(64)}`,
        ]
      );
      expect(mutated.rowCount).toBe(1);
      await transaction.query(`SET LOCAL session_replication_role='origin'`);
      await expect(
        materializeAflTradePrivateValuationFactualOutput(transactionalClient(transaction), {
          requestId: staged.requestId,
          candidateId: result.output.content.candidate.candidateId,
        })
      ).rejects.toThrow(/finalized acquisition-spell metrics from the exact factual run/);
      await transaction.query('ROLLBACK TO SAVEPOINT mixed_run_attack');
    });
    await client.transaction(async (transaction) => {
      await transaction.query('SAVEPOINT extra_source_attack');
      await transaction.query(`SET LOCAL session_replication_role='replica'`);
      await transaction.query(
        `INSERT INTO outcome_release_source_capture
          (release_id,capture_id,ordinal,record_sha256,membership_json)
         SELECT $1,$2,COALESCE(MAX(ordinal),0)+1,$3,'{}'::jsonb
           FROM outcome_release_source_capture
          WHERE release_id=$1`,
        [
          result.output.content.factualRelease.releaseId,
          `source-capture:${'e'.repeat(64)}`,
          'e'.repeat(64),
        ]
      );
      await transaction.query(`SET LOCAL session_replication_role='origin'`);
      await expect(
        materializeAflTradePrivateValuationFactualOutput(transactionalClient(transaction), {
          requestId: staged.requestId,
          candidateId: result.output.content.candidate.candidateId,
        })
      ).rejects.toThrow(/exact finalized fact, reconciliation, and candidate chain/);
      await transaction.query('ROLLBACK TO SAVEPOINT extra_source_attack');

      await transaction.query('SAVEPOINT extra_run_attack');
      await transaction.query(`SET LOCAL session_replication_role='replica'`);
      await transaction.query(
        `INSERT INTO outcome_release_factual_run_member
          (candidate_id,factual_run_id,ordinal,record_sha256,membership_json)
         SELECT $1,$2,COALESCE(MAX(ordinal),0)+1,$3,'{}'::jsonb
           FROM outcome_release_factual_run_member
          WHERE candidate_id=$1`,
        [
          result.output.content.candidate.candidateId,
          `factual-reconciliation-run:${'d'.repeat(64)}`,
          'd'.repeat(64),
        ]
      );
      await transaction.query(`SET LOCAL session_replication_role='origin'`);
      await expect(
        materializeAflTradePrivateValuationFactualOutput(transactionalClient(transaction), {
          requestId: staged.requestId,
          candidateId: result.output.content.candidate.candidateId,
        })
      ).rejects.toThrow(/exact finalized fact, reconciliation, and candidate chain/);
      await transaction.query('ROLLBACK TO SAVEPOINT extra_run_attack');
    });
    await expect(
      outcomesPool.query(
        `SELECT
          (SELECT revision FROM outcome_registry_head WHERE singleton_id=1) AS revision,
          (SELECT count(*)::text FROM outcome_registry_event) AS events,
          (SELECT count(*)::text FROM outcome_active_release) AS active_releases,
          (SELECT count(*)::text FROM outcome_projection_manifest) AS projections`
      )
    ).resolves.toMatchObject({ rows: before.rows });
    await expect(
      outcomesPool.query<{ outputs: string; admissions: string; candidates: string }>(
        `SELECT
          (SELECT count(*)::text FROM outcome_private_valuation_factual_output
            WHERE request_id=$1) AS outputs,
          (SELECT count(*)::text FROM outcome_private_valuation_source_admission
            WHERE request_id=$1) AS admissions,
          (SELECT count(*)::text FROM outcome_factual_release_candidate) AS candidates`,
        [staged.requestId]
      )
    ).resolves.toMatchObject({
      rows: [{ outputs: '1', admissions: '1', candidates: '1' }],
    });
    await expect(
      outcomesPool.query<{ legacy_metrics: string; versioned_members: string }>(
        `SELECT
          (SELECT count(*)::text FROM outcome_acquisition_spell_metric) AS legacy_metrics,
          (SELECT count(*)::text FROM outcome_release_spell_metric_member) AS versioned_members`
      )
    ).resolves.toMatchObject({
      rows: [{ legacy_metrics: '0', versioned_members: '2' }],
    });
  });

  it('rejects substituted spell ancestry and prevents legacy rows bypassing versioned checks', async () => {
    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const factual = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client);
    const captureId = factual.candidate.content.members.sourceCaptures[0]?.captureId;
    if (!captureId) throw new TypeError('The adversarial fixture requires one source capture.');

    const substitutedSpell = await seedPrivateValuationAcquisitionSpellFixture(
      client,
      captureId,
      factual.candidate,
      'substituted-spell'
    );
    await expect(
      persistPrivateValuationFactualCandidateFixture(
        client,
        factual.candidate,
        substitutedSpell,
        'afl-men:2026-trades',
        { playerId: 'fixture-substituted-player' }
      )
    ).rejects.toThrow(/must equal the factual candidate declaration/);

    const legacyBypassSpell = await seedPrivateValuationAcquisitionSpellFixture(
      client,
      captureId,
      factual.candidate,
      'legacy-bypass'
    );
    await client.query(
      `INSERT INTO outcome_acquisition_spell_metric
        (spell_version_id,metric_code,metric_definition_version,numeric_value,numerator,
         denominator,coverage_state,observation_count,effective_through,evidence_json)
       VALUES ($1,'games','games/v1',0,0,1,'complete',1,'2026-08-12','{}'::jsonb)`,
      [legacyBypassSpell.spellVersionId]
    );
    await client.transaction(async (transaction) => {
      await transaction.query(
        'SET LOCAL ROLE afl_trade_nonproduction_spell_metric_policy_reviewer'
      );
      await transaction.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,supersedes_decision_id,
           rationale,evidence_json,decided_by,decided_at)
         VALUES ($1,'acquisition_spell_metric_policy',$2,'withdrawn',$3,$4,$5::jsonb,$6,$7)`,
        [
          `spell-metric-policy-withdrawal:${legacyBypassSpell.policy.policyId}`,
          legacyBypassSpell.policy.policyId,
          legacyBypassSpell.policy.content.approval.id,
          'Withdraw the disposable policy to prove legacy evidence cannot bypass versioned checks.',
          JSON.stringify({ environment: 'non_production' }),
          'private-valuation-fixture-reviewer',
          '2026-08-12T00:05:00.000Z',
        ]
      );
    });
    await expect(
      persistPrivateValuationFactualCandidateFixture(
        client,
        factual.candidate,
        legacyBypassSpell,
        'afl-men:2026-trades'
      )
    ).rejects.toThrow(/exact approved versioned metrics/);
  });
});
