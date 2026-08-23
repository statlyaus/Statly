import type { AflOutcomeSqlClient } from '../../outcomes/postgresOutcomeReleaseRepository';
import {
  createAflTradePrivateValuationFactualOutput,
  type AflTradePrivateValuationFactualOutput,
} from '../privateValuationFactualOutput';

interface ParentRow {
  scope_key: string;
  binding_id: string;
  source_admission_id: string;
  normalization_run_id: string;
  fact_batch_id: string;
  fact_batch_sha256: string;
  factual_run_id: string;
  run_sha256: string;
  output_set_sha256: string;
  factual_run_finalized_at: Date | string;
  candidate_id: string;
  candidate_sha256: string;
  member_set_sha256: string;
  target_release_id: string;
  candidate_finalized_at: Date | string;
}

interface SpellBatchRow {
  batch_id: string;
  batch_sha256: string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class AflTradePrivateValuationFactualOutputUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AflTradePrivateValuationFactualOutputUnavailableError';
  }
}

export async function materializeAflTradePrivateValuationFactualOutput(
  client: AflOutcomeSqlClient,
  input: { requestId: string; candidateId: string }
): Promise<AflTradePrivateValuationFactualOutput> {
  const parents = await client.query<ParentRow>(
    `SELECT request.scope_key,binding.binding_id,admission.admission_id AS source_admission_id,
            binding.normalization_run_id,
            fact_batch.fact_batch_id,fact_batch.fact_batch_sha256,
            factual_run.factual_run_id,factual_run.run_sha256,factual_run.output_set_sha256,
            factual_run.finalized_at AS factual_run_finalized_at,
            candidate.candidate_id,candidate.candidate_sha256,candidate.member_set_sha256,
            candidate.target_release_id,candidate.finalized_at AS candidate_finalized_at
       FROM outcome_private_valuation_dispatch_request request
       JOIN outcome_private_valuation_capture_binding binding
         ON binding.request_id=request.request_id
       JOIN outcome_private_valuation_source_admission admission
         ON admission.request_id=request.request_id
        AND admission.capture_binding_id=binding.binding_id
        AND admission.source_capture_id=binding.source_capture_id
        AND admission.normalization_run_id=binding.normalization_run_id
       JOIN outcome_provider_fact_batch fact_batch
         ON fact_batch.fact_batch_id=admission.fact_batch_id
        AND fact_batch.normalization_run_id=binding.normalization_run_id
        AND fact_batch.capture_id=binding.source_capture_id
        AND fact_batch.status='approved' AND fact_batch.finalized_at IS NOT NULL
       JOIN outcome_provider_numeric_metric_fact metric_fact
         ON metric_fact.fact_batch_id=fact_batch.fact_batch_id
       JOIN outcome_factual_reconciliation_metric_input metric_input
         ON metric_input.metric_fact_id=metric_fact.metric_fact_id
       JOIN outcome_factual_reconciliation_run factual_run
         ON factual_run.factual_run_id=admission.factual_run_id
        AND factual_run.factual_run_id=metric_input.factual_run_id
        AND factual_run.status='approved' AND factual_run.finalized_at IS NOT NULL
       JOIN outcome_release_factual_run_member factual_member
         ON factual_member.factual_run_id=factual_run.factual_run_id
       JOIN outcome_factual_release_candidate candidate
         ON candidate.candidate_id=factual_member.candidate_id
        AND candidate.status='approved' AND candidate.finalized_at IS NOT NULL
       JOIN outcome_release_source_capture source_member
         ON source_member.release_id=candidate.target_release_id
        AND source_member.capture_id=binding.source_capture_id
      WHERE request.request_id=$1
        AND candidate.candidate_id=$2
        AND request.scope_key=candidate.scope_key
        AND candidate.environment='non_production'
        AND NOT EXISTS (
          SELECT 1
            FROM outcome_release_source_capture candidate_source
           WHERE candidate_source.release_id=candidate.target_release_id
             AND candidate_source.capture_id<>binding.source_capture_id)
        AND NOT EXISTS (
          SELECT 1
            FROM outcome_release_factual_run_member candidate_run
           WHERE candidate_run.candidate_id=candidate.candidate_id
             AND candidate_run.factual_run_id<>factual_run.factual_run_id)
        AND NOT EXISTS (
          SELECT 1 FROM outcome_registry_event event
           WHERE event.release_id=candidate.target_release_id)
      GROUP BY request.scope_key,binding.binding_id,admission.admission_id,
               binding.normalization_run_id,
               fact_batch.fact_batch_id,fact_batch.fact_batch_sha256,
               factual_run.factual_run_id,factual_run.run_sha256,factual_run.output_set_sha256,
               factual_run.finalized_at,candidate.candidate_id,candidate.candidate_sha256,
               candidate.member_set_sha256,candidate.target_release_id,candidate.finalized_at`,
    [input.requestId, input.candidateId]
  );
  if (parents.rows.length !== 1) {
    throw new AflTradePrivateValuationFactualOutputUnavailableError(
      'Private factual preparation requires one exact finalized fact, reconciliation, and candidate chain.'
    );
  }
  const parent = parents.rows[0];
  const batches = await client.query<SpellBatchRow>(
    `SELECT DISTINCT batch.batch_id,batch.batch_sha256
       FROM outcome_release_spell_metric_member candidate_member
       JOIN outcome_acquisition_spell_metric_version metric_version
         ON metric_version.spell_metric_version_id=candidate_member.spell_metric_version_id
       JOIN outcome_acquisition_spell_metric_batch batch
         ON batch.batch_id=metric_version.batch_id
        AND batch.status='approved' AND batch.finalized_at IS NOT NULL
      JOIN outcome_acquisition_spell_metric_version_member factual_member
         ON factual_member.spell_metric_version_id=metric_version.spell_metric_version_id
        AND factual_member.factual_run_id=$2
      WHERE candidate_member.candidate_id=$1
        AND NOT EXISTS (
          SELECT 1
            FROM outcome_release_spell_metric_member sibling_member
            JOIN outcome_acquisition_spell_metric_version sibling_version
              ON sibling_version.spell_metric_version_id=sibling_member.spell_metric_version_id
           WHERE sibling_member.candidate_id=candidate_member.candidate_id
             AND sibling_version.batch_id=batch.batch_id
             AND EXISTS (
               SELECT 1
                 FROM outcome_acquisition_spell_metric_version_member foreign_member
                WHERE foreign_member.spell_metric_version_id=sibling_version.spell_metric_version_id
                  AND foreign_member.factual_run_id<>$2))
      ORDER BY batch.batch_id`,
    [parent.candidate_id, parent.factual_run_id]
  );
  if (batches.rows.length === 0) {
    throw new AflTradePrivateValuationFactualOutputUnavailableError(
      'Private factual preparation requires finalized acquisition-spell metrics from the exact factual run.'
    );
  }
  return createAflTradePrivateValuationFactualOutput({
    requestId: input.requestId,
    valuationScopeKey: parent.scope_key,
    captureBindingId: parent.binding_id,
    sourceAdmissionId: parent.source_admission_id,
    normalizationRunId: parent.normalization_run_id,
    factBatch: {
      batchId: parent.fact_batch_id,
      batchSha256: parent.fact_batch_sha256,
    },
    reconciliation: {
      factualRunId: parent.factual_run_id,
      runSha256: parent.run_sha256,
      outputSetSha256: parent.output_set_sha256,
      finalizedAt: asIso(parent.factual_run_finalized_at),
    },
    spellMetricBatches: batches.rows.map((batch) => ({
      batchId: batch.batch_id,
      batchSha256: batch.batch_sha256,
    })),
    candidate: {
      candidateId: parent.candidate_id,
      candidateSha256: parent.candidate_sha256,
      memberSetSha256: parent.member_set_sha256,
    },
    factualRelease: {
      releaseId: parent.target_release_id,
      releaseSha256: parent.target_release_id.slice('outcome-release:'.length),
    },
    preparedAt: asIso(parent.candidate_finalized_at),
  });
}
