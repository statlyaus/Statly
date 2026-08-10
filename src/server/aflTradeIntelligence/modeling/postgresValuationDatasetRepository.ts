import {
  aflTradeConsumedFieldSetSchema,
  aflTradeDatasetOperationAuthorizationSchema,
  aflTradeValuationDatasetAdmissionReceiptSchema,
  aflTradeValuationDatasetCandidateSchema,
  listAflTradeValuationDatasetArtifactMemberships,
  type AflTradeConsumedFieldSet,
  type AflTradeDatasetOperationAuthorization,
  type AflTradeValuationDatasetAdmissionReceipt,
  type AflTradeValuationDatasetCandidate,
} from '../artifacts/valuationDatasetAdmissionContracts';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeGate0AReceiptSchema, type AflTradeGate0AReceipt } from '../source/gate0aReceipt';

export type AflTradeValuationDatasetPersistenceErrorCode =
  'INVALID_INPUT' | 'CONFLICTING_REPLAY' | 'INCOMPLETE_WRITE';

export class AflTradeValuationDatasetPersistenceError extends Error {
  constructor(
    readonly code: AflTradeValuationDatasetPersistenceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeValuationDatasetPersistenceError';
  }
}

export interface AflTradeValuationDatasetSourcePersistenceEvidence {
  captureId: string;
  sourceSnapshotId: string;
  consumedFieldSetId: string;
  rightsArtifactId: string;
  derivationReceipt: AflTradeGate0AReceipt;
  admissionReceipt: AflTradeGate0AReceipt;
}

export interface AflTradeValuationDatasetAdmissionPersistenceEvidence {
  gateLedgerRevision: number;
  analyticalAuthority: AflTradeDatasetOperationAuthorization;
  operationalAuthorization: AflTradeDatasetOperationAuthorization;
  consumedFieldSets: readonly AflTradeConsumedFieldSet[];
  sourceRights: readonly AflTradeValuationDatasetSourcePersistenceEvidence[];
}

interface ReplayRow extends Record<string, unknown> {
  status: string;
  document_json: unknown;
}

interface ExactRow extends Record<string, unknown> {
  canonical_json: string;
}

