import { z } from 'zod';
import {
  createAflTradeModelRunCheckpoint,
  createAflTradeModelRunCheckpointV2,
  AFL_TRADE_MODEL_RUN_PROGRESS_STAGES,
  aflTradeAnyModelRunCheckpointSchema as aflTradeModelRunCheckpointSchema,
  aflTradeModelRunCheckpointSchema as aflTradeModelRunCheckpointV1Schema,
  aflTradeModelRunCheckpointV2Schema,
  type AflTradeAnyModelRunCheckpoint as AflTradeModelRunCheckpoint,
} from '../artifacts/modelRunCheckpoint';
import {
  type AflTradeArtifactRef,
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
  doAflTradeArtifactRefsExactlyMatch,
} from '../artifacts/artifactReference';
import type { AflTradeDurableObjectArtifactRepository } from '../artifacts/durableObjectArtifactRepository';
import {
  type AflTradeImmutableArtifactRepository,
  verifyAflTradeArtifactReadback,
} from '../artifacts/immutableArtifactRepository';
import {
  type AflTradeModelRunIntent,
  type AflTradeModelRunManifestV3,
  type AflTradeModelRunManifestV4,
  type AflTradeModelRunManifestV5,
  aflTradeModelRunIntentSchema,
  createAflTradeModelRunContinuationIntent,
  aflTradeModelRunManifestV3Schema,
  aflTradeModelRunManifestV4Schema,
  aflTradeModelRunManifestV5Schema,
  aflTradeNativeFinalTestCompletionEvidenceSchema,
  aflTradeNativeFinalTestCompletionEvidenceV2Schema,
  type AflTradeNativeFinalTestCompletionEvidence,
  type AflTradeNativeFinalTestCompletionEvidenceV2,
  createAflTradeNativeFinalTestCompletionEvidence,
  createAflTradeNativeFinalTestCompletionEvidenceV2,
} from '../artifacts/modelRunManifest';
import {
  type AflTradePlayerContributionModelProtocolV2,
  type AflTradePlayerPavModelProtocol,
  aflTradePlayerContributionModelProtocolV2Schema,
  aflTradePlayerPavModelProtocolSchema,
} from '../artifacts/modelProtocol';
import {
  aflTradeValuationDatasetAdmissionReceiptSchema,
  aflTradeValuationDatasetCandidateSchema,
  aflTradeConsumedFieldSetSchema,
  type AflTradeValuationDatasetCandidate,
  type AflTradeValuationDatasetAdmissionReceipt,
} from '../artifacts/valuationDatasetAdmissionContracts';
import {
  canonicalizeAflTradeJson,
  aflTradeContentAddressedIdSchema,
} from '../artifacts/contentAddress';
import {
  type AflTradeGateDecisionLedgerRepository,
  createPostgresAflTradeGateDecisionLedgerRepository,
} from '../governance/postgresGateDecisionLedgerRepository';
import {
  loadAflTradeAdmittedPlayerPavCandidate,
  retainAflTradeAdmittedPlayerPavCandidate,
} from './admittedPlayerContributionCandidate';
import type { AflTradeAdmittedPlayerPavFitInput } from './admittedPlayerPavCandidate';
import { evaluateAflTradeAdmittedPlayerPavFinal } from './admittedPlayerPavFinalEvaluation';
import {
  interpretAflTradeNativePavMetricDefinitions,
  createAflTradeNativePavReportDocuments,
  authenticateAflTradeNativePavReportDocuments,
} from './admittedPlayerPavReports';
import { aflTradeNativePavPreFinalEvidenceSchema } from './admittedPlayerPavPreFinalContracts';
import { aflTradeNativePavValidationPlanEvidenceSchema } from './admittedPlayerPavValidationPlanContracts';
import {
  evaluateAflTradeAdmittedPlayerPavPreFinal,
  authenticateAflTradeAdmittedPlayerPavPreFinalEvidence,
  prepareAflTradeAdmittedPlayerPavValidationPlan,
  authenticateAflTradeAdmittedPlayerPavValidationPlan,
} from './admittedPlayerPavPreFinalEvaluation';
import { aflTradePlayerPavObservationSetSchema } from './playerPavObservationContracts';
import { aflTradeHpnPavMethodSchema } from './hpnPlayerApproximateValue';
import { parsePersistedAflTradeAcquisitionSpellMetric } from '../outcomes/acquisitionSpellMetricContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeGate0AReceiptSchema, type AflTradeGate0AReceipt } from '../source/gate0aReceipt';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';
import {
  type AflTradePlayerObservationSetV2,
  type AflTradePlayerObservationSetV3,
  aflTradePlayerObservationSetV2Schema,
  aflTradePlayerObservationSetV3Schema,
  createAflTradePlayerObservationSetV3,
} from './playerContributionContracts';
import { loadAflTradeCurrentAdmittedPavMeasurements } from './postgresValuationDatasetEvidenceAuthenticator';
import { hasCurrentAflTradeValuationDatasetDomainProvenance } from './postgresValuationDatasetFactualLineageRepository';
import {
  type AflTradeAdmittedModelRunEvidence,
  type AflTradeNativePavModelRunEvidence,
  type AflTradeAdmittedModelRunEvidenceAuthenticator,
  type AflTradeCompletedModelRunStore,
  type AflTradeModelRunOperationalAuthorization,
  type AflTradeModelRunAuthorization,
  type AflTradeModelRunAuthorizationStore,
  type AflTradeModelRunAuthorityClock,
  aflTradeModelRunAuthorizationSchema,
  aflTradeModelRunOperationalAuthorizationSchema,
  authenticateAflTradeAuthorizedModelRunManifest,
  authenticateAflTradeAuthorizedPersistenceRecoveryManifest,
  authenticateAflTradeNativePavStageEvidence,
} from './admittedModelRunAuthority';

const MAXIMUM_EXECUTABLE_ARTIFACT_BYTES = 128 * 1024 * 1024;

function nativeArtifactCustodyIdentity(repository: AflTradeImmutableArtifactRepository) {
  return canonicalizeAflTradeJson({
    assurance: repository.assurance,
    artifactClass: repository.artifactClass,
    custodyProfile: repository.custodyProfile,
  });
}

type AflTradeExactExecutableArtifactReader =
  | Pick<AflTradeDurableObjectArtifactRepository, 'loadExactWithObservation'>
  | Pick<AflTradeImmutableArtifactRepository, 'loadExact'>;

async function loadExactExecutableArtifact(
  repository: AflTradeExactExecutableArtifactReader,
  reference: AflTradeArtifactRef,
  maximumBytes: number
) {
  return 'loadExactWithObservation' in repository
    ? repository.loadExactWithObservation(reference, maximumBytes)
    : repository.loadExact(reference, maximumBytes);
}

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

export type AflTradeNativePavModelRunPreparation = Omit<
  AflTradeModelRunPreparation,
  'protocol' | 'observationSet'
> & {
  protocol: AflTradePlayerPavModelProtocol;
  observationSet: AflTradePlayerObservationSetV3;
};

export interface AflTradeRetainedModelRunRecoveryState {
  authorityBoundary: 'retained_model_run_recovery_evidence_no_execution_authority';
  rootIntent: AflTradeModelRunIntent;
  activeIntent: AflTradeModelRunIntent;
  checkpoints: readonly AflTradeModelRunCheckpoint[];
  terminalRun:
    AflTradeModelRunManifestV3 | AflTradeModelRunManifestV4 | AflTradeModelRunManifestV5 | null;
  finalTestCompletionEvidence:
    AflTradeNativeFinalTestCompletionEvidence | AflTradeNativeFinalTestCompletionEvidenceV2 | null;
}

const modelPairSchema = z.union([
  z
    .object({
      protocol: aflTradePlayerContributionModelProtocolV2Schema,
      observationSet: aflTradePlayerObservationSetV2Schema,
    })
    .transform((pair) => ({ ...pair, modelFamily: 'scalar' as const })),
  z
    .object({
      protocol: aflTradePlayerPavModelProtocolSchema,
      observationSet: aflTradePlayerObservationSetV3Schema,
    })
    .transform((pair) => ({ ...pair, modelFamily: 'native_pav' as const })),
]);

interface AdmissionRow extends Record<string, unknown> {
  admission_json: unknown;
  dataset_json?: unknown;
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

interface SpellMetricRow extends JsonRow {
  spell_metric_version_id: string;
  fact_sha256: string;
}

interface InstantRow extends Record<string, unknown> {
  instant: Date | string;
}

interface DatasetProvenanceRow extends Record<string, unknown> {
  factual_candidate_id: string;
  lineage_id: string;
  protocol_json: unknown;
  observation_json: unknown;
  dataset_json: unknown;
  admission_json: unknown;
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

async function hasCurrentDomainProvenanceForIntent(
  transaction: AflOutcomeSqlTransaction,
  intentId: string,
  authenticateParents: (row: DatasetProvenanceRow) => Promise<void>
): Promise<boolean> {
  const result = await transaction.query<DatasetProvenanceRow>(
    `SELECT dataset.factual_candidate_id,dataset.lineage_id,
            dataset.dataset_json,admission.admission_json,
            protocol.protocol_json,observation.observation_json
       FROM outcome_valuation_model_run_intent intent
       JOIN outcome_valuation_dataset_candidate dataset
         ON dataset.dataset_id=intent.dataset_id
       JOIN outcome_valuation_dataset_admission admission
         ON admission.admission_id=intent.admission_id
       JOIN outcome_valuation_model_protocol protocol
         ON protocol.protocol_id=intent.protocol_id
       JOIN outcome_valuation_player_observation_set observation
         ON observation.observation_set_id=intent.observation_set_id
      WHERE intent.intent_id=$1
        AND dataset.status='finalized' AND dataset.finalized_at IS NOT NULL
        AND admission.status='finalized' AND admission.finalized_at IS NOT NULL
      FOR SHARE OF intent,dataset,admission,protocol,observation`,
    [intentId]
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) return false;
  await authenticateParents(row);
  return (
    result.rows.length === 1 &&
    row !== undefined &&
    (await hasCurrentAflTradeValuationDatasetDomainProvenance(transaction, {
      factualCandidateId: row.factual_candidate_id,
      lineageId: row.lineage_id,
    }))
  );
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

async function lockModelRunRoot(transaction: AflOutcomeSqlTransaction, intentId: string) {
  const result = await transaction.query<{ root_intent_id: string }>(
    `SELECT COALESCE(root_intent_id,intent_id) AS root_intent_id
       FROM outcome_valuation_model_run_intent WHERE intent_id=$1`,
    [intentId]
  );
  await lock(transaction, [`valuation-model-root:${result.rows[0]?.root_intent_id ?? intentId}`]);
}

async function insertCheckpoint(
  transaction: AflOutcomeSqlTransaction,
  checkpoint: AflTradeModelRunCheckpoint
) {
  const content = checkpoint.content;
  await insertOrRequireExact(transaction, {
    insertSql: `INSERT INTO outcome_valuation_model_run_checkpoint
      (checkpoint_id,intent_id,root_intent_id,authorization_id,request_id,operation_id,claim_id,
       attempt_number,stage,previous_checkpoint_id,recorded_at,candidate_artifact,evidence_artifact,
       checkpoint_canonical_json,checkpoint_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb)
      ON CONFLICT DO NOTHING`,
    insertParameters: [
      checkpoint.checkpointId,
      content.intentId,
      content.rootIntentId,
      content.authorizationId,
      content.dispatchRequestId,
      content.substantiveOperationId,
      content.dispatchClaimId,
      content.dispatchAttemptNumber,
      content.stage,
      content.previousCheckpointId,
      content.recordedAt,
      content.candidateArtifact === null
        ? null
        : canonicalizeAflTradeJson(content.candidateArtifact),
      content.evidenceArtifact === null ? null : canonicalizeAflTradeJson(content.evidenceArtifact),
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(checkpoint),
    ],
    selectSql: `SELECT checkpoint_json AS document_json FROM outcome_valuation_model_run_checkpoint WHERE checkpoint_id=$1`,
    selectParameters: [checkpoint.checkpointId],
    expected: checkpoint,
    description: 'model-run checkpoint',
  });
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
  protocol: AflTradePlayerContributionModelProtocolV2 | AflTradePlayerPavModelProtocol
): AflTradeArtifactRef[] {
  if (protocol.content.schemaVersion === 'afl-trade-model-protocol/v3') {
    const content = protocol.content;
    return [
      intent.content.sourceCodeArtifact,
      intent.content.dependencyLockArtifact,
      intent.content.runtimeArtifact,
      intent.content.containerArtifact,
      intent.content.configurationArtifact,
      intent.content.environmentArtifact,
      ...intent.content.featureDefinitionArtifacts,
      content.sourceObservationSet.artifact,
      content.pavPolicy.artifact,
      content.hpnMethod.artifact,
      content.featureDefinitionArtifact,
      content.featurePolicy.featureAvailabilityArtifact,
      ...content.validationPlan.baselineDefinitionArtifacts,
      ...content.validationPlan.metricDefinitionArtifacts,
      content.validationPlan.intervalCalibrationArtifact,
      ...content.validationPlan.sensitivityAnalysisArtifacts,
      content.validationPlan.acceptanceCriteriaArtifact,
    ];
  }
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
    ...(protocol.content.featureValuesArtifact === undefined
      ? []
      : [protocol.content.featureValuesArtifact]),
    ...(protocol.content.pointInTimeFeatureValuesArtifact === undefined
      ? []
      : [protocol.content.pointInTimeFeatureValuesArtifact]),
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
      artifactRepository: AflTradeExactExecutableArtifactReader;
      candidateArtifactRepository?: AflTradeImmutableArtifactRepository;
      maximumArtifactBytes?: number;
    }
  ) {}

