import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeValuationDatasetAdmissionReceipt } from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import { prepareLocalAflTradeFitzRoyFactualReleaseCandidate } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePrivateValuationSourceAdmission } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationSourceAdmission';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';

import { admittedRunFixture } from '../testUtils/admittedPlayerModelRunFixture';
import {
  persistPrivateValuationFactualCandidateFixture,
  seedPrivateValuationAcquisitionSpellFixture,
  stageAcceptedPrivateValuationCaptureFixture,
} from '../testUtils/privateValuationFactualPreparationFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const readerRole = `afl_admitted_factual_reader_${process.pid}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const restrictedPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName} -c role=afl_trade_private_evaluation_coordinator`,
});
const client = createPgAflOutcomeSqlClient(pool);
const restricted = createPgAflOutcomeSqlClient(restrictedPool);
const hash = (character: string) => character.repeat(64);

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
  await admin.query(`CREATE ROLE "${readerRole}" NOLOGIN`);
  await admin.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${readerRole}"`);
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
  await admin.query(
    `GRANT SELECT,INSERT ON "${schemaName}".outcome_review_decision TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
});

afterAll(async () => {
  await restrictedPool.end();
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS "${readerRole}"`);
  } finally {
    await admin.end();
  }
});

async function admittedFixture() {
  const staged = await stageAcceptedPrivateValuationCaptureFixture(
    client,
    'admitted-v2-preparation'
  );
  const base = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client);
  await new PostgresAflTradePrivateValuationSourceAdmission(client).admit({
    requestId: staged.requestId,
    claim: { claimId: staged.claim.claimId, leaseToken: staged.claim.leaseToken },
  });
  const spell = await seedPrivateValuationAcquisitionSpellFixture(
    client,
    staged.binding.content.sourceCaptureId,
    base.candidate,
    'admitted-v2-preparation'
  );
  const candidate = await persistPrivateValuationFactualCandidateFixture(
    client,
    base.candidate,
    spell,
    staged.claim.request.scopeKey
  );
  const fixture = admittedRunFixture('non_production', {
    scopeKey: staged.claim.request.scopeKey,
    factualReleaseId: candidate.content.targetRelease.id,
    factualCandidateId: candidate.candidateId,
    sourceMemberSetSha256: candidate.content.memberSetSha256,
    metricRegistryVersion: 'fixture-v1',
    acquisitionSpellRuleId: `acquisition-spell-rule:${hash('8')}`,
    factualEffectiveThrough: candidate.content.effectiveThrough,
  });
  const admission = createAflTradeValuationDatasetAdmissionReceipt({
    ...fixture.admission.content,
    sourceRightsEvaluations: ['a', 'b'].map((marker) => ({
      ...fixture.admission.content.sourceRightsEvaluations[0]!,
      captureId: `source-capture:${hash(marker)}`,
      sourceSnapshotId: `source-snapshot:${hash(marker)}`,
      consumedFieldSetId: `consumed-field-set:${hash(marker)}`,
      consumedFieldSetSha256: hash(marker),
    })),
  });
  const dataset = fixture.datasetCandidate;
  // Synthetic upstream admission isolates this adapter seam. Output retention and its
  // complete migrated authority trigger run normally through the restricted caller.
  await client.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL session_replication_role='replica'`);
    await transaction.query(
      `INSERT INTO outcome_valuation_dataset_candidate
       (dataset_id,environment,scope_key,competition,created_at,knowledge_cutoff_at,
        factual_release_id,factual_candidate_id,corpus_id,lineage_id,source_member_set_sha256,
        row_count,row_set_sha256,row_set_canonical_json,artifact_count,status,
        dataset_canonical_json,dataset_json,finalized_at)
       VALUES ($1,'non_production',$2,'AFLM',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,10,
               'finalized',$13,$14::jsonb,$3)`,
      [
        dataset.datasetId,
        dataset.content.scopeKey,
        dataset.content.createdAt,
        dataset.content.knowledgeCutoffAt,
        candidate.content.targetRelease.id,
        candidate.candidateId,
        dataset.content.factualParent.corpusId,
        dataset.content.factualParent.corpusToCandidateLineageId,
        candidate.content.memberSetSha256,
        dataset.content.rows.length,
        dataset.content.rowSetSha256,
        canonicalizeAflTradeJson(dataset.content.rows),
        canonicalizeAflTradeJson(dataset.content),
        canonicalizeAflTradeJson(dataset),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_valuation_dataset_admission
       (admission_id,dataset_id,environment,admitted_at,gate2_decision_id,gate_ledger_revision,
        analytical_authority_receipt_id,operational_authorization_receipt_id,source_count,status,
        admission_canonical_json,admission_json,finalized_at)
       VALUES ($1,$2,'non_production',$3,$4,1,$5,$6,2,'finalized',$7,$8::jsonb,$3)`,
      [
        admission.admissionId,
        dataset.datasetId,
        admission.content.admittedAt,
        admission.content.gate2Decision.decisionId,
        admission.content.analyticalAuthorityReceiptId,
        admission.content.operationalAuthorizationReceiptId,
        canonicalizeAflTradeJson(admission.content),
        canonicalizeAflTradeJson(admission),
      ]
    );
    await transaction.query(
      `INSERT INTO outcome_record_state_commitment
       (event_revision,release_id,record_state_id,record_state_json) VALUES (1,$1,$2,$3::jsonb)`,
      [
        candidate.content.targetRelease.id,
        dataset.content.factualParent.releaseRecordStateId,
        canonicalizeAflTradeJson({ state: 'approved' }),
      ]
    );
  });
  return { staged, dataset, admission, candidate };
}

