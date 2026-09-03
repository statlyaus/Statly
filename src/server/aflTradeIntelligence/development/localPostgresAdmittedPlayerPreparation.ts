import { createHash } from 'node:crypto';

import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  verifyAflTradeArtifactReadback,
  type AflTradeImmutableArtifactRepository,
} from '../artifacts/immutableArtifactRepository';
import {
  createAflTradeModelRunIntent,
  type AflTradeModelRunManifestV3,
} from '../artifacts/modelRunManifest';
import { aflTradePlayerContributionModelProtocolV2Schema } from '../artifacts/modelProtocol';
import {
  aflTradeValuationDatasetAdmissionReceiptSchema,
  aflTradeValuationDatasetCandidateSchema,
} from '../artifacts/valuationDatasetAdmissionContracts';
import type { AflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import type { AflTradeModelRunFailureRecorder } from '../modeling/admittedModelRunAuthority';
import { createAflTradePlayerObservationSetV2 } from '../modeling/playerContributionContracts';
import type { AflTradeAcquisitionSpellMetric } from '../outcomes/acquisitionSpellMetricContracts';
import { aflTradeAcquisitionSpellMetricSchema } from '../outcomes/acquisitionSpellMetricContracts';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeGate0AReceiptSchema, createAflTradeGate0AReceipt } from '../source/gate0aReceipt';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '../valuation/automatedPrivateEvaluationPolicy';
import { parseAflTradeAdmittedPlayerFactualOutput } from '../valuation/privateValuationFactualOutput';
import { createGovernedValuationComponentRunManifest } from '../valuation/internal/governedValuationComponentRunManifest';
import type { PostgresGovernedValuationComponentRunRepository } from '../valuation/internal/postgresGovernedValuationComponentRunRepository';
import type {
  AflTradeDispatchBoundPlayerExecutorInput,
  AflTradeDispatchBoundPlayerPreparation,
} from '../valuation/postgresPrivateValuationModelPair';

interface AuthorityRow {
  readonly dataset_json: unknown;
  readonly admission_json: unknown;
  readonly protocol_json: unknown;
  readonly gate_ledger_revision: number | string;
  readonly output_json: unknown;
}

interface JsonRow {
  readonly id: string;
  readonly document_json: unknown;
}

interface SpellMetricRow extends JsonRow {
  readonly fact_sha256: string;
}

export function parsePersistedAflTradeAcquisitionSpellMetric(
  row: Readonly<{ id: string; fact_sha256: string; document_json: unknown }>
) {
  return aflTradeAcquisitionSpellMetricSchema.parse({
    spellMetricVersionId: row.id,
    factSha256: row.fact_sha256,
    content: row.document_json,
  });
}

interface InstantRow {
  readonly instant: Date | string;
}

interface CustodyRow {
  readonly artifact_id: string;
  readonly content_sha256: string;
  readonly storage_uri: string;
  readonly media_type: string;
  readonly byte_length: number | string | bigint;
  readonly created_at: Date | string;
}

interface RetainedComponentRow {
  readonly run_id: string;
}

export interface LocalAflTradeAdmittedPlayerRunProfile {
  readonly codeCommitSha: string;
  readonly seed: number;
  readonly sourceCodeArtifact: AflTradeArtifactRef;
  readonly dependencyLockArtifact: AflTradeArtifactRef;
  readonly runtimeArtifact: AflTradeArtifactRef;
  readonly containerArtifact: AflTradeArtifactRef;
  readonly configurationArtifact: AflTradeArtifactRef;
  readonly environmentArtifact: AflTradeArtifactRef;
  readonly operationalAuthorizationLifetimeMs?: number;
}

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function gateRequestAncestry(value: { readonly content: { readonly request: object } }) {
  const { evaluatedAt: _evaluatedAt, ...request } = value.content.request as {
    readonly evaluatedAt: string;
  } & Record<string, unknown>;
  return canonicalizeAflTradeJson(request);
}

