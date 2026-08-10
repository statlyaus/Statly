import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import type { AflTradeDurableObjectArtifactRepository } from '../artifacts/durableObjectArtifactRepository';
import {
  type AflTradeModelRunIntent,
  type AflTradeModelRunManifestV3,
  aflTradeModelRunIntentSchema,
  aflTradeModelRunManifestV3Schema,
} from '../artifacts/modelRunManifest';
import {
  type AflTradePlayerContributionModelProtocolV2,
  aflTradePlayerContributionModelProtocolV2Schema,
} from '../artifacts/modelProtocol';
import {
  aflTradeValuationDatasetAdmissionReceiptSchema,
  aflTradeValuationDatasetCandidateSchema,
} from '../artifacts/valuationDatasetAdmissionContracts';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import { aflTradeAcquisitionSpellMetricSchema } from '../outcomes/acquisitionSpellMetricContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeGate0AReceiptSchema, type AflTradeGate0AReceipt } from '../source/gate0aReceipt';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';
import {
  type AflTradePlayerObservationSetV2,
  aflTradePlayerObservationSetV2Schema,
} from './playerContributionContracts';
import {
  type AflTradeAdmittedModelRunEvidence,
  type AflTradeAdmittedModelRunEvidenceAuthenticator,
  type AflTradeCompletedModelRunStore,
  type AflTradeModelRunOperationalAuthorization,
  type AflTradeModelRunAuthorization,
  type AflTradeModelRunAuthorizationStore,
  type AflTradeModelRunAuthorityClock,
  aflTradeModelRunAuthorizationSchema,
  aflTradeModelRunOperationalAuthorizationSchema,
  authenticateAflTradeAuthorizedModelRunManifest,
} from './admittedModelRunAuthority';

const MAXIMUM_EXECUTABLE_ARTIFACT_BYTES = 128 * 1024 * 1024;

export type AflTradeModelRunPersistenceErrorCode =
  'INVALID_INPUT' | 'MISSING_EVIDENCE' | 'CONFLICTING_REPLAY' | 'INCOMPLETE_WRITE';

export class AflTradeModelRunPersistenceError extends Error {
  constructor(
    readonly code: AflTradeModelRunPersistenceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeModelRunPersistenceError';
  }
}

export interface AflTradeModelRunPreparation {
  protocol: AflTradePlayerContributionModelProtocolV2;
  observationSet: AflTradePlayerObservationSetV2;
  intent: AflTradeModelRunIntent;
  operationalAuthorization: AflTradeModelRunOperationalAuthorization;
  runStartEvaluationReceipts: readonly AflTradeGate0AReceipt[];
}

interface AdmissionRow extends Record<string, unknown> {
  admission_json: unknown;
  analytical_authority_receipt_id: string;
  gate2_decision_key: string;
}

interface EvidenceRow extends Record<string, unknown> {
  protocol_json: unknown;
  observation_json: unknown;
  admission_json: unknown;
  dataset_json: unknown;
  gate2_decision_key: string;
  operational_authorization_json: unknown;
}

interface JsonRow extends Record<string, unknown> {
  document_json: unknown;
}

interface InstantRow extends Record<string, unknown> {
  instant: Date | string;
}

function exactInstant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function requireOne<Row>(rows: readonly Row[], description: string): Row {
  if (rows.length !== 1) {
    throw new AflTradeModelRunPersistenceError(
      'MISSING_EVIDENCE',
      `Model-run authority requires one exact ${description}.`
    );
  }
  return rows[0]!;
}

function requireMapValue<Key, Value>(
  values: ReadonlyMap<Key, Value>,
  key: Key,
  description: string
): Value {
  const value = values.get(key);
  if (value === undefined) {
    throw new AflTradeModelRunPersistenceError(
      'MISSING_EVIDENCE',
      `Model-run authority requires one exact ${description}.`
    );
  }
  return value;
}

