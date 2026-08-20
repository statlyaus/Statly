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
  aflTradePickPavDistributionBenchmarkConfigSchema,
  aflTradePickPavDistributionBenchmarkSchema,
  fitAflTradePickPavDistributionBenchmark,
} from './pickPavDistributionBenchmark';
import type { computeAflTradePickPavModelExecutionOutputs } from './pickPavModelExecution';
import {
  aflTradePickPavValidationConfigSchema,
  aflTradePickPavValidationReportSchema,
  validateAflTradePickPavDistributionBenchmark,
} from './pickPavDistributionValidation';

const LEGACY_AUTHORITY_BOUNDARY =
  'authenticated_non_production_pick_model_candidate_no_gate_3_approval_grade_publication_or_fantasy_ownership' as const;
const LEGACY_LIMITATION =
  'This retained non-production execution is eligible for independent Gate 3 review only; it is not an approval, trade grade, or public numerical authority.' as const;
const AUTHORITY_BOUNDARY =
  'authenticated_non_production_pick_model_candidate_pending_automated_qualification_no_grade_publication_or_fantasy_ownership' as const;
const LIMITATION =
  'This retained non-production execution is pending automated model-pair qualification; it is not a trade grade or public numerical authority.' as const;
const instantSchema = z.iso.datetime({ offset: true });

const sharedGovernedExecutionContentSchema = z
  .object({
    publicationEligible: z.literal(false),
    environment: z.literal('non_production'),
    competition: z.literal('AFLM'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetArtifact: aflTradeArtifactRefSchema,
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    datasetAdmissionArtifact: aflTradeArtifactRefSchema,
    datasetAdmissionGateLedgerRevision: z.number().int().positive(),
    protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    protocolArtifact: aflTradeArtifactRefSchema,
    observationSetId: aflTradeContentAddressedIdSchema('pick-pav-observation-set'),
    observationSetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    policyId: aflTradeContentAddressedIdSchema('pick-pav-policy'),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    valueUnit: z.literal('fixed_horizon_pav'),
    finalTestEvaluationStartedAt: instantSchema,
    completedAt: instantSchema,
    observationSet: aflTradePickPavObservationSetSchema,
    benchmarkConfig: aflTradePickPavDistributionBenchmarkConfigSchema,
    validationConfig: aflTradePickPavValidationConfigSchema,
    benchmark: aflTradePickPavDistributionBenchmarkSchema,
    validationReport: aflTradePickPavValidationReportSchema,
  })
  .strict();

function refineGovernedExecution(
  execution: z.infer<typeof sharedGovernedExecutionContentSchema>,
  context: z.RefinementCtx
) {
    const observationSet = execution.observationSet;
    if (
      execution.observationSetId !== observationSet.observationSetId ||
      execution.observationSetSha256 !== observationSet.content.observationSetSha256 ||
      observationSet.content.environment !== 'non_production' ||
      execution.competition !== observationSet.content.competition ||
      execution.releaseId !== observationSet.content.releaseId ||
      execution.policyId !== observationSet.content.policy.policyId ||
      execution.methodId !== observationSet.content.policy.content.methodId ||
      execution.valueUnit !== observationSet.content.policy.content.outcomeValueUnit
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationSet'],
        message: 'Governed pick execution ancestry must match one non-production observation set.',
      });
      return;
    }

    const evidenceArtifacts = [
      execution.datasetArtifact,
      execution.datasetAdmissionArtifact,
      execution.protocolArtifact,
    ];
    if (
      new Set(evidenceArtifacts.map(({ artifactId }) => artifactId)).size !==
        evidenceArtifacts.length ||
      evidenceArtifacts.some(
        ({ createdAt }) => Date.parse(createdAt) > Date.parse(execution.completedAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['datasetArtifact'],
        message: 'Governed pick execution requires distinct authority artifacts retained in time.',
      });
      return;
    }

    const createdAt = Date.parse(observationSet.content.createdAt);
    const finalTestEvaluationStartedAt = Date.parse(execution.finalTestEvaluationStartedAt);
    const completedAt = Date.parse(execution.completedAt);
    if (
      finalTestEvaluationStartedAt < createdAt ||
      completedAt < finalTestEvaluationStartedAt ||
      execution.validationConfig.evaluatedAt !== execution.finalTestEvaluationStartedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['finalTestEvaluationStartedAt'],
        message: 'Governed final-test evaluation chronology is invalid.',
      });
      return;
    }

    try {
      const expectedBenchmark = fitAflTradePickPavDistributionBenchmark(
        observationSet,
        execution.benchmarkConfig
      );
      const expectedReport = validateAflTradePickPavDistributionBenchmark(
        observationSet,
        expectedBenchmark,
        execution.validationConfig
      );
      if (
        canonicalizeAflTradeJson(expectedBenchmark) !==
          canonicalizeAflTradeJson(execution.benchmark) ||
        canonicalizeAflTradeJson(expectedReport) !==
          canonicalizeAflTradeJson(execution.validationReport)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['benchmark'],
          message: 'Governed pick execution must retain its exactly re-derived model outputs.',
        });
      }
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['benchmark'],
        message:
          error instanceof Error
            ? error.message
            : 'Governed pick execution outputs could not be re-derived.',
      });
    }
}

