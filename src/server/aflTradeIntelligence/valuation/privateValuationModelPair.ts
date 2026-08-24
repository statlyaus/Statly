import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

const boundedIdSchema = z.string().trim().min(1).max(400);
const claimSchema = z
  .object({
    claimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
    leaseToken: aflTradeSha256Schema,
  })
  .strict();
const modelTargetSchema = z
  .object({
    modelId: boundedIdSchema,
    modelVersion: boundedIdSchema,
    protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
  })
  .strict();
const pickModelTargetSchema = modelTargetSchema
  .omit({ modelId: true, modelVersion: true })
  .extend({ policyId: aflTradeContentAddressedIdSchema('pick-pav-policy') })
  .strict();

export const aflTradePrivateValuationModelOperationContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-private-valuation-model-operation/v1'),
    scopeKey: boundedIdSchema,
    factualValuesSha256: aflTradeSha256Schema,
    hpnValuesSha256: aflTradeSha256Schema,
    hpnMethodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    player: modelTargetSchema,
    pick: pickModelTargetSchema,
    qualificationPolicyId: aflTradeContentAddressedIdSchema('model-qualification-policy'),
  })
  .strict();

export const aflTradePrivateValuationModelOperationSchema = z
  .object({
    operationId: aflTradeContentAddressedIdSchema('private-valuation-model-operation'),
    content: aflTradePrivateValuationModelOperationContentSchema,
  })
  .strict()
  .superRefine((operation, context) => {
    addAflTradeContentAddressIssue(
      'private-valuation-model-operation',
      operation.operationId,
      operation.content,
      context,
      ['operationId']
    );
  });

export type AflTradePrivateValuationModelOperation = z.infer<
  typeof aflTradePrivateValuationModelOperationSchema
>;

export function createAflTradePrivateValuationModelOperation(
  input: Omit<z.input<typeof aflTradePrivateValuationModelOperationContentSchema>, 'schemaVersion'>
): AflTradePrivateValuationModelOperation {
  const content = aflTradePrivateValuationModelOperationContentSchema.parse({
    schemaVersion: 'afl-trade-private-valuation-model-operation/v1',
    ...input,
  });
  return aflTradePrivateValuationModelOperationSchema.parse({
    operationId: createAflTradeContentAddress('private-valuation-model-operation', content),
    content,
  });
}

const substantiveInputSchema = aflTradePrivateValuationModelOperationContentSchema.omit({
  schemaVersion: true,
  scopeKey: true,
});

export const aflTradePrivateValuationModelPairExactInputSchema = z
  .object({
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    scopeKey: boundedIdSchema,
    factualOutputId: aflTradeContentAddressedIdSchema('private-valuation-factual-output'),
    hpnCalculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
    substantive: substantiveInputSchema,
  })
  .strict();

export type AflTradePrivateValuationModelPairExactInput = z.infer<
  typeof aflTradePrivateValuationModelPairExactInputSchema
>;

export interface AflTradePrivateValuationModelOperationState {
  readonly operation: AflTradePrivateValuationModelOperation;
  readonly attemptNumber: number;
  readonly playerRunId: string | null;
  readonly pickRunId: string | null;
  readonly pairAccepted: boolean;
  readonly qualificationId: string | null;
  readonly qualificationOutcome: 'qualified' | 'failed' | null;
}

type Claim = z.infer<typeof claimSchema>;

export interface AflTradePrivateValuationModelPairRepository {
  bindInput(input: {
    readonly exactInput: AflTradePrivateValuationModelPairExactInput;
    readonly claim: Claim;
  }): Promise<AflTradePrivateValuationModelOperationState>;
  acceptComponent(input: {
    readonly operationId: string;
    readonly role: 'player' | 'pick';
    readonly runId: string;
    readonly claim: Claim;
  }): Promise<AflTradePrivateValuationModelOperationState>;
  acceptPair(input: {
    readonly operationId: string;
    readonly playerRunId: string;
    readonly pickRunId: string;
    readonly claim: Claim;
  }): Promise<AflTradePrivateValuationModelOperationState>;
  bindQualification(input: {
    readonly operationId: string;
    readonly qualificationId: string;
    readonly outcome: 'qualified' | 'failed';
    readonly claim: Claim;
  }): Promise<AflTradePrivateValuationModelOperationState>;
}

type ComponentExecutionResult =
  | Readonly<{ state: 'completed'; runId: string }>
  | Readonly<{
      state: 'transient_failure' | 'deterministic_failure' | 'stale_authority';
      reason: string;
    }>;
type QualificationExecutionResult =
  | Readonly<{
      qualificationId: string;
      outcome: 'qualified' | 'failed';
    }>
  | Readonly<{
      state: 'transient_failure' | 'deterministic_failure' | 'stale_authority';
      reason: string;
    }>;

