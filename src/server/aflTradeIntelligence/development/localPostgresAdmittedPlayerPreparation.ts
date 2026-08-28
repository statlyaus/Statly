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
}

interface JsonRow {
  readonly id: string;
  readonly document_json: unknown;
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
  const result = await sql.query<AuthorityRow>(
    `SELECT dataset.dataset_json,admission.admission_json,protocol.protocol_json,
            admission.gate_ledger_revision
       FROM outcome_valuation_dataset_candidate dataset
       JOIN outcome_valuation_dataset_admission admission
         ON admission.dataset_id=dataset.dataset_id
       JOIN outcome_valuation_model_protocol protocol
         ON protocol.dataset_id=dataset.dataset_id AND protocol.admission_id=admission.admission_id
      WHERE dataset.dataset_id=$1 AND admission.admission_id=$2 AND protocol.protocol_id=$3
        AND dataset.status='finalized' AND dataset.finalized_at IS NOT NULL
        AND admission.status='finalized' AND admission.finalized_at IS NOT NULL`,
    [target.datasetId, target.datasetAdmissionId, target.protocolId]
  );
  if (result.rows.length !== 1) {
    throw new TypeError('Local player preparation requires one exact admitted model authority.');
  }
  const row = result.rows[0]!;
  return {
    dataset: aflTradeValuationDatasetCandidateSchema.parse(row.dataset_json),
    admission: aflTradeValuationDatasetAdmissionReceiptSchema.parse(row.admission_json),
    protocol: aflTradePlayerContributionModelProtocolV2Schema.parse(row.protocol_json),
    gateLedgerRevision: Number(row.gate_ledger_revision),
  };
}

async function loadSpellMetrics(
  sql: AflOutcomeSqlClient,
  dataset: ReturnType<typeof aflTradeValuationDatasetCandidateSchema.parse>
): Promise<readonly AflTradeAcquisitionSpellMetric[]> {
  const ids = [
    ...new Set(
      dataset.content.rows.flatMap(({ content }) =>
        content.targetInputs.flatMap((target) =>
          target.kind === 'acquisition_spell_metric' ? [target.memberId] : []
        )
      )
    ),
  ].sort();
  const result = await sql.query<JsonRow>(
    `SELECT spell_metric_version_id AS id,fact_json AS document_json
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
  return result.rows.map(({ document_json }) =>
    aflTradeAcquisitionSpellMetricSchema.parse(document_json)
  );
}

async function prepareRunStartReceipts(input: {
  readonly sql: AflOutcomeSqlClient;
  readonly gateDecisionLedgerRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load'>;
  readonly admission: ReturnType<typeof aflTradeValuationDatasetAdmissionReceiptSchema.parse>;
  readonly startedAt: string;
}) {
  const evaluations = input.admission.content.sourceRightsEvaluations;
  const receiptIds = evaluations.map(
    ({ admissionEvaluationReceiptId }) => admissionEvaluationReceiptId
  );
  const proposalIds = evaluations.map(({ proposalId }) => proposalId);
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
  const receiptById = new Map(
    receipts.rows.map(({ id, document_json }) => [
      id,
      aflTradeGate0AReceiptSchema.parse(document_json),
    ])
  );
  const proposalById = new Map(
    proposals.rows.map(({ id, document_json }) => [
      id,
      aflTradeSourceRightsProposalSchema.parse(document_json),
    ])
  );
  return evaluations
    .map((evaluation) => {
      const admissionReceipt = receiptById.get(evaluation.admissionEvaluationReceiptId);
      const proposal = proposalById.get(evaluation.proposalId);
      if (admissionReceipt === undefined || proposal === undefined) {
        throw new TypeError('Local player preparation source-rights ancestry is incomplete.');
      }
      return createAflTradeGate0AReceipt(
        gate.ledger,
        proposal,
        { ...admissionReceipt.content.request, evaluatedAt: input.startedAt },
        input.startedAt
      );
    })
    .sort((left, right) => left.receiptId.localeCompare(right.receiptId));
}

export function createLocalAflTradePostgresAdmittedPlayerPreparation(input: {
  readonly sql: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly gateDecisionLedgerRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load'>;
  readonly componentRepository: Pick<PostgresGovernedValuationComponentRunRepository, 'register'>;
  readonly profile: LocalAflTradeAdmittedPlayerRunProfile;
}) {
  const lifetime = input.profile.operationalAuthorizationLifetimeMs ?? 30_000;
  if (!Number.isSafeInteger(lifetime) || lifetime <= 0 || lifetime > 300_000) {
    throw new TypeError('Local player operational authorization lifetime is invalid.');
  }

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
      codeCommitSha: input.profile.codeCommitSha,
      cleanWorktree: true,
      seed: input.profile.seed,
      job: {
        jobId: execution.operation.operationId,
        attempt: execution.attemptNumber,
        initiatedBy: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
        workerIdentity: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
      },
      startedAt,
      windows: authority.protocol.content.windows,
      sourceCodeArtifact: input.profile.sourceCodeArtifact,
      dependencyLockArtifact: input.profile.dependencyLockArtifact,
      runtimeArtifact: input.profile.runtimeArtifact,
      containerArtifact: input.profile.containerArtifact,
      configurationArtifact: input.profile.configurationArtifact,
      environmentArtifact: input.profile.environmentArtifact,
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

  const registerComponent = async (value: {
    readonly run: AflTradeModelRunManifestV3;
    readonly execution: AflTradeDispatchBoundPlayerExecutorInput;
  }) => {
    const authority = await loadAuthority(input.sql, value.execution);
    const outcomeArtifacts =
      value.run.content.outcome.status === 'succeeded'
        ? [
            value.run.content.outcome.modelArtifact,
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

  return { prepareRun, registerComponent, failureRecorder, retainArtifact } as const;
}
