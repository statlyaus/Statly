import { z } from 'zod';

import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import {
  type AflTradeFinalizedHpnPavCalculation,
  type AflTradeFinalizedHpnPavCalculationRequest,
} from './hpnPavCalculationService';
import type { AflTradeHpnPavInputExecutionContext } from './hpnPavInputRepository';
import type { AflTradeHpnPavMethod } from './hpnPlayerApproximateValue';

export const aflTradeFinalizedHpnPavCalculationLoadRequestSchema = z
  .object({
    calculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
  })
  .strict();

export type AflTradeFinalizedHpnPavCalculationLoadRequest = z.infer<
  typeof aflTradeFinalizedHpnPavCalculationLoadRequestSchema
>;

export interface PersistedAflTradeFinalizedHpnPavCalculation {
  readonly calculation: AflTradeFinalizedHpnPavCalculation;
  readonly idempotentReplay: boolean;
}

export type AflTradeHpnPavCalculationErrorCode =
  | 'INVALID_METHOD'
  | 'INVALID_REQUEST'
  | 'ENVIRONMENT_MISMATCH'
  | 'METHOD_AUTHORITY_MISMATCH'
  | 'INPUT_AUTHORITY_MISMATCH'
  | 'CALCULATION_NOT_FINALIZED'
  | 'REPLAY_CONFLICT'
  | 'PERSISTENCE_REJECTED';

export class AflTradeHpnPavCalculationError extends Error {
  constructor(
    readonly code: AflTradeHpnPavCalculationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeHpnPavCalculationError';
  }
}

export interface AflTradeHpnPavCalculationRepository {
  registerMethod(
    method: unknown,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<AflTradeHpnPavMethod>;

  calculateAndPersist(
    request: AflTradeFinalizedHpnPavCalculationRequest,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<PersistedAflTradeFinalizedHpnPavCalculation>;

  loadFinalizedCalculation(
    request: AflTradeFinalizedHpnPavCalculationLoadRequest,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<AflTradeFinalizedHpnPavCalculation>;
}