export function createAflTradeAdmittedPlayerRunStartReceipts(input: {
  readonly evaluations: ReturnType<
    typeof aflTradeValuationDatasetAdmissionReceiptSchema.parse
  >['content']['sourceRightsEvaluations'];
  readonly admissionReceipts: readonly ReturnType<typeof aflTradeGate0AReceiptSchema.parse>[];
  readonly proposals: readonly ReturnType<typeof aflTradeSourceRightsProposalSchema.parse>[];
  readonly gateLedger: Parameters<typeof createAflTradeGate0AReceipt>[0];
  readonly startedAt: string;
}) {
  const receiptById = new Map(
    input.admissionReceipts.map((receipt) => [receipt.receiptId, receipt])
  );
  const proposalById = new Map(
    input.proposals.map((proposal) => [proposal.rightsArtifactId, proposal])
  );
  const proposalIds = [...new Set(input.evaluations.map(({ proposalId }) => proposalId))].sort();
  return proposalIds
    .map((proposalId) => {
      const proposalEvaluations = input.evaluations.filter(
        (evaluation) => evaluation.proposalId === proposalId
      );
      const admissionReceipts = proposalEvaluations.map((evaluation) =>
        receiptById.get(evaluation.admissionEvaluationReceiptId)
      );
      const proposal = proposalById.get(proposalId);
      const firstReceipt = admissionReceipts[0];
      if (
        firstReceipt === undefined ||
        proposal === undefined ||
        admissionReceipts.some(
          (receipt) =>
            receipt === undefined ||
            receipt.content.request.rightsArtifactId !== proposalId ||
            gateRequestAncestry(receipt) !== gateRequestAncestry(firstReceipt)
        )
      ) {
        throw new TypeError('Local player preparation source-rights ancestry is inconsistent.');
      }
      return createAflTradeGate0AReceipt(
        input.gateLedger,
        proposal,
        { ...firstReceipt.content.request, evaluatedAt: input.startedAt },
        input.startedAt
      );
    })
    .sort((left, right) => left.receiptId.localeCompare(right.receiptId));
}

async function retainCanonical(input: {
  readonly sql: AflOutcomeSqlClient;
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly document: unknown;
  readonly createdAt: string;
}) {
  const candidate = createAflTradeCanonicalJsonArtifactRef(input.document, input.createdAt);
  const loadRetained = async () => {
    const retained = await input.sql.query<CustodyRow>(
      `SELECT artifact_id,content_sha256,storage_uri,media_type,byte_length,created_at
         FROM outcome_artifact_custody WHERE artifact_id=$1`,
      [candidate.artifactId]
    );
    const row = retained.rows[0];
    if (retained.rows.length === 0) return null;
    if (
      retained.rows.length !== 1 ||
      row === undefined ||
      row.artifact_id !== candidate.artifactId ||
      row.content_sha256 !== candidate.contentSha256 ||
      row.storage_uri !== candidate.storageUri ||
      row.media_type !== candidate.mediaType ||
      String(row.byte_length) !== String(candidate.byteLength)
    ) {
      throw new TypeError('Local player artifact custody replay conflicts.');
    }
    return { ...candidate, createdAt: instant(row.created_at) };
  };
  const existing = await loadRetained();
  const reference =
    existing ??
    (
      await input.repository.putIfAbsent(
        candidate,
        new TextEncoder().encode(canonicalizeAflTradeJson(input.document))
      )
    ).reference;
  await registerExistingArtifactCustody({
    sql: input.sql,
    repository: input.repository,
    maximumArtifactBytes: input.maximumArtifactBytes,
    reference,
    verifiedAt:
      Date.parse(input.createdAt) > Date.parse(reference.createdAt)
        ? input.createdAt
        : reference.createdAt,
  });
  return reference;
}

