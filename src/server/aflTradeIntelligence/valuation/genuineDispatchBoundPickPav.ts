import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import { aflTradePickPavObservationSetSchema } from '../modeling/pickOutcomeContracts';
import {
  aflTradePickPavDistributionBenchmarkConfigSchema,
  type AflTradePickPavDistributionBenchmarkConfig,
} from '../modeling/pickPavDistributionBenchmark';
import { computeAflTradePickPavModelExecutionOutputs } from '../modeling/pickPavModelExecution';
import {
  aflTradePickPavValidationConfigSchema,
  type AflTradePickPavValidationConfig,
} from '../modeling/pickPavDistributionValidation';
import {
  aflTradePrivateValuationModelOperationSchema,
  aflTradePrivateValuationModelPairExactInputSchema,
  createAflTradePrivateValuationModelOperation,
} from './privateValuationModelPair';

const instantSchema = z.iso.datetime({ offset: true });

const executionInputSchema = z
  .object({
    exactInput: aflTradePrivateValuationModelPairExactInputSchema,
    operation: aflTradePrivateValuationModelOperationSchema,
    attemptNumber: z.number().int().min(1).max(3),
    claim: z
      .object({
        claimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
        leaseToken: aflTradeSha256Schema,
      })
      .strict(),
  })
  .strict();

export type GenuineDispatchBoundPickPavExecutionInput = z.infer<typeof executionInputSchema>;

export function parseGenuineDispatchBoundPickPavExecutionInput(
  unparsedExecution: unknown
): GenuineDispatchBoundPickPavExecutionInput {
  const execution = executionInputSchema.parse(unparsedExecution);
  const expectedOperation = createAflTradePrivateValuationModelOperation({
    scopeKey: execution.exactInput.scopeKey,
    ...execution.exactInput.substantive,
  });
  if (
    canonicalizeAflTradeJson(expectedOperation) !== canonicalizeAflTradeJson(execution.operation)
  ) {
    throw new TypeError('Dispatch-bound pick-PAV operation is not content-address authentic.');
  }
  return execution;
}

const exactAuthoritySchema = z
  .object({
    observationSet: aflTradePickPavObservationSetSchema,
    authority: z
      .object({
        datasetId: aflTradeContentAddressedIdSchema('dataset'),
        datasetArtifact: aflTradeArtifactRefSchema,
        datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
        datasetAdmissionArtifact: aflTradeArtifactRefSchema,
        datasetAdmissionGateLedgerRevision: z.number().int().positive(),
        protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
        protocolArtifact: aflTradeArtifactRefSchema,
      })
      .strict(),
    benchmarkConfig: aflTradePickPavDistributionBenchmarkConfigSchema,
    validationConfig: aflTradePickPavValidationConfigSchema,
    completedAt: instantSchema,
    registeredAt: instantSchema,
  })
  .strict();

export type GenuineDispatchBoundPickPavAuthority = z.infer<typeof exactAuthoritySchema>;

function requireExactTarget(
  execution: GenuineDispatchBoundPickPavExecutionInput,
  retained: GenuineDispatchBoundPickPavAuthority
): void {
  const target = execution.operation.content.pick;
  const observation = retained.observationSet.content;
  if (
    retained.authority.datasetId !== target.datasetId ||
    retained.authority.datasetAdmissionId !== target.datasetAdmissionId ||
    retained.authority.protocolId !== target.protocolId ||
    observation.policy.policyId !== target.policyId ||
    observation.policy.content.methodId !== execution.operation.content.hpnMethodId
  ) {
    throw new TypeError('Genuine pick-PAV authority does not match the dispatch-bound target.');
  }
}

export function createGenuineDispatchBoundPickPavRunner(dependencies: {
  readonly loadExactAuthority: (
    execution: GenuineDispatchBoundPickPavExecutionInput
  ) => Promise<GenuineDispatchBoundPickPavAuthority>;
}) {
  return async (unparsedExecution: GenuineDispatchBoundPickPavExecutionInput) => {
    const execution = parseGenuineDispatchBoundPickPavExecutionInput(unparsedExecution);
    const retained = exactAuthoritySchema.parse(await dependencies.loadExactAuthority(execution));
    requireExactTarget(execution, retained);
    return {
      outputs: computeAflTradePickPavModelExecutionOutputs({
        observationSet: retained.observationSet,
        benchmarkConfig: retained.benchmarkConfig as AflTradePickPavDistributionBenchmarkConfig,
        validationConfig: retained.validationConfig as AflTradePickPavValidationConfig,
      }),
      completedAt: retained.completedAt,
      registeredAt: retained.registeredAt,
      authority: retained.authority,
    };
  };
}
