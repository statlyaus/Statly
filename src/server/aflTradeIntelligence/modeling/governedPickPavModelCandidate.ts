import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradePickPavObservationSetSchema } from './pickOutcomeContracts';
import {
  aflTradePickPavModelRunAuthorizationSchema,
  aflTradePickPavModelRunIntentSchema,
  aflTradePickPavObservationAdmissionSchema,
  type AflTradePickPavModelRunAuthorization,
  type AflTradePickPavModelRunIntent,
  type AflTradePickPavObservationAdmission,
} from './pickPavModelCandidateAuthority';
import {
  aflTradePickPavDistributionBenchmarkConfigSchema,
  aflTradePickPavDistributionBenchmarkSchema,
  fitAflTradePickPavDistributionBenchmark,
} from './pickPavDistributionBenchmark';
import {
  computeAflTradePickPavModelExecutionOutputs,
} from './pickPavModelExecution';
import {
  aflTradePickPavValidationConfigSchema,
  aflTradePickPavValidationReportSchema,
  validateAflTradePickPavDistributionBenchmark,
} from './pickPavDistributionValidation';

export const AFL_TRADE_GOVERNED_PICK_PAV_MODEL_CANDIDATE_SCHEMA_VERSION =
  'afl-trade-governed-pick-pav-model-candidate/v1' as const;
export const AFL_TRADE_GOVERNED_PICK_PAV_MODEL_CANDIDATE_AUTHORITY_BOUNDARY =
  'retained_non_production_candidate_evidence_not_gate_3_trade_scoring_grade_publication_or_fantasy_ownership' as const;