async function registerExistingArtifactCustody(input: {
  readonly sql: AflOutcomeSqlClient;
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly reference: AflTradeArtifactRef;
  readonly verifiedAt: string;
}) {
  await verifyAflTradeArtifactReadback(
    input.repository,
    input.reference,
    input.verifiedAt,
    input.maximumArtifactBytes
  );
  await input.sql.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,'derived_private','non_production',$6,$6,$7::jsonb)
       ON CONFLICT (artifact_id) DO NOTHING`,
      [
        input.reference.artifactId,
        input.reference.contentSha256,
        input.reference.storageUri,
        input.reference.mediaType,
        input.reference.byteLength,
        input.reference.createdAt,
        canonicalizeAflTradeJson({
          schemaVersion: 'local-admitted-player-artifact-custody/v1',
          environment: 'non_production',
          repositoryAssurance: 'local_non_production_filesystem',
          publicationProhibited: true,
          reference: input.reference,
        }),
      ]
    );
    const retained = await transaction.query<CustodyRow>(
      `SELECT artifact_id,content_sha256,storage_uri,media_type,byte_length,created_at
         FROM outcome_artifact_custody WHERE artifact_id=$1 FOR KEY SHARE`,
      [input.reference.artifactId]
    );
    const row = retained.rows[0];
    if (
      retained.rows.length !== 1 ||
      row === undefined ||
      row.artifact_id !== input.reference.artifactId ||
      row.content_sha256 !== input.reference.contentSha256 ||
      row.storage_uri !== input.reference.storageUri ||
      row.media_type !== input.reference.mediaType ||
      String(row.byte_length) !== String(input.reference.byteLength)
    ) {
      throw new TypeError('Local player artifact custody replay conflicts.');
    }
  });
}

async function loadAuthority(
  sql: AflOutcomeSqlClient,
  execution: AflTradeDispatchBoundPlayerExecutorInput
) {
  const target = execution.operation.content.player;
  const result = await sql.transaction(async (transaction) => {
    await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
    await transaction.query(
      `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
      [execution.exactInput.requestId, execution.claim.claimId, sha256(execution.claim.leaseToken)]
    );
    return transaction.query<AuthorityRow>(
      `SELECT dataset.dataset_json,admission.admission_json,protocol.protocol_json,
              admission.gate_ledger_revision,factual.output_json
       FROM outcome_private_valuation_model_request_binding binding
       JOIN outcome_private_valuation_model_operation operation
         ON operation.operation_id=binding.operation_id
       JOIN outcome_private_valuation_dispatch_attempt attempt
         ON attempt.request_id=binding.request_id
        AND attempt.claim_id=binding.claim_id
        AND attempt.attempt_number=binding.attempt_number
       JOIN outcome_private_valuation_factual_output factual
         ON factual.output_id=binding.factual_output_id
        AND factual.request_id=binding.request_id
       JOIN outcome_valuation_dataset_candidate dataset
         ON dataset.dataset_id=operation.player_dataset_id
       JOIN outcome_valuation_dataset_admission admission
         ON admission.dataset_id=dataset.dataset_id
        AND admission.admission_id=operation.player_dataset_admission_id
       JOIN outcome_valuation_model_protocol protocol
         ON protocol.dataset_id=dataset.dataset_id
        AND protocol.admission_id=admission.admission_id
        AND protocol.protocol_id=operation.player_protocol_id
      WHERE binding.request_id=$1 AND binding.operation_id=$2
        AND binding.factual_output_id=$3 AND binding.hpn_calculation_id=$4
        AND operation.player_model_id=$5 AND operation.player_model_version=$6
        AND operation.player_protocol_id=$7 AND operation.player_dataset_id=$8
        AND operation.player_dataset_admission_id=$9
        AND dataset.status='finalized' AND dataset.finalized_at IS NOT NULL
        AND admission.status='finalized' AND admission.finalized_at IS NOT NULL`,
      [
        execution.exactInput.requestId,
        execution.operation.operationId,
        execution.exactInput.factualOutputId,
        execution.exactInput.hpnCalculationId,
        target.modelId,
        target.modelVersion,
        target.protocolId,
        target.datasetId,
        target.datasetAdmissionId,
      ]
    );
  });
  if (result.rows.length !== 1) {
    throw new TypeError('Local player preparation requires one exact admitted model authority.');
  }
  const row = result.rows[0]!;
  const authority = {
    dataset: aflTradeValuationDatasetCandidateSchema.parse(row.dataset_json),
    admission: aflTradeValuationDatasetAdmissionReceiptSchema.parse(row.admission_json),
    protocol: aflTradePlayerContributionModelProtocolV2Schema.parse(row.protocol_json),
    factual: parseAflTradeAdmittedPlayerFactualOutput(row.output_json),
    gateLedgerRevision: Number(row.gate_ledger_revision),
  };
  const admittedSources = authority.admission.content.sourceRightsEvaluations
    .map(({ captureId, sourceSnapshotId, consumedFieldSetId, consumedFieldSetSha256 }) => ({
      captureId,
      sourceSnapshotId,
      consumedFieldSetId,
      consumedFieldSetSha256,
    }))
    .sort((left, right) => left.captureId.localeCompare(right.captureId));
  if (
    authority.factual.content.requestId !== execution.exactInput.requestId ||
    authority.factual.outputId !== execution.exactInput.factualOutputId ||
    authority.factual.content.valuationScopeKey !== execution.operation.content.scopeKey ||
    authority.factual.content.admittedPlayerDataset.datasetId !== authority.dataset.datasetId ||
    authority.factual.content.admittedPlayerDataset.admissionId !==
      authority.admission.admissionId ||
    canonicalizeAflTradeJson(authority.factual.content.sourceCaptures) !==
      canonicalizeAflTradeJson(admittedSources) ||
    authority.dataset.content.scopeKey !== execution.operation.content.scopeKey ||
    authority.factual.content.candidate.memberSetSha256 !==
      execution.operation.content.factualValuesSha256 ||
    authority.dataset.content.factualParent.factualReleaseId !==
      authority.factual.content.factualRelease.releaseId ||
    authority.dataset.content.factualParent.factualCandidateId !==
      authority.factual.content.candidate.candidateId ||
    authority.dataset.content.factualParent.sourceMemberSetSha256 !==
      authority.factual.content.candidate.memberSetSha256 ||
    authority.admission.content.factualReleaseId !==
      authority.factual.content.factualRelease.releaseId ||
    authority.admission.content.factualCandidateId !==
      authority.factual.content.candidate.candidateId ||
    authority.admission.content.sourceMemberSetSha256 !==
      authority.factual.content.candidate.memberSetSha256 ||
    authority.dataset.content.environment !== 'non_production' ||
    authority.admission.content.environment !== 'non_production' ||
    authority.protocol.content.environment !== 'non_production'
  ) {
    throw new TypeError('Local admitted player factual and model ancestry is inconsistent.');
  }
  return authority;
}

