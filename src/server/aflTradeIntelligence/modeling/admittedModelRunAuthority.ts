import { z } from 'zod';

import {
  type AflTradeModelRunIntent,
  type AflTradeModelRunManifestV3,
  type AflTradeModelRunManifestV4,
  type AflTradeModelRunManifestV5,
  aflTradeModelRunManifestV4Schema,
  aflTradeModelRunManifestV5Schema,
  aflTradeModelRunManifestV3ContentSchema,
  aflTradeModelRunManifestV3Schema,
  aflTradeModelRunIntentSchema,
  createAflTradeModelRunContinuationIntent,
} from '../artifacts/modelRunManifest';
import { aflTradeAnyModelRunCheckpointSchema } from '../artifacts/modelRunCheckpoint';
import {
  type AflTradeArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
} from '../artifacts/artifactReference';
import {
  type AflTradePlayerContributionModelProtocolV2,
  type AflTradePlayerPavModelProtocol,
  aflTradePlayerContributionModelProtocolV2Schema,
  aflTradePlayerPavModelProtocolSchema,
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
  type AflTradePlayerObservationSetV3,
  aflTradePlayerObservationSetV2Schema,
  aflTradePlayerObservationSetV3Schema,
  createAflTradePlayerObservationSetV2,
  createAflTradePlayerObservationSetV3,
} from './playerContributionContracts';
import {
  type AflTradePlayerPavObservationSet,
  aflTradePlayerPavObservationSetSchema,
} from './playerPavObservationContracts';
import { type AflTradeHpnPavMethod, aflTradeHpnPavMethodSchema } from './hpnPlayerApproximateValue';
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

/** Authenticates retained bindings only; consumption and live write authority belong to the durable owner. */
export function authenticateAflTradeAuthorizedPersistenceRecoveryManifest(input: {
  run: AflTradeModelRunManifestV4 | AflTradeModelRunManifestV5;
  intent: AflTradeModelRunIntent;
  authorization: AflTradeModelRunAuthorization;
}): AflTradeModelRunManifestV4 | AflTradeModelRunManifestV5 {
  const run = z
    .union([aflTradeModelRunManifestV4Schema, aflTradeModelRunManifestV5Schema])
    .parse(input.run);
  const intent = aflTradeModelRunIntentSchema.parse(input.intent);
  const authorization = aflTradeModelRunAuthorizationSchema.parse(input.authorization);
  const child = run.content.recovery.intentChain.at(-1)!;
  if (
    canonicalizeAflTradeJson(child) !== canonicalizeAflTradeJson(intent) ||
    run.content.runAuthorizationId !== authorization.authorizationId ||
    authorization.content.runIntentId !== intent.intentId ||
    authorization.content.environment !== intent.content.environment ||
    authorization.content.datasetId !== intent.content.datasetId ||
    authorization.content.datasetAdmissionId !== intent.content.datasetAdmissionId ||
    authorization.content.modelProtocolId !== intent.content.modelProtocolId ||
    authorization.content.observationSetId !== intent.content.observationSetId ||
    !exactIds(
      authorization.content.modelTrainingEvaluationReceiptIds,
      intent.content.modelTrainingEvaluationReceiptIds
    ) ||
    Date.parse(authorization.content.authorizedAt) < Date.parse(intent.content.startedAt) ||
    Date.parse(authorization.content.authorizedAt) > Date.parse(run.content.finishedAt)
  ) {
    throw new RangeError(
      'Persistence recovery does not bind its exact child intent and authorization.'
    );
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
    /** Completed evidence recovery only; omission retains numerical-start rules. */
    purpose?: 'persistence_only';
  }): Promise<AflTradeAdmittedModelRunEvidence | AflTradeNativePavModelRunEvidence>;
}

export type AflTradeNativePavModelRunEvidence = Omit<
  AflTradeAdmittedModelRunEvidence,
  'registeredProtocol' | 'observationSet' | 'spellMetrics'