const isoInstantSchema = z.iso.datetime({ offset: true });
const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const candidateContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_GOVERNED_PICK_PAV_MODEL_CANDIDATE_SCHEMA_VERSION),
    authorityBoundary: z.literal(
      AFL_TRADE_GOVERNED_PICK_PAV_MODEL_CANDIDATE_AUTHORITY_BOUNDARY
    ),
    publicationEligible: z.literal(false),
    environment: z.literal('non_production'),
    competition: z.literal('AFLM'),
    modelKind: z.literal('draft_pick_and_future_pick_distribution'),
    modelId: publicIdSchema,
    modelVersion: publicIdSchema,
    gate3Authority: z.literal('not_granted'),
    tradeScoringAuthority: z.literal('not_granted'),
    observationAdmissionId: aflTradeContentAddressedIdSchema(
      'pick-pav-observation-admission'
    ),
    runIntentId: aflTradeContentAddressedIdSchema('pick-pav-model-run-intent'),
    runAuthorizationId: aflTradeContentAddressedIdSchema('pick-pav-model-run-authorization'),
    runAuthorizedAt: isoInstantSchema,
    runAuthorizationValidThrough: isoInstantSchema,
    operationalPrincipalAuthorityId: aflTradeContentAddressedIdSchema(
      'operational-principal-authority'
    ),
    gateLedgerRevision: z.number().int().positive(),
    sourceQualificationReportId: aflTradeContentAddressedIdSchema(
      'valuation-source-qualification'
    ),
    modelTrainingEvaluationReceiptIds: z
      .array(aflTradeContentAddressedIdSchema('gate0a-evaluation'))
      .min(1)
      .max(1000),
    observationSetId: aflTradeContentAddressedIdSchema('pick-pav-observation-set'),
    observationSetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    policyId: aflTradeContentAddressedIdSchema('pick-pav-policy'),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    valueUnit: z.literal('fixed_horizon_pav'),
    codeCommitSha: gitCommitSchema,
    cleanWorktree: z.literal(true),
    seed: z.number().int().nonnegative(),
    job: z
      .object({
        jobId: publicIdSchema,
        attempt: z.number().int().positive(),
        initiatedBy: publicIdSchema,
        workerIdentity: publicIdSchema,
      })
      .strict(),
    startedAt: isoInstantSchema,
    candidateLockedAt: isoInstantSchema,
    finalTestEvaluatedAt: isoInstantSchema,
    completedAt: isoInstantSchema,
    sourceCodeArtifact: aflTradeArtifactRefSchema,
    dependencyLockArtifact: aflTradeArtifactRefSchema,
    runtimeArtifact: aflTradeArtifactRefSchema,
    configurationArtifact: aflTradeArtifactRefSchema,
    observationSet: aflTradePickPavObservationSetSchema,
    benchmarkConfig: aflTradePickPavDistributionBenchmarkConfigSchema,
    validationConfig: aflTradePickPavValidationConfigSchema,
    benchmark: aflTradePickPavDistributionBenchmarkSchema,
    validationReport: aflTradePickPavValidationReportSchema,
    limitation: z.literal(
      'This retained candidate is reproducible private model evidence. Only a separate exact current Gate 3 decision and valuation bundle may authorize later trade scoring; it is never itself a trade score, grade, or publication authority.'
    ),
  })
  .strict()
  .superRefine((candidate, context) => {
    const receipts = candidate.modelTrainingEvaluationReceiptIds;
    if (
      new Set(receipts).size !== receipts.length ||
      receipts.some((receipt, index) => index > 0 && receipts[index - 1]! > receipt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['modelTrainingEvaluationReceiptIds'],
        message: 'Model-training evaluation receipts must be unique and canonically ordered.',
      });
    }

    const observationSet = candidate.observationSet;
    if (
      observationSet.content.environment !== 'non_production' ||
      candidate.observationSetId !== observationSet.observationSetId ||
      candidate.observationSetSha256 !== observationSet.content.observationSetSha256 ||
      candidate.releaseId !== observationSet.content.releaseId ||
      candidate.policyId !== observationSet.content.policy.policyId ||
      candidate.methodId !== observationSet.content.policy.content.methodId ||
      candidate.valueUnit !== observationSet.content.policy.content.outcomeValueUnit
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationSet'],
        message:
          'A governed pick candidate requires exact non-production observation, release, policy, method, and value-unit ancestry.',
      });
    }

    const observedCreatedAt = Date.parse(observationSet.content.createdAt);
    const startedAt = Date.parse(candidate.startedAt);
    const candidateLockedAt = Date.parse(candidate.candidateLockedAt);
    const finalTestEvaluatedAt = Date.parse(candidate.finalTestEvaluatedAt);
    const completedAt = Date.parse(candidate.completedAt);
    const runAuthorizedAt = Date.parse(candidate.runAuthorizedAt);
    const runAuthorizationValidThrough = Date.parse(candidate.runAuthorizationValidThrough);
    if (
      startedAt < observedCreatedAt ||
      startedAt < runAuthorizedAt ||
      candidateLockedAt < startedAt ||
      finalTestEvaluatedAt < candidateLockedAt ||
      completedAt < finalTestEvaluatedAt ||
      completedAt > runAuthorizationValidThrough ||
      candidate.validationConfig.evaluatedAt !== candidate.finalTestEvaluatedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidateLockedAt'],
        message:
          'The candidate must start after observation materialization, lock before final-test evaluation, and finish afterward.',
      });
    }

    try {
      const expectedBenchmark = fitAflTradePickPavDistributionBenchmark(
        observationSet,
        candidate.benchmarkConfig
      );
      const expectedReport = validateAflTradePickPavDistributionBenchmark(
        observationSet,
        expectedBenchmark,
        candidate.validationConfig
      );
      if (
        canonicalizeAflTradeJson(expectedBenchmark) !==
          canonicalizeAflTradeJson(candidate.benchmark) ||
        canonicalizeAflTradeJson(expectedReport) !==
          canonicalizeAflTradeJson(candidate.validationReport)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['benchmark'],
          message:
            'Candidate benchmark and validation outputs must exactly match values re-derived from retained inputs.',
        });
      }
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['benchmark'],
        message:
          error instanceof Error
            ? error.message
            : 'Candidate outputs could not be re-derived from retained inputs.',
      });
    }
  });

export const aflTradeGovernedPickPavModelCandidateSchema = z
  .object({
    candidateId: aflTradeContentAddressedIdSchema('pick-pav-model-candidate'),
    content: candidateContentSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    addAflTradeContentAddressIssue(
      'pick-pav-model-candidate',
      candidate.candidateId,
      candidate.content,
      context,
      ['candidateId']
    );
  });

export type AflTradeGovernedPickPavModelCandidate = z.infer<
  typeof aflTradeGovernedPickPavModelCandidateSchema
>;

type CandidateOutputs = ReturnType<typeof computeAflTradePickPavModelExecutionOutputs>;