describe.sequential('admitted-player factual preparation in PostgreSQL', () => {
  it('retains both admitted captures, exactly replays, and rejects mismatched or stale custody', async () => {
    const fixture = await admittedFixture();
    const { PostgresAflTradeAdmittedPlayerFactualPreparation } =
      await import('@/server/aflTradeIntelligence/valuation/postgresAdmittedPlayerFactualPreparation');
    const adapter = new PostgresAflTradeAdmittedPlayerFactualPreparation(restricted);
    const input = {
      requestId: fixture.staged.requestId,
      claim: { claimId: fixture.staged.claim.claimId, leaseToken: fixture.staged.claim.leaseToken },
      datasetId: fixture.dataset.datasetId,
      admissionId: fixture.admission.admissionId,
    };
    await expect(
      client.transaction(async (transaction) => {
        await transaction.query(`SET LOCAL ROLE "${readerRole}"`);
        await transaction.query(
          'SELECT load_outcome_admitted_player_factual_parent($1,$2,$3,$4,$5)',
          [input.requestId, input.claim.claimId, hash('0'), input.datasetId, input.admissionId]
        );
      })
    ).rejects.toThrow('permission denied for function load_outcome_admitted_player_factual_parent');
    await expect(
      adapter.prepare({ ...input, admissionId: `dataset-admission:${hash('f')}` })
    ).rejects.toThrow('Exact admitted-player factual parent is unavailable');
    const first = await adapter.prepare(input);
    expect(first.state).toBe('prepared');
    expect(first.output.content).toMatchObject({
      schemaVersion: 'afl-trade-private-valuation-factual-output/v2',
      admittedPlayerDataset: { datasetId: input.datasetId, admissionId: input.admissionId },
      sourceCaptures: ['a', 'b'].map((marker) => ({
        captureId: `source-capture:${hash(marker)}`,
        sourceSnapshotId: `source-snapshot:${hash(marker)}`,
        consumedFieldSetId: `consumed-field-set:${hash(marker)}`,
        consumedFieldSetSha256: hash(marker),
      })),
      publicationEligible: false,
      publicationProhibited: true,
    });
    await expect(adapter.prepare(input)).resolves.toEqual({
      state: 'already_prepared',
      output: first.output,
    });
    await expect(
      adapter.prepare({ ...input, admissionId: `dataset-admission:${hash('f')}` })
    ).rejects.toThrow('Retained admitted-player factual output binds another dataset or admission');
    await expect(
      adapter.prepare({ ...input, claim: { ...input.claim, leaseToken: hash('0') } })
    ).rejects.toThrow();
    const stored = await pool.query(
      `SELECT count(*)::integer AS count,
       bool_and(capture_binding_id IS NULL AND source_admission_id IS NULL
         AND normalization_run_id IS NULL AND fact_batch_id IS NULL AND factual_run_id IS NULL) AS no_legacy_parent
       FROM outcome_private_valuation_factual_output WHERE request_id=$1`,
      [input.requestId]
    );
    expect(stored.rows).toEqual([{ count: 1, no_legacy_parent: true }]);
    await client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL session_replication_role='replica'`);
      await transaction.query(
        `INSERT INTO outcome_record_state_commitment
         (event_revision,release_id,record_state_id,record_state_json) VALUES (2,$1,$2,$3::jsonb)`,
        [
          fixture.candidate.content.targetRelease.id,
          `outcome-release-record-state:${hash('f')}`,
          canonicalizeAflTradeJson({ state: 'withdrawn' }),
        ]
      );
    });
    await expect(adapter.prepare(input)).rejects.toThrow(
      'Exact admitted-player factual parent is unavailable'
    );
    await new PostgresAflTradePrivateValuationScheduleRepository(restricted).complete({
      ...input.claim,
      result: { state: 'exhausted' },
    });
    await expect(adapter.prepare(input)).rejects.toThrow(/claim|dispatch/i);
  });
});