function invalidInput(message: string, cause?: unknown) {
  return new AflTradeValuationDatasetPersistenceError('INVALID_INPUT', message, { cause });
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

async function lock(transaction: AflOutcomeSqlTransaction, keys: readonly string[]) {
  for (const key of [...new Set(keys)].sort()) {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  }
}

async function candidateReplay(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeValuationDatasetCandidate
): Promise<boolean> {
  const result = await transaction.query<ReplayRow>(
    `SELECT status,dataset_json AS document_json
       FROM outcome_valuation_dataset_candidate
      WHERE dataset_id=$1
      FOR UPDATE`,
    [candidate.datasetId]
  );
  const replay = result.rows[0];
  if (!replay) return false;
  if (replay.status !== 'finalized' || !exactJson(replay.document_json, candidate)) {
    throw new AflTradeValuationDatasetPersistenceError(
      'CONFLICTING_REPLAY',
      'The valuation dataset identity already names different or incomplete content.'
    );
  }
  return true;
}

async function admissionReplay(
  transaction: AflOutcomeSqlTransaction,
  receipt: AflTradeValuationDatasetAdmissionReceipt
): Promise<boolean> {
  const result = await transaction.query<ReplayRow>(
    `SELECT status,admission_json AS document_json
       FROM outcome_valuation_dataset_admission
      WHERE admission_id=$1
      FOR UPDATE`,
    [receipt.admissionId]
  );
  const replay = result.rows[0];
  if (!replay) return false;
  if (replay.status !== 'finalized' || !exactJson(replay.document_json, receipt)) {
    throw new AflTradeValuationDatasetPersistenceError(
      'CONFLICTING_REPLAY',
      'The valuation dataset admission identity already names different or incomplete content.'
    );
  }
  return true;
}

async function persistCandidateRows(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeValuationDatasetCandidate
) {
  for (const row of candidate.content.rows) {
    const content = row.content;
    await transaction.query(
      `INSERT INTO outcome_valuation_dataset_row
        (dataset_id,ordinal,row_id,row_key,split_role,season_year,player_id,club_id,event_id,
         event_version_id,acquisition_spell_id,acquisition_spell_version_id,row_canonical_json,
         row_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [
        candidate.datasetId,
        content.ordinal,
        row.rowId,
        content.rowKey,
        content.splitRole,
        content.seasonYear,
        content.identity.playerId,
        content.identity.clubId,
        content.lineage.eventId,
        content.lineage.eventVersionId,
        content.lineage.acquisitionSpellId,
        content.lineage.acquisitionSpellVersionId,
        canonicalizeAflTradeJson(content),
        canonicalizeAflTradeJson(row),
      ]
    );
  }
}

async function persistCandidateArtifacts(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeValuationDatasetCandidate,
  memberships: ReturnType<typeof listAflTradeValuationDatasetArtifactMemberships>
) {
  for (const { role, ordinal, reference } of memberships) {
    await transaction.query(
      `INSERT INTO outcome_valuation_dataset_artifact_member
        (dataset_id,role,ordinal,artifact_id,content_sha256,media_type,byte_length,created_at,
         reference_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        candidate.datasetId,
        role,
        ordinal,
        reference.artifactId,
        reference.contentSha256,
        reference.mediaType,
        reference.byteLength,
        reference.createdAt,
        canonicalizeAflTradeJson(reference),
      ]
    );
  }
}

async function requireOrInsertFieldSet(
  transaction: AflOutcomeSqlTransaction,
  fieldSet: AflTradeConsumedFieldSet
) {
  const canonical = canonicalizeAflTradeJson(fieldSet.content);
  const replay = await transaction.query<ExactRow>(
    `SELECT field_set_canonical_json AS canonical_json
       FROM outcome_valuation_dataset_consumed_field_set
      WHERE field_set_id=$1 FOR SHARE`,
    [fieldSet.fieldSetId]
  );
  if (replay.rows[0]) {
    if (replay.rows[0].canonical_json !== canonical) {
      throw new AflTradeValuationDatasetPersistenceError(
        'CONFLICTING_REPLAY',
        'The consumed field-set identity already names different content.'
      );
    }
    return;
  }
  await transaction.query(
    `INSERT INTO outcome_valuation_dataset_consumed_field_set
      (field_set_id,capture_id,source_snapshot_id,created_at,field_set_sha256,
       fields_canonical_json,field_set_canonical_json,field_set_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      fieldSet.fieldSetId,
      fieldSet.content.captureId,
      fieldSet.content.sourceSnapshotId,
      fieldSet.content.createdAt,
      fieldSet.content.fieldSetSha256,
      canonicalizeAflTradeJson(fieldSet.content.fields),
      canonical,
      canonicalizeAflTradeJson(fieldSet),
    ]
  );
}

async function requireOrInsertGate0Receipt(
  transaction: AflOutcomeSqlTransaction,
  receipt: AflTradeGate0AReceipt,
  operationKind: 'derived_feature_creation' | 'model_training'
) {
  const canonical = canonicalizeAflTradeJson(receipt.content);
  const replay = await transaction.query<ExactRow>(
    `SELECT receipt_canonical_json AS canonical_json
       FROM outcome_valuation_dataset_gate0_evaluation
      WHERE receipt_id=$1 FOR SHARE`,
    [receipt.receiptId]
  );
  if (replay.rows[0]) {
    if (replay.rows[0].canonical_json !== canonical) {
      throw new AflTradeValuationDatasetPersistenceError(
        'CONFLICTING_REPLAY',
        'The Gate 0A evaluation identity already names different content.'
      );
    }
    return;
  }
  const decisionId = receipt.content.result.decisionId;
  if (decisionId === null)
    throw invalidInput('A persisted Gate 0A evaluation requires a decision.');
  await transaction.query(
    `INSERT INTO outcome_valuation_dataset_gate0_evaluation
      (receipt_id,rights_artifact_id,decision_id,environment,evaluated_at,recorded_at,
       operation_kind,receipt_canonical_json,receipt_json)
     VALUES ($1,$2,$3,$4::"OutcomeEnvironment",$5,$6,$7,$8,$9::jsonb)`,
    [
      receipt.receiptId,
      receipt.content.request.rightsArtifactId,
      decisionId,
      receipt.content.request.environment,
      receipt.content.request.evaluatedAt,
      receipt.content.recordedAt,
      operationKind,
      canonical,
      canonicalizeAflTradeJson(receipt),
    ]
  );
}

async function requireOrInsertOperationAuthority(
  transaction: AflOutcomeSqlTransaction,
  authority: AflTradeDatasetOperationAuthorization
) {
  const canonical = canonicalizeAflTradeJson(authority.content);
  const replay = await transaction.query<ExactRow>(
    `SELECT receipt_canonical_json AS canonical_json
       FROM outcome_valuation_dataset_operation_authority
      WHERE receipt_id=$1 FOR SHARE`,
    [authority.receiptId]
  );
  if (replay.rows[0]) {
    if (replay.rows[0].canonical_json !== canonical) {
      throw new AflTradeValuationDatasetPersistenceError(
        'CONFLICTING_REPLAY',
        'The operation-authorization identity already names different content.'
      );
    }
    return;
  }
  const content = authority.content;
  await transaction.query(
    `INSERT INTO outcome_valuation_dataset_operation_authority
      (receipt_id,authority_kind,environment,scope_key,dataset_id,factual_release_id,
       factual_candidate_id,authorized_at,valid_through,principal_ref,receipt_canonical_json,
       receipt_json)
     VALUES ($1,$2,$3::"OutcomeEnvironment",$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [
      authority.receiptId,
      content.authorityKind,
      content.environment,
      content.scopeKey,
      content.datasetId,
      content.factualReleaseId,
      content.factualCandidateId,
      content.authorizedAt,
      content.validThrough,
      content.principalRef,
      canonical,
      canonicalizeAflTradeJson(authority),
    ]
  );
}

function parsePersistenceEvidence(input: AflTradeValuationDatasetAdmissionPersistenceEvidence) {
  try {
    return {
      gateLedgerRevision: input.gateLedgerRevision,
      analyticalAuthority: aflTradeDatasetOperationAuthorizationSchema.parse(
        input.analyticalAuthority
      ),
      operationalAuthorization: aflTradeDatasetOperationAuthorizationSchema.parse(
        input.operationalAuthorization
      ),
      consumedFieldSets: input.consumedFieldSets.map((value) =>
        aflTradeConsumedFieldSetSchema.parse(value)
      ),
      sourceRights: input.sourceRights.map((value) => ({
        ...value,
        derivationReceipt: aflTradeGate0AReceiptSchema.parse(value.derivationReceipt),
        admissionReceipt: aflTradeGate0AReceiptSchema.parse(value.admissionReceipt),
      })),
    };
  } catch (cause) {
    throw invalidInput('The valuation dataset evidence is invalid.', cause);
  }
}

async function persistEvidenceRecords(
  transaction: AflOutcomeSqlTransaction,
  evidence: ReturnType<typeof parsePersistenceEvidence>
) {
  for (const fieldSet of evidence.consumedFieldSets) {
    await requireOrInsertFieldSet(transaction, fieldSet);
  }
  for (const source of evidence.sourceRights) {
    await requireOrInsertGate0Receipt(
      transaction,
      source.derivationReceipt,
      'derived_feature_creation'
    );
    await requireOrInsertGate0Receipt(transaction, source.admissionReceipt, 'model_training');
  }
  await requireOrInsertOperationAuthority(transaction, evidence.analyticalAuthority);
  await requireOrInsertOperationAuthority(transaction, evidence.operationalAuthorization);
}

export class PostgresAflTradeValuationDatasetRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persistCandidate(unparsed: AflTradeValuationDatasetCandidate) {
    let candidate: AflTradeValuationDatasetCandidate;
    try {
      candidate = aflTradeValuationDatasetCandidateSchema.parse(unparsed);
    } catch (cause) {
      throw invalidInput('The valuation dataset candidate is invalid.', cause);
    }
    return this.client.transaction(async (transaction) => {
      await lock(transaction, [`valuation-dataset:${candidate.datasetId}`]);
      if (await candidateReplay(transaction, candidate)) {
        return { datasetId: candidate.datasetId, idempotentReplay: true } as const;
      }
      const memberships = listAflTradeValuationDatasetArtifactMemberships(candidate);
      await transaction.query(
        `INSERT INTO outcome_valuation_dataset_candidate
          (dataset_id,environment,scope_key,competition,created_at,knowledge_cutoff_at,
           factual_release_id,factual_candidate_id,corpus_id,lineage_id,source_member_set_sha256,
           row_count,row_set_sha256,row_set_canonical_json,artifact_count,status,
           dataset_canonical_json,dataset_json,
           finalized_at)
         VALUES ($1,$2::"OutcomeEnvironment",$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 'staged',$16,$17::jsonb,NULL)`,
        [
          candidate.datasetId,
          candidate.content.environment,
          candidate.content.scopeKey,
          candidate.content.competition,
          candidate.content.createdAt,
          candidate.content.knowledgeCutoffAt,
          candidate.content.factualParent.factualReleaseId,
          candidate.content.factualParent.factualCandidateId,
          candidate.content.factualParent.corpusId,
          candidate.content.factualParent.corpusToCandidateLineageId,
          candidate.content.factualParent.sourceMemberSetSha256,
          candidate.content.rowCount,
          candidate.content.rowSetSha256,
          canonicalizeAflTradeJson(candidate.content.rows),
          memberships.length,
          canonicalizeAflTradeJson(candidate.content),
          canonicalizeAflTradeJson(candidate),
        ]
      );
      await persistCandidateRows(transaction, candidate);
      await persistCandidateArtifacts(transaction, candidate, memberships);
      const finalized = await transaction.query(
        `UPDATE outcome_valuation_dataset_candidate
            SET status='finalized',finalized_at=$2
          WHERE dataset_id=$1 AND status='staged'`,
        [candidate.datasetId, candidate.content.createdAt]
      );
      if (finalized.rowCount !== 1) {
        throw new AflTradeValuationDatasetPersistenceError(
          'INCOMPLETE_WRITE',
          'The valuation dataset candidate did not finalize atomically.'
        );
      }
      return { datasetId: candidate.datasetId, idempotentReplay: false } as const;
    });
  }

  async persistEvidence(
    unparsedDataset: AflTradeValuationDatasetCandidate,
    unparsedEvidence: AflTradeValuationDatasetAdmissionPersistenceEvidence
  ) {
    let dataset: AflTradeValuationDatasetCandidate;
    try {
      dataset = aflTradeValuationDatasetCandidateSchema.parse(unparsedDataset);
    } catch (cause) {
      throw invalidInput('The valuation dataset candidate is invalid.', cause);
    }
    const evidence = parsePersistenceEvidence(unparsedEvidence);
    if (
      evidence.gateLedgerRevision <= 0 ||
      evidence.analyticalAuthority.content.datasetId !== dataset.datasetId ||
      evidence.operationalAuthorization.content.datasetId !== dataset.datasetId
    ) {
      throw invalidInput('Dataset evidence is not scoped to the exact candidate.');
    }
    await this.client.transaction(async (transaction) => {
      await lock(transaction, [
        ...evidence.consumedFieldSets.map(({ fieldSetId }) => `valuation-evidence:${fieldSetId}`),
        ...evidence.sourceRights.flatMap(({ derivationReceipt, admissionReceipt }) => [
          `valuation-evidence:${derivationReceipt.receiptId}`,
          `valuation-evidence:${admissionReceipt.receiptId}`,
        ]),
        `valuation-evidence:${evidence.analyticalAuthority.receiptId}`,
        `valuation-evidence:${evidence.operationalAuthorization.receiptId}`,
      ]);
      await persistEvidenceRecords(transaction, evidence);
    });
  }

  async persistAdmission(input: {
    dataset: AflTradeValuationDatasetCandidate;
    receipt: AflTradeValuationDatasetAdmissionReceipt;
    evidence: AflTradeValuationDatasetAdmissionPersistenceEvidence;
  }) {
    let dataset: AflTradeValuationDatasetCandidate;
    let receipt: AflTradeValuationDatasetAdmissionReceipt;
    let evidence: ReturnType<typeof parsePersistenceEvidence>;
    try {
      dataset = aflTradeValuationDatasetCandidateSchema.parse(input.dataset);
      receipt = aflTradeValuationDatasetAdmissionReceiptSchema.parse(input.receipt);
      evidence = parsePersistenceEvidence(input.evidence);
    } catch (cause) {
      throw invalidInput('The valuation dataset admission persistence input is invalid.', cause);
    }
    if (
      receipt.content.datasetId !== dataset.datasetId ||
      evidence.analyticalAuthority.receiptId !== receipt.content.analyticalAuthorityReceiptId ||
      evidence.operationalAuthorization.receiptId !==
        receipt.content.operationalAuthorizationReceiptId ||
      evidence.gateLedgerRevision <= 0
    ) {
      throw invalidInput(
        'Admission evidence does not bind the exact dataset and authority receipts.'
      );
    }
    return this.client.transaction(async (transaction) => {
      const evidenceKeys = [
        `valuation-admission:${receipt.admissionId}`,
        ...evidence.consumedFieldSets.map(({ fieldSetId }) => `valuation-evidence:${fieldSetId}`),
        ...evidence.sourceRights.flatMap(({ derivationReceipt, admissionReceipt }) => [
          `valuation-evidence:${derivationReceipt.receiptId}`,
          `valuation-evidence:${admissionReceipt.receiptId}`,
        ]),
        `valuation-evidence:${evidence.analyticalAuthority.receiptId}`,
        `valuation-evidence:${evidence.operationalAuthorization.receiptId}`,
      ];
      await lock(transaction, evidenceKeys);
      if (await admissionReplay(transaction, receipt)) {
        return { admissionId: receipt.admissionId, idempotentReplay: true } as const;
      }
      await persistEvidenceRecords(transaction, evidence);
      await transaction.query(
        `INSERT INTO outcome_valuation_dataset_admission
          (admission_id,dataset_id,environment,admitted_at,gate2_decision_id,
           gate_ledger_revision,analytical_authority_receipt_id,
           operational_authorization_receipt_id,source_count,status,admission_canonical_json,
           admission_json,finalized_at)
         VALUES ($1,$2,$3::"OutcomeEnvironment",$4,$5,$6,$7,$8,$9,'staged',$10,$11::jsonb,NULL)`,
        [
          receipt.admissionId,
          dataset.datasetId,
          receipt.content.environment,
          receipt.content.admittedAt,
          receipt.content.gate2Decision.decisionId,
          evidence.gateLedgerRevision,
          evidence.analyticalAuthority.receiptId,
          evidence.operationalAuthorization.receiptId,
          receipt.content.sourceRightsEvaluations.length,
          canonicalizeAflTradeJson(receipt.content),
          canonicalizeAflTradeJson(receipt),
        ]
      );
      const sourcesByCapture = new Map(
        evidence.sourceRights.map((source) => [source.captureId, source])
      );
      for (const [index, evaluation] of receipt.content.sourceRightsEvaluations.entries()) {
        const source = sourcesByCapture.get(evaluation.captureId);
        if (
          !source ||
          source.sourceSnapshotId !== evaluation.sourceSnapshotId ||
          source.consumedFieldSetId !== evaluation.consumedFieldSetId ||
          source.rightsArtifactId !== evaluation.proposalId ||
          source.derivationReceipt.receiptId !== evaluation.derivationEvaluationReceiptId ||
          source.admissionReceipt.receiptId !== evaluation.admissionEvaluationReceiptId
        ) {
          throw invalidInput(
            'Admission source summaries do not match their exact persisted evidence.'
          );
        }
        await transaction.query(
          `INSERT INTO outcome_valuation_dataset_admission_source
            (admission_id,ordinal,capture_id,source_snapshot_id,consumed_field_set_id,
             rights_artifact_id,derivation_decision_id,derivation_receipt_id,
             admission_decision_id,admission_receipt_id,source_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [
            receipt.admissionId,
            index + 1,
            evaluation.captureId,
            evaluation.sourceSnapshotId,
            evaluation.consumedFieldSetId,
            evaluation.proposalId,
            evaluation.derivationDecisionId,
            evaluation.derivationEvaluationReceiptId,
            evaluation.admissionDecisionId,
            evaluation.admissionEvaluationReceiptId,
            canonicalizeAflTradeJson(evaluation),
          ]
        );
      }
      const finalized = await transaction.query(
        `UPDATE outcome_valuation_dataset_admission
            SET status='finalized',finalized_at=$2
          WHERE admission_id=$1 AND status='staged'`,
        [receipt.admissionId, receipt.content.admittedAt]
      );
      if (finalized.rowCount !== 1) {
        throw new AflTradeValuationDatasetPersistenceError(
          'INCOMPLETE_WRITE',
          'The valuation dataset admission did not finalize atomically.'
        );
      }
      return { admissionId: receipt.admissionId, idempotentReplay: false } as const;
    });
  }
}