const legacyGovernedExecutionContentSchema = sharedGovernedExecutionContentSchema
  .extend({
    schemaVersion: z.literal('afl-trade-pick-pav-model-execution/v2'),
    authorityBoundary: z.literal(LEGACY_AUTHORITY_BOUNDARY),
    approvalStatus: z.literal('gate_3_review_required'),
    limitation: z.literal(LEGACY_LIMITATION),
  })
  .strict()
  .superRefine(refineGovernedExecution);

const governedExecutionContentSchema = sharedGovernedExecutionContentSchema
  .extend({
    schemaVersion: z.literal('afl-trade-pick-pav-model-execution/v3'),
    authorityBoundary: z.literal(AUTHORITY_BOUNDARY),
    qualificationStatus: z.literal('automated_qualification_pending'),
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine(refineGovernedExecution);

export const governedAflTradePickPavModelExecutionSchema = z
  .object({
    executionId: aflTradeContentAddressedIdSchema('pick-pav-model-execution'),
    content: z.union([legacyGovernedExecutionContentSchema, governedExecutionContentSchema]),
  })
  .strict()
  .superRefine((execution, context) => {
    addAflTradeContentAddressIssue(
      'pick-pav-model-execution',
      execution.executionId,
      execution.content,
      context,
      ['executionId']
    );
  });

export type GovernedAflTradePickPavModelExecution = z.infer<
  typeof governedAflTradePickPavModelExecutionSchema
>;

export function createGovernedAflTradePickPavModelExecution(input: {
  readonly outputs: ReturnType<typeof computeAflTradePickPavModelExecutionOutputs>;
  readonly completedAt: string;
  readonly authority: Readonly<{
    datasetId: string;
    datasetArtifact: z.input<typeof aflTradeArtifactRefSchema>;
    datasetAdmissionId: string;
    datasetAdmissionArtifact: z.input<typeof aflTradeArtifactRefSchema>;
    datasetAdmissionGateLedgerRevision: number;
    protocolId: string;
    protocolArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  }>;
}): GovernedAflTradePickPavModelExecution {
  const observationSet = aflTradePickPavObservationSetSchema.parse(input.outputs.observationSet);
  const content = governedExecutionContentSchema.parse({
    schemaVersion: 'afl-trade-pick-pav-model-execution/v3',
    authorityBoundary: AUTHORITY_BOUNDARY,
    publicationEligible: false,
    qualificationStatus: 'automated_qualification_pending',
    environment: 'non_production',
    competition: observationSet.content.competition,
    ...input.authority,
    observationSetId: observationSet.observationSetId,
    observationSetSha256: observationSet.content.observationSetSha256,
    releaseId: observationSet.content.releaseId,
    policyId: observationSet.content.policy.policyId,
    methodId: observationSet.content.policy.content.methodId,
    valueUnit: observationSet.content.policy.content.outcomeValueUnit,
    finalTestEvaluationStartedAt: input.outputs.validationConfig.evaluatedAt,
    completedAt: input.completedAt,
    observationSet,
    benchmarkConfig: input.outputs.benchmarkConfig,
    validationConfig: input.outputs.validationConfig,
    benchmark: input.outputs.benchmark,
    validationReport: input.outputs.validationReport,
    limitation: LIMITATION,
  });
  return governedAflTradePickPavModelExecutionSchema.parse({
    executionId: createAflTradeContentAddress('pick-pav-model-execution', content),
    content,
  });
}
