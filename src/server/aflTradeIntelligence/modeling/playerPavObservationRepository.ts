import { z } from 'zod';

import {
  aflTradePlayerPavPolicySchema,
  type AflTradePlayerPavObservationSet,
  type AflTradePlayerPavPolicy,
} from './playerPavObservationContracts';

const addressed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}:[a-f0-9]{64}$`));
const instant = z.iso.datetime({ offset: true });

export const aflTradePlayerPavMaterializationRequestSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    releaseId: addressed('outcome-release'),
    policyId: addressed('player-pav-policy'),
    knowledgeCutoffAt: instant,
  })
  .strict();

export const aflTradeFinalizedPlayerPavObservationSetRequestSchema = z
  .object({
    observationSetId: addressed('player-pav-observation-set'),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
  })
  .strict();

export interface AflTradePlayerPavExecutionContext {
  readonly environment: 'test_fixture' | 'non_production' | 'production';
}

export interface PersistedAflTradePlayerPavObservationSet {
  readonly observationSet: AflTradePlayerPavObservationSet;
  readonly idempotentReplay: boolean;
}

export type AflTradePlayerPavObservationErrorCode =
  | 'INVALID_POLICY'
  | 'INVALID_REQUEST'
  | 'ENVIRONMENT_MISMATCH'
  | 'POLICY_NOT_CURRENT'
  | 'RELEASE_NOT_CURRENT'
  | 'SPELL_MEMBERSHIP_INCOMPLETE'
  | 'CALCULATION_EVIDENCE_INCOMPLETE'
  | 'REPLAY_CONFLICT'
  | 'NOT_FINALIZED'
  | 'PERSISTENCE_REJECTED';

export class AflTradePlayerPavObservationError extends Error {
  constructor(
    readonly code: AflTradePlayerPavObservationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradePlayerPavObservationError';
  }
}

/**
 * Owns the complete factual-release-to-player-observation materialization seam. Callers select only
 * the reviewed release, policy and knowledge cutoff; adapters derive spell and PAV membership from
 * durable authority rather than accepting caller-authored football values.
 */
export interface AflTradePlayerPavObservationRepository {
  registerPolicy(
    policy: unknown,
    execution: AflTradePlayerPavExecutionContext
  ): Promise<AflTradePlayerPavPolicy>;

  materializeAndPersist(
    request: unknown,
    execution: AflTradePlayerPavExecutionContext
  ): Promise<PersistedAflTradePlayerPavObservationSet>;

  loadFinalized(
    request: unknown,
    execution: AflTradePlayerPavExecutionContext
  ): Promise<AflTradePlayerPavObservationSet>;
}

export function parseAflTradePlayerPavPolicy(input: unknown): AflTradePlayerPavPolicy {
  return aflTradePlayerPavPolicySchema.parse(input);
}