async function lock(transaction: AflOutcomeSqlTransaction, keys: readonly string[]) {
  for (const key of unique(keys)) {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  }
}

async function insertOrRequireExact(
  transaction: AflOutcomeSqlTransaction,
  input: {
    insertSql: string;
    insertParameters: readonly unknown[];
    selectSql: string;
    selectParameters: readonly unknown[];
    expected: unknown;
    description: string;
  }
) {
  await transaction.query(input.insertSql, input.insertParameters);
  const result = await transaction.query<JsonRow>(input.selectSql, input.selectParameters);
  const row = requireOne(result.rows, input.description);
  if (!exactJson(row.document_json, input.expected)) {
    throw new AflTradeModelRunPersistenceError(
      'CONFLICTING_REPLAY',
      `The ${input.description} identity already names different content.`
    );
  }
}

function executableReferences(
  intent: AflTradeModelRunIntent,
  protocol: AflTradePlayerContributionModelProtocolV2
): AflTradeArtifactRef[] {
  return [
    intent.content.sourceCodeArtifact,
    intent.content.dependencyLockArtifact,
    intent.content.runtimeArtifact,
    intent.content.containerArtifact,
    intent.content.configurationArtifact,
    intent.content.environmentArtifact,
    ...intent.content.featureDefinitionArtifacts,
    protocol.content.valueUnit.definitionArtifact,
    protocol.content.footballContext.roleTaxonomyArtifact,
    protocol.content.footballContext.eraDefinitionArtifact,
    protocol.content.replacementBaseline.definitionArtifact,
    protocol.content.featurePolicy.featureAvailabilityArtifact,
    protocol.content.contributionAndCensoringPolicy.unavailableObservationTreatmentArtifact,
    protocol.content.contributionAndCensoringPolicy.censoringDefinitionArtifact,
    protocol.content.scalarValueTransformArtifact,
    ...protocol.content.validationPlan.baselineDefinitionArtifacts,
    ...protocol.content.validationPlan.metricDefinitionArtifacts,
    protocol.content.validationPlan.intervalCalibrationArtifact,
    ...protocol.content.validationPlan.sensitivityAnalysisArtifacts,
    protocol.content.validationPlan.acceptanceCriteriaArtifact,
  ];
}

async function persistGate0Receipt(
  transaction: AflOutcomeSqlTransaction,
  unparsed: AflTradeGate0AReceipt
) {
  const receipt = aflTradeGate0AReceiptSchema.parse(unparsed);
  if (!receipt.content.request.operations.includes('model_training')) {
    throw new AflTradeModelRunPersistenceError(
      'INVALID_INPUT',
      'A model-run Gate 0A receipt must authorize the model-training operation.'
    );
  }
  const operationKind = 'model_training';
  await insertOrRequireExact(transaction, {
    insertSql: `INSERT INTO outcome_valuation_dataset_gate0_evaluation
      (receipt_id,rights_artifact_id,decision_id,environment,evaluated_at,recorded_at,
       operation_kind,receipt_canonical_json,receipt_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (receipt_id) DO NOTHING`,
    insertParameters: [
      receipt.receiptId,
      receipt.content.request.rightsArtifactId,
      receipt.content.result.decisionId,
      receipt.content.request.environment,
      receipt.content.request.evaluatedAt,
      receipt.content.recordedAt,
      operationKind,
      canonicalizeAflTradeJson(receipt.content),
      canonicalizeAflTradeJson(receipt),
    ],
    selectSql: `SELECT receipt_json AS document_json
                  FROM outcome_valuation_dataset_gate0_evaluation
                 WHERE receipt_id=$1 FOR KEY SHARE`,
    selectParameters: [receipt.receiptId],
    expected: receipt,
    description: 'run-start Gate 0A receipt',
  });
}

