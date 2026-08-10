import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradePickPavObservationSetSchema } from './pickOutcomeContracts';
import {
  aflTradePickPavDistributionBenchmarkConfigSchema,
  aflTradePickPavDistributionBenchmarkSchema,
  fitAflTradePickPavDistributionBenchmark,
  type AflTradePickPavDistributionBenchmarkConfig,
} from './pickPavDistributionBenchmark';
import {
  aflTradePickPavValidationConfigSchema,
  aflTradePickPavValidationReportSchema,
  validateAflTradePickPavDistributionBenchmark,
  type AflTradePickPavValidationConfig,
} from './pickPavDistributionValidation';

export const AFL_TRADE_PICK_PAV_MODEL_EXECUTION_SCHEMA_VERSION =
  'afl-trade-pick-pav-model-execution/v1' as const;
export const AFL_TRADE_PICK_PAV_MODEL_EXECUTION_AUTHORITY_BOUNDARY =
  'test_fixture_development_experiment_not_candidate_lock_gate_3_approval_grade_publication_or_fantasy_ownership' as const;

const isoInstant = z.iso.datetime({ offset: true });

const executionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PICK_PAV_MODEL_EXECUTION_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PICK_PAV_MODEL_EXECUTION_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    approvalStatus: z.literal('development_only_not_eligible_for_gate_3'),
    environment: z.literal('test_fixture'),
    competition: z.literal('AFLM'),
    observationSetId: z.string().regex(/^pick-pav-observation-set:[a-f0-9]{64}$/),
    observationSetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    releaseId: z.string().regex(/^outcome-release:[a-f0-9]{64}$/),
    policyId: z.string().regex(/^pick-pav-policy:[a-f0-9]{64}$/),
    methodId: z.string().regex(/^hpn-pav-method:[a-f0-9]{64}$/),
    valueUnit: z.literal('fixed_horizon_pav'),
    finalTestEvaluationStartedAt: isoInstant,
    completedAt: isoInstant,
    observationSet: aflTradePickPavObservationSetSchema,
    benchmarkConfig: aflTradePickPavDistributionBenchmarkConfigSchema,
    validationConfig: aflTradePickPavValidationConfigSchema,
    benchmark: aflTradePickPavDistributionBenchmarkSchema,
    validationReport: aflTradePickPavValidationReportSchema,
    limitation: z.literal(
      'This retained execution is private model evidence, not Gate 3 approval, a trade grade, or public numerical authority.'
    ),
  })
  .strict()
  .superRefine((execution, context) => {
    const observationSet = execution.observationSet;
    if (
      execution.observationSetId !== observationSet.observationSetId ||
      execution.observationSetSha256 !== observationSet.content.observationSetSha256 ||
      execution.environment !== observationSet.content.environment ||
      execution.competition !== observationSet.content.competition ||
      execution.releaseId !== observationSet.content.releaseId ||
      execution.policyId !== observationSet.content.policy.policyId ||
      execution.methodId !== observationSet.content.policy.content.methodId ||
      execution.valueUnit !== observationSet.content.policy.content.outcomeValueUnit
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationSet'],
        message: 'Execution ancestry must exactly match the retained observation set.',
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
        message:
          'Final-test evaluation must start after observation creation and finish before completion.',
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
          message:
            'Execution must retain the exact fitted benchmark and validation report derived from its observation set.',
        });
      }
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['benchmark'],
        message:
          error instanceof Error
            ? error.message
            : 'Execution outputs could not be re-derived from their inputs.',
      });
    }
  });

export const aflTradePickPavModelExecutionSchema = z
  .object({
    executionId: z.string().regex(/^pick-pav-model-execution:[a-f0-9]{64}$/),
    content: executionContentSchema,
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

export type AflTradePickPavModelExecution = z.infer<typeof aflTradePickPavModelExecutionSchema>;

export function computeAflTradePickPavModelExecutionOutputs(input: {
  observationSet: unknown;
  benchmarkConfig: AflTradePickPavDistributionBenchmarkConfig;
  validationConfig: AflTradePickPavValidationConfig;
}) {
  const observationSet = aflTradePickPavObservationSetSchema.parse(input.observationSet);
  const benchmarkConfig = aflTradePickPavDistributionBenchmarkConfigSchema.parse(
    input.benchmarkConfig
  );
  const validationConfig = aflTradePickPavValidationConfigSchema.parse(input.validationConfig);
  const benchmark = fitAflTradePickPavDistributionBenchmark(observationSet, benchmarkConfig);
  const validationReport = validateAflTradePickPavDistributionBenchmark(
    observationSet,
    benchmark,
    validationConfig
  );
  return { observationSet, benchmarkConfig, validationConfig, benchmark, validationReport };
}

export function createAflTradePickPavModelExecution(input: {
  outputs: ReturnType<typeof computeAflTradePickPavModelExecutionOutputs>;
  completedAt: string;
}): AflTradePickPavModelExecution {
  const observationSet = aflTradePickPavObservationSetSchema.parse(input.outputs.observationSet);
  const benchmarkConfig = aflTradePickPavDistributionBenchmarkConfigSchema.parse(
    input.outputs.benchmarkConfig
  );
  const validationConfig = aflTradePickPavValidationConfigSchema.parse(
    input.outputs.validationConfig
  );
  const benchmark = aflTradePickPavDistributionBenchmarkSchema.parse(input.outputs.benchmark);
  const validationReport = aflTradePickPavValidationReportSchema.parse(
    input.outputs.validationReport
  );
  const content = executionContentSchema.parse({
    schemaVersion: AFL_TRADE_PICK_PAV_MODEL_EXECUTION_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PICK_PAV_MODEL_EXECUTION_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    approvalStatus: 'development_only_not_eligible_for_gate_3',
    environment: observationSet.content.environment,
    competition: observationSet.content.competition,
    observationSetId: observationSet.observationSetId,
    observationSetSha256: observationSet.content.observationSetSha256,
    releaseId: observationSet.content.releaseId,
    policyId: observationSet.content.policy.policyId,
    methodId: observationSet.content.policy.content.methodId,
    valueUnit: observationSet.content.policy.content.outcomeValueUnit,
    finalTestEvaluationStartedAt: validationConfig.evaluatedAt,
    completedAt: input.completedAt,
    observationSet,
    benchmarkConfig,
    validationConfig,
    benchmark,
    validationReport,
    limitation:
      'This retained execution is private model evidence, not Gate 3 approval, a trade grade, or public numerical authority.',
  });
  return aflTradePickPavModelExecutionSchema.parse({
    executionId: createAflTradeContentAddress('pick-pav-model-execution', content),
    content,
  });
}
