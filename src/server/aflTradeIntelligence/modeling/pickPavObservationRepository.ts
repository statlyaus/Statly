import { z } from 'zod';

import {
  aflTradePickPavPolicySchema,
  type AflTradePickPavObservationSet,
  type AflTradePickPavPolicy,
} from './pickOutcomeContracts';

const addressed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}:[a-f0-9]{64}$`));
const instant = z.iso.datetime({ offset: true });

export const aflTradePickPavSelectionAccessRegistrationSchema = z
  .object({
    selectionId: addressed('draft-selection'),
    access: z.discriminatedUnion('state', [
      z
        .object({
          state: z.literal('open'),
          decision: z
            .object({
              id: addressed('review-decision'),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict(),
          recordedAt: instant,
        })
        .strict(),
      z
        .object({
          state: z.literal('restricted'),
          restriction: z.enum(['father_son_bid_match', 'academy_bid_match', 'other_restricted']),
          bidSelectionNumber: z.number().int().positive().max(500).nullable(),
          decision: z
            .object({
              id: addressed('review-decision'),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict(),
          recordedAt: instant,
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((registration, context) => {
    if (
      registration.access.decision.id !== `review-decision:${registration.access.decision.sha256}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['access', 'decision'],
        message: 'Selection-access review identity must equal its exact digest.',
      });
    }
  });

export const aflTradePickPavMaterializationRequestSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    releaseId: addressed('outcome-release'),
    policyId: addressed('pick-pav-policy'),
    knowledgeCutoffAt: instant,
  })
  .strict();

export const aflTradeFinalizedPickPavObservationSetRequestSchema = z
  .object({
    observationSetId: addressed('pick-pav-observation-set'),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
  })
  .strict();

export interface AflTradePickPavExecutionContext {
  readonly environment: 'test_fixture' | 'non_production' | 'production';
}

export interface PersistedAflTradePickPavObservationSet {
  readonly observationSet: AflTradePickPavObservationSet;
  readonly idempotentReplay: boolean;
}

export type AflTradePickPavObservationErrorCode =
  | 'INVALID_POLICY'
  | 'INVALID_ACCESS_REVIEW'
  | 'INVALID_REQUEST'
  | 'ENVIRONMENT_MISMATCH'
  | 'POLICY_NOT_CURRENT'
  | 'RELEASE_NOT_CURRENT'
  | 'SELECTION_MEMBERSHIP_INCOMPLETE'
  | 'CALCULATION_EVIDENCE_INCOMPLETE'
  | 'REPLAY_CONFLICT'
  | 'NOT_FINALIZED'
  | 'PERSISTENCE_REJECTED';

export class AflTradePickPavObservationError extends Error {
  constructor(
    readonly code: AflTradePickPavObservationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradePickPavObservationError';
  }
}

export interface AflTradePickPavObservationRepository {
  registerPolicy(
    policy: unknown,
    execution: AflTradePickPavExecutionContext
  ): Promise<AflTradePickPavPolicy>;

  registerSelectionAccess(
    registration: unknown,
    execution: AflTradePickPavExecutionContext
  ): Promise<z.infer<typeof aflTradePickPavSelectionAccessRegistrationSchema>>;

  materializeAndPersist(
    request: unknown,
    execution: AflTradePickPavExecutionContext
  ): Promise<PersistedAflTradePickPavObservationSet>;

  loadFinalized(
    request: unknown,
    execution: AflTradePickPavExecutionContext
  ): Promise<AflTradePickPavObservationSet>;
}

export function parseAflTradePickPavPolicy(input: unknown): AflTradePickPavPolicy {
  return aflTradePickPavPolicySchema.parse(input);
}