> & {
  registeredProtocol: AflTradePlayerPavModelProtocol;
  observationSet: AflTradePlayerObservationSetV3;
  pavObservationSet: AflTradePlayerPavObservationSet;
  hpnMethod: AflTradeHpnPavMethod;
  spellMetrics: readonly [];
  continuationAuthority?: z.infer<typeof nativeContinuationAuthoritySchema>;
};

const nativeContinuationAuthoritySchema = z
  .object({
    rootIntent: aflTradeModelRunIntentSchema,
    previousIntent: aflTradeModelRunIntentSchema,
    checkpoint: aflTradeAnyModelRunCheckpointSchema,
    checkpointIntent: aflTradeModelRunIntentSchema.optional(),
  })
  .strict();

type AuthorizedModelInputs =
  | {
      modelFamily?: 'scalar';
      protocol: AflTradePlayerContributionModelProtocolV2;
      observationSet: AflTradePlayerObservationSetV2;
      spellMetrics: readonly AflTradeAcquisitionSpellMetric[];
    }
  | {
      modelFamily: 'native_pav';
      protocol: AflTradePlayerPavModelProtocol;
      datasetCandidate: AflTradeValuationDatasetCandidate;
      observationSet: AflTradePlayerObservationSetV3;
      pavObservationSet: AflTradePlayerPavObservationSet;
      hpnMethod: AflTradeHpnPavMethod;
      spellMetrics: readonly [];
    };

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
  | (AuthorizedModelInputs & {
      status: 'authorized';
      authorization: AflTradeModelRunAuthorization;
      intent: AflTradeModelRunIntent;
      executableArtifacts: readonly { artifactId: string; bytes: Uint8Array }[];
      blockers: readonly [];
    })
  | {
      status: 'blocked';
      authorization: null;
      blockers: readonly AflTradeAdmittedModelRunAuthorityBlocker[];
    };

export interface AflTradeAdmittedModelRunAuthorityRequest {
  intent: unknown;
  protocol: unknown;
}

export type AflTradePersistenceRecoveryAuthorityResult =
  | Extract<AflTradeAdmittedModelRunAuthorityResult, { status: 'blocked' }>
  | {
      status: 'authorized_for_persistence_only';
      authorization: AflTradeModelRunAuthorization;
      intent: AflTradeModelRunIntent;
      blockers: readonly [];
    };

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

const pairedModelEvidenceSchema = z.union([
  z
    .object({
      registeredProtocol: aflTradePlayerContributionModelProtocolV2Schema,
      observationSet: aflTradePlayerObservationSetV2Schema,
      spellMetrics: z.array(aflTradeAcquisitionSpellMetricSchema),
      pavObservationSet: z.never().optional(),
      hpnMethod: z.never().optional(),
      continuationAuthority: z.never().optional(),
    })
    .transform((value) => ({ ...value, modelFamily: 'scalar' as const })),
  z
    .object({
      registeredProtocol: aflTradePlayerPavModelProtocolSchema,
      observationSet: aflTradePlayerObservationSetV3Schema,
      pavObservationSet: aflTradePlayerPavObservationSetSchema,
      hpnMethod: aflTradeHpnPavMethodSchema,
      spellMetrics: z.tuple([]),
      continuationAuthority: nativeContinuationAuthoritySchema.optional(),
    })
    .transform((value) => ({ ...value, modelFamily: 'native_pav' as const })),
]);