async function loadSpellMetrics(
  sql: AflOutcomeSqlClient,
  dataset: ReturnType<typeof aflTradeValuationDatasetCandidateSchema.parse>
): Promise<readonly AflTradeAcquisitionSpellMetric[]> {
  const ids = [
    ...new Set(
      dataset.content.rows.flatMap(({ content }) =>
        [...content.featureInputs, ...content.targetInputs].flatMap((fact) =>
          fact.kind === 'acquisition_spell_metric' ? [fact.memberId] : []
        )
      )
    ),
  ].sort();
  const result = await sql.query<SpellMetricRow>(
    `SELECT spell_metric_version_id AS id,fact_sha256,fact_json AS document_json
       FROM outcome_acquisition_spell_metric_version
      WHERE spell_metric_version_id=ANY($1::text[])
      ORDER BY spell_metric_version_id`,
    [ids]
  );
  if (
    result.rows.length !== ids.length ||
    result.rows.some((row, index) => row.id !== ids[index])
  ) {
    throw new TypeError('Local player preparation is missing exact admitted target metrics.');
  }
  return result.rows.map(parsePersistedAflTradeAcquisitionSpellMetric);
}

async function prepareRunStartReceipts(input: {
  readonly sql: AflOutcomeSqlClient;
  readonly gateDecisionLedgerRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load'>;
  readonly admission: ReturnType<typeof aflTradeValuationDatasetAdmissionReceiptSchema.parse>;
  readonly startedAt: string;
}) {
  const evaluations = input.admission.content.sourceRightsEvaluations;
  const receiptIds = [
    ...new Set(evaluations.map(({ admissionEvaluationReceiptId }) => admissionEvaluationReceiptId)),
  ].sort();
  const proposalIds = [...new Set(evaluations.map(({ proposalId }) => proposalId))].sort();
  const [receipts, proposals, gate] = await Promise.all([
    input.sql.query<JsonRow>(
      `SELECT receipt_id AS id,receipt_json AS document_json
         FROM outcome_valuation_dataset_gate0_evaluation
        WHERE receipt_id=ANY($1::text[]) ORDER BY receipt_id`,
      [receiptIds]
    ),
    input.sql.query<JsonRow>(
      `SELECT rights_artifact_id AS id,content_json AS document_json
         FROM outcome_source_rights_proposal
        WHERE rights_artifact_id=ANY($1::text[]) ORDER BY rights_artifact_id`,
      [proposalIds]
    ),
    input.gateDecisionLedgerRepository.load(),
  ]);
  if (receipts.rows.length !== receiptIds.length || proposals.rows.length !== proposalIds.length) {
    throw new TypeError('Local player preparation is missing source-rights authority.');
  }
  return createAflTradeAdmittedPlayerRunStartReceipts({
    evaluations,
    admissionReceipts: receipts.rows.map(({ document_json }) =>
      aflTradeGate0AReceiptSchema.parse(document_json)
    ),
    proposals: proposals.rows.map(({ document_json }) =>
      aflTradeSourceRightsProposalSchema.parse(document_json)
    ),
    gateLedger: gate.ledger,
    startedAt: input.startedAt,
  });
}