export function createAflTradeGovernedPickPavModelCandidate(input: {
  outputs: CandidateOutputs;
  admission: AflTradePickPavObservationAdmission;
  intent: AflTradePickPavModelRunIntent;
  authorization: AflTradePickPavModelRunAuthorization;
  job: {
    jobId: string;
    attempt: number;
    initiatedBy: string;
    workerIdentity: string;
  };
  startedAt: string;
  candidateLockedAt: string;
  completedAt: string;
}): AflTradeGovernedPickPavModelCandidate {
  const observationSet = aflTradePickPavObservationSetSchema.parse(input.outputs.observationSet);
  if (observationSet.content.environment !== 'non_production') {
    throw new TypeError('A governed pick model candidate requires a non-production observation set.');
  }
  const admission = aflTradePickPavObservationAdmissionSchema.parse(input.admission);
  const intent = aflTradePickPavModelRunIntentSchema.parse(input.intent);
  const authorization = aflTradePickPavModelRunAuthorizationSchema.parse(input.authorization);
  if (
    admission.content.observationSetId !== observationSet.observationSetId ||
    admission.content.observationSetSha256 !== observationSet.content.observationSetSha256 ||
    admission.content.releaseId !== observationSet.content.releaseId ||
    admission.content.policyId !== observationSet.content.policy.policyId ||
    intent.content.observationAdmissionId !== admission.observationAdmissionId ||
    intent.content.observationSetId !== observationSet.observationSetId ||
    authorization.content.runIntentId !== intent.runIntentId ||
    authorization.content.observationAdmissionId !== admission.observationAdmissionId ||
    authorization.content.observationSetId !== observationSet.observationSetId
  ) {
    throw new TypeError(
      'A governed pick model candidate requires exact observation admission, intent, and authorization ancestry.'
    );
  }
  if (
    Date.parse(input.startedAt) < Date.parse(authorization.content.authorizedAt) ||
    Date.parse(input.completedAt) > Date.parse(authorization.content.validThrough)
  ) {
    throw new TypeError(
      'A governed pick model candidate must execute entirely within its authorization window.'
    );
  }
  const content = candidateContentSchema.parse({
    schemaVersion: AFL_TRADE_GOVERNED_PICK_PAV_MODEL_CANDIDATE_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_GOVERNED_PICK_PAV_MODEL_CANDIDATE_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: 'non_production',
    competition: 'AFLM',
    modelKind: 'draft_pick_and_future_pick_distribution',
    modelId: intent.content.modelId,
    modelVersion: intent.content.modelVersion,
    gate3Authority: 'not_granted',
    tradeScoringAuthority: 'not_granted',
    observationAdmissionId: admission.observationAdmissionId,
    runIntentId: intent.runIntentId,
    runAuthorizationId: authorization.runAuthorizationId,
    runAuthorizedAt: authorization.content.authorizedAt,
    runAuthorizationValidThrough: authorization.content.validThrough,
    operationalPrincipalAuthorityId: authorization.content.operationalPrincipalAuthorityId,
    gateLedgerRevision: authorization.content.gateLedgerRevision,
    sourceQualificationReportId: admission.content.sourceQualificationReportId,
    modelTrainingEvaluationReceiptIds:
      authorization.content.modelTrainingEvaluationReceiptIds,
    observationSetId: observationSet.observationSetId,
    observationSetSha256: observationSet.content.observationSetSha256,
    releaseId: observationSet.content.releaseId,
    policyId: observationSet.content.policy.policyId,
    methodId: observationSet.content.policy.content.methodId,
    valueUnit: observationSet.content.policy.content.outcomeValueUnit,
    codeCommitSha: intent.content.codeCommitSha,
    cleanWorktree: intent.content.cleanWorktree,
    seed: intent.content.seed,
    job: input.job,
    startedAt: input.startedAt,
    candidateLockedAt: input.candidateLockedAt,
    finalTestEvaluatedAt: input.outputs.validationConfig.evaluatedAt,
    completedAt: input.completedAt,
    sourceCodeArtifact: intent.content.sourceCodeArtifact,
    dependencyLockArtifact: intent.content.dependencyLockArtifact,
    runtimeArtifact: intent.content.runtimeArtifact,
    configurationArtifact: intent.content.configurationArtifact,
    observationSet,
    benchmarkConfig: input.outputs.benchmarkConfig,
    validationConfig: input.outputs.validationConfig,
    benchmark: input.outputs.benchmark,
    validationReport: input.outputs.validationReport,
    limitation:
      'This retained candidate is reproducible private model evidence. Only a separate exact current Gate 3 decision and valuation bundle may authorize later trade scoring; it is never itself a trade score, grade, or publication authority.',
  });
  return aflTradeGovernedPickPavModelCandidateSchema.parse({
    candidateId: createAflTradeContentAddress('pick-pav-model-candidate', content),
    content,
  });
}
