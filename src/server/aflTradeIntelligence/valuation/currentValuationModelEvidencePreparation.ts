import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
} from '../artifacts/contentAddress';
import {
  aflTradeCurrentValuationModelEvidenceRequestSchema,
  type AflTradeCurrentValuationPreparedModelEvidence,
  type AflTradeCurrentValuationModelEvidenceRequest,
} from './currentValuationModelEvidence';
import { aflTradePrivateValuationDispatchRequestSchema } from './privateValuationScheduling';

const claimSchema = z
  .object({
    claimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
    leaseToken: aflTradeSha256Schema,
  })
  .strict();

const terminalPairResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.enum(['qualified', 'already_qualified', 'qualification_failed']),
      operationId: aflTradeContentAddressedIdSchema('private-valuation-model-operation'),
      attemptNumber: z.number().int().min(1).max(3),
      qualificationId: aflTradeContentAddressedIdSchema('model-qualification'),
    })
    .strict(),
  z
    .object({
      state: z.enum(['transient_failure', 'deterministic_failure', 'stale_authority']),
      operationId: aflTradeContentAddressedIdSchema('private-valuation-model-operation'),
      attemptNumber: z.number().int().min(1).max(3),
      reason: z.string().trim().min(1).max(2_000),
    })
    .strict(),
]);

export type AflTradeCurrentValuationModelEvidenceDispatch = Readonly<{
  request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>;
  claim: z.infer<typeof claimSchema>;
}>;

type Dispatch = AflTradeCurrentValuationModelEvidenceDispatch;

export type AflTradeCurrentValuationModelEvidencePreparationInput =
  AflTradeCurrentValuationModelEvidenceRequest &
    Readonly<{ operationId: string }>;

type PairResult = z.infer<typeof terminalPairResultSchema>;
type TerminalPairResult = Extract<
  PairResult,
  { readonly state: 'qualified' | 'already_qualified' | 'qualification_failed' }
>;

export class AflTradeCurrentValuationModelEvidencePreparationError extends Error {
  constructor(
    readonly state: 'transient_failure' | 'deterministic_failure' | 'stale_authority',
    readonly operationId: string,
    readonly attemptNumber: number,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeCurrentValuationModelEvidencePreparationError';
  }
}

function parseCurrent(
  input: AflTradeCurrentValuationModelEvidencePreparationInput
): AflTradeCurrentValuationModelEvidencePreparationInput {
  const { operationId, ...request } = input;
  return {
    ...aflTradeCurrentValuationModelEvidenceRequestSchema.parse(request),
    operationId: aflTradeContentAddressedIdSchema(
      'current-valuation-model-evidence-operation'
    ).parse(operationId),
  };
}

function requireMatchingTerminalEvidence(
  pair: TerminalPairResult,
  evidence: AflTradeCurrentValuationPreparedModelEvidence
): AflTradeCurrentValuationPreparedModelEvidence {
  if (
    pair.qualificationId !== evidence.qualificationId ||
    (pair.state === 'qualification_failed') !== (evidence.state === 'qualification_failed')
  ) {
    throw new TypeError(
      'Current model evidence does not match the exact retained pair qualification.'
    );
  }
  return evidence;
}

export function createAflTradeCurrentValuationModelEvidencePreparation(dependencies: {
  readonly dispatch: Dispatch;
  readonly authority: Readonly<{
    authenticate(input: {
      readonly current: AflTradeCurrentValuationModelEvidencePreparationInput;
      readonly dispatch: Dispatch;
    }): Promise<void>;
  }>;
  readonly pair: Readonly<{
    prepare(input: {
      readonly requestId: string;
      readonly claim: Dispatch['claim'];
    }): Promise<unknown>;
  }>;
  readonly evidence: Readonly<{
    load(input: {
      readonly current: AflTradeCurrentValuationModelEvidencePreparationInput;
      readonly dispatch: Dispatch;
      readonly pair: TerminalPairResult;
    }): Promise<AflTradeCurrentValuationPreparedModelEvidence>;
  }>;
}) {
  const dispatch: Dispatch = {
    request: aflTradePrivateValuationDispatchRequestSchema.parse(dependencies.dispatch.request),
    claim: claimSchema.parse(dependencies.dispatch.claim),
  };
  return {
    async prepareAndQualify(
      unparsedCurrent: AflTradeCurrentValuationModelEvidencePreparationInput
    ): Promise<AflTradeCurrentValuationPreparedModelEvidence> {
      const current = parseCurrent(unparsedCurrent);
      if (current.scopeKey !== dispatch.request.scopeKey) {
        throw new TypeError('Current model evidence and dispatch scopes do not match.');
      }
      await dependencies.authority.authenticate({ current, dispatch });
      const pair = terminalPairResultSchema.parse(
        await dependencies.pair.prepare({
          requestId: dispatch.request.requestId,
          claim: dispatch.claim,
        })
      );
      if (!('qualificationId' in pair)) {
        throw new AflTradeCurrentValuationModelEvidencePreparationError(
          pair.state,
          pair.operationId,
          pair.attemptNumber,
          pair.reason
        );
      }
      return requireMatchingTerminalEvidence(
        pair,
        await dependencies.evidence.load({ current, dispatch, pair })
      );
    },
  };
}