export function createLocalAflTradePostgresAdmittedPlayerPreparation(input: {
  readonly sql: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly gateDecisionLedgerRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load'>;
  readonly componentRepository: Pick<
    PostgresGovernedValuationComponentRunRepository,
    'register' | 'loadExact'
  >;
  readonly attestRunProfile: (input: {
    readonly createdAt: string;
    readonly retainArtifact: (value: {
      readonly document: unknown;
      readonly createdAt: string;
    }) => Promise<AflTradeArtifactRef>;
  }) => Promise<LocalAflTradeAdmittedPlayerRunProfile>;
}) {
  const retainArtifact = (value: { readonly document: unknown; readonly createdAt: string }) =>
    retainCanonical({
      sql: input.sql,
      repository: input.artifactRepository,
      maximumArtifactBytes: input.maximumArtifactBytes,
      ...value,
    });

  const prepareRun = async (
    execution: AflTradeDispatchBoundPlayerExecutorInput
  ): Promise<AflTradeDispatchBoundPlayerPreparation> => {
    const authority = await loadAuthority(input.sql, execution);
    const target = execution.operation.content.player;
    if (
      authority.dataset.datasetId !== target.datasetId ||
      authority.admission.admissionId !== target.datasetAdmissionId ||
      authority.protocol.protocolId !== target.protocolId
    ) {
      throw new TypeError('Local player authority does not match the dispatch target.');
    }
    const nowResult = await input.sql.query<InstantRow>('SELECT clock_timestamp() AS instant');
    if (nowResult.rows.length !== 1)
      throw new TypeError('Local player database clock is unavailable.');
    const startedAt = instant(nowResult.rows[0]!.instant);
    const [spellMetrics, runStartEvaluationReceipts] = await Promise.all([
      loadSpellMetrics(input.sql, authority.dataset),
      prepareRunStartReceipts({
        sql: input.sql,
        gateDecisionLedgerRepository: input.gateDecisionLedgerRepository,
        admission: authority.admission,
        startedAt,
      }),
    ]);
    const profile = await input.attestRunProfile({ createdAt: startedAt, retainArtifact });
    const lifetime = profile.operationalAuthorizationLifetimeMs ?? 30_000;
    if (!Number.isSafeInteger(lifetime) || lifetime <= 0 || lifetime > 300_000) {
      throw new TypeError('Local player operational authorization lifetime is invalid.');
    }
    const observationSet = createAflTradePlayerObservationSetV2({
      candidate: authority.dataset,
      datasetAdmissionId: authority.admission.admissionId,
      modelProtocolId: authority.protocol.protocolId,
      spellMetrics,
    });
    const intent = createAflTradeModelRunIntent({
      environment: 'non_production',
      modelId: target.modelId,
      modelVersion: target.modelVersion,
      datasetId: target.datasetId,
      datasetAdmissionId: target.datasetAdmissionId,
      modelProtocolId: target.protocolId,
      observationSetId: observationSet.observationSetId,
      codeCommitSha: profile.codeCommitSha,
      cleanWorktree: true,
      seed: profile.seed,
      job: {
        jobId: execution.operation.operationId,
        attempt: execution.attemptNumber,
        initiatedBy: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
        workerIdentity: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
      },
      startedAt,
      windows: authority.protocol.content.windows,
      sourceCodeArtifact: profile.sourceCodeArtifact,
      dependencyLockArtifact: profile.dependencyLockArtifact,
      runtimeArtifact: profile.runtimeArtifact,
      containerArtifact: profile.containerArtifact,
      configurationArtifact: profile.configurationArtifact,
      environmentArtifact: profile.environmentArtifact,
      featureDefinitionArtifacts:
        authority.dataset.content.specification.content.featureDefinitions,
      modelTrainingEvaluationReceiptIds: runStartEvaluationReceipts.map(
        ({ receiptId }) => receiptId
      ),
    });
    return {
      protocol: authority.protocol,
      observationSet,
      intent,
      runStartEvaluationReceipts,
      validThrough: new Date(Date.parse(startedAt) + lifetime).toISOString(),
    };
  };

  const loadRetainedComponent = async (
    execution: AflTradeDispatchBoundPlayerExecutorInput
  ): Promise<{ readonly runId: string } | null> => {
    await loadAuthority(input.sql, execution);
    const target = execution.operation.content.player;
    const retained = await input.sql.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      await transaction.query(
        `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
        [
          execution.exactInput.requestId,
          execution.claim.claimId,
          sha256(execution.claim.leaseToken),
        ]
      );
      return transaction.query<RetainedComponentRow>(
        `SELECT component.run_id
           FROM outcome_governed_valuation_component_run component
           JOIN outcome_valuation_model_run native
             ON native.run_id=component.native_execution_id AND native.status='succeeded'
           JOIN outcome_valuation_model_run_authorization run_authorization
             ON run_authorization.authorization_id=native.authorization_id
           JOIN outcome_valuation_model_run_operational_authorization operational
             ON operational.receipt_id=run_authorization.operational_authorization_receipt_id
           JOIN outcome_private_valuation_dispatch_attempt original_attempt
             ON original_attempt.request_id=
                  operational.receipt_json->'content'->>'dispatchRequestId'
            AND original_attempt.claim_id=
                  operational.receipt_json->'content'->>'dispatchClaimId'
            AND original_attempt.attempt_number=
                  (operational.receipt_json->'content'->>'dispatchAttemptNumber')::integer
            AND original_attempt.lease_token_sha256=
                  operational.receipt_json->'content'->>'dispatchLeaseTokenSha256'
          WHERE component.role='player_contribution_and_availability'
            AND component.native_execution_kind='admitted_player_model_run'
            AND component.protocol_id=$8 AND component.dataset_id=$9
            AND component.dataset_admission_id=$10
            AND operational.receipt_json->'content'->>'dispatchRequestId'=$1
            AND operational.receipt_json->'content'->>'substantiveOperationId'=$2
            AND operational.receipt_json->'content'->>'factualOutputId'=$3
            AND operational.receipt_json->'content'->>'hpnCalculationId'=$4
            AND operational.receipt_json->'content'->>'factualValuesSha256'=$5
            AND operational.receipt_json->'content'->>'hpnValuesSha256'=$6
            AND native.run_json->'content'->>'modelId'=$7
            AND native.run_json->'content'->>'modelVersion'=$11`,
        [
          execution.exactInput.requestId,
          execution.operation.operationId,
          execution.exactInput.factualOutputId,
          execution.exactInput.hpnCalculationId,
          execution.exactInput.substantive.factualValuesSha256,
          execution.exactInput.substantive.hpnValuesSha256,
          target.modelId,
          target.protocolId,
          target.datasetId,
          target.datasetAdmissionId,
          target.modelVersion,
        ]
      );
    });
    if (retained.rows.length === 0) return null;
    if (retained.rows.length !== 1) {
      throw new TypeError('Dispatch-bound admitted player component replay is ambiguous.');
    }
    const row = retained.rows[0]!;
    const component = await input.componentRepository.loadExact(row.run_id);
    if (
      component.manifest.runId !== row.run_id ||
      component.manifest.content.nativeExecution.kind !== 'admitted_player_model_run'
    ) {
      throw new TypeError('Dispatch-bound admitted player component replay is inconsistent.');
    }
    await loadAuthority(input.sql, execution);
    return { runId: row.run_id };
  };

  const registerComponent = async (value: {
    readonly run: AflTradeModelRunManifestV3;
    readonly execution: AflTradeDispatchBoundPlayerExecutorInput;
  }) => {
    const authority = await loadAuthority(input.sql, value.execution);
    const outcomeArtifacts =
      value.run.content.outcome.status === 'succeeded'
        ? [
            value.run.content.outcome.modelArtifact,
            ...(value.run.content.outcome.selectionValidationReportArtifact === undefined
              ? []
              : [value.run.content.outcome.selectionValidationReportArtifact]),
            value.run.content.outcome.validationReportArtifact,
            value.run.content.outcome.baselineComparisonArtifact,
            value.run.content.outcome.calibrationReportArtifact,
            value.run.content.outcome.intervalCoverageArtifact,
            value.run.content.outcome.subgroupReportArtifact,
            value.run.content.outcome.sensitivityReportArtifact,
            value.run.content.outcome.leakageAuditArtifact,
            value.run.content.outcome.modelCardArtifact,
            value.run.content.outcome.diagnosticsArtifact,
          ]
        : [
            value.run.content.outcome.failureArtifact,
            value.run.content.outcome.diagnosticsArtifact,
          ];
    await Promise.all(
      outcomeArtifacts.map((reference) =>
        registerExistingArtifactCustody({
          sql: input.sql,
          repository: input.artifactRepository,
          maximumArtifactBytes: input.maximumArtifactBytes,
          reference,
          verifiedAt: value.run.content.finishedAt,
        })
      )
    );
    const [runArtifact, protocolArtifact, datasetArtifact, admissionArtifact] = await Promise.all([
      retainCanonical({
        sql: input.sql,
        repository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
        document: value.run,
        createdAt: value.run.content.finishedAt,
      }),
      retainCanonical({
        sql: input.sql,
        repository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
        document: authority.protocol,
        createdAt: authority.protocol.content.preparedAt,
      }),
      retainCanonical({
        sql: input.sql,
        repository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
        document: authority.dataset,
        createdAt: authority.dataset.content.createdAt,
      }),
      retainCanonical({
        sql: input.sql,
        repository: input.artifactRepository,
        maximumArtifactBytes: input.maximumArtifactBytes,
        document: authority.admission,
        createdAt: authority.admission.content.admittedAt,
      }),
    ]);
    const manifest = createGovernedValuationComponentRunManifest({
      environment: 'non_production',
      role: 'player_contribution_and_availability',
      nativeExecution: {
        kind: 'admitted_player_model_run',
        executionId: value.run.runId,
        artifact: runArtifact,
      },
      protocolId: authority.protocol.protocolId,
      protocolArtifact,
      datasetId: authority.dataset.datasetId,
      datasetArtifact,
      datasetAdmissionId: authority.admission.admissionId,
      datasetAdmissionArtifact: admissionArtifact,
      datasetAdmissionGateLedgerRevision: authority.gateLedgerRevision,
      registeredAt: value.run.content.finishedAt,
    });
    const artifact = await retainCanonical({
      sql: input.sql,
      repository: input.artifactRepository,
      maximumArtifactBytes: input.maximumArtifactBytes,
      document: manifest,
      createdAt: manifest.content.registeredAt,
    });
    await loadAuthority(input.sql, value.execution);
    const retained = await input.componentRepository.register({ manifest, artifact });
    return { runId: retained.manifest.runId };
  };

  const failureRecorder: AflTradeModelRunFailureRecorder = {
    async recordExecutionFailure({ intent, failedAt, cause }) {
      const message = cause instanceof Error ? cause.message : 'Unknown admitted player failure.';
      const [failureArtifact, diagnosticsArtifact] = await Promise.all([
        retainCanonical({
          sql: input.sql,
          repository: input.artifactRepository,
          maximumArtifactBytes: input.maximumArtifactBytes,
          createdAt: failedAt,
          document: {
            schemaVersion: 'afl-trade-model-run-failure/v1',
            intentId: intent.intentId,
            classification: 'validation_failure',
            message,
          },
        }),
        retainCanonical({
          sql: input.sql,
          repository: input.artifactRepository,
          maximumArtifactBytes: input.maximumArtifactBytes,
          createdAt: failedAt,
          document: {
            schemaVersion: 'afl-trade-model-run-failure-diagnostics/v1',
            intentId: intent.intentId,
            failedAt,
          },
        }),
      ]);
      return {
        candidateLockedAt: null,
        finalTestEvaluatedAt: null,
        finishedAt: failedAt,
        outcome: {
          status: 'failed',
          failureClassification: 'validation_failure',
          failureArtifact,
          diagnosticsArtifact,
        },
      };
    },
  };

  return {
    loadRetainedComponent,
    prepareRun,
    registerComponent,
    failureRecorder,
    retainArtifact,
  } as const;
}
