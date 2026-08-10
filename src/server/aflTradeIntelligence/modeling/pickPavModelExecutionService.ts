import { z } from 'zod';

import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import {
  aflTradePickPavDistributionBenchmarkConfigSchema,
  type AflTradePickPavDistributionBenchmarkConfig,
} from './pickPavDistributionBenchmark';
import {
  computeAflTradePickPavModelExecutionOutputs,
  createAflTradePickPavModelExecution,
  type AflTradePickPavModelExecution,
} from './pickPavModelExecution';
import {
  retainAflTradePickPavModelExecution,
  type AflTradePickPavModelCustodyReceipt,
} from './pickPavModelExecutionCustody';
import type { AflTradePickPavObservationRepository } from './pickPavObservationRepository';

const validationPolicySchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-pav-validation-policy/v1'),
    minimumEligibleObservations: z.number().int().positive().max(100_000),
    minimumPartitionObservations: z.number().int().positive().max(100_000),
    nominalIntervalCoverage: z.literal(0.8),
  })
  .strict();

export const aflTradePickPavModelExecutionRequestSchema = z
  .object({
    observationSetId: z.string().regex(/^pick-pav-observation-set:[a-f0-9]{64}$/),
    environment: z.literal('test_fixture'),
    benchmarkConfig: aflTradePickPavDistributionBenchmarkConfigSchema,
    validationPolicy: validationPolicySchema,
  })
  .strict();

export interface AflTradePickPavModelExecutionClock {
  now(): Promise<string>;
}

export interface AflTradePickPavModelExecutionRegistry {
  persist(input: {
    execution: AflTradePickPavModelExecution;
    custody: AflTradePickPavModelCustodyReceipt;
  }): Promise<{ idempotentReplay: boolean }>;
}

export interface AflTradePickPavModelExecutionResult {
  readonly execution: AflTradePickPavModelExecution;
  readonly custody: AflTradePickPavModelCustodyReceipt;
  readonly idempotentReplay: boolean;
}

export class AflTradePickPavModelExecutionService {
  constructor(
    private readonly dependencies: {
      observationSets: Pick<AflTradePickPavObservationRepository, 'loadFinalized'>;
      artifacts: AflTradeImmutableArtifactRepository;
      registry: AflTradePickPavModelExecutionRegistry;
      clock: AflTradePickPavModelExecutionClock;
      maximumArtifactBytes: number;
    }
  ) {
    if (
      !Number.isInteger(dependencies.maximumArtifactBytes) ||
      dependencies.maximumArtifactBytes <= 0
    ) {
      throw new TypeError('Pick-model execution requires a positive artifact byte bound.');
    }
  }

  async execute(unparsedRequest: unknown): Promise<AflTradePickPavModelExecutionResult> {
    const request = aflTradePickPavModelExecutionRequestSchema.parse(unparsedRequest);
    const observationSet = await this.dependencies.observationSets.loadFinalized(
      {
        observationSetId: request.observationSetId,
        environment: request.environment,
      },
      { environment: request.environment }
    );
    if (
      observationSet.observationSetId !== request.observationSetId ||
      observationSet.content.environment !== request.environment
    ) {
      throw new TypeError(
        'Finalized observation-set identity or environment did not match request.'
      );
    }

    const finalTestEvaluationStartedAt = await this.dependencies.clock.now();
    const outputs = computeAflTradePickPavModelExecutionOutputs({
      observationSet,
      benchmarkConfig: request.benchmarkConfig satisfies AflTradePickPavDistributionBenchmarkConfig,
      validationConfig: {
        schemaVersion: 'afl-trade-pick-pav-validation-config/v1',
        evaluatedAt: finalTestEvaluationStartedAt,
        minimumEligibleObservations: request.validationPolicy.minimumEligibleObservations,
        minimumPartitionObservations: request.validationPolicy.minimumPartitionObservations,
        nominalIntervalCoverage: request.validationPolicy.nominalIntervalCoverage,
      },
    });
    const completedAt = await this.dependencies.clock.now();
    const execution = createAflTradePickPavModelExecution({
      outputs,
      completedAt,
    });

    const custody = await retainAflTradePickPavModelExecution({
      execution,
      repository: this.dependencies.artifacts,
      clock: this.dependencies.clock,
      maximumBytes: this.dependencies.maximumArtifactBytes,
    });
    const persisted = await this.dependencies.registry.persist({ execution, custody });
    return { execution, custody, idempotentReplay: persisted.idempotentReplay };
  }
}
