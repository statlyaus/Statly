import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

const isoInstantSchema = z.iso.datetime({ offset: true });
const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const admissionContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-pav-observation-admission/v1'),
    authorityBoundary: z.literal(
      'non_production_pick_observation_model_training_admission_not_run_gate_3_scoring_or_publication_authority'
    ),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    observationSetId: aflTradeContentAddressedIdSchema('pick-pav-observation-set'),
    observationSetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    policyId: aflTradeContentAddressedIdSchema('pick-pav-policy'),
    sourceQualificationReportId: aflTradeContentAddressedIdSchema(
      'valuation-source-qualification'
    ),
    gate2DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    sourceQualificationArtifact: aflTradeArtifactRefSchema,
    gate2DecisionArtifact: aflTradeArtifactRefSchema,
    admittedUse: z.literal('candidate_training_validation_and_final_test_only'),
    tradeScoringAuthority: z.literal('not_granted'),
    admittedAt: isoInstantSchema,
  })
  .strict()
  .superRefine((admission, context) => {
    const admittedAt = Date.parse(admission.admittedAt);
    if (
      [admission.sourceQualificationArtifact, admission.gate2DecisionArtifact].some(
        (artifact) => Date.parse(artifact.createdAt) > admittedAt
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['admittedAt'],
        message: 'Observation admission cannot predate its source and Gate 2 evidence.',
      });
    }
  });

export const aflTradePickPavObservationAdmissionSchema = z
  .object({
    observationAdmissionId: aflTradeContentAddressedIdSchema(
      'pick-pav-observation-admission'
    ),
    content: admissionContentSchema,
  })
  .strict()
  .superRefine((admission, context) => {
    addAflTradeContentAddressIssue(
      'pick-pav-observation-admission',
      admission.observationAdmissionId,
      admission.content,
      context,
      ['observationAdmissionId']
    );
  });

export type AflTradePickPavObservationAdmission = z.infer<
  typeof aflTradePickPavObservationAdmissionSchema
>;

export function createAflTradePickPavObservationAdmission(input: {
  observationSetId: string;
  observationSetSha256: string;
  releaseId: string;
  policyId: string;
  sourceQualificationReportId: string;
  gate2DecisionId: string;
  sourceQualificationArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  gate2DecisionArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  admittedAt: string;
}): AflTradePickPavObservationAdmission {
  const content = admissionContentSchema.parse({
    schemaVersion: 'afl-trade-pick-pav-observation-admission/v1',
    authorityBoundary:
      'non_production_pick_observation_model_training_admission_not_run_gate_3_scoring_or_publication_authority',
    environment: 'non_production',
    publicationEligible: false,
    observationSetId: input.observationSetId,
    observationSetSha256: input.observationSetSha256,
    releaseId: input.releaseId,
    policyId: input.policyId,
    sourceQualificationReportId: input.sourceQualificationReportId,
    gate2DecisionId: input.gate2DecisionId,
    sourceQualificationArtifact: input.sourceQualificationArtifact,
    gate2DecisionArtifact: input.gate2DecisionArtifact,
    admittedUse: 'candidate_training_validation_and_final_test_only',
    tradeScoringAuthority: 'not_granted',
    admittedAt: input.admittedAt,
  });
  return aflTradePickPavObservationAdmissionSchema.parse({
    observationAdmissionId: createAflTradeContentAddress(
      'pick-pav-observation-admission',
      content
    ),
    content,
  });
}

const intentContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-pav-model-run-intent/v1'),
    authorityBoundary: z.literal(
      'pre_execution_pick_model_candidate_intent_no_outputs_gate_3_scoring_or_publication_authority'
    ),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    observationAdmissionId: aflTradeContentAddressedIdSchema(
      'pick-pav-observation-admission'
    ),
    observationSetId: aflTradeContentAddressedIdSchema('pick-pav-observation-set'),
    modelId: publicIdSchema,
    modelVersion: publicIdSchema,
    codeCommitSha: gitCommitSchema,
    cleanWorktree: z.literal(true),
    seed: z.number().int().nonnegative(),
    sourceCodeArtifact: aflTradeArtifactRefSchema,
    dependencyLockArtifact: aflTradeArtifactRefSchema,
    runtimeArtifact: aflTradeArtifactRefSchema,
    configurationArtifact: aflTradeArtifactRefSchema,
    startedAt: isoInstantSchema,
    candidateOutputs: z.literal('not_yet_created'),
  })
  .strict()
  .superRefine((intent, context) => {
    if (
      [
        intent.sourceCodeArtifact,
        intent.dependencyLockArtifact,
        intent.runtimeArtifact,
        intent.configurationArtifact,
      ].some((artifact) => Date.parse(artifact.createdAt) > Date.parse(intent.startedAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['startedAt'],
        message: 'A run intent cannot start before its execution artifacts exist.',
      });
    }
  });

export const aflTradePickPavModelRunIntentSchema = z
  .object({
    runIntentId: aflTradeContentAddressedIdSchema('pick-pav-model-run-intent'),
    content: intentContentSchema,
  })
  .strict()
  .superRefine((intent, context) => {
    addAflTradeContentAddressIssue(
      'pick-pav-model-run-intent',
      intent.runIntentId,
      intent.content,
      context,
      ['runIntentId']
    );
  });

export type AflTradePickPavModelRunIntent = z.infer<
  typeof aflTradePickPavModelRunIntentSchema
>;

export function createAflTradePickPavModelRunIntent(input: {
  admission: AflTradePickPavObservationAdmission;
  modelId: string;
  modelVersion: string;
  codeCommitSha: string;
  cleanWorktree: true;
  seed: number;
  sourceCodeArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  dependencyLockArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  runtimeArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  configurationArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  startedAt: string;
}): AflTradePickPavModelRunIntent {
  const admission = aflTradePickPavObservationAdmissionSchema.parse(input.admission);
  if (Date.parse(input.startedAt) < Date.parse(admission.content.admittedAt)) {
    throw new TypeError('A pick model run intent cannot predate its observation admission.');
  }
  const content = intentContentSchema.parse({
    schemaVersion: 'afl-trade-pick-pav-model-run-intent/v1',
    authorityBoundary:
      'pre_execution_pick_model_candidate_intent_no_outputs_gate_3_scoring_or_publication_authority',
    environment: 'non_production',
    publicationEligible: false,
    observationAdmissionId: admission.observationAdmissionId,
    observationSetId: admission.content.observationSetId,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    codeCommitSha: input.codeCommitSha,
    cleanWorktree: input.cleanWorktree,
    seed: input.seed,
    sourceCodeArtifact: input.sourceCodeArtifact,
    dependencyLockArtifact: input.dependencyLockArtifact,
    runtimeArtifact: input.runtimeArtifact,
    configurationArtifact: input.configurationArtifact,
    startedAt: input.startedAt,
    candidateOutputs: 'not_yet_created',
  });
  return aflTradePickPavModelRunIntentSchema.parse({
    runIntentId: createAflTradeContentAddress('pick-pav-model-run-intent', content),
    content,
  });
}

const authorizationContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-pav-model-run-authorization/v1'),
    authorityBoundary: z.literal(
      'time_bounded_exactly_once_pick_candidate_execution_not_gate_3_scoring_or_publication_authority'
    ),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    runIntentId: aflTradeContentAddressedIdSchema('pick-pav-model-run-intent'),
    observationAdmissionId: aflTradeContentAddressedIdSchema(
      'pick-pav-observation-admission'
    ),
    observationSetId: aflTradeContentAddressedIdSchema('pick-pav-observation-set'),
    modelTrainingEvaluationReceiptIds: z
      .array(aflTradeContentAddressedIdSchema('gate0a-evaluation'))
      .min(1)
      .max(1000),
    operationalPrincipalAuthorityId: aflTradeContentAddressedIdSchema(
      'operational-principal-authority'
    ),
    gateLedgerRevision: z.number().int().positive(),
    authorizedAt: isoInstantSchema,
    validThrough: isoInstantSchema,
    consumption: z.literal('exactly_once'),
    initialConsumptionState: z.literal('available'),
    gate3Authority: z.literal('not_granted'),
    tradeScoringAuthority: z.literal('not_granted'),
  })
  .strict()
  .superRefine((authorization, context) => {
    const receipts = authorization.modelTrainingEvaluationReceiptIds;
    if (
      new Set(receipts).size !== receipts.length ||
      receipts.some((receipt, index) => index > 0 && receipts[index - 1]! > receipt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['modelTrainingEvaluationReceiptIds'],
        message: 'Model-training receipts must be unique and canonically ordered.',
      });
    }
    if (Date.parse(authorization.validThrough) <= Date.parse(authorization.authorizedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['validThrough'],
        message: 'Authorization valid through must follow its authorization time.',
      });
    }
  });

export const aflTradePickPavModelRunAuthorizationSchema = z
  .object({
    runAuthorizationId: aflTradeContentAddressedIdSchema(
      'pick-pav-model-run-authorization'
    ),
    content: authorizationContentSchema,
  })
  .strict()
  .superRefine((authorization, context) => {
    addAflTradeContentAddressIssue(
      'pick-pav-model-run-authorization',
      authorization.runAuthorizationId,
      authorization.content,
      context,
      ['runAuthorizationId']
    );
  });

export type AflTradePickPavModelRunAuthorization = z.infer<
  typeof aflTradePickPavModelRunAuthorizationSchema
>;

export function createAflTradePickPavModelRunAuthorization(input: {
  admission: AflTradePickPavObservationAdmission;
  intent: AflTradePickPavModelRunIntent;
  modelTrainingEvaluationReceiptIds: string[];
  operationalPrincipalAuthorityId: string;
  gateLedgerRevision: number;
  authorizedAt: string;
  validThrough: string;
}): AflTradePickPavModelRunAuthorization {
  const admission = aflTradePickPavObservationAdmissionSchema.parse(input.admission);
  const intent = aflTradePickPavModelRunIntentSchema.parse(input.intent);
  if (
    intent.content.observationAdmissionId !== admission.observationAdmissionId ||
    intent.content.observationSetId !== admission.content.observationSetId
  ) {
    throw new TypeError('Pick model run authorization requires exact intent/admission ancestry.');
  }
  if (Date.parse(input.authorizedAt) < Date.parse(intent.content.startedAt)) {
    throw new TypeError('Pick model run authorization cannot predate its run intent.');
  }
  const content = authorizationContentSchema.parse({
    schemaVersion: 'afl-trade-pick-pav-model-run-authorization/v1',
    authorityBoundary:
      'time_bounded_exactly_once_pick_candidate_execution_not_gate_3_scoring_or_publication_authority',
    environment: 'non_production',
    publicationEligible: false,
    runIntentId: intent.runIntentId,
    observationAdmissionId: admission.observationAdmissionId,
    observationSetId: admission.content.observationSetId,
    modelTrainingEvaluationReceiptIds: input.modelTrainingEvaluationReceiptIds,
    operationalPrincipalAuthorityId: input.operationalPrincipalAuthorityId,
    gateLedgerRevision: input.gateLedgerRevision,
    authorizedAt: input.authorizedAt,
    validThrough: input.validThrough,
    consumption: 'exactly_once',
    initialConsumptionState: 'available',
    gate3Authority: 'not_granted',
    tradeScoringAuthority: 'not_granted',
  });
  return aflTradePickPavModelRunAuthorizationSchema.parse({
    runAuthorizationId: createAflTradeContentAddress(
      'pick-pav-model-run-authorization',
      content
    ),
    content,
  });
}