function parseState(
  state: AflTradePrivateValuationModelOperationState
): AflTradePrivateValuationModelOperationState {
  const operation = aflTradePrivateValuationModelOperationSchema.parse(state.operation);
  const attemptNumber = z.number().int().min(1).max(3).parse(state.attemptNumber);
  const playerRunId = z
    .union([aflTradeContentAddressedIdSchema('model-run'), z.null()])
    .parse(state.playerRunId);
  const pickRunId = z
    .union([aflTradeContentAddressedIdSchema('model-run'), z.null()])
    .parse(state.pickRunId);
  const qualificationId = z
    .union([aflTradeContentAddressedIdSchema('model-qualification'), z.null()])
    .parse(state.qualificationId);
  const qualificationOutcome = z
    .union([z.enum(['qualified', 'failed']), z.null()])
    .parse(state.qualificationOutcome);
  if (
    (state.pairAccepted && (playerRunId === null || pickRunId === null)) ||
    (qualificationId === null) !== (qualificationOutcome === null) ||
    (qualificationId !== null && !state.pairAccepted)
  ) {
    throw new TypeError('Private valuation model-pair custody is inconsistent.');
  }
  return {
    operation,
    attemptNumber,
    playerRunId,
    pickRunId,
    pairAccepted: state.pairAccepted,
    qualificationId,
    qualificationOutcome,
  };
}

export function createAflTradePrivateValuationModelPairCoordinator(dependencies: {
  readonly prepareExactInput: (input: {
    readonly requestId: string;
    readonly claim: Claim;
  }) => Promise<AflTradePrivateValuationModelPairExactInput>;
  readonly repository: AflTradePrivateValuationModelPairRepository;
  readonly executePlayer: (input: {
    readonly exactInput: AflTradePrivateValuationModelPairExactInput;
    readonly operation: AflTradePrivateValuationModelOperation;
    readonly attemptNumber: number;
    readonly claim: Claim;
  }) => Promise<ComponentExecutionResult>;
  readonly executePick: (input: {
    readonly exactInput: AflTradePrivateValuationModelPairExactInput;
    readonly operation: AflTradePrivateValuationModelOperation;
    readonly attemptNumber: number;
    readonly claim: Claim;
  }) => Promise<ComponentExecutionResult>;
  readonly qualify: (input: {
    readonly exactInput: AflTradePrivateValuationModelPairExactInput;
    readonly operation: AflTradePrivateValuationModelOperation;
    readonly playerRunId: string;
    readonly pickRunId: string;
    readonly claim: Claim;
  }) => Promise<QualificationExecutionResult>;
}) {
  return {
    async prepare(input: { readonly requestId: string; readonly claim: Claim }) {
      const requestId = aflTradeContentAddressedIdSchema('private-valuation-dispatch').parse(
        input.requestId
      );
      const claim = claimSchema.parse(input.claim);
      const exactInput = aflTradePrivateValuationModelPairExactInputSchema.parse(
        await dependencies.prepareExactInput({ requestId, claim })
      );
      if (exactInput.requestId !== requestId) {
        throw new TypeError('Private model input belongs to another dispatch request.');
      }
      let state = parseState(await dependencies.repository.bindInput({ exactInput, claim }));
      const operationId = state.operation.operationId;
      if (state.qualificationId !== null) {
        return {
          state:
            state.qualificationOutcome === 'qualified'
              ? ('already_qualified' as const)
              : ('qualification_failed' as const),
          operationId,
          attemptNumber: state.attemptNumber,
          qualificationId: state.qualificationId,
        };
      }

      for (const role of ['player', 'pick'] as const) {
        const retainedRunId = role === 'player' ? state.playerRunId : state.pickRunId;
        if (retainedRunId !== null) continue;
        const execution = await (
          role === 'player' ? dependencies.executePlayer : dependencies.executePick
        )({
          exactInput,
          operation: state.operation,
          attemptNumber: state.attemptNumber,
          claim,
        });
        if (execution.state !== 'completed') {
          return {
            state: execution.state,
            operationId,
            attemptNumber: state.attemptNumber,
            reason: execution.reason,
          };
        }
        const runId = aflTradeContentAddressedIdSchema('model-run').parse(execution.runId);
        state = parseState(
          await dependencies.repository.acceptComponent({
            operationId,
            role,
            runId,
            claim,
          })
        );
      }

      if (state.playerRunId === null || state.pickRunId === null) {
        throw new TypeError('Private valuation pair is missing a retained component.');
      }
      const playerRunId = state.playerRunId;
      const pickRunId = state.pickRunId;
      if (!state.pairAccepted) {
        state = parseState(
          await dependencies.repository.acceptPair({
            operationId,
            playerRunId,
            pickRunId,
            claim,
          })
        );
      }
      const qualificationExecution = await dependencies.qualify({
        exactInput,
        operation: state.operation,
        playerRunId,
        pickRunId,
        claim,
      });
      if ('state' in qualificationExecution) {
        return {
          state: qualificationExecution.state,
          operationId,
          attemptNumber: state.attemptNumber,
          reason: qualificationExecution.reason,
        };
      }
      const qualification = z
        .object({
          qualificationId: aflTradeContentAddressedIdSchema('model-qualification'),
          outcome: z.enum(['qualified', 'failed']),
        })
        .strict()
        .parse(qualificationExecution);
      state = parseState(
        await dependencies.repository.bindQualification({
          operationId,
          qualificationId: qualification.qualificationId,
          outcome: qualification.outcome,
          claim,
        })
      );
      return {
        state:
          state.qualificationOutcome === 'qualified'
            ? ('qualified' as const)
            : ('qualification_failed' as const),
        operationId,
        attemptNumber: state.attemptNumber,
        qualificationId: state.qualificationId!,
      };
    },
  };
}
