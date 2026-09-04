import { z } from 'zod';

import {
  type AflTradeModelRunIntent,
  type AflTradeModelRunManifestV3,
  aflTradeModelRunManifestV3ContentSchema,
  aflTradeModelRunManifestV3Schema,
  aflTradeModelRunIntentSchema,
} from '../artifacts/modelRunManifest';
import {
  type AflTradeArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
} from '../artifacts/artifactReference';
import {
  type AflTradePlayerContributionModelProtocolV2,
  aflTradePlayerContributionModelProtocolV2Schema,
} from '../artifacts/modelProtocol';
import {
  type AflTradeValuationDatasetAdmissionReceipt,
  type AflTradeValuationDatasetCandidate,
  aflTradeValuationDatasetAdmissionReceiptSchema,
  aflTradeValuationDatasetCandidateSchema,
} from '../artifacts/valuationDatasetAdmissionContracts';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  type AflTradeGateDecisionLedger,
  resolveAflTradeGateEligibility,
  validateAflTradeGateDecisionLedger,
} from '../governance/gateDecisionLedger';
import { evaluateAflTradeGate0A } from '../source/gate0aEvaluation';
import { type AflTradeGate0AReceipt, aflTradeGate0AReceiptSchema } from '../source/gate0aReceipt';
import {
  type AflTradeSourceRightsProposal,
  aflTradeSourceRightsProposalSchema,
} from '../source/sourceRights';
import {
  type AflTradePlayerObservationSetV2,
  aflTradePlayerObservationSetV2Schema,
  createAflTradePlayerObservationSetV2,
} from './playerContributionContracts';
import {
  type AflTradeAcquisitionSpellMetric,
  aflTradeAcquisitionSpellMetricSchema,
} from '../outcomes/acquisitionSpellMetricContracts';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '../valuation/automatedPrivateEvaluationPolicy';

const utcInstantSchema = z.iso.datetime({ offset: true });

export const AFL_TRADE_MODEL_RUN_AUTHORIZATION_SCHEMA_VERSION =
  'afl-trade-model-run-authorization/v1' as const;

export const AFL_TRADE_MODEL_RUN_OPERATIONAL_AUTHORIZATION_SCHEMA_VERSION =
  'afl-trade-model-run-operational-authorization/v1' as const;

const humanModelRunOperationalAuthorizationContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_MODEL_RUN_OPERATIONAL_AUTHORIZATION_SCHEMA_VERSION),
    operation: z.literal('execute_model_run'),
    authorityBoundary: z.literal('human_operational_authorization_for_one_exact_model_run_intent'),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    runIntentId: aflTradeContentAddressedIdSchema('model-run-intent'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    authorizedAt: utcInstantSchema,
    validThrough: utcInstantSchema,
    principalRef: z.string().trim().min(1).max(200),
    role: z.literal('afl_trade_model_run_operator'),
    authorityEvidence: z
      .object({
        id: aflTradeContentAddressedIdSchema('reviewer-authority-evidence'),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((authorization, context) => {
    if (Date.parse(authorization.validThrough) <= Date.parse(authorization.authorizedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['validThrough'],
        message: 'Operational authorization requires a bounded positive execution window.',
      });
    }
    if (
      authorization.authorityEvidence.id !==
      `reviewer-authority-evidence:${authorization.authorityEvidence.sha256}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorityEvidence'],
        message: 'Operational authority evidence must bind its exact content digest.',
      });
    }
  });

const privateValuationModelRunOperationalAuthorizationContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_MODEL_RUN_OPERATIONAL_AUTHORIZATION_SCHEMA_VERSION),
    operation: z.literal('execute_model_run'),
    authorityBoundary: z.literal(
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
    ),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    environment: z.literal('non_production'),
    executionMode: z.literal('local'),
    runIntentId: aflTradeContentAddressedIdSchema('model-run-intent'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    dispatchRequestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    substantiveOperationId: aflTradeContentAddressedIdSchema('private-valuation-model-operation'),
    dispatchClaimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
    dispatchAttemptNumber: z.number().int().min(1).max(3),
    dispatchLeaseTokenSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    factualOutputId: aflTradeContentAddressedIdSchema('private-valuation-factual-output'),
    hpnCalculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
    factualValuesSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    hpnValuesSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    authorizedAt: utcInstantSchema,
    validThrough: utcInstantSchema,
    principalRef: z.literal(AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID),
    role: z.literal('afl_trade_private_evaluation_coordinator'),
  })
  .strict()
  .superRefine((authorization, context) => {
    if (Date.parse(authorization.validThrough) <= Date.parse(authorization.authorizedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['validThrough'],
        message: 'Operational authorization requires a bounded positive execution window.',
      });
    }
  });

const modelRunOperationalAuthorizationContentSchema = z.discriminatedUnion('authorityBoundary', [
  humanModelRunOperationalAuthorizationContentSchema,
  privateValuationModelRunOperationalAuthorizationContentSchema,
]);

export const aflTradeModelRunOperationalAuthorizationSchema = z
  .object({
    receiptId: aflTradeContentAddressedIdSchema('architecture-operation-receipt'),
    content: modelRunOperationalAuthorizationContentSchema,
  })
  .strict()
  .superRefine((authorization, context) => {
    addAflTradeContentAddressIssue(
      'architecture-operation-receipt',
      authorization.receiptId,
      authorization.content,
      context,
      ['receiptId']
    );
  });

export type AflTradeModelRunOperationalAuthorization = z.infer<
  typeof aflTradeModelRunOperationalAuthorizationSchema
>;
export type AflTradeHumanModelRunOperationalAuthorization = Readonly<{
  receiptId: string;
  content: z.infer<typeof humanModelRunOperationalAuthorizationContentSchema>;
}>;

export function createAflTradeModelRunOperationalAuthorization(
  input: Omit<
    z.input<typeof humanModelRunOperationalAuthorizationContentSchema>,
    'schemaVersion' | 'operation' | 'authorityBoundary' | 'publicationEligible'
  >
): AflTradeHumanModelRunOperationalAuthorization {
  const content = humanModelRunOperationalAuthorizationContentSchema.parse({
    ...input,
    schemaVersion: AFL_TRADE_MODEL_RUN_OPERATIONAL_AUTHORIZATION_SCHEMA_VERSION,
    operation: 'execute_model_run',
    authorityBoundary: 'human_operational_authorization_for_one_exact_model_run_intent',
    publicationEligible: false,
  });
  return {
    receiptId: createAflTradeContentAddress('architecture-operation-receipt', content),
    content,
  };
}

export function createAflTradePrivateValuationModelRunOperationalAuthorization(
  input: Omit<
    z.input<typeof privateValuationModelRunOperationalAuthorizationContentSchema>,
    | 'schemaVersion'
    | 'operation'
    | 'authorityBoundary'
    | 'publicationEligible'
    | 'publicationProhibited'
    | 'environment'
    | 'executionMode'
    | 'principalRef'
    | 'role'
  >
): AflTradeModelRunOperationalAuthorization {
  const content = privateValuationModelRunOperationalAuthorizationContentSchema.parse({
    ...input,
    schemaVersion: AFL_TRADE_MODEL_RUN_OPERATIONAL_AUTHORIZATION_SCHEMA_VERSION,
    operation: 'execute_model_run',
    authorityBoundary: 'policy_owned_local_private_valuation_for_one_exact_model_run_intent',
    publicationEligible: false,
    publicationProhibited: true,
    environment: 'non_production',
    executionMode: 'local',
    principalRef: AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
    role: 'afl_trade_private_evaluation_coordinator',
  });
  return aflTradeModelRunOperationalAuthorizationSchema.parse({
    receiptId: createAflTradeContentAddress('architecture-operation-receipt', content),
    content,
  });
}

const modelRunAuthorizationContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_MODEL_RUN_AUTHORIZATION_SCHEMA_VERSION),
    authorityBoundary: z.literal(
      'model_run_start_authority_no_grade_publication_or_fantasy_ownership'
    ),
    publicationEligible: z.literal(false),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    runIntentId: aflTradeContentAddressedIdSchema('model-run-intent'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    datasetRowSetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    operationalAuthorizationReceiptId: aflTradeContentAddressedIdSchema(
      'architecture-operation-receipt'
    ),
    gate2DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    gateLedgerRevision: z.number().int().nonnegative(),
    authorizedAt: utcInstantSchema,
    validThrough: utcInstantSchema,
    modelTrainingEvaluationReceiptIds: z
      .array(aflTradeContentAddressedIdSchema('gate0a-evaluation'))
      .min(1)
      .max(1000),
  })
  .strict()
  .superRefine((authorization, context) => {
    const ids = authorization.modelTrainingEvaluationReceiptIds;
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id, index) => index > 0 && ids[index - 1]! > id)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['modelTrainingEvaluationReceiptIds'],
        message: 'Model-training evaluation receipts must be unique and canonically ordered.',
      });
    }
    if (Date.parse(authorization.validThrough) <= Date.parse(authorization.authorizedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['validThrough'],
        message: 'A model-run authorization requires a bounded positive execution window.',
      });
    }
  });

export const aflTradeModelRunAuthorizationSchema = z
  .object({
    authorizationId: aflTradeContentAddressedIdSchema('model-run-authorization'),
    content: modelRunAuthorizationContentSchema,
  })
  .strict()
  .superRefine((authorization, context) => {
    addAflTradeContentAddressIssue(
      'model-run-authorization',
      authorization.authorizationId,
      authorization.content,
      context,
      ['authorizationId']
    );
  });

export type AflTradeModelRunAuthorization = z.infer<typeof aflTradeModelRunAuthorizationSchema>;

export type AflTradeAuthorizedModelRunCompletion = Pick<
  z.input<typeof aflTradeModelRunManifestV3ContentSchema>,
  'candidateLockedAt' | 'finalTestEvaluatedAt' | 'finishedAt' | 'outcome'
>;

function createAflTradeAuthorizedModelRunManifest(input: {
  intent: AflTradeModelRunIntent;
  authorization: AflTradeModelRunAuthorization;
  completion: AflTradeAuthorizedModelRunCompletion;
}): AflTradeModelRunManifestV3 {
  const intent = aflTradeModelRunIntentSchema.parse(input.intent);
  const authorization = aflTradeModelRunAuthorizationSchema.parse(input.authorization);
  if (
    authorization.content.runIntentId !== intent.intentId ||
    authorization.content.datasetId !== intent.content.datasetId ||
    authorization.content.datasetAdmissionId !== intent.content.datasetAdmissionId ||
    authorization.content.modelProtocolId !== intent.content.modelProtocolId ||
    authorization.content.observationSetId !== intent.content.observationSetId ||
    !exactIds(
      authorization.content.modelTrainingEvaluationReceiptIds,
      intent.content.modelTrainingEvaluationReceiptIds
    )
  ) {
    throw new RangeError('Model-run authorization does not bind the exact executable intent.');
  }
  const content = aflTradeModelRunManifestV3ContentSchema.parse({
    schemaVersion: 'afl-trade-model-run/v3',
    environment: intent.content.environment,
    modelId: intent.content.modelId,
    modelVersion: intent.content.modelVersion,
    datasetId: intent.content.datasetId,
    datasetAdmissionId: intent.content.datasetAdmissionId,
    modelProtocolId: intent.content.modelProtocolId,
    runIntentId: intent.intentId,
    runAuthorizationId: authorization.authorizationId,
    observationSetId: intent.content.observationSetId,
    modelTrainingEvaluationReceiptIds: intent.content.modelTrainingEvaluationReceiptIds,
    codeCommitSha: intent.content.codeCommitSha,
    cleanWorktree: intent.content.cleanWorktree,
    seed: intent.content.seed,
    job: intent.content.job,
    startedAt: intent.content.startedAt,
    windows: intent.content.windows,
    sourceCodeArtifact: intent.content.sourceCodeArtifact,
    dependencyLockArtifact: intent.content.dependencyLockArtifact,
    runtimeArtifact: intent.content.runtimeArtifact,
    containerArtifact: intent.content.containerArtifact,
    configurationArtifact: intent.content.configurationArtifact,
    environmentArtifact: intent.content.environmentArtifact,
    featureDefinitionArtifacts: intent.content.featureDefinitionArtifacts,
    ...input.completion,
  });
  return aflTradeModelRunManifestV3Schema.parse({
    runId: createAflTradeContentAddress('model-run', content),
    content,
  });
}

export function authenticateAflTradeAuthorizedModelRunManifest(input: {
  run: AflTradeModelRunManifestV3;
  intent: AflTradeModelRunIntent;
  authorization: AflTradeModelRunAuthorization;
}): AflTradeModelRunManifestV3 {
  const run = aflTradeModelRunManifestV3Schema.parse(input.run);
  const expected = createAflTradeAuthorizedModelRunManifest({
    intent: input.intent,
    authorization: input.authorization,
    completion: {
      candidateLockedAt: run.content.candidateLockedAt,
      finalTestEvaluatedAt: run.content.finalTestEvaluatedAt,
      finishedAt: run.content.finishedAt,
      outcome: run.content.outcome,
    },
  });
  if (canonicalizeAflTradeJson(expected) !== canonicalizeAflTradeJson(run)) {
    throw new RangeError('Completed model run does not match its exact intent and authorization.');
  }
  return run;
}

export interface AflTradeAdmittedModelRunEvidence {
  registeredProtocol: AflTradePlayerContributionModelProtocolV2;
  admission: AflTradeValuationDatasetAdmissionReceipt;
  datasetCandidate: AflTradeValuationDatasetCandidate;
  observationSet: AflTradePlayerObservationSetV2;
  admissionEvaluationReceipts: readonly AflTradeGate0AReceipt[];
  runStartEvaluationReceipts: readonly AflTradeGate0AReceipt[];
  sourceRightsProposals: readonly AflTradeSourceRightsProposal[];
  gateLedgerRevision: number;
  gateDecisionLedger: AflTradeGateDecisionLedger;
  gate2DecisionKey: string;
  gate2Ledger: AflTradeGateDecisionLedger;
  operationalAuthorization: AflTradeModelRunOperationalAuthorization;
  spellMetrics: readonly AflTradeAcquisitionSpellMetric[];
  executableArtifacts: readonly {
    artifactId: string;
    bytes: Uint8Array;
  }[];
}

export interface AflTradeAdmittedModelRunEvidenceAuthenticator {
  authenticate(input: {
    intent: AflTradeModelRunIntent;
  }): Promise<AflTradeAdmittedModelRunEvidence>;
}

export type AflTradeAdmittedModelRunAuthorityBlockerCode =
  | 'invalid_request'
  | 'evidence_unavailable'
  | 'invalid_evidence'
  | 'ancestry_mismatch'
  | 'observation_set_mismatch'
  | 'gate2_not_current'
  | 'rights_not_current'
  | 'operational_authorization_invalid'
  | 'execution_artifact_mismatch'
  | 'authorization_unavailable'
  | 'authorization_not_consumable'
  | 'execution_failure_unrecorded'
  | 'run_persistence_failed';

export interface AflTradeAdmittedModelRunAuthorityBlocker {
  code: AflTradeAdmittedModelRunAuthorityBlockerCode;
  message: string;
}

export type AflTradeAdmittedModelRunAuthorityResult =
  | {
      status: 'authorized';
      authorization: AflTradeModelRunAuthorization;
      intent: AflTradeModelRunIntent;
      protocol: AflTradePlayerContributionModelProtocolV2;
      observationSet: AflTradePlayerObservationSetV2;
      spellMetrics: readonly AflTradeAcquisitionSpellMetric[];
      executableArtifacts: readonly { artifactId: string; bytes: Uint8Array }[];
      blockers: readonly [];
    }
  | {
      status: 'blocked';
      authorization: null;
      blockers: readonly AflTradeAdmittedModelRunAuthorityBlocker[];
    };

export interface AflTradeAdmittedModelRunAuthorityRequest {
  intent: unknown;
  protocol: unknown;
}

export interface AflTradeModelRunAuthorityClock {
  now(): Promise<string>;
}

export interface AflTradeModelRunAuthorizationStore {
  issueOnceForIntent(input: {
    authorization: AflTradeModelRunAuthorization;
    intent: AflTradeModelRunIntent;
  }): Promise<boolean>;
  consumeIntentOnce(input: {
    authorizationId: string;
    intentId: string;
    consumedAt: string;
  }): Promise<boolean>;
}

export interface AflTradeCompletedModelRunStore {
  persistCompletedRun(run: AflTradeModelRunManifestV3): Promise<boolean>;
}

function blocked(
  code: AflTradeAdmittedModelRunAuthorityBlockerCode,
  message: string
): AflTradeAdmittedModelRunAuthorityResult {
  return { status: 'blocked', authorization: null, blockers: [{ code, message }] };
}

function exactIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index]) &&
    new Set(left).size === left.length
  );
}

function requestWithoutEvaluationTime(receipt: AflTradeGate0AReceipt): string {
  const { evaluatedAt: _evaluatedAt, ...request } = receipt.content.request;
  return canonicalizeAflTradeJson(request);
}

function parseEvidence(value: AflTradeAdmittedModelRunEvidence) {
  const registeredProtocol = aflTradePlayerContributionModelProtocolV2Schema.safeParse(
    value.registeredProtocol
  );
  const admission = aflTradeValuationDatasetAdmissionReceiptSchema.safeParse(value.admission);
  const datasetCandidate = aflTradeValuationDatasetCandidateSchema.safeParse(
    value.datasetCandidate
  );
  const observationSet = aflTradePlayerObservationSetV2Schema.safeParse(value.observationSet);
  const admissionEvaluationReceipts = value.admissionEvaluationReceipts.map((receipt) =>
    aflTradeGate0AReceiptSchema.safeParse(receipt)
  );
  const runStartEvaluationReceipts = value.runStartEvaluationReceipts.map((receipt) =>
    aflTradeGate0AReceiptSchema.safeParse(receipt)
  );
  const sourceRightsProposals = value.sourceRightsProposals.map((rights) =>
    aflTradeSourceRightsProposalSchema.safeParse(rights)
  );
  const spellMetrics = value.spellMetrics.map((metric) =>
    aflTradeAcquisitionSpellMetricSchema.safeParse(metric)
  );
  const operationalAuthorization = aflTradeModelRunOperationalAuthorizationSchema.safeParse(
    value.operationalAuthorization
  );
  if (
    !registeredProtocol.success ||
    !admission.success ||
    !datasetCandidate.success ||
    !observationSet.success ||
    admissionEvaluationReceipts.some((receipt) => !receipt.success) ||
    runStartEvaluationReceipts.some((receipt) => !receipt.success) ||
    sourceRightsProposals.some((rights) => !rights.success) ||
    spellMetrics.some((metric) => !metric.success) ||
    !operationalAuthorization.success ||
    !Number.isSafeInteger(value.gateLedgerRevision) ||
    value.gateLedgerRevision < 0 ||
    !validateAflTradeGateDecisionLedger(value.gateDecisionLedger).valid ||
    !validateAflTradeGateDecisionLedger(value.gate2Ledger).valid ||
    !value.gate2DecisionKey.trim()
  ) {
    return null;
  }
  return {
    registeredProtocol: registeredProtocol.data,
    admission: admission.data,
    datasetCandidate: datasetCandidate.data,
    observationSet: observationSet.data,
    admissionEvaluationReceipts: admissionEvaluationReceipts.flatMap((receipt) =>
      receipt.success ? [receipt.data] : []
    ),
    runStartEvaluationReceipts: runStartEvaluationReceipts.flatMap((receipt) =>
      receipt.success ? [receipt.data] : []
    ),
    sourceRightsProposals: sourceRightsProposals.flatMap((rights) =>
      rights.success ? [rights.data] : []
    ),
    gateLedgerRevision: value.gateLedgerRevision,
    gateDecisionLedger: value.gateDecisionLedger,
    gate2DecisionKey: value.gate2DecisionKey,
    gate2Ledger: value.gate2Ledger,
    operationalAuthorization: operationalAuthorization.data,
    spellMetrics: spellMetrics.flatMap((metric) => (metric.success ? [metric.data] : [])),
    executableArtifacts: value.executableArtifacts,
  };
}

function operationalAuthorizationIsCurrent(
  authorization: AflTradeModelRunOperationalAuthorization,
  intent: AflTradeModelRunIntent,
  evaluatedAt: string
): boolean {
  const content = authorization.content;
  const exactIntent =
    content.environment === intent.content.environment &&
    content.runIntentId === intent.intentId &&
    content.datasetId === intent.content.datasetId &&
    content.datasetAdmissionId === intent.content.datasetAdmissionId &&
    content.modelProtocolId === intent.content.modelProtocolId &&
    content.observationSetId === intent.content.observationSetId &&
    Date.parse(content.authorizedAt) <= Date.parse(intent.content.startedAt) &&
    Date.parse(content.validThrough) > Date.parse(evaluatedAt);
  if (!exactIntent) return false;
  return content.authorityBoundary ===
    'human_operational_authorization_for_one_exact_model_run_intent'
    ? true
    : intent.content.job.initiatedBy === AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID &&
        intent.content.job.workerIdentity === AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID;
}

function intentMatchesProtocol(
  intent: AflTradeModelRunIntent,
  protocol: AflTradePlayerContributionModelProtocolV2
): boolean {
  return (
    intent.content.environment === protocol.content.environment &&
    intent.content.datasetId === protocol.content.datasetId &&
    intent.content.datasetAdmissionId === protocol.content.datasetAdmission.admissionId &&
    intent.content.modelProtocolId === protocol.protocolId &&
    Date.parse(intent.content.startedAt) >= Date.parse(protocol.content.preparedAt) &&
    canonicalizeAflTradeJson(intent.content.windows) ===
      canonicalizeAflTradeJson(protocol.content.windows)
  );
}

function observationSetMatchesExactCandidate(
  evidence: NonNullable<ReturnType<typeof parseEvidence>>,
  protocol: AflTradePlayerContributionModelProtocolV2,
  intent: AflTradeModelRunIntent
): boolean {
  let expected: AflTradePlayerObservationSetV2;
  try {
    expected = createAflTradePlayerObservationSetV2({
      candidate: evidence.datasetCandidate,
      datasetAdmissionId: evidence.admission.admissionId,
      modelProtocolId: protocol.protocolId,
      spellMetrics: evidence.spellMetrics,
    });
  } catch {
    return false;
  }
  if (
    evidence.observationSet.observationSetId !== intent.content.observationSetId ||
    canonicalizeAflTradeJson(evidence.observationSet) !== canonicalizeAflTradeJson(expected) ||
    protocol.content.observationGrain !== evidence.observationSet.content.observationGrain ||
    canonicalizeAflTradeJson(protocol.content.sourceOutcomeVector) !==
      canonicalizeAflTradeJson(evidence.observationSet.content.outcomeVector)
  ) {
    return false;
  }
  const windowByPartition = {
    train: protocol.content.windows.train,
    calibration: protocol.content.windows.calibration,
    validation: protocol.content.windows.validation,
    final_test: protocol.content.windows.finalTest,
  };
  return evidence.observationSet.content.observations.every((observation) => {
    const window = windowByPartition[observation.partition];
    const cutoff = Date.parse(observation.predictionCutoffAt);
    return cutoff >= Date.parse(window.from) && cutoff < Date.parse(window.to);
  });
}

function exactDatasetAncestry(
  evidence: NonNullable<ReturnType<typeof parseEvidence>>,
  protocol: AflTradePlayerContributionModelProtocolV2,
  intent: AflTradeModelRunIntent
): boolean {
  const { admission, datasetCandidate } = evidence;
  const parent = datasetCandidate.content.factualParent;
  return (
    admission.admissionId === protocol.content.datasetAdmission.admissionId &&
    admission.content.datasetId === datasetCandidate.datasetId &&
    admission.content.datasetId === intent.content.datasetId &&
    admission.content.environment === intent.content.environment &&
    admission.content.admittedAt === protocol.content.datasetAdmission.admittedAt &&
    admission.content.datasetSha256 === datasetCandidate.datasetId.slice('dataset:'.length) &&
    admission.content.factualReleaseId === parent.factualReleaseId &&
    admission.content.factualCandidateId === parent.factualCandidateId &&
    admission.content.sourceMemberSetSha256 === parent.sourceMemberSetSha256 &&
    admission.content.corpusId === parent.corpusId &&
    admission.content.corpusToCandidateLineageId === parent.corpusToCandidateLineageId &&
    Date.parse(admission.content.admittedAt) <= Date.parse(intent.content.startedAt)
  );
}

function gate2IsCurrent(
  evidence: NonNullable<ReturnType<typeof parseEvidence>>,
  intent: AflTradeModelRunIntent,
  evaluatedAt: string
): { decisionId: string; validThrough: string } | null {
  const admittedDecision = evidence.gate2Ledger.decisions.find(
    ({ decisionId }) => decisionId === evidence.admission.content.gate2Decision.decisionId
  );
  const admissionDecision = evidence.admission.content.gate2Decision;
  if (
    !admittedDecision ||
    admissionDecision.evaluatedAt !== evidence.admission.content.admittedAt ||
    admittedDecision.content.decisionKey !== evidence.gate2DecisionKey ||
    admittedDecision.content.state !== admissionDecision.state ||
    admittedDecision.content.effectiveAt !== admissionDecision.effectiveAt ||
    admittedDecision.content.revalidateAt !== admissionDecision.revalidateAt
  ) {
    return null;
  }
  const expectedArtifacts = [
    ['corpus_manifest', evidence.admission.content.corpusId],
    ['corpus_factual_lineage', evidence.admission.content.corpusToCandidateLineageId],
    ['factual_release', evidence.admission.content.factualReleaseId],
    ['factual_release_candidate', evidence.admission.content.factualCandidateId],
  ] as const;
  const artifactKeys = (artifacts: typeof admittedDecision.content.affectedArtifacts) =>
    artifacts.map(({ kind, artifactId }) => `${kind}|${artifactId}`).sort();
  const requiredArtifactKeys = expectedArtifacts
    .map(([kind, artifactId]) => `${kind}|${artifactId}`)
    .sort();
  const scopeMatches = (decision: typeof admittedDecision): boolean => {
    if (decision === undefined) return false;
    const dimensions = new Map(
      decision.content.scope.dimensions.map(({ name, values }) => [name, values] as const)
    );
    const dimensionNames = [...dimensions.keys()].sort();
    const exactScopeKey = exactIds(dimensions.get('scope') ?? [], [
      evidence.datasetCandidate.content.scopeKey,
    ]);
    const validFrom = dimensions.get('valid_from_season') ?? [];
    const validThrough = dimensions.get('valid_through_season') ?? [];
    const legacyScope = exactScopeKey && exactIds(dimensionNames, ['competition', 'scope']);
    const privateFactualScope =
      exactScopeKey &&
      exactIds(dimensionNames, [
        'competition',
        'scope',
        'valid_from_season',
        'valid_through_season',
      ]) &&
      validFrom.length === 1 &&
      validThrough.length === 1 &&
      /^\d{4}$/.test(validFrom[0] ?? '') &&
      /^\d{4}$/.test(validThrough[0] ?? '') &&
      Number(validFrom[0]) <= Number(validThrough[0]);
    return (
      decision.content.scope.scopeKey === evidence.datasetCandidate.content.scopeKey &&
      exactIds(dimensions.get('competition') ?? [], [
        evidence.datasetCandidate.content.competition,
      ]) &&
      (legacyScope || privateFactualScope)
    );
  };
  const admittedAtResolution = resolveAflTradeGateEligibility(evidence.gate2Ledger, {
    gate: 'gate_2_corpus_lineage',
    decisionKey: evidence.gate2DecisionKey,
    environment: intent.content.environment,
    evaluatedAt: admissionDecision.evaluatedAt,
  });
  if (
    admittedAtResolution.status !== 'mechanically_eligible' ||
    admittedAtResolution.decision?.decisionId !== admittedDecision.decisionId ||
    !scopeMatches(admittedDecision) ||
    !exactIds(artifactKeys(admittedDecision.content.affectedArtifacts), requiredArtifactKeys)
  ) {
    return null;
  }
  const current = resolveAflTradeGateEligibility(evidence.gate2Ledger, {
    gate: 'gate_2_corpus_lineage',
    decisionKey: evidence.gate2DecisionKey,
    environment: intent.content.environment,
    evaluatedAt,
  });
  if (
    current.status !== 'mechanically_eligible' ||
    current.decision === null ||
    !scopeMatches(current.decision) ||
    canonicalizeAflTradeJson(current.decision.content.scope) !==
      canonicalizeAflTradeJson(admittedDecision.content.scope)
  ) {
    return null;
  }
  return exactIds(artifactKeys(current.decision.content.affectedArtifacts), requiredArtifactKeys) &&
    current.decision.content.revalidateAt !== null
    ? {
        decisionId: current.decision.decisionId,
        validThrough: current.decision.content.revalidateAt,
      }
    : null;
}

function rightsCoverageIsCurrent(
  evidence: NonNullable<ReturnType<typeof parseEvidence>>,
  intent: AflTradeModelRunIntent,
  evaluatedAt: string
): string | null {
  const requestedReceiptIds = intent.content.modelTrainingEvaluationReceiptIds;
  const requiredProposalIds = [
    ...new Set(
      evidence.admission.content.sourceRightsEvaluations.map((evaluation) => evaluation.proposalId)
    ),
  ].sort();
  const rightsById = new Map(
    evidence.sourceRightsProposals.map((rights) => [rights.rightsArtifactId, rights])
  );
  const admissionReceiptById = new Map(
    evidence.admissionEvaluationReceipts.map((receipt) => [receipt.receiptId, receipt])
  );
  const runReceiptById = new Map(
    evidence.runStartEvaluationReceipts.map((receipt) => [receipt.receiptId, receipt])
  );
  if (!exactIds([...requestedReceiptIds], [...runReceiptById.keys()].sort())) return null;
  if (runReceiptById.size !== requiredProposalIds.length) return null;
  const validityBoundaries: string[] = [];

  for (const evaluation of evidence.admission.content.sourceRightsEvaluations) {
    const rights = rightsById.get(evaluation.proposalId);
    const admissionReceipt = admissionReceiptById.get(evaluation.admissionEvaluationReceiptId);
    const runReceipt = evidence.runStartEvaluationReceipts.find(
      (receipt) => receipt.content.request.rightsArtifactId === evaluation.proposalId
    );
    if (!rights || !admissionReceipt || !runReceipt) return null;
    if (
      admissionReceipt.content.result.status !== 'mechanically_eligible' ||
      admissionReceipt.content.result.decisionId !== evaluation.admissionDecisionId ||
      admissionReceipt.content.request.evaluatedAt !== evaluation.admissionEvaluatedAt ||
      requestWithoutEvaluationTime(admissionReceipt) !== requestWithoutEvaluationTime(runReceipt) ||
      runReceipt.content.request.evaluatedAt !== intent.content.startedAt ||
      runReceipt.content.recordedAt !== intent.content.startedAt ||
      !runReceipt.content.request.operations.includes('model_training') ||
      !runReceipt.content.request.fieldUses.some(({ use }) => use === 'model_training')
    ) {
      return null;
    }
    const reevaluated = evaluateAflTradeGate0A(evidence.gateDecisionLedger, rights, {
      ...runReceipt.content.request,
      evaluatedAt,
    });
    if (
      reevaluated.status !== 'mechanically_eligible' ||
      reevaluated.decisionId !== runReceipt.content.result.decisionId
    ) {
      return null;
    }
    const decision = evidence.gateDecisionLedger.decisions.find(
      ({ decisionId }) => decisionId === runReceipt.content.result.decisionId
    );
    if (decision?.content.revalidateAt === null || decision === undefined) return null;
    validityBoundaries.push(decision.content.revalidateAt);
    if (rights.content.termsExpireAt !== null) {
      validityBoundaries.push(rights.content.termsExpireAt);
    }
  }
  if (!requiredProposalIds.every((proposalId) => rightsById.has(proposalId))) return null;
  return new Date(Math.min(...validityBoundaries.map(Date.parse))).toISOString();
}

function executableArtifactsMatch(
  evidence: NonNullable<ReturnType<typeof parseEvidence>>,
  intent: AflTradeModelRunIntent,
  protocol: AflTradePlayerContributionModelProtocolV2
): boolean {
  const datasetSpecification = evidence.datasetCandidate.content.specification.content;
  if (
    canonicalizeAflTradeJson(intent.content.featureDefinitionArtifacts) !==
      canonicalizeAflTradeJson(datasetSpecification.featureDefinitions) ||
    canonicalizeAflTradeJson(protocol.content.valueUnit.definitionArtifact) !==
      canonicalizeAflTradeJson(datasetSpecification.valueUnitDefinition) ||
    canonicalizeAflTradeJson(protocol.content.footballContext.roleTaxonomyArtifact) !==
      canonicalizeAflTradeJson(datasetSpecification.roleTaxonomy) ||
    canonicalizeAflTradeJson(protocol.content.footballContext.eraDefinitionArtifact) !==
      canonicalizeAflTradeJson(datasetSpecification.eraDefinition) ||
    canonicalizeAflTradeJson(
      protocol.content.contributionAndCensoringPolicy.censoringDefinitionArtifact
    ) !== canonicalizeAflTradeJson(datasetSpecification.censoringDefinition)
  ) {
    return false;
  }
  const protocolReferences: AflTradeArtifactRef[] = [
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
  const references: AflTradeArtifactRef[] = [
    intent.content.sourceCodeArtifact,
    intent.content.dependencyLockArtifact,
    intent.content.runtimeArtifact,
    intent.content.containerArtifact,
    intent.content.configurationArtifact,
    intent.content.environmentArtifact,
    ...intent.content.featureDefinitionArtifacts,
    ...protocolReferences,
  ];
  const proofById = new Map(
    evidence.executableArtifacts.map((proof) => [proof.artifactId, proof] as const)
  );
  if (proofById.size !== evidence.executableArtifacts.length) return false;
  const expectedIds = [...new Set(references.map(({ artifactId }) => artifactId))].sort();
  if (!exactIds([...proofById.keys()].sort(), expectedIds)) return false;
  return references.every((reference) => {
    const proof = proofById.get(reference.artifactId);
    return proof !== undefined && doesAflTradeArtifactRefMatchBytes(reference, proof.bytes);
  });
}

export class AflTradeAdmittedModelRunAuthorityService {
  constructor(
    private readonly dependencies: {
      authenticator: AflTradeAdmittedModelRunEvidenceAuthenticator;
      clock: AflTradeModelRunAuthorityClock;
      authorizationStore: AflTradeModelRunAuthorizationStore;
      maximumStartDelayMs?: number;
      authorizationLifetimeMs?: number;
    }
  ) {}

  async authorize(
    request: AflTradeAdmittedModelRunAuthorityRequest
  ): Promise<AflTradeAdmittedModelRunAuthorityResult> {
    const intent = aflTradeModelRunIntentSchema.safeParse(request.intent);
    const protocol = aflTradePlayerContributionModelProtocolV2Schema.safeParse(request.protocol);
    if (
      !intent.success ||
      !protocol.success ||
      !intentMatchesProtocol(intent.data, protocol.data)
    ) {
      return blocked('invalid_request', 'The admitted model-run intent is invalid.');
    }

    let unparsedEvidence: AflTradeAdmittedModelRunEvidence;
    try {
      unparsedEvidence = await this.dependencies.authenticator.authenticate({
        intent: intent.data,
      });
    } catch {
      return blocked('evidence_unavailable', 'Admitted model-run evidence could not be loaded.');
    }
    const evidence = parseEvidence(unparsedEvidence);
    if (!evidence) {
      return blocked('invalid_evidence', 'Admitted model-run evidence failed authentication.');
    }
    if (!exactDatasetAncestry(evidence, protocol.data, intent.data)) {
      return blocked('ancestry_mismatch', 'The run does not bind the exact admitted dataset.');
    }
    if (
      canonicalizeAflTradeJson(evidence.registeredProtocol) !==
      canonicalizeAflTradeJson(protocol.data)
    ) {
      return blocked(
        'ancestry_mismatch',
        'The run protocol is not the exact durably registered protocol.'
      );
    }
    if (!observationSetMatchesExactCandidate(evidence, protocol.data, intent.data)) {
      return blocked(
        'observation_set_mismatch',
        'The observation set is not the deterministic projection of the admitted rows.'
      );
    }
    if (!executableArtifactsMatch(evidence, intent.data, protocol.data)) {
      return blocked(
        'execution_artifact_mismatch',
        'Every executable model artifact must match its exact retained bytes.'
      );
    }
    const evaluatedAt = await this.dependencies.clock.now();
    const startDelay = Date.parse(evaluatedAt) - Date.parse(intent.data.content.startedAt);
    const maximumStartDelayMs = this.dependencies.maximumStartDelayMs ?? 5_000;
    if (startDelay < 0 || startDelay > maximumStartDelayMs) {
      return blocked(
        'invalid_request',
        'The model-run intent is not fresh at the trusted execution boundary.'
      );
    }
    const gate2Authority = gate2IsCurrent(evidence, intent.data, evaluatedAt);
    if (gate2Authority === null) {
      return blocked(
        'gate2_not_current',
        'The exact corpus lineage lacks current Gate 2 approval.'
      );
    }
    const rightsValidThrough = rightsCoverageIsCurrent(evidence, intent.data, evaluatedAt);
    if (rightsValidThrough === null) {
      return blocked(
        'rights_not_current',
        'Every admitted source requires exact current model-training authority at run start.'
      );
    }
    if (
      !operationalAuthorizationIsCurrent(
        evidence.operationalAuthorization,
        intent.data,
        evaluatedAt
      )
    ) {
      return blocked(
        'operational_authorization_invalid',
        'Current human operational authorization must cover the exact model-run intent.'
      );
    }

    const content = modelRunAuthorizationContentSchema.parse({
      schemaVersion: AFL_TRADE_MODEL_RUN_AUTHORIZATION_SCHEMA_VERSION,
      authorityBoundary: 'model_run_start_authority_no_grade_publication_or_fantasy_ownership',
      publicationEligible: false,
      environment: intent.data.content.environment,
      runIntentId: intent.data.intentId,
      datasetId: intent.data.content.datasetId,
      datasetAdmissionId: evidence.admission.admissionId,
      datasetRowSetSha256: evidence.datasetCandidate.content.rowSetSha256,
      modelProtocolId: protocol.data.protocolId,
      observationSetId: evidence.observationSet.observationSetId,
      operationalAuthorizationReceiptId: evidence.operationalAuthorization.receiptId,
      gate2DecisionId: gate2Authority.decisionId,
      gateLedgerRevision: evidence.gateLedgerRevision,
      authorizedAt: evaluatedAt,
      validThrough: new Date(
        Math.min(
          Date.parse(evaluatedAt) +
            Math.max(1, Math.min(this.dependencies.authorizationLifetimeMs ?? 30_000, 30_000)),
          Date.parse(gate2Authority.validThrough),
          Date.parse(rightsValidThrough),
          Date.parse(evidence.operationalAuthorization.content.validThrough)
        )
      ).toISOString(),
      modelTrainingEvaluationReceiptIds: intent.data.content.modelTrainingEvaluationReceiptIds,
    });
    const authorization = aflTradeModelRunAuthorizationSchema.parse({
      authorizationId: createAflTradeContentAddress('model-run-authorization', content),
      content,
    });
    try {
      const issued = await this.dependencies.authorizationStore.issueOnceForIntent({
        authorization,
        intent: intent.data,
      });
      if (!issued) {
        return blocked(
          'authorization_unavailable',
          'The exact model-run authorization could not be issued durably.'
        );
      }
    } catch {
      return blocked(
        'authorization_unavailable',
        'The exact model-run authorization could not be issued durably.'
      );
    }
    return {
      status: 'authorized',
      authorization,
      intent: intent.data,
      protocol: protocol.data,
      observationSet: evidence.observationSet,
      spellMetrics: evidence.spellMetrics,
      executableArtifacts: evidence.executableArtifacts,
      blockers: [],
    };
  }
}

export interface AflTradeAuthorizedModelExecutor {
  execute(input: {
    intent: AflTradeModelRunIntent;
    authorization: AflTradeModelRunAuthorization;
    protocol: AflTradePlayerContributionModelProtocolV2;
    observationSet: AflTradePlayerObservationSetV2;
    spellMetrics: readonly AflTradeAcquisitionSpellMetric[];
    executableArtifacts: readonly { artifactId: string; bytes: Uint8Array }[];
  }): Promise<AflTradeAuthorizedModelRunCompletion>;
}

export interface AflTradeModelRunFailureRecorder {
  recordExecutionFailure(input: {
    intent: AflTradeModelRunIntent;
    authorization: AflTradeModelRunAuthorization;
    failedAt: string;
    cause: unknown;
  }): Promise<AflTradeAuthorizedModelRunCompletion>;
}

export type AflTradeAdmittedModelRunResult =
  | AflTradeAdmittedModelRunAuthorityResult
  | {
      status: 'completed';
      authorization: AflTradeModelRunAuthorization;
      run: AflTradeModelRunManifestV3;
      blockers: readonly [];
    }
  | {
      status: 'persistence_failed';
      authorization: AflTradeModelRunAuthorization;
      run: AflTradeModelRunManifestV3 | null;
      blockers: readonly [AflTradeAdmittedModelRunAuthorityBlocker];
    };

export class AflTradeAdmittedModelRunner {
  constructor(
    private readonly authority: AflTradeAdmittedModelRunAuthorityService,
    private readonly executor: AflTradeAuthorizedModelExecutor,
    private readonly authorizationStore: AflTradeModelRunAuthorizationStore,
    private readonly clock: AflTradeModelRunAuthorityClock,
    private readonly completedRunStore: AflTradeCompletedModelRunStore,
    private readonly failureRecorder: AflTradeModelRunFailureRecorder
  ) {}

  async run(
    request: AflTradeAdmittedModelRunAuthorityRequest
  ): Promise<AflTradeAdmittedModelRunResult> {
    const authorized = await this.authority.authorize(request);
    if (authorized.status !== 'authorized') return authorized;
    const consumedAt = await this.clock.now();
    const consumedAtMs = Date.parse(consumedAt);
    const withinAuthorizationWindow =
      consumedAtMs >= Date.parse(authorized.authorization.content.authorizedAt) &&
      consumedAtMs < Date.parse(authorized.authorization.content.validThrough);
    let consumed = false;
    if (withinAuthorizationWindow) {
      try {
        consumed = await this.authorizationStore.consumeIntentOnce({
          authorizationId: authorized.authorization.authorizationId,
          intentId: authorized.intent.intentId,
          consumedAt,
        });
      } catch {
        consumed = false;
      }
    }
    if (!withinAuthorizationWindow || !consumed) {
      return blocked(
        'authorization_not_consumable',
        'The model-run authorization is expired, replayed, or not durably issued.'
      );
    }
    let completion: AflTradeAuthorizedModelRunCompletion;
    try {
      completion = await this.executor.execute({
        intent: authorized.intent,
        authorization: authorized.authorization,
        protocol: authorized.protocol,
        observationSet: authorized.observationSet,
        spellMetrics: authorized.spellMetrics,
        executableArtifacts: authorized.executableArtifacts,
      });
    } catch (cause) {
      try {
        const failedAt = await this.clock.now();
        completion = await this.failureRecorder.recordExecutionFailure({
          intent: authorized.intent,
          authorization: authorized.authorization,
          failedAt,
          cause,
        });
        if (completion.outcome.status === 'succeeded')
          throw new RangeError('Invalid failure record.');
      } catch {
        return {
          status: 'persistence_failed',
          authorization: authorized.authorization,
          run: null,
          blockers: [
            {
              code: 'execution_failure_unrecorded',
              message:
                'The consumed model-run intent failed and its failure evidence could not be retained.',
            },
          ],
        };
      }
    }
    const run = createAflTradeAuthorizedModelRunManifest({
      intent: authorized.intent,
      authorization: authorized.authorization,
      completion,
    });
    let persisted = false;
    try {
      persisted = await this.completedRunStore.persistCompletedRun(run);
    } catch {
      persisted = false;
    }
    if (!persisted) {
      return {
        status: 'persistence_failed',
        authorization: authorized.authorization,
        run,
        blockers: [
          {
            code: 'run_persistence_failed',
            message:
              'The executed model run could not be committed to the durable private registry.',
          },
        ],
      };
    }
    return {
      status: 'completed',
      authorization: authorized.authorization,
      run,
      blockers: [],
    };
  }
}