  /** Fits only the original consumed native run. A checkpoint is not a terminal model result. */
  async retainNativeCandidateCheckpoint(input: {
    intentId: string;
    authorizationId: string;
  }): Promise<{
    state: 'candidate_locked' | 'already_locked';
    checkpoint: AflTradeModelRunCheckpoint;
  }> {
    let result = await this.retainNativeStageCheckpoint(input, 'candidate_locked');
    while (result.state === 'progress_retained')
      result = await this.retainNativeStageCheckpoint(input, 'candidate_locked');
    if (result.state !== 'candidate_locked' && result.state !== 'already_locked')
      throw new Error('Native candidate transition returned another stage.');
    return { state: result.state, checkpoint: result.checkpoint };
  }

  /** Only newly_started permits the caller to proceed; a retained start never grants a rerun. */
  async beginNativeFinalTestCheckpoint(input: {
    intentId: string;
    authorizationId: string;
  }): Promise<
    | { state: 'newly_started' | 'already_started'; checkpoint: AflTradeModelRunCheckpoint }
    | {
        state: 'completed';
        checkpoint: AflTradeModelRunCheckpoint;
        recovery: AflTradeRetainedModelRunRecoveryState;
      }
  > {
    const result = await this.retainNativeStageCheckpoint(input, 'final_test_started');
    if (result.state === 'completed') return result;
    if (result.state === 'newly_started' || result.state === 'already_started')
      return { state: result.state, checkpoint: result.checkpoint };
    throw new Error('Native final-test transition returned a candidate stage.');
  }