function parseEvidence(
  value: AflTradeAdmittedModelRunEvidence | AflTradeNativePavModelRunEvidence
) {
  const model = pairedModelEvidenceSchema.safeParse(value);
  const admission = aflTradeValuationDatasetAdmissionReceiptSchema.safeParse(value.admission);
  const datasetCandidate = aflTradeValuationDatasetCandidateSchema.safeParse(
    value.datasetCandidate
  );
  const admissionEvaluationReceipts = value.admissionEvaluationReceipts.map((receipt) =>
    aflTradeGate0AReceiptSchema.safeParse(receipt)
  );
  const runStartEvaluationReceipts = value.runStartEvaluationReceipts.map((receipt) =>
    aflTradeGate0AReceiptSchema.safeParse(receipt)
  );
  const sourceRightsProposals = value.sourceRightsProposals.map((rights) =>
    aflTradeSourceRightsProposalSchema.safeParse(rights)
  );
  const operationalAuthorization = aflTradeModelRunOperationalAuthorizationSchema.safeParse(
    value.operationalAuthorization
  );
  if (
    !model.success ||
    !admission.success ||
    !datasetCandidate.success ||
    admissionEvaluationReceipts.some((receipt) => !receipt.success) ||
    runStartEvaluationReceipts.some((receipt) => !receipt.success) ||
    sourceRightsProposals.some((rights) => !rights.success) ||
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
    ...model.data,
    admission: admission.data,
    datasetCandidate: datasetCandidate.data,
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

/** Retained ancestry is necessary, not execution authority. The durable adapter owns currentness. */
function nativeContinuationMatches(
  intent: AflTradeModelRunIntent,
  evidence: NonNullable<ReturnType<typeof parseEvidence>>,
  purpose: 'numerical' | 'persistence_only' = 'numerical'
): boolean {
  const context = evidence.continuationAuthority;
  if (intent.content.schemaVersion === 'afl-trade-model-run-intent/v1')
    return purpose === 'numerical' && context === undefined;
  if (
    evidence.modelFamily !== 'native_pav' ||
    !context ||
    intent.content.environment !== 'non_production'
  )
    return false;
  const { rootIntent, previousIntent, checkpoint } = context;
  const checkpointIntent =
    context.checkpointIntent ??
    (checkpoint.content.intentId === rootIntent.intentId
      ? rootIntent
      : checkpoint.content.intentId === previousIntent.intentId
        ? previousIntent
        : undefined);
  const binding = intent.content.continuation;
  const operational = evidence.operationalAuthorization.content;
  if (
    rootIntent.content.schemaVersion !== 'afl-trade-model-run-intent/v1' ||
    rootIntent.content.environment !== 'non_production' ||
    binding.rootIntentId !== rootIntent.intentId ||
    binding.previousIntentId !== previousIntent.intentId ||
    checkpoint.content.rootIntentId !== rootIntent.intentId ||
    !checkpointIntent ||
    checkpointIntent.intentId !== checkpoint.content.intentId ||
    checkpointIntent.content.job.attempt !== checkpoint.content.dispatchAttemptNumber ||
    Date.parse(checkpointIntent.content.startedAt) > Date.parse(checkpoint.content.recordedAt) ||
    (checkpointIntent.content.schemaVersion === 'afl-trade-model-run-intent/v1'
      ? checkpointIntent.intentId !== rootIntent.intentId
      : checkpointIntent.content.continuation.rootIntentId !== rootIntent.intentId) ||
    (purpose === 'persistence_only'
      ? checkpoint.content.stage !== 'final_test_completed'
      : ![
          'started',
          'candidate_fitted',
          'pre_final_retained',
          'validation_plan_retained',
          'candidate_locked',
        ].includes(checkpoint.content.stage)) ||
    binding.dispatchAttemptNumber < previousIntent.content.job.attempt ||
    (binding.dispatchAttemptNumber === previousIntent.content.job.attempt &&
      previousIntent.content.schemaVersion === 'afl-trade-model-run-intent/v2' &&
      (binding.dispatchClaimId !== previousIntent.content.continuation.dispatchClaimId ||
        binding.dispatchLeaseTokenSha256 !==
          previousIntent.content.continuation.dispatchLeaseTokenSha256)) ||
    (previousIntent.content.schemaVersion === 'afl-trade-model-run-intent/v1'
      ? previousIntent.intentId !== rootIntent.intentId
      : previousIntent.content.continuation.rootIntentId !== rootIntent.intentId) ||
    operational.authorityBoundary !==
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent' ||
    operational.dispatchRequestId !== binding.dispatchRequestId ||
    operational.substantiveOperationId !== binding.substantiveOperationId ||
    operational.dispatchClaimId !== binding.dispatchClaimId ||
    operational.dispatchLeaseTokenSha256 !== binding.dispatchLeaseTokenSha256 ||
    operational.dispatchAttemptNumber !== binding.dispatchAttemptNumber
  )
    return false;
  const immutableExecution = (value: AflTradeModelRunIntent) => {
    const body: Record<string, unknown> = { ...value.content, job: { ...value.content.job } };
    delete body.schemaVersion;
    delete body.startedAt;
    delete body.continuation;
    delete body.modelTrainingEvaluationReceiptIds;
    const { attempt: _attempt, ...job } = value.content.job;
    body.job = job;
    return canonicalizeAflTradeJson(body);
  };
  if (
    immutableExecution(rootIntent) !== immutableExecution(previousIntent) ||
    immutableExecution(rootIntent) !== immutableExecution(checkpointIntent)
  )
    return false;
  try {
    const expected = createAflTradeModelRunContinuationIntent({
      previousIntent,
      checkpoint,
      startedAt: intent.content.startedAt,
      dispatchClaimId: binding.dispatchClaimId,
      dispatchLeaseTokenSha256: binding.dispatchLeaseTokenSha256,
      dispatchAttemptNumber: binding.dispatchAttemptNumber,
      modelTrainingEvaluationReceiptIds: [...intent.content.modelTrainingEvaluationReceiptIds],
    });
    return canonicalizeAflTradeJson(expected) === canonicalizeAflTradeJson(intent);
  } catch {
    return false;
  }
}

function intentMatchesProtocol(
  intent: AflTradeModelRunIntent,
  protocol: AflTradePlayerContributionModelProtocolV2 | AflTradePlayerPavModelProtocol
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
  intent: AflTradeModelRunIntent
): boolean {
  if (evidence.modelFamily === 'native_pav') {
    const { registeredProtocol: protocol, pavObservationSet: original, hpnMethod } = evidence;
    const content = protocol.content;
    const matchesDocument = (reference: AflTradeArtifactRef, document: unknown) =>
      doesAflTradeArtifactRefMatchBytes(
        reference,
        new TextEncoder().encode(canonicalizeAflTradeJson(document)),
        'application/json'
      );
    if (
      content.sourceObservationSet.observationSetId !== original.observationSetId ||
      !matchesDocument(content.sourceObservationSet.artifact, original) ||
      content.pavPolicy.policyId !== original.content.policy.policyId ||
      !matchesDocument(content.pavPolicy.artifact, original.content.policy) ||
      content.hpnMethod.methodId !== hpnMethod.methodId ||
      hpnMethod.methodId !== original.content.policy.content.methodId ||
      !matchesDocument(content.hpnMethod.artifact, hpnMethod) ||
      Date.parse(hpnMethod.content.capturedAt) > Date.parse(original.content.knowledgeCutoffAt) ||
      content.featurePolicy.knowledgeJoin !==
        evidence.datasetCandidate.content.specification.content.featurePolicy.knowledgeJoin ||
      content.featurePolicy.knowledgeJoin !==
        evidence.observationSet.content.featureKnowledgePolicy ||
      (original.content.knowledgePolicy !== undefined &&
        content.featurePolicy.knowledgeJoin !== 'retrospective_as_captured_at_dataset_creation')
    )
      return false;
    try {
      const expected = createAflTradePlayerObservationSetV3({
        candidate: evidence.datasetCandidate,
        datasetAdmissionId: evidence.admission.admissionId,
        modelProtocolId: protocol.protocolId,
        pavObservationSet: original,
      });
      if (
        expected.observationSetId !== intent.content.observationSetId ||
        canonicalizeAflTradeJson(expected) !== canonicalizeAflTradeJson(evidence.observationSet)
      )
        return false;
    } catch {
      return false;
    }
    const windows = {
      train: content.windows.train,
      calibration: content.windows.calibration,
      validation: content.windows.validation,
      final_test: content.windows.finalTest,
    };
    return evidence.observationSet.content.observations.every(({ pavObservation }) => {
      const window = windows[pavObservation.partition];
      const cutoff = Date.parse(pavObservation.predictionCutoffAt);
      return cutoff >= Date.parse(window.from) && cutoff < Date.parse(window.to);
    });
  }
  const protocol = evidence.registeredProtocol;
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
  protocol: AflTradePlayerContributionModelProtocolV2 | AflTradePlayerPavModelProtocol,
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
  intent: AflTradeModelRunIntent
): boolean {
  const datasetSpecification = evidence.datasetCandidate.content.specification.content;
  if (
    canonicalizeAflTradeJson(intent.content.featureDefinitionArtifacts) !==
    canonicalizeAflTradeJson(datasetSpecification.featureDefinitions)
  )
    return false;
  let protocolReferences: AflTradeArtifactRef[];
  if (evidence.modelFamily === 'native_pav') {
    const protocol = evidence.registeredProtocol;
    if (
      !datasetSpecification.featureDefinitions.some(
        (reference) =>
          canonicalizeAflTradeJson(reference) ===
          canonicalizeAflTradeJson(protocol.content.featureDefinitionArtifact)
      )
    )
      return false;
    protocolReferences = [
      protocol.content.sourceObservationSet.artifact,
      protocol.content.pavPolicy.artifact,
      protocol.content.hpnMethod.artifact,
      evidence.hpnMethod.content.sourceArtifact,
      protocol.content.featureDefinitionArtifact,
      protocol.content.featurePolicy.featureAvailabilityArtifact,
      ...protocol.content.validationPlan.baselineDefinitionArtifacts,
      ...protocol.content.validationPlan.metricDefinitionArtifacts,
      protocol.content.validationPlan.intervalCalibrationArtifact,
      ...protocol.content.validationPlan.sensitivityAnalysisArtifacts,
      protocol.content.validationPlan.acceptanceCriteriaArtifact,
    ];
  } else {
    const protocol = evidence.registeredProtocol;
    if (
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
    protocolReferences = [
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

/** Revalidates native stage evidence; caller must separately fence consumed authority and custody. */
export function authenticateAflTradeNativePavStageEvidence(input: {
  intent: AflTradeModelRunIntent;
  evidence: AflTradeAdmittedModelRunEvidence | AflTradeNativePavModelRunEvidence;
  evaluatedAt: string;
}): AflTradeNativePavModelRunEvidence {
  const intent = aflTradeModelRunIntentSchema.parse(input.intent);
  if (intent.content.environment !== 'non_production') {
    throw new RangeError('Native PAV stage requires an exact private root intent.');
  }
  const evidence = parseEvidence(input.evidence);
  if (
    !evidence ||
    evidence.modelFamily !== 'native_pav' ||
    evidence.operationalAuthorization.content.authorityBoundary !==
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
  ) {
    throw new RangeError('Native PAV stage requires exact private native evidence.');
  }
  if (!nativeContinuationMatches(intent, evidence))
    throw new RangeError('Native PAV stage requires exact retained continuation ancestry.');
  if (
    !Number.isFinite(Date.parse(input.evaluatedAt)) ||
    Date.parse(input.evaluatedAt) < Date.parse(intent.content.startedAt)
  ) {
    throw new RangeError('Native PAV stage requires a valid current evaluation time.');
  }
  if (
    !intentMatchesProtocol(intent, evidence.registeredProtocol) ||
    !exactDatasetAncestry(evidence, evidence.registeredProtocol, intent) ||
    !observationSetMatchesExactCandidate(evidence, intent)
  ) {
    throw new RangeError('Native PAV stage requires exact admitted observation ancestry.');
  }
  if (!executableArtifactsMatch(evidence, intent)) {
    throw new RangeError('Native PAV stage requires exact executable artifact bytes.');
  }
  if (gate2IsCurrent(evidence, intent, input.evaluatedAt) === null) {
    throw new RangeError('Native PAV stage requires current Gate 2 authority.');
  }
  if (rightsCoverageIsCurrent(evidence, intent, input.evaluatedAt) === null) {
    throw new RangeError('Native PAV stage requires current model-training rights.');
  }
  if (
    !operationalAuthorizationIsCurrent(evidence.operationalAuthorization, intent, input.evaluatedAt)
  ) {
    throw new RangeError('Native PAV stage requires current exact operational authorization.');
  }
  return evidence;
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
    return this.authorizeForPurpose(request, 'numerical');
  }

  /** This result cannot be supplied to the numerical runner; the durable owner still consumes once. */
  async authorizePersistenceRecovery(
    request: AflTradeAdmittedModelRunAuthorityRequest
  ): Promise<AflTradePersistenceRecoveryAuthorityResult> {
    const result = await this.authorizeForPurpose(request, 'persistence_only');
    if (result.status === 'blocked') return result;
    return {
      status: 'authorized_for_persistence_only',
      authorization: result.authorization,
      intent: result.intent,
      blockers: [],
    };
  }

  private async authorizeForPurpose(
    request: AflTradeAdmittedModelRunAuthorityRequest,
    purpose: 'numerical' | 'persistence_only'
  ): Promise<AflTradeAdmittedModelRunAuthorityResult> {
    const intent = aflTradeModelRunIntentSchema.safeParse(request.intent);
    const protocol = z
      .union([
        aflTradePlayerContributionModelProtocolV2Schema,
        aflTradePlayerPavModelProtocolSchema,
      ])
      .safeParse(request.protocol);
    if (
      !intent.success ||
      !protocol.success ||
      !intentMatchesProtocol(intent.data, protocol.data)
    ) {
      return blocked('invalid_request', 'The admitted model-run intent is invalid.');
    }

    let unparsedEvidence: AflTradeAdmittedModelRunEvidence | AflTradeNativePavModelRunEvidence;
    try {
      unparsedEvidence = await this.dependencies.authenticator.authenticate({
        intent: intent.data,
        ...(purpose === 'persistence_only' ? { purpose } : {}),
      });
    } catch {
      return blocked('evidence_unavailable', 'Admitted model-run evidence could not be loaded.');
    }
    const evidence = parseEvidence(unparsedEvidence);
    if (!evidence) {
      return blocked('invalid_evidence', 'Admitted model-run evidence failed authentication.');
    }
    if (!nativeContinuationMatches(intent.data, evidence, purpose))
      return blocked(
        'ancestry_mismatch',
        'The run lacks exact retained native continuation ancestry.'
      );
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
    if (!observationSetMatchesExactCandidate(evidence, intent.data)) {
      return blocked(
        'observation_set_mismatch',
        'The observation set is not the deterministic projection of the admitted rows.'
      );
    }
    if (!executableArtifactsMatch(evidence, intent.data)) {
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
    const modelInputs: AuthorizedModelInputs =
      evidence.modelFamily === 'native_pav'
        ? {
            modelFamily: 'native_pav',
            protocol: evidence.registeredProtocol,
            datasetCandidate: evidence.datasetCandidate,
            observationSet: evidence.observationSet,
            pavObservationSet: evidence.pavObservationSet,
            hpnMethod: evidence.hpnMethod,
            spellMetrics: evidence.spellMetrics,
          }
        : {
            protocol: evidence.registeredProtocol,
            observationSet: evidence.observationSet,
            spellMetrics: evidence.spellMetrics,
          };
    return {
      status: 'authorized',
      ...modelInputs,
      authorization,
      intent: intent.data,
      executableArtifacts: evidence.executableArtifacts,
      blockers: [],
    };
  }
}

export interface AflTradeAuthorizedModelExecutor {
  execute(
    input: AuthorizedModelInputs & {
      intent: AflTradeModelRunIntent;
      authorization: AflTradeModelRunAuthorization;
      executableArtifacts: readonly { artifactId: string; bytes: Uint8Array }[];
    }
  ): Promise<AflTradeAuthorizedModelRunCompletion>;
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
      completion = await this.executor.execute(authorized);
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