export class PostgresAflTradeAdmittedModelRunAuthority
  implements
    AflTradeAdmittedModelRunEvidenceAuthenticator,
    AflTradeModelRunAuthorityClock,
    AflTradeModelRunAuthorizationStore,
    AflTradeCompletedModelRunStore
{
  constructor(
    private readonly dependencies: {
      sql: AflOutcomeSqlClient;
      gateDecisionLedgerRepository: AflTradeGateDecisionLedgerRepository;
      artifactRepository: Pick<AflTradeDurableObjectArtifactRepository, 'loadExactWithObservation'>;
      maximumArtifactBytes?: number;
    }
  ) {}

  async prepare(unparsed: AflTradeModelRunPreparation): Promise<void> {
    const protocol = aflTradePlayerContributionModelProtocolV2Schema.parse(unparsed.protocol);
    const observationSet = aflTradePlayerObservationSetV2Schema.parse(unparsed.observationSet);
    const intent = aflTradeModelRunIntentSchema.parse(unparsed.intent);
    const operationalAuthorization = aflTradeModelRunOperationalAuthorizationSchema.parse(
      unparsed.operationalAuthorization
    );
    const runStartReceipts = unparsed.runStartEvaluationReceipts.map((receipt) =>
      aflTradeGate0AReceiptSchema.parse(receipt)
    );
    if (
      protocol.protocolId !== intent.content.modelProtocolId ||
      observationSet.observationSetId !== intent.content.observationSetId ||
      protocol.content.datasetId !== intent.content.datasetId ||
      protocol.content.datasetAdmission.admissionId !== intent.content.datasetAdmissionId ||
      observationSet.content.datasetId !== intent.content.datasetId ||
      observationSet.content.datasetAdmissionId !== intent.content.datasetAdmissionId ||
      observationSet.content.modelProtocolId !== protocol.protocolId ||
      operationalAuthorization.content.runIntentId !== intent.intentId ||
      operationalAuthorization.content.environment !== intent.content.environment ||
      operationalAuthorization.content.datasetId !== intent.content.datasetId ||
      operationalAuthorization.content.datasetAdmissionId !== intent.content.datasetAdmissionId ||
      operationalAuthorization.content.modelProtocolId !== intent.content.modelProtocolId ||
      operationalAuthorization.content.observationSetId !== intent.content.observationSetId ||
      !exactJson(
        unique(runStartReceipts.map(({ receiptId }) => receiptId)),
        intent.content.modelTrainingEvaluationReceiptIds
      )
    ) {
      throw new AflTradeModelRunPersistenceError(
        'INVALID_INPUT',
        'Model-run preparation does not bind one exact admitted execution.'
      );
    }

    await this.dependencies.sql.transaction(async (transaction) => {
      await lock(transaction, [
        `valuation-model-protocol:${protocol.protocolId}`,
        `valuation-model-intent:${intent.intentId}`,
        `valuation-model-operation:${operationalAuthorization.receiptId}`,
        `operational-authority:${operationalAuthorization.content.authorityEvidence.id}`,
      ]);
      const admissionResult = await transaction.query<AdmissionRow>(
        `SELECT admission.admission_json,admission.analytical_authority_receipt_id,
                decision.decision_key AS gate2_decision_key
           FROM outcome_valuation_dataset_admission admission
           JOIN outcome_gate_decision decision
             ON decision.decision_id=admission.gate2_decision_id
          WHERE admission.admission_id=$1 AND admission.dataset_id=$2
            AND admission.status='finalized' AND admission.finalized_at IS NOT NULL
          FOR KEY SHARE OF admission,decision`,
        [intent.content.datasetAdmissionId, intent.content.datasetId]
      );
      const admission = requireOne(admissionResult.rows, 'finalized dataset admission');
      for (const receipt of runStartReceipts) await persistGate0Receipt(transaction, receipt);

      await insertOrRequireExact(transaction, {
        insertSql: `INSERT INTO outcome_valuation_model_protocol
          (protocol_id,environment,dataset_id,admission_id,analytical_authority_receipt_id,
           prepared_at,protocol_canonical_json,protocol_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (protocol_id) DO NOTHING`,
        insertParameters: [
          protocol.protocolId,
          protocol.content.environment,
          protocol.content.datasetId,
          protocol.content.datasetAdmission.admissionId,
          admission.analytical_authority_receipt_id,
          protocol.content.preparedAt,
          canonicalizeAflTradeJson(protocol.content),
          canonicalizeAflTradeJson(protocol),
        ],
        selectSql: `SELECT protocol_json AS document_json
                      FROM outcome_valuation_model_protocol
                     WHERE protocol_id=$1 FOR KEY SHARE`,
        selectParameters: [protocol.protocolId],
        expected: protocol,
        description: 'registered model protocol',
      });

      await insertOrRequireExact(transaction, {
        insertSql: `INSERT INTO outcome_valuation_player_observation_set
          (observation_set_id,environment,dataset_id,admission_id,protocol_id,
           dataset_row_set_sha256,observation_count,observation_canonical_json,
           observation_json,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         ON CONFLICT (observation_set_id) DO NOTHING`,
        insertParameters: [
          observationSet.observationSetId,
          protocol.content.environment,
          observationSet.content.datasetId,
          observationSet.content.datasetAdmissionId,
          observationSet.content.modelProtocolId,
          observationSet.content.datasetRowSetSha256,
          observationSet.content.observations.length,
          canonicalizeAflTradeJson(observationSet.content),
          canonicalizeAflTradeJson(observationSet),
          intent.content.startedAt,
        ],
        selectSql: `SELECT observation_json AS document_json
                      FROM outcome_valuation_player_observation_set
                     WHERE observation_set_id=$1 FOR KEY SHARE`,
        selectParameters: [observationSet.observationSetId],
        expected: observationSet,
        description: 'player observation set',
      });

      await insertOrRequireExact(transaction, {
        insertSql: `INSERT INTO outcome_valuation_model_run_intent
          (intent_id,environment,dataset_id,admission_id,protocol_id,observation_set_id,
           started_at,intent_canonical_json,intent_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT (intent_id) DO NOTHING`,
        insertParameters: [
          intent.intentId,
          intent.content.environment,
          intent.content.datasetId,
          intent.content.datasetAdmissionId,
          intent.content.modelProtocolId,
          intent.content.observationSetId,
          intent.content.startedAt,
          canonicalizeAflTradeJson(intent.content),
          canonicalizeAflTradeJson(intent),
        ],
        selectSql: `SELECT intent_json AS document_json
                      FROM outcome_valuation_model_run_intent
                     WHERE intent_id=$1 FOR KEY SHARE`,
        selectParameters: [intent.intentId],
        expected: intent,
        description: 'model-run intent',
      });

      await insertOrRequireExact(transaction, {
        insertSql: `INSERT INTO outcome_valuation_model_run_operational_authorization
          (receipt_id,intent_id,environment,dataset_id,admission_id,protocol_id,
           observation_set_id,authorized_at,valid_through,principal_ref,authority_evidence_id,
           receipt_canonical_json,receipt_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         ON CONFLICT (receipt_id) DO NOTHING`,
        insertParameters: [
          operationalAuthorization.receiptId,
          intent.intentId,
          operationalAuthorization.content.environment,
          operationalAuthorization.content.datasetId,
          operationalAuthorization.content.datasetAdmissionId,
          operationalAuthorization.content.modelProtocolId,
          operationalAuthorization.content.observationSetId,
          operationalAuthorization.content.authorizedAt,
          operationalAuthorization.content.validThrough,
          operationalAuthorization.content.principalRef,
          operationalAuthorization.content.authorityEvidence.id,
          canonicalizeAflTradeJson(operationalAuthorization.content),
          canonicalizeAflTradeJson(operationalAuthorization),
        ],
        selectSql: `SELECT receipt_json AS document_json
                      FROM outcome_valuation_model_run_operational_authorization
                     WHERE receipt_id=$1 FOR KEY SHARE`,
        selectParameters: [operationalAuthorization.receiptId],
        expected: operationalAuthorization,
        description: 'model-run operational authorization',
      });
    });
  }

  async authenticate(input: {
    intent: AflTradeModelRunIntent;
  }): Promise<AflTradeAdmittedModelRunEvidence> {
    const intent = aflTradeModelRunIntentSchema.parse(input.intent);
    const result = await this.dependencies.sql.query<EvidenceRow>(
      `SELECT protocol.protocol_json,observation.observation_json,admission.admission_json,
              dataset.dataset_json,decision.decision_key AS gate2_decision_key,
              operational.receipt_json AS operational_authorization_json
         FROM outcome_valuation_model_run_intent intent
         JOIN outcome_valuation_model_protocol protocol
           ON protocol.protocol_id=intent.protocol_id
         JOIN outcome_valuation_player_observation_set observation
           ON observation.observation_set_id=intent.observation_set_id
         JOIN outcome_valuation_dataset_admission admission
           ON admission.admission_id=intent.admission_id
         JOIN outcome_valuation_dataset_candidate dataset
           ON dataset.dataset_id=intent.dataset_id
         JOIN outcome_gate_decision decision
           ON decision.decision_id=admission.gate2_decision_id
         JOIN outcome_valuation_model_run_operational_authorization operational
           ON operational.intent_id=intent.intent_id
        WHERE intent.intent_id=$1 AND intent.intent_json=$2::jsonb
          AND admission.status='finalized' AND admission.finalized_at IS NOT NULL
          AND dataset.status='finalized' AND dataset.finalized_at IS NOT NULL`,
      [intent.intentId, canonicalizeAflTradeJson(intent)]
    );
    const row = requireOne(result.rows, 'prepared model-run evidence');
    const registeredProtocol = aflTradePlayerContributionModelProtocolV2Schema.parse(
      row.protocol_json
    );
    const observationSet = aflTradePlayerObservationSetV2Schema.parse(row.observation_json);
    const admission = aflTradeValuationDatasetAdmissionReceiptSchema.parse(row.admission_json);
    const datasetCandidate = aflTradeValuationDatasetCandidateSchema.parse(row.dataset_json);
    const operationalAuthorization = aflTradeModelRunOperationalAuthorizationSchema.parse(
      row.operational_authorization_json
    );

    const admissionReceiptIds = admission.content.sourceRightsEvaluations
      .map(({ admissionEvaluationReceiptId }) => admissionEvaluationReceiptId)
      .sort();
    const receiptIds = unique([
      ...admissionReceiptIds,
      ...intent.content.modelTrainingEvaluationReceiptIds,
    ]);
    const receiptResult = await this.dependencies.sql.query<JsonRow>(
      `SELECT receipt_json AS document_json
         FROM outcome_valuation_dataset_gate0_evaluation
        WHERE receipt_id=ANY($1::text[])
        ORDER BY receipt_id`,
      [receiptIds]
    );
    if (receiptResult.rows.length !== receiptIds.length) {
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Model-run authority is missing an exact Gate 0A evaluation receipt.'
      );
    }
    const receiptById = new Map(
      receiptResult.rows.map(({ document_json }) => {
        const receipt = aflTradeGate0AReceiptSchema.parse(document_json);
        return [receipt.receiptId, receipt] as const;
      })
    );
    const proposalIds = unique(
      admission.content.sourceRightsEvaluations.map(({ proposalId }) => proposalId)
    );
    const rightsResult = await this.dependencies.sql.query<JsonRow>(
      `SELECT content_json AS document_json
         FROM outcome_source_rights_proposal
        WHERE rights_artifact_id=ANY($1::text[])
        ORDER BY rights_artifact_id`,
      [proposalIds]
    );
    if (rightsResult.rows.length !== proposalIds.length) {
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Model-run authority is missing an exact source-rights proposal.'
      );
    }
    const sourceRightsProposals = rightsResult.rows.map(({ document_json }) =>
      aflTradeSourceRightsProposalSchema.parse(document_json)
    );

    const spellMetricIds = unique(
      observationSet.content.observations.flatMap(({ outcome }) =>
        outcome.metrics.map(({ spellMetricVersionId }) => spellMetricVersionId)
      )
    );
    const metricsResult = await this.dependencies.sql.query<JsonRow>(
      `SELECT fact_json AS document_json
         FROM outcome_acquisition_spell_metric_version
        WHERE spell_metric_version_id=ANY($1::text[])
        ORDER BY spell_metric_version_id`,
      [spellMetricIds]
    );
    if (metricsResult.rows.length !== spellMetricIds.length) {
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Model-run authority is missing an exact acquisition-spell metric body.'
      );
    }
    const spellMetrics = metricsResult.rows.map(({ document_json }) =>
      aflTradeAcquisitionSpellMetricSchema.parse(document_json)
    );

    const referenceById = new Map(
      executableReferences(intent, registeredProtocol).map((reference) => [
        reference.artifactId,
        reference,
      ])
    );
    const executableArtifacts = [];
    for (const reference of [...referenceById.values()].sort((left, right) =>
      left.artifactId.localeCompare(right.artifactId)
    )) {
      const loaded = await this.dependencies.artifactRepository.loadExactWithObservation(
        reference,
        Math.min(
          this.dependencies.maximumArtifactBytes ?? MAXIMUM_EXECUTABLE_ARTIFACT_BYTES,
          MAXIMUM_EXECUTABLE_ARTIFACT_BYTES
        )
      );
      if (loaded === null) {
        throw new AflTradeModelRunPersistenceError(
          'MISSING_EVIDENCE',
          `Model-run authority is missing executable artifact ${reference.artifactId}.`
        );
      }
      executableArtifacts.push({ artifactId: reference.artifactId, bytes: loaded.bytes });
    }

    const storedLedger = await this.dependencies.gateDecisionLedgerRepository.load();
    return {
      registeredProtocol,
      admission,
      datasetCandidate,
      observationSet,
      admissionEvaluationReceipts: admissionReceiptIds.map((id) =>
        requireMapValue(receiptById, id, 'admission Gate 0A receipt')
      ),
      runStartEvaluationReceipts: intent.content.modelTrainingEvaluationReceiptIds.map((id) =>
        requireMapValue(receiptById, id, 'run-start Gate 0A receipt')
      ),
      sourceRightsProposals,
      gateLedgerRevision: storedLedger.revision,
      gateDecisionLedger: storedLedger.ledger,
      gate2DecisionKey: row.gate2_decision_key,
      gate2Ledger: storedLedger.ledger,
      operationalAuthorization,
      spellMetrics,
      executableArtifacts,
    };
  }

  async now(): Promise<string> {
    const result = await this.dependencies.sql.query<InstantRow>(
      'SELECT clock_timestamp() AS instant'
    );
    return exactInstant(requireOne(result.rows, 'database execution time').instant);
  }

  async issueOnceForIntent(input: {
    authorization: AflTradeModelRunAuthorization;
    intent: AflTradeModelRunIntent;
  }): Promise<boolean> {
    const authorization = aflTradeModelRunAuthorizationSchema.parse(input.authorization);
    const intent = aflTradeModelRunIntentSchema.parse(input.intent);
    if (authorization.content.runIntentId !== intent.intentId) return false;
    return this.dependencies.sql.transaction(async (transaction) => {
      await lock(transaction, [`valuation-model-intent:${intent.intentId}`]);
      const gateHead = await transaction.query<{ revision: number }>(
        `SELECT revision FROM outcome_gate_ledger_head
          WHERE singleton_id=1 FOR SHARE`
      );
      if (gateHead.rows[0]?.revision !== authorization.content.gateLedgerRevision) return false;
      const inserted = await transaction.query(
        `INSERT INTO outcome_valuation_model_run_authorization
          (authorization_id,intent_id,operational_authorization_receipt_id,
           gate_ledger_revision,authorized_at,valid_through,
           authorization_canonical_json,authorization_json)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb
          WHERE EXISTS (
            SELECT 1 FROM outcome_valuation_model_run_intent
             WHERE intent_id=$2 AND intent_json=$9::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          authorization.authorizationId,
          intent.intentId,
          authorization.content.operationalAuthorizationReceiptId,
          authorization.content.gateLedgerRevision,
          authorization.content.authorizedAt,
          authorization.content.validThrough,
          canonicalizeAflTradeJson(authorization.content),
          canonicalizeAflTradeJson(authorization),
          canonicalizeAflTradeJson(intent),
        ]
      );
      return inserted.rowCount === 1;
    });
  }

  async consumeIntentOnce(input: {
    authorizationId: string;
    intentId: string;
    consumedAt: string;
  }): Promise<boolean> {
    const result = await this.dependencies.sql.query(
      `UPDATE outcome_valuation_model_run_authorization
          SET consumed_at=$3
        WHERE authorization_id=$1 AND intent_id=$2 AND consumed_at IS NULL
          AND clock_timestamp()>=authorized_at AND clock_timestamp()<valid_through
      RETURNING authorization_id`,
      [input.authorizationId, input.intentId, input.consumedAt]
    );
    return result.rowCount === 1;
  }

  async persistCompletedRun(unparsed: AflTradeModelRunManifestV3): Promise<boolean> {
    const run = aflTradeModelRunManifestV3Schema.parse(unparsed);
    return this.dependencies.sql.transaction(async (transaction) => {
      await lock(transaction, [`valuation-model-intent:${run.content.runIntentId}`]);
      const ancestry = await transaction.query<{
        intent_json: unknown;
        authorization_json: unknown;
      }>(
        `SELECT intent.intent_json, authorization.authorization_json
           FROM outcome_valuation_model_run_intent intent
           JOIN outcome_valuation_model_run_authorization authorization
             ON authorization.intent_id=intent.intent_id
          WHERE intent.intent_id=$1 AND authorization.authorization_id=$2
          FOR SHARE OF intent,authorization`,
        [run.content.runIntentId, run.content.runAuthorizationId]
      );
      const ancestryRow = ancestry.rows[0];
      if (!ancestryRow) return false;
      authenticateAflTradeAuthorizedModelRunManifest({
        run,
        intent: aflTradeModelRunIntentSchema.parse(ancestryRow.intent_json),
        authorization: aflTradeModelRunAuthorizationSchema.parse(ancestryRow.authorization_json),
      });
      await transaction.query(
        `INSERT INTO outcome_valuation_model_run
          (run_id,intent_id,authorization_id,status,started_at,finished_at,
           run_canonical_json,run_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (run_id) DO NOTHING`,
        [
          run.runId,
          run.content.runIntentId,
          run.content.runAuthorizationId,
          run.content.outcome.status,
          run.content.startedAt,
          run.content.finishedAt,
          canonicalizeAflTradeJson(run.content),
          canonicalizeAflTradeJson(run),
        ]
      );
      const persisted = await transaction.query<JsonRow>(
        `SELECT run_json AS document_json
           FROM outcome_valuation_model_run
          WHERE run_id=$1 FOR KEY SHARE`,
        [run.runId]
      );
      const row = persisted.rows[0];
      if (!row) return false;
      if (!exactJson(row.document_json, run)) {
        throw new AflTradeModelRunPersistenceError(
          'CONFLICTING_REPLAY',
          'The model-run identity already names different completed content.'
        );
      }
      return true;
    });
  }
}