  /** Evaluates only this invocation's committed start; recovery never grants another evaluation. */
  async executeNativeFinalTest(input: { intentId: string; authorizationId: string }): Promise<
    | { state: 'already_started'; checkpoint: AflTradeModelRunCheckpoint }
    | {
        state: 'completed';
        checkpoint: AflTradeModelRunCheckpoint;
        recovery: AflTradeRetainedModelRunRecoveryState;
      }
  > {
    const started = await this.retainNativeStageCheckpoint(input, 'final_test_started');
    if (started.state === 'completed' || started.state === 'already_started') return started;
    if (started.state !== 'newly_started')
      throw new Error('Native final execution requires a committed start.');
    // This context exists only after the transaction above commits; it is never request data
    // and is not returned by public begin/recovery. Any later failure leaves an ambiguous start.
    const { parents, metricDefinitionArtifacts } = started.numericalContext;
    const intent = parents.executionIntent ?? parents.fitInput.intent;
    const repository = this.dependencies.candidateArtifactRepository!;
    const maximumBytes = Math.min(
      this.dependencies.maximumArtifactBytes ?? MAXIMUM_EXECUTABLE_ARTIFACT_BYTES,
      MAXIMUM_EXECUTABLE_ARTIFACT_BYTES
    );
    const fail = (message: string): never => {
      throw new AflTradeModelRunPersistenceError('MISSING_EVIDENCE', message);
    };
    const expectedCustodyIdentity = started.numericalContext.custodyIdentity;
    const checkCustody = () => {
      if (nativeArtifactCustodyIdentity(repository) !== expectedCustodyIdentity)
        fail('Native final execution custody changed after its private start validation.');
    };
    checkCustody();
    return this.dependencies.sql.transaction(async (transaction) => {
      await lockModelRunRoot(transaction, intent.intentId);
      const before = await this.readRetainedRecoveryState(transaction, intent.intentId);
      if (
        !exactJson(before.activeIntent, intent) ||
        before.terminalRun ||
        before.finalTestCompletionEvidence ||
        !exactJson(before.checkpoints.at(-1), started.checkpoint)
      )
        return fail('Native final execution lost its exact newly committed start.');
      const sql: AflOutcomeSqlClient = {
        query: transaction.query.bind(transaction),
        transaction: (work) => work(transaction),
      };
      const evidence = await this.authenticateEvidence(
        { intent },
        sql,
        createPostgresAflTradeGateDecisionLedgerRepository(sql),
        started.checkpoint
      );
      const gateHead = await transaction.query<{ revision: number }>(
        'SELECT revision FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE'
      );
      if (gateHead.rows.length !== 1 || gateHead.rows[0]?.revision !== evidence.gateLedgerRevision)
        return fail('Native final execution Gate ledger changed.');
      const now = async () =>
        exactInstant(
          requireOne(
            (
              await transaction.query<{ now: Date | string }>(
                "SELECT date_trunc('milliseconds',clock_timestamp()) AS now"
              )
            ).rows,
            'native final execution clock'
          ).now
        );
      const authenticated = authenticateAflTradeNativePavStageEvidence({
        intent,
        evidence,
        evaluatedAt: await now(),
      });
      if (
        !exactJson(authenticated.datasetCandidate, parents.fitInput.datasetCandidate) ||
        !exactJson(authenticated.observationSet, parents.fitInput.observationSet) ||
        !exactJson(authenticated.pavObservationSet, parents.fitInput.pavObservationSet) ||
        !exactJson(authenticated.hpnMethod, parents.fitInput.hpnMethod)
      )
        return fail(
          'Native final execution current parents differ from its locked numerical inputs.'
        );
      const operation = evidence.operationalAuthorization.content;
      if (!('dispatchRequestId' in operation))
        return fail('Native final execution requires its private claim.');
      await transaction.query(
        'SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)',
        [operation.dispatchRequestId, operation.dispatchClaimId, operation.dispatchLeaseTokenSha256]
      );
      checkCustody();
      const finalEvidence = evaluateAflTradeAdmittedPlayerPavFinal(parents);
      const evaluatedAt = await now();
      const reportInput = { parents, finalEvidence, metricDefinitionArtifacts };
      const documents = createAflTradeNativePavReportDocuments(reportInput);
      const custodyIdentity = () => nativeArtifactCustodyIdentity(repository);
      const profile = expectedCustodyIdentity;
      const retain = async (
        document: unknown,
        createdAt: string,
        existingReference?: AflTradeArtifactRef
      ) => {
        checkCustody();
        const proposed = createAflTradeCanonicalJsonArtifactRef(document, createdAt);
        if (proposed.byteLength > maximumBytes)
          return fail('Native final output exceeds its configured artifact bound.');
        const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(document));
        const stored = existingReference
          ? { reference: existingReference }
          : await repository.putIfAbsent(proposed, bytes);
        const reference = aflTradeArtifactRefSchema.parse(stored.reference);
        const verifiedAt = await now();
        const loaded = await repository.loadExact(reference, maximumBytes);
        if (
          !doAflTradeArtifactRefsExactlyMatch(
            { ...reference, createdAt: proposed.createdAt },
            proposed
          ) ||
          Date.parse(reference.createdAt) > Date.parse(verifiedAt) ||
          !loaded ||
          !doAflTradeArtifactRefsExactlyMatch(loaded.reference, reference) ||
          !doesAflTradeArtifactRefMatchBytes(reference, loaded.bytes, 'application/json') ||
          custodyIdentity() !== profile
        )
          return fail('Native final output custody differs from exact immutable bytes.');
        await verifyAflTradeArtifactReadback(repository, reference, verifiedAt, maximumBytes);
        if (custodyIdentity() !== profile)
          return fail('Native final output custody profile changed.');
        return {
          reference,
          document: JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(loaded.bytes)
          ) as unknown,
        };
      };
      const retained = new Map<string, Awaited<ReturnType<typeof retain>>>();
      for (const [key, document] of Object.entries(documents))
        retained.set(
          key,
          await retain(
            document,
            await now(),
            key === 'modelArtifact'
              ? parents.candidateArtifact
              : key === 'selectionValidationReportArtifact'
                ? parents.preFinalArtifact
                : undefined
          )
        );
      authenticateAflTradeNativePavReportDocuments(
        Object.fromEntries([...retained].map(([key, value]) => [key, value.document])),
        reportInput
      );
      const reference = (key: keyof typeof documents) => retained.get(key)!.reference;
      if (
        !doAflTradeArtifactRefsExactlyMatch(reference('modelArtifact'), parents.candidateArtifact)
      )
        return fail('Native final output changed the original candidate custody reference.');
      const outcome = {
        status: 'succeeded' as const,
        modelArtifact: reference('modelArtifact'),
        selectionValidationReportArtifact: reference('selectionValidationReportArtifact'),
        validationReportArtifact: reference('validationReportArtifact'),
        baselineComparisonArtifact: reference('baselineComparisonArtifact'),
        calibrationReportArtifact: reference('calibrationReportArtifact'),
        intervalCoverageArtifact: reference('intervalCoverageArtifact'),
        subgroupReportArtifact: reference('subgroupReportArtifact'),
        sensitivityReportArtifact: reference('sensitivityReportArtifact'),
        leakageAuditArtifact: reference('leakageAuditArtifact'),
        modelCardArtifact: reference('modelCardArtifact'),
        diagnosticsArtifact: reference('diagnosticsArtifact'),
      };
      const recordedAt = await now();
      const completion =
        started.checkpoint.content.schemaVersion === 'afl-trade-model-run-checkpoint/v2'
          ? createAflTradeNativeFinalTestCompletionEvidenceV2({
              finalTestStartedCheckpoint: aflTradeModelRunCheckpointV2Schema.parse(
                started.checkpoint
              ),
              evaluatedAt,
              recordedAt,
              outcome,
            })
          : createAflTradeNativeFinalTestCompletionEvidence({
              finalTestStartedCheckpoint: aflTradeModelRunCheckpointV1Schema.parse(
                started.checkpoint
              ),
              evaluatedAt,
              recordedAt,
              outcome,
            });
      const completionArtifact = await retain(completion, recordedAt);
      if (completionArtifact.reference.createdAt !== recordedAt)
        return fail('Native completion evidence changed its recorded custody time.');
      const finishedAt = await now();
      authenticateAflTradeNativePavStageEvidence({ intent, evidence, evaluatedAt: finishedAt });
      const checkpoint = (
        started.checkpoint.content.schemaVersion === 'afl-trade-model-run-checkpoint/v2'
          ? createAflTradeModelRunCheckpointV2
          : createAflTradeModelRunCheckpoint
      )({
        ...started.checkpoint.content,
        stage: 'final_test_completed',
        previousCheckpointId: started.checkpoint.checkpointId,
        recordedAt: finishedAt,
        evidenceArtifact: completionArtifact.reference,
      });
      await insertCheckpoint(transaction, checkpoint);
      const recovery = await this.readRetainedRecoveryState(transaction, intent.intentId);
      return { state: 'completed', checkpoint, recovery };
    });
  }

  private async retainNativeStageCheckpoint(
    input: {
      intentId: string;
      authorizationId: string;
    },
    requestedStage: 'candidate_locked' | 'final_test_started'
  ): Promise<
    | {
        state: 'candidate_locked' | 'already_locked' | 'progress_retained';
        checkpoint: AflTradeModelRunCheckpoint;
      }
    | { state: 'already_started'; checkpoint: AflTradeModelRunCheckpoint }
    | {
        state: 'newly_started';
        checkpoint: AflTradeModelRunCheckpoint;
        numericalContext: {
          parents: Parameters<typeof evaluateAflTradeAdmittedPlayerPavFinal>[0];
          metricDefinitionArtifacts: { reference: AflTradeArtifactRef; bytes: Uint8Array }[];
          custodyIdentity: string;
        };
      }
    | {
        state: 'completed';
        checkpoint: AflTradeModelRunCheckpoint;
        recovery: AflTradeRetainedModelRunRecoveryState;
      }
  > {
    const repository = this.dependencies.candidateArtifactRepository;
    if (!repository)
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Native candidate artifact repository is not configured.'
      );
    const initialCustodyIdentity = nativeArtifactCustodyIdentity(repository);
    const intentId = aflTradeContentAddressedIdSchema('model-run-intent').parse(input.intentId);
    const authorizationId = aflTradeContentAddressedIdSchema('model-run-authorization').parse(
      input.authorizationId
    );
    const maximumBytes = Math.min(
      this.dependencies.maximumArtifactBytes ?? MAXIMUM_EXECUTABLE_ARTIFACT_BYTES,
      MAXIMUM_EXECUTABLE_ARTIFACT_BYTES
    );
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0)
      throw new RangeError('Native candidate artifact bound is invalid.');
    const fail = (message: string): never => {
      throw new AflTradeModelRunPersistenceError('MISSING_EVIDENCE', message);
    };
    const readBytes = async (reference: AflTradeArtifactRef) => {
      if (reference.byteLength > maximumBytes)
        return fail('Native candidate executable exceeds its artifact bound.');
      const loaded = await loadExactExecutableArtifact(
        this.dependencies.artifactRepository,
        reference,
        maximumBytes
      );
      if (
        !loaded ||
        !doAflTradeArtifactRefsExactlyMatch(reference, loaded.reference) ||
        !doesAflTradeArtifactRefMatchBytes(reference, loaded.bytes, 'application/json')
      )
        return fail('Native candidate requires exact retained executable bytes.');
      return loaded.bytes;
    };
    return this.dependencies.sql.transaction(async (transaction) => {
      await lockModelRunRoot(transaction, intentId);
      await lock(transaction, [`valuation-model-intent:${intentId}`]);
      const retained = await transaction.query<{
        intent_json: unknown;
        authorization_json: unknown;
        consumed_at: Date | string | null;
        receipt_json: unknown;
        protocol_json: unknown;
        observation_json: unknown;
        dataset_json: unknown;
      }>(
        `SELECT intent.intent_json,authority.authorization_json,authority.consumed_at,
                 operational.receipt_json,protocol.protocol_json,observation.observation_json,dataset.dataset_json
            FROM outcome_valuation_model_run_intent intent
            JOIN outcome_valuation_model_run_authorization authority ON authority.intent_id=intent.intent_id
            JOIN outcome_valuation_model_run_operational_authorization operational ON operational.receipt_id=authority.operational_authorization_receipt_id
            JOIN outcome_valuation_model_protocol protocol ON protocol.protocol_id=intent.protocol_id
            JOIN outcome_valuation_player_observation_set observation ON observation.observation_set_id=intent.observation_set_id
            JOIN outcome_valuation_dataset_candidate dataset ON dataset.dataset_id=intent.dataset_id
           WHERE intent.intent_id=$1 AND authority.authorization_id=$2
           FOR SHARE OF intent,authority,operational,protocol,observation,dataset`,
        [intentId, authorizationId]
      );
      const row = requireOne(retained.rows, 'consumed native candidate ancestry');
      const intent = aflTradeModelRunIntentSchema.parse(row.intent_json);
      const authorization = aflTradeModelRunAuthorizationSchema.parse(row.authorization_json);
      const receipt = aflTradeModelRunOperationalAuthorizationSchema.parse(row.receipt_json);
      if (
        intent.intentId !== intentId ||
        intent.content.environment !== 'non_production' ||
        row.consumed_at === null ||
        authorization.authorizationId !== authorizationId ||
        receipt.content.authorityBoundary !==
          'policy_owned_local_private_valuation_for_one_exact_model_run_intent' ||
        receipt.content.runIntentId !== intentId ||
        authorization.content.runIntentId !== intentId ||
        authorization.content.operationalAuthorizationReceiptId !== receipt.receiptId ||
        authorization.content.datasetId !== intent.content.datasetId ||
        authorization.content.datasetAdmissionId !== intent.content.datasetAdmissionId ||
        authorization.content.modelProtocolId !== intent.content.modelProtocolId ||
        authorization.content.observationSetId !== intent.content.observationSetId
      )
        return fail('Candidate checkpoint requires the exact consumed native private run.');
      const continuationState =
        intent.content.schemaVersion === 'afl-trade-model-run-intent/v2'
          ? await this.readRetainedRecoveryState(transaction, intentId)
          : null;
      if (continuationState && !exactJson(continuationState.activeIntent, intent))
        return fail('Native continuation is not the exact active retained intent.');
      const rootIntent = continuationState?.rootIntent ?? intent;
      const rootIntentId = rootIntent.intentId;
      const protocol = aflTradePlayerPavModelProtocolSchema.parse(row.protocol_json);
      const fitInput: AflTradeAdmittedPlayerPavFitInput = {
        intent: rootIntent,
        protocol,
        datasetCandidate: aflTradeValuationDatasetCandidateSchema.parse(row.dataset_json),
        observationSet: aflTradePlayerObservationSetV3Schema.parse(row.observation_json),
        pavObservationSet: aflTradePlayerPavObservationSetSchema.parse(
          JSON.parse(
            new TextDecoder().decode(
              await readBytes(protocol.content.sourceObservationSet.artifact)
            )
          )
        ),
        hpnMethod: aflTradeHpnPavMethodSchema.parse(
          JSON.parse(new TextDecoder().decode(await readBytes(protocol.content.hpnMethod.artifact)))
        ),
        configurationBytes: await readBytes(intent.content.configurationArtifact),
      };
      const records = await transaction.query<{ checkpoint_json: unknown }>(
        `SELECT checkpoint_json FROM outcome_valuation_model_run_checkpoint WHERE root_intent_id=$1
        ORDER BY CASE stage WHEN 'started' THEN 1 WHEN 'candidate_fitted' THEN 2 WHEN 'pre_final_retained' THEN 3 WHEN 'validation_plan_retained' THEN 4 WHEN 'candidate_locked' THEN 5 WHEN 'final_test_started' THEN 6 ELSE 7 END`,
        [rootIntentId]
      );
      const checkpoints = records.rows.map(({ checkpoint_json }) =>
        aflTradeModelRunCheckpointSchema.parse(checkpoint_json)
      );
      const started = checkpoints[0];
      if (
        !started ||
        started.content.stage !== 'started' ||
        started.content.intentId !== rootIntentId ||
        (!continuationState && started.content.authorizationId !== authorizationId) ||
        (!continuationState &&
          started.content.dispatchClaimId !== receipt.content.dispatchClaimId) ||
        started.content.dispatchRequestId !== receipt.content.dispatchRequestId ||
        started.content.substantiveOperationId !== receipt.content.substantiveOperationId ||
        (!continuationState &&
          started.content.dispatchAttemptNumber !== receipt.content.dispatchAttemptNumber)
      )
        return fail('Native candidate requires its exact retained started checkpoint.');
      const evidenceFor = (
        candidateId: string,
        candidateArtifact: AflTradeArtifactRef,
        preFinalArtifact?: AflTradeArtifactRef,
        validationPlanArtifact?: AflTradeArtifactRef
      ) => ({
        schemaVersion: validationPlanArtifact
          ? 'afl-trade-native-pav-candidate-custody/v3'
          : preFinalArtifact
            ? 'afl-trade-native-pav-candidate-custody/v2'
            : 'afl-trade-native-pav-candidate-custody/v1',
        authorityBoundary: preFinalArtifact
          ? 'pre_final_numerical_evidence_no_final_test_or_qualification'
          : 'train_only_no_evaluation_or_qualification',
        rootIntentId,
        fitIntentId: rootIntentId,
        candidateId,
        candidateArtifact,
        ...(preFinalArtifact ? { preFinalArtifact } : {}),
        ...(validationPlanArtifact ? { validationPlanArtifact } : {}),
      });
      const preFinalInput = async (candidate: unknown, candidateArtifact: AflTradeArtifactRef) => ({
        fitInput,
        candidate,
        candidateArtifact,
        calibrationConfigurationArtifact:
          protocol.content.validationPlan.intervalCalibrationArtifact,
        calibrationConfigurationBytes: await readBytes(
          protocol.content.validationPlan.intervalCalibrationArtifact
        ),
      });
      const validationPlanInput = async (
        candidate: unknown,
        candidateArtifact: AflTradeArtifactRef,
        preFinalEvidence: unknown
      ) => ({
        preFinalInput: await preFinalInput(candidate, candidateArtifact),
        preFinalEvidence,
        definitionArtifacts: await Promise.all(
          [
            ...protocol.content.validationPlan.baselineDefinitionArtifacts,
            ...protocol.content.validationPlan.sensitivityAnalysisArtifacts,
          ].map(async (reference) => ({ reference, bytes: await readBytes(reference) }))
        ),
      });
      const saved =
        checkpoints.find((item) => item.content.stage === 'candidate_locked') ??
        [...checkpoints]
          .reverse()
          .find((item) =>
            ['candidate_fitted', 'pre_final_retained', 'validation_plan_retained'].includes(
              item.content.stage
            )
          );
      let retainedCandidate: Awaited<
        ReturnType<typeof loadAflTradeAdmittedPlayerPavCandidate>
      > | null = null;
      let retainedPreFinal: { document: unknown; reference: AflTradeArtifactRef } | null = null;
      let retainedPlan: { document: unknown; reference: AflTradeArtifactRef } | null = null;
      let retainedCustodyBytes: Uint8Array | null = null;
      if (saved) {
        const content = saved.content;
        const savedIndex = checkpoints.indexOf(saved);
        const previous = checkpoints[savedIndex - 1]!;
        const stages = checkpoints.some(
          (item) => item.content.schemaVersion === 'afl-trade-model-run-checkpoint/v2'
        )
          ? AFL_TRADE_MODEL_RUN_PROGRESS_STAGES
          : ['started', 'candidate_locked', 'final_test_started', 'final_test_completed'];
        if (
          checkpoints.some(
            (item, index) =>
              item.content.stage !== stages[index] ||
              item.content.previousCheckpointId !==
                (checkpoints[index - 1]?.checkpointId ?? null) ||
              item.content.rootIntentId !== rootIntentId ||
              (index > 0 &&
                Date.parse(item.content.recordedAt) <
                  Date.parse(checkpoints[index - 1]!.content.recordedAt)) ||
              (index > 1 &&
                !exactJson(
                  item.content.candidateArtifact,
                  checkpoints[index - 1]!.content.candidateArtifact
                )) ||
              (stages === AFL_TRADE_MODEL_RUN_PROGRESS_STAGES &&
                index > 0 &&
                item.content.schemaVersion !== 'afl-trade-model-run-checkpoint/v2') ||
              (index > 0 &&
                (item.content.stage === 'final_test_started' ||
                  (item.content.stage === 'candidate_locked' &&
                    item.content.schemaVersion === 'afl-trade-model-run-checkpoint/v2')) &&
                !exactJson(
                  item.content.evidenceArtifact,
                  checkpoints[index - 1]!.content.evidenceArtifact
                ))
          ) ||
          (!continuationState && content.intentId !== intentId) ||
          (!continuationState && content.authorizationId !== authorizationId) ||
          content.previousCheckpointId !== previous.checkpointId ||
          !content.candidateArtifact ||
          !content.evidenceArtifact ||
          content.dispatchRequestId !== started.content.dispatchRequestId ||
          (!continuationState && content.dispatchClaimId !== started.content.dispatchClaimId) ||
          content.substantiveOperationId !== started.content.substantiveOperationId ||
          (!continuationState &&
            content.dispatchAttemptNumber !== started.content.dispatchAttemptNumber)
        )
          return fail('Retained native candidate checkpoint ancestry is inconsistent.');
        const restored = await loadAflTradeAdmittedPlayerPavCandidate({
          fitInput,
          artifact: content.candidateArtifact,
          artifactRepository: repository,
          maximumArtifactBytes: maximumBytes,
        });
        retainedCandidate = restored;
        if (content.evidenceArtifact.byteLength > maximumBytes)
          return fail('Native candidate custody evidence exceeds its artifact bound.');
        const evidence = await repository.loadExact(content.evidenceArtifact, maximumBytes);
        if (
          !evidence ||
          !doAflTradeArtifactRefsExactlyMatch(content.evidenceArtifact, evidence.reference) ||
          !doesAflTradeArtifactRefMatchBytes(
            content.evidenceArtifact,
            evidence.bytes,
            'application/json'
          )
        )
          return fail(
            'Retained native candidate custody evidence differs from exact fitted state.'
          );
        const custody = JSON.parse(new TextDecoder().decode(evidence.bytes)) as Record<
          string,
          unknown
        >;
        retainedCustodyBytes = evidence.bytes;
        const preFinalArtifact = [
          'afl-trade-native-pav-candidate-custody/v2',
          'afl-trade-native-pav-candidate-custody/v3',
        ].includes(String(custody.schemaVersion))
          ? aflTradeArtifactRefSchema.parse(custody.preFinalArtifact)
          : undefined;
        const validationPlanArtifact =
          custody.schemaVersion === 'afl-trade-native-pav-candidate-custody/v3'
            ? aflTradeArtifactRefSchema.parse(custody.validationPlanArtifact)
            : undefined;
        if (
          (content.stage === 'candidate_fitted' && (preFinalArtifact || validationPlanArtifact)) ||
          (content.stage === 'pre_final_retained' &&
            (!preFinalArtifact || validationPlanArtifact)) ||
          (content.stage === 'validation_plan_retained' &&
            (!preFinalArtifact || !validationPlanArtifact))
        )
          return fail('Native numerical progress differs from its exact custody stage.');
        if (
          !exactJson(
            custody,
            evidenceFor(
              restored.candidate.candidateId,
              content.candidateArtifact,
              preFinalArtifact,
              validationPlanArtifact
            )
          )
        )
          return fail(
            'Retained native candidate custody evidence differs from exact fitted state.'
          );
        if (preFinalArtifact) {
          if (preFinalArtifact.byteLength > maximumBytes)
            return fail('Native pre-final report exceeds its artifact bound.');
          const report = await repository.loadExact(preFinalArtifact, maximumBytes);
          if (
            !report ||
            !doAflTradeArtifactRefsExactlyMatch(report.reference, preFinalArtifact) ||
            !doesAflTradeArtifactRefMatchBytes(preFinalArtifact, report.bytes, 'application/json')
          )
            return fail('Native candidate requires exact retained pre-final report bytes.');
          if (Date.parse(preFinalArtifact.createdAt) > Date.parse(content.recordedAt))
            return fail('Native pre-final report must precede the candidate lock.');
          authenticateAflTradeAdmittedPlayerPavPreFinalEvidence(
            JSON.parse(new TextDecoder().decode(report.bytes)),
            await preFinalInput(restored.candidate, content.candidateArtifact)
          );
          retainedPreFinal = {
            document: JSON.parse(new TextDecoder().decode(report.bytes)),
            reference: preFinalArtifact,
          };
          if (validationPlanArtifact) {
            if (
              validationPlanArtifact.byteLength > maximumBytes ||
              Date.parse(validationPlanArtifact.createdAt) > Date.parse(content.recordedAt)
            )
              return fail('Native validation plan must be bounded and precede the candidate lock.');
            const plan = await repository.loadExact(validationPlanArtifact, maximumBytes);
            if (
              !plan ||
              !doAflTradeArtifactRefsExactlyMatch(plan.reference, validationPlanArtifact) ||
              !doesAflTradeArtifactRefMatchBytes(
                validationPlanArtifact,
                plan.bytes,
                'application/json'
              )
            )
              return fail('Native candidate requires exact retained validation plan bytes.');
            authenticateAflTradeAdmittedPlayerPavValidationPlan(
              JSON.parse(new TextDecoder().decode(plan.bytes)),
              await validationPlanInput(
                restored.candidate,
                content.candidateArtifact,
                JSON.parse(new TextDecoder().decode(report.bytes))
              )
            );
            retainedPlan = {
              document: JSON.parse(new TextDecoder().decode(plan.bytes)),
              reference: validationPlanArtifact,
            };
          }
        }
        for (const predecessor of checkpoints.slice(1, savedIndex)) {
          const phase = predecessor.content.stage;
          if (
            !['candidate_fitted', 'pre_final_retained', 'validation_plan_retained'].includes(phase)
          )
            continue;
          const reference = predecessor.content.evidenceArtifact;
          if (
            !reference ||
            reference.byteLength > maximumBytes ||
            (phase !== 'candidate_fitted' && !retainedPreFinal) ||
            (phase === 'validation_plan_retained' && !retainedPlan)
          )
            return fail('Native accepted progress ancestry is incomplete.');
          const expected = evidenceFor(
            restored.candidate.candidateId,
            content.candidateArtifact,
            phase === 'candidate_fitted' ? undefined : retainedPreFinal!.reference,
            phase === 'validation_plan_retained' ? retainedPlan!.reference : undefined
          );
          const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(expected));
          const retained = await repository.loadExact(reference, maximumBytes);
          if (
            !retained ||
            !doAflTradeArtifactRefsExactlyMatch(retained.reference, reference) ||
            !doesAflTradeArtifactRefMatchBytes(reference, retained.bytes, 'application/json') ||
            !doesAflTradeArtifactRefMatchBytes(reference, bytes, 'application/json')
          )
            return fail('Native accepted progress must preserve exact predecessor custody.');
        }
        if (requestedStage === 'candidate_locked' && content.stage === 'candidate_locked')
          return { state: 'already_locked', checkpoint: saved };
        if (checkpoints.some((item) => item.content.stage === 'final_test_started')) {
          const recovery = await this.readRetainedRecoveryState(transaction, intentId);
          const completed = recovery.checkpoints.find(
            (item) => item.content.stage === 'final_test_completed'
          );
          return completed
            ? { state: 'completed', checkpoint: completed, recovery }
            : {
                state: 'already_started',
                checkpoint: recovery.checkpoints.find(
                  (item) => item.content.stage === 'final_test_started'
                )!,
              };
        }
        if (
          requestedStage === 'final_test_started' &&
          (!preFinalArtifact || !validationPlanArtifact)
        )
          return fail(
            'Native final-test work requires retained v3 validation plan custody; legacy fit-only locks cannot be upgraded, nor can pre-final-only locks.'
          );
      }
      if (requestedStage === 'final_test_started' && saved?.content.stage !== 'candidate_locked')
        return fail('Native final-test work requires an already retained candidate lock.');
      const terminal = await transaction.query(
        `SELECT intent_id FROM outcome_valuation_model_run_intent WHERE previous_intent_id=$1
        UNION ALL SELECT intent_id FROM outcome_valuation_model_run WHERE intent_id=$1`,
        [intentId]
      );
      if (terminal.rows.length) return fail('Native candidate run is superseded or terminal.');
      await transaction.query(
        `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
        [
          receipt.content.dispatchRequestId,
          receipt.content.dispatchClaimId,
          receipt.content.dispatchLeaseTokenSha256,
        ]
      );
      const binding = await transaction.query(
        `SELECT operation_id FROM outcome_private_valuation_model_request_binding WHERE request_id=$1 AND operation_id=$2`,
        [receipt.content.dispatchRequestId, receipt.content.substantiveOperationId]
      );
      if (binding.rows.length !== 1)
        return fail('Native candidate requires exact request operation binding.');
      const sql: AflOutcomeSqlClient = {
        query: transaction.query.bind(transaction),
        transaction: (work) => work(transaction),
      };
      const evidence = await this.authenticateEvidence(
        { intent },
        sql,
        createPostgresAflTradeGateDecisionLedgerRepository(sql)
      );
      const gateHead = await transaction.query<{ revision: number }>(
        `SELECT revision FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE`
      );
      if (gateHead.rows.length !== 1 || gateHead.rows[0]?.revision !== evidence.gateLedgerRevision)
        return fail('Native candidate Gate ledger changed before fitting.');
      const databaseNow = async () =>
        exactInstant(
          requireOne(
            (
              await transaction.query<{ now: Date | string }>(
                `SELECT date_trunc('milliseconds',clock_timestamp()) AS now`
              )
            ).rows,
            'candidate checkpoint clock'
          ).now
        );
      const createdAt = await databaseNow();
      const custodyIdentity = () =>
        canonicalizeAflTradeJson({
          assurance: repository.assurance,
          artifactClass: repository.artifactClass,
          custodyProfile: repository.custodyProfile,
        });
      const expectedCustodyIdentity = custodyIdentity();
      const retainNumericalDocument = async (document: unknown, label: string) => {
        const proposed = createAflTradeCanonicalJsonArtifactRef(document, await databaseNow());
        if (proposed.byteLength > maximumBytes)
          return fail(`Native ${label} exceeds its artifact bound.`);
        const bytes = new TextEncoder().encode(canonicalizeAflTradeJson(document));
        const stored = await repository.putIfAbsent(proposed, bytes);
        const reference = aflTradeArtifactRefSchema.parse(stored.reference);
        const verifiedAt = await databaseNow();
        // Conditional-create may return an older reference for identical bytes. Preserve it;
        // only creation time can differ, and it cannot exceed the trusted verification clock.
        if (
          !doAflTradeArtifactRefsExactlyMatch(
            { ...reference, createdAt: proposed.createdAt },
            proposed
          ) ||
          Date.parse(reference.createdAt) > Date.parse(verifiedAt) ||
          custodyIdentity() !== expectedCustodyIdentity
        )
          return fail(
            `Native ${label} custody changed its immutable metadata, chronology or profile.`
          );
        const readback = await repository.loadExact(reference, maximumBytes);
        if (
          !readback ||
          !doAflTradeArtifactRefsExactlyMatch(readback.reference, reference) ||
          !doesAflTradeArtifactRefMatchBytes(reference, readback.bytes, 'application/json')
        )
          return fail(`Native candidate requires exact retained ${label} bytes.`);
        await verifyAflTradeArtifactReadback(repository, reference, verifiedAt, maximumBytes);
        if (custodyIdentity() !== expectedCustodyIdentity)
          return fail(`Native ${label} custody profile changed during readback.`);
        return { reference, bytes: readback.bytes };
      };
      if (Date.parse(createdAt) < Date.parse(exactInstant(row.consumed_at)))
        return fail('Native candidate clock predates consumed authorization.');
      const authenticated = authenticateAflTradeNativePavStageEvidence({
        intent,
        evidence,
        evaluatedAt: createdAt,
      });
      if (
        !exactJson(authenticated.datasetCandidate, fitInput.datasetCandidate) ||
        !exactJson(authenticated.observationSet, fitInput.observationSet) ||
        !exactJson(authenticated.pavObservationSet, fitInput.pavObservationSet) ||
        !exactJson(authenticated.hpnMethod, fitInput.hpnMethod)
      )
        return fail('Current native fitting parents changed.');
      if (requestedStage === 'final_test_started') {
        if (nativeArtifactCustodyIdentity(repository) !== initialCustodyIdentity)
          return fail('Native final execution custody changed during private start validation.');
        if (
          !saved ||
          !saved.content.candidateArtifact ||
          !saved.content.evidenceArtifact ||
          !retainedCandidate ||
          !retainedPreFinal ||
          !retainedPlan ||
          !retainedCustodyBytes
        )
          return fail('Native final-test work requires exact locked candidate custody.');
        const metricDefinitionArtifacts = await Promise.all(
          protocol.content.validationPlan.metricDefinitionArtifacts.map(async (reference) => ({
            reference,
            bytes: await readBytes(reference),
          }))
        );
        interpretAflTradeNativePavMetricDefinitions(protocol, metricDefinitionArtifacts);
        const numericalParents = {
          ...(await preFinalInput(retainedCandidate.candidate, saved.content.candidateArtifact)),
          preFinalEvidence: retainedPreFinal.document,
          preFinalArtifact: retainedPreFinal.reference,
          validationPlanEvidence: retainedPlan.document,
          validationPlanArtifact: retainedPlan.reference,
          candidateCustodyBytes: retainedCustodyBytes,
          candidateLockedCheckpoint: saved,
          executionIntent: intent,
        };
        const preFinalDocument = aflTradeNativePavPreFinalEvidenceSchema.parse(
          retainedPreFinal.document
        );
        const planDocument = aflTradeNativePavValidationPlanEvidenceSchema.parse(
          retainedPlan.document
        );
        const metadata = fitInput.observationSet.content.observations.map(
          ({ pavObservation: row }) => ({
            observationId: row.observationId,
            playerId: row.playerId,
            predictionSeason: row.predictionSeason,
            partition: row.partition,
          })
        );
        const jsonBytes = (value: unknown) =>
          new TextEncoder().encode(canonicalizeAflTradeJson(value)).byteLength;
        const states = [
          preFinalDocument.content.calibrationState,
          ...planDocument.content.evaluations
            .filter((item) => item.kind === 'baseline')
            .map((item) => item.calibrationState),
        ];
        // Conservative serialization envelope, not a model threshold. Four numeric draws per
        // residual reserve 26 bytes each (all finite JSON numbers); exact calibration IDs and
        // source metadata are measured. Fixed schema keys/scalars and paired metric cells
        // reserve 8192 bytes per forecast (more than 128 numeric metric cells plus their keys).
        // Retained parents cover static report content; no final numerical target is accessed.
        const forecastEnvelope = states.reduce(
          (sum, state) =>
            sum +
            8192 +
            state.content.residuals.length * 4 * 26 +
            jsonBytes(state.content.residuals.map((row) => row.observationId)),
          0
        );
        // V2 retains primary and baseline score contributions for all four scopes.
        // Reserve every numeric cell plus JSON keys, and measure repeated row metadata;
        // this envelope applies independently to both final and baseline report artifacts.
        const pairedScoreEnvelope =
          (states.length - 1) *
          metadata
            .filter((row) => row.partition === 'final_test')
            .reduce((sum, row) => sum + jsonBytes(row) + 2 * 4 * (7 * 26 + 256), 0);
        const reportEnvelope =
          32768 +
          pairedScoreEnvelope +
          2 *
            (saved.content.candidateArtifact.byteLength +
              retainedPreFinal.reference.byteLength +
              retainedPlan.reference.byteLength +
              jsonBytes(protocol) +
              jsonBytes(metadata)) +
          metadata.filter((row) => row.partition === 'final_test').length * forecastEnvelope;
        if (!Number.isSafeInteger(reportEnvelope) || reportEnvelope > maximumBytes)
          return fail(
            'Native final reports cannot fit the configured artifact bound before evaluation.'
          );
        const recordedAt = await databaseNow();
        authenticateAflTradeNativePavStageEvidence({ intent, evidence, evaluatedAt: recordedAt });
        const createCheckpoint =
          saved.content.schemaVersion === 'afl-trade-model-run-checkpoint/v2'
            ? createAflTradeModelRunCheckpointV2
            : createAflTradeModelRunCheckpoint;
        const checkpoint = createCheckpoint({
          ...saved.content,
          intentId,
          authorizationId,
          dispatchClaimId: receipt.content.dispatchClaimId,
          dispatchAttemptNumber: receipt.content.dispatchAttemptNumber,
          stage: 'final_test_started',
          previousCheckpointId: saved.checkpointId,
          recordedAt,
        });
        await insertCheckpoint(transaction, checkpoint);
        return {
          state: 'newly_started',
          checkpoint,
          numericalContext: {
            custodyIdentity: initialCustodyIdentity,
            parents: { ...numericalParents, finalTestStartedCheckpoint: checkpoint },
            metricDefinitionArtifacts,
          },
        };
      }
      let stage:
        'candidate_fitted' | 'pre_final_retained' | 'validation_plan_retained' | 'candidate_locked';
      let candidateArtifact: AflTradeArtifactRef;
      let evidenceReference: AflTradeArtifactRef;
      if (!retainedCandidate) {
        const fitted = await retainAflTradeAdmittedPlayerPavCandidate({
          fitInput,
          artifactRepository: repository,
          createdAt,
          maximumArtifactBytes: maximumBytes,
        });
        await loadAflTradeAdmittedPlayerPavCandidate({
          fitInput,
          artifact: fitted.artifact,
          artifactRepository: repository,
          maximumArtifactBytes: maximumBytes,
        });
        candidateArtifact = fitted.artifact;
        evidenceReference = (
          await retainNumericalDocument(
            evidenceFor(fitted.candidate.candidateId, candidateArtifact),
            'candidate evidence'
          )
        ).reference;
        stage = 'candidate_fitted';
      } else {
        candidateArtifact = saved!.content.candidateArtifact!;
        if (saved!.content.stage === 'candidate_fitted') {
          const preFinalInputValue = await preFinalInput(
            retainedCandidate.candidate,
            candidateArtifact
          );
          const report = await retainNumericalDocument(
            evaluateAflTradeAdmittedPlayerPavPreFinal(preFinalInputValue),
            'pre-final report'
          );
          authenticateAflTradeAdmittedPlayerPavPreFinalEvidence(
            JSON.parse(new TextDecoder().decode(report.bytes)),
            preFinalInputValue
          );
          evidenceReference = (
            await retainNumericalDocument(
              evidenceFor(
                retainedCandidate.candidate.candidateId,
                candidateArtifact,
                report.reference
              ),
              'candidate evidence'
            )
          ).reference;
          stage = 'pre_final_retained';
        } else if (saved!.content.stage === 'pre_final_retained' && retainedPreFinal) {
          const planInput = await validationPlanInput(
            retainedCandidate.candidate,
            candidateArtifact,
            retainedPreFinal.document
          );
          const plan = await retainNumericalDocument(
            prepareAflTradeAdmittedPlayerPavValidationPlan(planInput),
            'validation plan'
          );
          authenticateAflTradeAdmittedPlayerPavValidationPlan(
            JSON.parse(new TextDecoder().decode(plan.bytes)),
            planInput
          );
          evidenceReference = (
            await retainNumericalDocument(
              evidenceFor(
                retainedCandidate.candidate.candidateId,
                candidateArtifact,
                retainedPreFinal.reference,
                plan.reference
              ),
              'candidate evidence'
            )
          ).reference;
          stage = 'validation_plan_retained';
        } else if (
          saved!.content.stage === 'validation_plan_retained' &&
          retainedPreFinal &&
          retainedPlan
        ) {
          evidenceReference = saved!.content.evidenceArtifact!;
          stage = 'candidate_locked';
        } else
          return fail('Native accepted progress requires the exact next retained numerical stage.');
      }
      const recordedAt = await databaseNow();
      authenticateAflTradeNativePavStageEvidence({ intent, evidence, evaluatedAt: recordedAt });
      const checkpoint = createAflTradeModelRunCheckpointV2({
        intentId,
        rootIntentId,
        authorizationId,
        dispatchRequestId: receipt.content.dispatchRequestId,
        substantiveOperationId: receipt.content.substantiveOperationId,
        dispatchClaimId: receipt.content.dispatchClaimId,
        dispatchAttemptNumber: receipt.content.dispatchAttemptNumber,
        stage,
        previousCheckpointId: saved?.checkpointId ?? started.checkpointId,
        recordedAt,
        candidateArtifact,
        evidenceArtifact: evidenceReference,
      });
      await insertCheckpoint(transaction, checkpoint);
      return {
        state: stage === 'candidate_locked' ? 'candidate_locked' : 'progress_retained',
        checkpoint,
      };
    });
  }

  /** Historical custody only. Fresh claims, source rights and execution still require authorization. */
  async loadRetainedRecoveryState(input: {
    intentId: string;
  }): Promise<AflTradeRetainedModelRunRecoveryState> {
    const intentId = aflTradeContentAddressedIdSchema('model-run-intent').parse(input.intentId);
    return this.dependencies.sql.transaction((transaction) =>
      this.readRetainedRecoveryState(transaction, intentId)
    );
  }

  private async readRetainedRecoveryState(
    transaction: AflOutcomeSqlTransaction,
    intentId: string
  ): Promise<AflTradeRetainedModelRunRecoveryState> {
    await lockModelRunRoot(transaction, intentId);
    const roots = await transaction.query<{
      intent_json: unknown;
      consumed_at: Date | string | null;
    }>(
      `SELECT root.intent_json,authority.consumed_at
           FROM outcome_valuation_model_run_intent requested
           JOIN outcome_valuation_model_run_intent root ON root.intent_id=COALESCE(requested.root_intent_id,requested.intent_id)
           JOIN outcome_valuation_model_protocol protocol ON protocol.protocol_id=root.protocol_id
           JOIN outcome_valuation_model_run_operational_authorization operational ON operational.intent_id=root.intent_id
           LEFT JOIN outcome_valuation_model_run_authorization authority ON authority.intent_id=root.intent_id
          WHERE requested.intent_id=$1 AND root.environment='non_production'
            AND protocol.protocol_json#>>'{content,schemaVersion}'='afl-trade-model-protocol/v3'
            AND operational.receipt_json#>>'{content,authorityBoundary}'=
                'policy_owned_local_private_valuation_for_one_exact_model_run_intent'`,
      [intentId]
    );
    const retainedRoot = requireOne(roots.rows, 'private native recovery root');
    const rootIntent = aflTradeModelRunIntentSchema.parse(retainedRoot.intent_json);
    const fail = (): never => {
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Retained model-run recovery ancestry is incomplete or inconsistent.'
      );
    };
    if (
      rootIntent.content.schemaVersion !== 'afl-trade-model-run-intent/v1' ||
      rootIntent.content.environment !== 'non_production'
    )
      fail();
    const intentRows = await transaction.query<{ intent_json: unknown }>(
      `SELECT intent_json FROM outcome_valuation_model_run_intent
          WHERE COALESCE(root_intent_id,intent_id)=$1`,
      [rootIntent.intentId]
    );
    const intents = intentRows.rows.map((row) =>
      aflTradeModelRunIntentSchema.parse(row.intent_json)
    );
    const byId = new Map(intents.map((intent) => [intent.intentId, intent]));
    if (
      byId.size !== intents.length ||
      !byId.has(intentId) ||
      !exactJson(byId.get(rootIntent.intentId), rootIntent)
    )
      fail();
    const successors = new Map<string, AflTradeModelRunIntent>();
    for (const intent of intents) {
      if (intent.intentId === rootIntent.intentId) continue;
      if (intent.content.schemaVersion !== 'afl-trade-model-run-intent/v2') return fail();
      const binding = intent.content.continuation;
      if (binding.rootIntentId !== rootIntent.intentId || successors.has(binding.previousIntentId))
        fail();
      successors.set(binding.previousIntentId, intent);
    }
    let activeIntent = rootIntent;
    const visited = new Set<string>([rootIntent.intentId]);
    while (successors.has(activeIntent.intentId)) {
      activeIntent = successors.get(activeIntent.intentId)!;
      if (visited.has(activeIntent.intentId)) fail();
      visited.add(activeIntent.intentId);
    }
    if (visited.size !== intents.length) fail();
    const checkpointRows = await transaction.query<{ checkpoint_json: unknown }>(
      `SELECT checkpoint_json FROM outcome_valuation_model_run_checkpoint WHERE root_intent_id=$1
          ORDER BY CASE stage WHEN 'started' THEN 1 WHEN 'candidate_fitted' THEN 2 WHEN 'pre_final_retained' THEN 3 WHEN 'validation_plan_retained' THEN 4 WHEN 'candidate_locked' THEN 5 WHEN 'final_test_started' THEN 6 ELSE 7 END`,
      [rootIntent.intentId]
    );
    const checkpoints = checkpointRows.rows.map((row) =>
      aflTradeModelRunCheckpointSchema.parse(row.checkpoint_json)
    );
    const stages = checkpoints.some(
      (item) => item.content.schemaVersion === 'afl-trade-model-run-checkpoint/v2'
    )
      ? AFL_TRADE_MODEL_RUN_PROGRESS_STAGES
      : ['started', 'candidate_locked', 'final_test_started', 'final_test_completed'];
    if ((retainedRoot.consumed_at === null) !== (checkpoints.length === 0)) fail();
    for (const [index, checkpoint] of checkpoints.entries()) {
      const content = checkpoint.content;
      const previous = checkpoints[index - 1];
      if (
        content.rootIntentId !== rootIntent.intentId ||
        !byId.has(content.intentId) ||
        content.stage !== stages[index] ||
        content.previousCheckpointId !== (previous?.checkpointId ?? null) ||
        content.substantiveOperationId !== rootIntent.content.job.jobId ||
        (previous &&
          (content.dispatchRequestId !== previous.content.dispatchRequestId ||
            Date.parse(content.recordedAt) < Date.parse(previous.content.recordedAt))) ||
        (index > 1 && !exactJson(content.candidateArtifact, previous!.content.candidateArtifact)) ||
        (stages === AFL_TRADE_MODEL_RUN_PROGRESS_STAGES &&
          index > 0 &&
          content.schemaVersion !== 'afl-trade-model-run-checkpoint/v2') ||
        (previous &&
          (content.stage === 'final_test_started' ||
            (content.stage === 'candidate_locked' &&
              content.schemaVersion === 'afl-trade-model-run-checkpoint/v2')) &&
          !exactJson(content.evidenceArtifact, previous.content.evidenceArtifact))
      )
        fail();
    }
    for (const intent of intents) {
      if (intent.content.schemaVersion !== 'afl-trade-model-run-intent/v2') continue;
      const content = intent.content;
      const binding = content.continuation;
      const predecessor = byId.get(binding.previousIntentId);
      const checkpoint = checkpoints.find((item) => item.checkpointId === binding.checkpointId);
      if (!predecessor || !checkpoint) return fail();
      try {
        const expected = createAflTradeModelRunContinuationIntent({
          previousIntent: predecessor,
          checkpoint,
          startedAt: content.startedAt,
          dispatchClaimId: binding.dispatchClaimId,
          dispatchLeaseTokenSha256: binding.dispatchLeaseTokenSha256,
          dispatchAttemptNumber: binding.dispatchAttemptNumber,
          modelTrainingEvaluationReceiptIds: content.modelTrainingEvaluationReceiptIds,
        });
        if (!exactJson(expected, intent)) fail();
      } catch {
        return fail();
      }
    }
    let finalTestCompletionEvidence: AflTradeRetainedModelRunRecoveryState['finalTestCompletionEvidence'] =
      null;
    const completedCheckpoint = checkpoints.find(
      (item) => item.content.stage === 'final_test_completed'
    );
    if (completedCheckpoint) {
      const reference = completedCheckpoint.content.evidenceArtifact;
      const maximumBytes = Math.min(
        this.dependencies.maximumArtifactBytes ?? MAXIMUM_EXECUTABLE_ARTIFACT_BYTES,
        MAXIMUM_EXECUTABLE_ARTIFACT_BYTES
      );
      if (
        !reference ||
        !Number.isSafeInteger(maximumBytes) ||
        maximumBytes <= 0 ||
        reference.byteLength > maximumBytes
      )
        return fail();
      const loaded = await loadExactExecutableArtifact(
        this.dependencies.artifactRepository,
        reference,
        maximumBytes
      );
      if (
        !loaded ||
        !doAflTradeArtifactRefsExactlyMatch(reference, loaded.reference) ||
        !doesAflTradeArtifactRefMatchBytes(reference, loaded.bytes, 'application/json')
      )
        return fail();
      try {
        finalTestCompletionEvidence = (
          completedCheckpoint.content.schemaVersion === 'afl-trade-model-run-checkpoint/v2'
            ? aflTradeNativeFinalTestCompletionEvidenceV2Schema
            : aflTradeNativeFinalTestCompletionEvidenceSchema
        ).parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(loaded.bytes)));
      } catch {
        return fail();
      }
      if (
        !exactJson(
          finalTestCompletionEvidence.finalTestStartedCheckpoint,
          checkpoints.find((checkpoint) => checkpoint.content.stage === 'final_test_started')
        ) ||
        !exactJson(
          finalTestCompletionEvidence.outcome.modelArtifact,
          completedCheckpoint.content.candidateArtifact
        ) ||
        finalTestCompletionEvidence.recordedAt !== reference.createdAt ||
        Date.parse(finalTestCompletionEvidence.recordedAt) >
          Date.parse(completedCheckpoint.content.recordedAt)
      )
        return fail();
    }
    const runRows = await transaction.query<{ run_json: unknown; authorization_json: unknown }>(
      `SELECT run.run_json,authority.authorization_json FROM outcome_valuation_model_run run
          JOIN outcome_valuation_model_run_intent intent ON intent.intent_id=run.intent_id
          JOIN outcome_valuation_model_run_authorization authority ON authority.authorization_id=run.authorization_id
          WHERE COALESCE(intent.root_intent_id,intent.intent_id)=$1`,
      [rootIntent.intentId]
    );
    if (runRows.rows.length > 1) fail();
    let terminalRun: AflTradeRetainedModelRunRecoveryState['terminalRun'] = null;
    const retainedRun = runRows.rows[0];
    if (retainedRun) {
      try {
        const recoveryRun = z
          .union([aflTradeModelRunManifestV4Schema, aflTradeModelRunManifestV5Schema])
          .safeParse(retainedRun.run_json);
        if (recoveryRun.success) {
          terminalRun = authenticateAflTradeAuthorizedPersistenceRecoveryManifest({
            run: recoveryRun.data,
            authorization: aflTradeModelRunAuthorizationSchema.parse(
              retainedRun.authorization_json
            ),
            intent: activeIntent,
          });
          this.assertPersistenceRecoveryAncestry(terminalRun, {
            rootIntent,
            activeIntent,
            checkpoints,
            finalTestCompletionEvidence,
          });
        } else
          terminalRun = authenticateAflTradeAuthorizedModelRunManifest({
            run: aflTradeModelRunManifestV3Schema.parse(retainedRun.run_json),
            authorization: aflTradeModelRunAuthorizationSchema.parse(
              retainedRun.authorization_json
            ),
            intent: activeIntent,
          });
      } catch {
        return fail();
      }
    }
    return {
      authorityBoundary: 'retained_model_run_recovery_evidence_no_execution_authority',
      rootIntent,
      activeIntent,
      checkpoints,
      terminalRun,
      finalTestCompletionEvidence,
    };
  }

  private assertPersistenceRecoveryAncestry(
    run: AflTradeModelRunManifestV4 | AflTradeModelRunManifestV5,
    state: Pick<
      AflTradeRetainedModelRunRecoveryState,
      'rootIntent' | 'activeIntent' | 'checkpoints' | 'finalTestCompletionEvidence'
    >
  ): void {
    const recovery = run.content.recovery;
    if (
      !exactJson(recovery.intentChain[0], state.rootIntent) ||
      !exactJson(recovery.intentChain.at(-1), state.activeIntent) ||
      !exactJson(recovery.checkpoints, state.checkpoints) ||
      !exactJson(recovery.completionEvidence, state.finalTestCompletionEvidence)
    ) {
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Persistence recovery must match its exact retained native ancestry and completion bytes.'
      );
    }
  }

  private async loadCurrentNativePav(
    transaction: AflOutcomeSqlTransaction,
    dataset: AflTradeValuationDatasetCandidate,
    admission: AflTradeValuationDatasetAdmissionReceipt
  ) {
    if (
      dataset.content.schemaVersion !== 'afl-trade-valuation-dataset/v5' ||
      !dataset.content.pavObservationSet ||
      admission.content.datasetId !== dataset.datasetId
    )
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Native PAV requires its exact admitted dataset.'
      );
    const fieldSetIds = unique(
      admission.content.sourceRightsEvaluations.map(({ consumedFieldSetId }) => consumedFieldSetId)
    );
    const retained = await transaction.query<{ field_set_json: unknown }>(
      `SELECT field_set_json FROM outcome_valuation_dataset_consumed_field_set
       WHERE field_set_id=ANY($1::text[]) ORDER BY field_set_id FOR SHARE`,
      [fieldSetIds]
    );
    const fields = retained.rows.map(({ field_set_json }) =>
      aflTradeConsumedFieldSetSchema.parse(field_set_json)
    );
    const byId = new Map(fields.map((field) => [field.fieldSetId, field]));
    if (
      !exactJson([...byId.keys()].sort(), fieldSetIds) ||
      fields.length !== fieldSetIds.length ||
      admission.content.sourceRightsEvaluations.some((evaluation) => {
        const field = byId.get(evaluation.consumedFieldSetId);
        return (
          !field ||
          field.content.captureId !== evaluation.captureId ||
          field.content.sourceSnapshotId !== evaluation.sourceSnapshotId ||
          field.content.fieldSetSha256 !== evaluation.consumedFieldSetSha256
        );
      })
    )
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Native PAV requires the exact admitted consumed-field sets.'
      );
    const scoped: AflOutcomeSqlClient = {
      query: transaction.query.bind(transaction),
      transaction: async (work) => work(transaction),
    };
    const native = await loadAflTradeCurrentAdmittedPavMeasurements(
      scoped,
      {
        loadExactWithObservation: (reference, maximumBytes) =>
          loadExactExecutableArtifact(
            this.dependencies.artifactRepository,
            reference,
            Math.min(
              maximumBytes,
              this.dependencies.maximumArtifactBytes ?? MAXIMUM_EXECUTABLE_ARTIFACT_BYTES
            )
          ),
      },
      dataset,
      fields
    );
    if (!native.pavObservationSet || !native.hpnMethod) {
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Native PAV current parents are unavailable.'
      );
    }
    return { pavObservationSet: native.pavObservationSet, hpnMethod: native.hpnMethod };
  }

  private async persistNativeStartedCheckpoint(
    transaction: AflOutcomeSqlTransaction,
    intentId: string,
    authorizationId: string
  ) {
    const result = await transaction.query<{
      intent_json: unknown;
      receipt_json: unknown;
      recorded_at: Date | string;
    }>(
      `SELECT intent.intent_json,operational.receipt_json,
              date_trunc('milliseconds',clock_timestamp()) AS recorded_at
         FROM outcome_valuation_model_run_intent intent
         JOIN outcome_valuation_model_protocol protocol ON protocol.protocol_id=intent.protocol_id
         JOIN outcome_valuation_model_run_authorization authority ON authority.intent_id=intent.intent_id
         JOIN outcome_valuation_model_run_operational_authorization operational
           ON operational.receipt_id=authority.operational_authorization_receipt_id
        WHERE intent.intent_id=$1 AND authority.authorization_id=$2 AND authority.consumed_at IS NOT NULL
          AND intent.intent_json#>>'{content,schemaVersion}'='afl-trade-model-run-intent/v1'
          AND protocol.protocol_json#>>'{content,schemaVersion}'='afl-trade-model-protocol/v3'
          AND operational.receipt_json#>>'{content,authorityBoundary}'=
              'policy_owned_local_private_valuation_for_one_exact_model_run_intent'`,
      [intentId, authorizationId]
    );
    if (result.rows.length === 0) return;
    const row = requireOne(result.rows, 'native start checkpoint ancestry');
    const intent = aflTradeModelRunIntentSchema.parse(row.intent_json);
    const receipt = aflTradeModelRunOperationalAuthorizationSchema.parse(row.receipt_json).content;
    if (
      intent.intentId !== intentId ||
      receipt.runIntentId !== intentId ||
      receipt.authorityBoundary !==
        'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
    ) {
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Native start checkpoint requires exact private run authority.'
      );
    }
    await insertCheckpoint(
      transaction,
      createAflTradeModelRunCheckpoint({
        intentId,
        rootIntentId: intentId,
        authorizationId,
        dispatchRequestId: receipt.dispatchRequestId,
        substantiveOperationId: receipt.substantiveOperationId,
        dispatchClaimId: receipt.dispatchClaimId,
        dispatchAttemptNumber: receipt.dispatchAttemptNumber,
        stage: 'started',
        previousCheckpointId: null,
        recordedAt: exactInstant(row.recorded_at),
        candidateArtifact: null,
        evidenceArtifact: null,
      })
    );
  }

  async prepare(
    unparsed: AflTradeModelRunPreparation | AflTradeNativePavModelRunPreparation
  ): Promise<void> {
    const pair = modelPairSchema.parse(unparsed);
    const { protocol, observationSet } = pair;
    const intent = aflTradeModelRunIntentSchema.parse(unparsed.intent);
    const operationalAuthorization = aflTradeModelRunOperationalAuthorizationSchema.parse(
      unparsed.operationalAuthorization
    );
    const operationalAuthorityEvidenceId =
      operationalAuthorization.content.authorityBoundary ===
      'human_operational_authorization_for_one_exact_model_run_intent'
        ? operationalAuthorization.content.authorityEvidence.id
        : null;
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
        `valuation-model-root:${intent.content.schemaVersion === 'afl-trade-model-run-intent/v2' ? intent.content.continuation.rootIntentId : intent.intentId}`,
      ]);
      await lock(transaction, [
        `valuation-model-protocol:${protocol.protocolId}`,
        `valuation-model-intent:${intent.intentId}`,
        `valuation-model-operation:${operationalAuthorization.receiptId}`,
        ...(operationalAuthorityEvidenceId === null
          ? []
          : [`operational-authority:${operationalAuthorityEvidenceId}`]),
      ]);
      const admissionResult = await transaction.query<AdmissionRow>(
        `SELECT admission.admission_json,dataset.dataset_json,admission.analytical_authority_receipt_id,
                decision.decision_key AS gate2_decision_key
           FROM outcome_valuation_dataset_admission admission
           JOIN outcome_valuation_dataset_candidate dataset ON dataset.dataset_id=admission.dataset_id
           JOIN outcome_gate_decision decision
             ON decision.decision_id=admission.gate2_decision_id
          WHERE admission.admission_id=$1 AND admission.dataset_id=$2
            AND admission.status='finalized' AND admission.finalized_at IS NOT NULL
            AND dataset.status='finalized' AND dataset.finalized_at IS NOT NULL
          FOR KEY SHARE OF admission,decision,dataset`,
        [intent.content.datasetAdmissionId, intent.content.datasetId]
      );
      const admission = requireOne(admissionResult.rows, 'finalized dataset admission');
      if (pair.modelFamily === 'native_pav') {
        const dataset = aflTradeValuationDatasetCandidateSchema.parse(admission.dataset_json);
        const receipt = aflTradeValuationDatasetAdmissionReceiptSchema.parse(
          admission.admission_json
        );
        const current = await this.loadCurrentNativePav(transaction, dataset, receipt);
        const expected = createAflTradePlayerObservationSetV3({
          candidate: dataset,
          datasetAdmissionId: receipt.admissionId,
          modelProtocolId: protocol.protocolId,
          pavObservationSet: current.pavObservationSet,
        });
        if (!exactJson(expected, observationSet)) {
          throw new AflTradeModelRunPersistenceError(
            'INVALID_INPUT',
            'Native PAV observations differ from their admitted projection.'
          );
        }
      }
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
          operationalAuthorityEvidenceId,
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
    purpose?: 'persistence_only';
  }): Promise<AflTradeAdmittedModelRunEvidence | AflTradeNativePavModelRunEvidence> {
    if (
      input.purpose === 'persistence_only' &&
      input.intent.content.schemaVersion !== 'afl-trade-model-run-intent/v2'
    )
      throw new AflTradeModelRunPersistenceError(
        'INVALID_INPUT',
        'Persistence evidence requires a completed continuation.'
      );
    if (input.intent.content.schemaVersion === 'afl-trade-model-run-intent/v2')
      return this.dependencies.sql.transaction((transaction) => {
        const sql: AflOutcomeSqlClient = {
          query: transaction.query.bind(transaction),
          transaction: (work) => work(transaction),
        };
        return this.authenticateEvidence(
          input,
          sql,
          createPostgresAflTradeGateDecisionLedgerRepository(sql)
        );
      });
    return this.authenticateEvidence(
      input,
      this.dependencies.sql,
      this.dependencies.gateDecisionLedgerRepository
    );
  }

  private async authenticateEvidence(
    input: { intent: AflTradeModelRunIntent; purpose?: 'persistence_only' },
    sql: AflOutcomeSqlClient,
    ledger: AflTradeGateDecisionLedgerRepository,
    activeFinalStart?: AflTradeModelRunCheckpoint
  ): Promise<AflTradeAdmittedModelRunEvidence | AflTradeNativePavModelRunEvidence> {
    const intent = aflTradeModelRunIntentSchema.parse(input.intent);
    const continuationAuthority =
      intent.content.schemaVersion === 'afl-trade-model-run-intent/v2'
        ? await this.loadNativeContinuationAuthority(sql, intent, input.purpose, activeFinalStart)
        : undefined;
    const result = await sql.query<EvidenceRow>(
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
    const pair = modelPairSchema.parse({
      protocol: row.protocol_json,
      observationSet: row.observation_json,
    });
    const { protocol: registeredProtocol } = pair;
    const admission = aflTradeValuationDatasetAdmissionReceiptSchema.parse(row.admission_json);
    const datasetCandidate = aflTradeValuationDatasetCandidateSchema.parse(row.dataset_json);
    const operationalAuthorization = aflTradeModelRunOperationalAuthorizationSchema.parse(
      row.operational_authorization_json
    );
    if (
      !(await hasCurrentAflTradeValuationDatasetDomainProvenance(sql, {
        factualCandidateId: datasetCandidate.content.factualParent.factualCandidateId,
        lineageId: datasetCandidate.content.factualParent.corpusToCandidateLineageId,
      }))
    ) {
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Model-run authority requires current canonical-promotion provenance.'
      );
    }

    const admissionReceiptIds = admission.content.sourceRightsEvaluations
      .map(({ admissionEvaluationReceiptId }) => admissionEvaluationReceiptId)
      .sort();
    const receiptIds = unique([
      ...admissionReceiptIds,
      ...intent.content.modelTrainingEvaluationReceiptIds,
    ]);
    const receiptResult = await sql.query<JsonRow>(
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
    const rightsResult = await sql.query<JsonRow>(
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

    const native =
      pair.modelFamily === 'native_pav'
        ? await sql.transaction((transaction) =>
            this.loadCurrentNativePav(transaction, datasetCandidate, admission)
          )
        : null;
    const spellMetricIds =
      pair.modelFamily === 'scalar'
        ? unique(
            pair.observationSet.content.observations.flatMap(({ featureInputs, outcome }) => [
              ...featureInputs.flatMap((feature) =>
                feature.kind === 'acquisition_spell_metric' ? [feature.memberId] : []
              ),
              ...outcome.metrics.map(({ spellMetricVersionId }) => spellMetricVersionId),
            ])
          )
        : [];
    const metricsResult =
      pair.modelFamily === 'scalar'
        ? await sql.query<SpellMetricRow>(
            `SELECT spell_metric_version_id,fact_sha256,fact_json AS document_json
         FROM outcome_acquisition_spell_metric_version
        WHERE spell_metric_version_id=ANY($1::text[])
        ORDER BY spell_metric_version_id`,
            [spellMetricIds]
          )
        : { rows: [] };
    if (metricsResult.rows.length !== spellMetricIds.length) {
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Model-run authority is missing an exact acquisition-spell metric body.'
      );
    }
    const spellMetrics = metricsResult.rows.map((row) =>
      parsePersistedAflTradeAcquisitionSpellMetric({
        spellMetricVersionId: row.spell_metric_version_id,
        factSha256: row.fact_sha256,
        content: row.document_json,
      })
    );

    const referenceById = new Map(
      [
        ...executableReferences(intent, registeredProtocol),
        ...(native ? [native.hpnMethod.content.sourceArtifact] : []),
      ].map((reference) => [reference.artifactId, reference])
    );
    const executableArtifacts = [];
    for (const reference of [...referenceById.values()].sort((left, right) =>
      left.artifactId.localeCompare(right.artifactId)
    )) {
      const loaded = await loadExactExecutableArtifact(
        this.dependencies.artifactRepository,
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

    const storedLedger = await ledger.load();
    const common = {
      admission,
      datasetCandidate,
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
      executableArtifacts,
    };
    if (pair.modelFamily === 'native_pav') {
      if (!native)
        throw new AflTradeModelRunPersistenceError(
          'MISSING_EVIDENCE',
          'Native PAV current parents are unavailable.'
        );
      return {
        ...common,
        registeredProtocol: pair.protocol,
        observationSet: pair.observationSet,
        ...native,
        ...(continuationAuthority ? { continuationAuthority } : {}),
        spellMetrics: [],
      };
    }
    return {
      ...common,
      registeredProtocol: pair.protocol,
      observationSet: pair.observationSet,
      spellMetrics,
    };
  }

  private async loadNativeContinuationAuthority(
    transaction: AflOutcomeSqlTransaction,
    intent: AflTradeModelRunIntent,
    purpose?: 'persistence_only',
    activeFinalStart?: AflTradeModelRunCheckpoint
  ): Promise<NonNullable<AflTradeNativePavModelRunEvidence['continuationAuthority']>> {
    if (intent.content.schemaVersion !== 'afl-trade-model-run-intent/v2')
      throw new AflTradeModelRunPersistenceError('INVALID_INPUT', 'Expected native continuation.');
    const state = await this.readRetainedRecoveryState(transaction, intent.intentId);
    const binding = intent.content.continuation;
    const checkpoint = state.checkpoints.find((item) => item.checkpointId === binding.checkpointId);
    const previous = await transaction.query<{ intent_json: unknown }>(
      `SELECT intent_json FROM outcome_valuation_model_run_intent WHERE intent_id=$1 FOR SHARE`,
      [binding.previousIntentId]
    );
    const previousIntent = aflTradeModelRunIntentSchema.parse(
      requireOne(previous.rows, 'native continuation predecessor').intent_json
    );
    if (
      !exactJson(state.activeIntent, intent) ||
      state.rootIntent.intentId !== binding.rootIntentId ||
      previousIntent.intentId !== binding.previousIntentId ||
      !checkpoint ||
      state.terminalRun ||
      (purpose === 'persistence_only'
        ? checkpoint.content.stage !== 'final_test_completed' ||
          state.checkpoints.at(-1)?.checkpointId !== checkpoint.checkpointId ||
          state.finalTestCompletionEvidence === null
        : activeFinalStart
          ? activeFinalStart.content.stage !== 'final_test_started' ||
            !exactJson(state.checkpoints.at(-1), activeFinalStart) ||
            activeFinalStart.content.intentId !== intent.intentId ||
            state.finalTestCompletionEvidence !== null
          : state.checkpoints.some((item) =>
              ['final_test_started', 'final_test_completed'].includes(item.content.stage)
            ))
    )
      throw new AflTradeModelRunPersistenceError(
        'MISSING_EVIDENCE',
        'Native continuation requires exact active retained numerical ancestry.'
      );
    let checkpointIntent: AflTradeModelRunIntent | undefined;
    if (
      checkpoint.content.intentId !== state.rootIntent.intentId &&
      checkpoint.content.intentId !== previousIntent.intentId
    ) {
      const owner = await transaction.query<{ intent_json: unknown }>(
        `SELECT intent_json FROM outcome_valuation_model_run_intent WHERE intent_id=$1 FOR SHARE`,
        [checkpoint.content.intentId]
      );
      checkpointIntent = aflTradeModelRunIntentSchema.parse(
        requireOne(owner.rows, 'native continuation checkpoint owner').intent_json
      );
      if (checkpointIntent.intentId !== checkpoint.content.intentId)
        throw new AflTradeModelRunPersistenceError(
          'MISSING_EVIDENCE',
          'Native checkpoint owner differs from retained ancestry.'
        );
    }
    return {
      rootIntent: state.rootIntent,
      previousIntent,
      checkpoint,
      ...(checkpointIntent ? { checkpointIntent } : {}),
    };
  }

  private async authenticateCurrentParents(
    transaction: AflOutcomeSqlTransaction,
    row: DatasetProvenanceRow
  ): Promise<void> {
    const pair = modelPairSchema.parse({
      protocol: row.protocol_json,
      observationSet: row.observation_json,
    });
    if (pair.modelFamily !== 'native_pav') return;
    const dataset = aflTradeValuationDatasetCandidateSchema.parse(row.dataset_json);
    const admission = aflTradeValuationDatasetAdmissionReceiptSchema.parse(row.admission_json);
    const current = await this.loadCurrentNativePav(transaction, dataset, admission);
    const expected = createAflTradePlayerObservationSetV3({
      candidate: dataset,
      datasetAdmissionId: admission.admissionId,
      modelProtocolId: pair.protocol.protocolId,
      pavObservationSet: current.pavObservationSet,
    });
    if (!exactJson(expected, pair.observationSet)) {
      throw new AflTradeModelRunPersistenceError(
        'INVALID_INPUT',
        'Native PAV observations differ from their admitted projection.'
      );
    }
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
      await lockModelRunRoot(transaction, intent.intentId);
      await lock(transaction, [`valuation-model-intent:${intent.intentId}`]);
      if (
        !(await hasCurrentDomainProvenanceForIntent(transaction, intent.intentId, (row) =>
          this.authenticateCurrentParents(transaction, row)
        ))
      )
        return false;
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
    return this.dependencies.sql.transaction(async (transaction) => {
      await lockModelRunRoot(transaction, input.intentId);
      await lock(transaction, [`valuation-model-intent:${input.intentId}`]);
      if (
        !(await hasCurrentDomainProvenanceForIntent(transaction, input.intentId, (row) =>
          this.authenticateCurrentParents(transaction, row)
        ))
      )
        return false;
      const result = await transaction.query(
        `UPDATE outcome_valuation_model_run_authorization
            SET consumed_at=$3
          WHERE authorization_id=$1 AND intent_id=$2 AND consumed_at IS NULL
            AND clock_timestamp()>=authorized_at AND clock_timestamp()<valid_through
        RETURNING authorization_id`,
        [input.authorizationId, input.intentId, input.consumedAt]
      );
      if (result.rowCount === 1)
        await this.persistNativeStartedCheckpoint(
          transaction,
          input.intentId,
          input.authorizationId
        );
      return result.rowCount === 1;
    });
  }

  async persistCompletedRun(
    unparsed: AflTradeModelRunManifestV3 | AflTradeModelRunManifestV4 | AflTradeModelRunManifestV5
  ): Promise<boolean> {
    const recoveryRun = z
      .union([aflTradeModelRunManifestV4Schema, aflTradeModelRunManifestV5Schema])
      .safeParse(unparsed);
    const run = recoveryRun.success
      ? recoveryRun.data
      : aflTradeModelRunManifestV3Schema.parse(unparsed);
    return this.dependencies.sql.transaction(async (transaction) => {
      await lockModelRunRoot(transaction, run.content.runIntentId);
      await lock(transaction, [`valuation-model-intent:${run.content.runIntentId}`]);
      const ancestry = await transaction.query<{
        intent_json: unknown;
        authorization_json: unknown;
      }>(
        `SELECT intent.intent_json,run_authorization.authorization_json
           FROM outcome_valuation_model_run_intent intent
           JOIN outcome_valuation_model_run_authorization run_authorization
             ON run_authorization.intent_id=intent.intent_id
          WHERE intent.intent_id=$1 AND run_authorization.authorization_id=$2
          FOR SHARE OF intent,run_authorization`,
        [run.content.runIntentId, run.content.runAuthorizationId]
      );
      const ancestryRow = ancestry.rows[0];
      if (!ancestryRow) return false;
      if (recoveryRun.success) {
        authenticateAflTradeAuthorizedPersistenceRecoveryManifest({
          run: recoveryRun.data,
          intent: aflTradeModelRunIntentSchema.parse(ancestryRow.intent_json),
          authorization: aflTradeModelRunAuthorizationSchema.parse(ancestryRow.authorization_json),
        });
        const state = await this.readRetainedRecoveryState(transaction, run.content.runIntentId);
        this.assertPersistenceRecoveryAncestry(recoveryRun.data, state);
        if (state.terminalRun !== null && !exactJson(state.terminalRun, recoveryRun.data)) {
          throw new AflTradeModelRunPersistenceError(
            'CONFLICTING_REPLAY',
            'The native root already has a different terminal result.'
          );
        }
      } else
        authenticateAflTradeAuthorizedModelRunManifest({
          run: aflTradeModelRunManifestV3Schema.parse(run),
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
