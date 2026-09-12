import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeValuationDatasetAdmissionReceipt } from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import { prepareLocalAflTradeFitzRoyFactualReleaseCandidate } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { PostgresAflTradePrivateValuationSourceAdmission } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationSourceAdmission';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { admittedRunFixture } from './admittedPlayerModelRunFixture';
import {
  persistPrivateValuationFactualCandidateFixture,
  seedPrivateValuationAcquisitionSpellFixture,
  stageAcceptedPrivateValuationCaptureFixture,
} from './privateValuationFactualPreparationFixture';

const hash = (character: string) => character.repeat(64);

export async function admittedPlayerFactualPreparationFixture(
  client: AflOutcomeSqlClient,
  operationKey = 'admitted-v2-preparation'
) {
  const staged = await stageAcceptedPrivateValuationCaptureFixture(client, operationKey);
  const base = await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client);
  await new PostgresAflTradePrivateValuationSourceAdmission(client).admit({
    requestId: staged.requestId,
    claim: { claimId: staged.claim.claimId, leaseToken: staged.claim.leaseToken },
  });
  const spell = await seedPrivateValuationAcquisitionSpellFixture(
    client,
    staged.binding.content.sourceCaptureId,
    base.candidate,
    operationKey
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
  return { staged, dataset, admission, candidate, spell, base };
}
