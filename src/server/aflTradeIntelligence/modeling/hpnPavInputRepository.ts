import { z } from 'zod';

import type { AflTradeHpnPavFieldMap, AflTradeHpnPavSeasonInputSet } from './hpnPavInputContracts';

const contentAddressedId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}:[a-f0-9]{64}$`));

const sourceSelectionSchema = z
  .object({
    normalizationRunId: contentAddressedId('provider-normalization-run'),
    fieldMapId: contentAddressedId('hpn-pav-field-map'),
    inputKind: z.enum(['completed_match_result', 'player_match_stats']),
    role: z.enum(['primary', 'corroborating']).nullable(),
  })
  .strict()
  .superRefine((source, context) => {
    if (
      (source.inputKind === 'completed_match_result' && source.role !== null) ||
      (source.inputKind === 'player_match_stats' && source.role === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['role'],
        message: 'Only player-stat sources have a primary or corroborating role.',
      });
    }
  });

export const aflTradeHpnPavSeasonInputRequestSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    seasonYear: z.number().int().min(1998).max(2200),
    methodId: contentAddressedId('hpn-pav-method'),
    factualRunId: contentAddressedId('factual-reconciliation-run'),
    effectiveThrough: z.iso.datetime({ offset: true }),
    sources: z.array(sourceSelectionSchema).min(3).max(100),
  })
  .strict()
  .superRefine((request, context) => {
    const runIds = request.sources.map(({ normalizationRunId }) => normalizationRunId);
    if (new Set(runIds).size !== runIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Source runs must be unique.',
      });
    }
    if (
      request.sources.filter(({ inputKind }) => inputKind === 'completed_match_result').length !==
        1 ||
      !request.sources.some(({ role }) => role === 'primary') ||
      !request.sources.some(({ role }) => role === 'corroborating')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'One result run plus primary and corroborating player-stat runs are required.',
      });
    }
  });

export type AflTradeHpnPavSeasonInputRequest = z.infer<
  typeof aflTradeHpnPavSeasonInputRequestSchema
>;

export interface AflTradeHpnPavInputExecutionContext {
  readonly environment: 'test_fixture' | 'non_production' | 'production';
}

export interface PersistedAflTradeHpnPavInputSet {
  readonly inputSet: AflTradeHpnPavSeasonInputSet;
  readonly idempotentReplay: boolean;
}

export const aflTradeFinalizedHpnPavInputSetRequestSchema = z
  .object({
    inputSetId: contentAddressedId('hpn-pav-input-set'),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    seasonYear: z.number().int().min(1998).max(2200),
    methodId: contentAddressedId('hpn-pav-method'),
  })
  .strict();

export type AflTradeFinalizedHpnPavInputSetRequest = z.infer<
  typeof aflTradeFinalizedHpnPavInputSetRequestSchema
>;

export type AflTradeHpnPavInputErrorCode =
  | 'INVALID_FIELD_MAP'
  | 'INVALID_REQUEST'
  | 'ENVIRONMENT_MISMATCH'
  | 'FIELD_MAP_REJECTED'
  | 'SOURCE_AUTHORITY_MISMATCH'
  | 'FACTUAL_UNIVERSE_MISMATCH'
  | 'INPUT_SET_NOT_FINALIZED'
  | 'INCOMPLETE_SOURCE_ROWS'
  | 'RESOLUTION_NOT_CURRENT'
  | 'REPLAY_CONFLICT'
  | 'PERSISTENCE_REJECTED';

export class AflTradeHpnPavInputError extends Error {
  constructor(
    readonly code: AflTradeHpnPavInputErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeHpnPavInputError';
  }
}

export interface AflTradeHpnPavInputRepository {
  registerFieldMap(
    input: unknown,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<AflTradeHpnPavFieldMap>;

  buildAndPersistSeasonInputSet(
    input: unknown,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<PersistedAflTradeHpnPavInputSet>;

  loadFinalizedSeasonInputSet(
    input: unknown,
    execution: AflTradeHpnPavInputExecutionContext
  ): Promise<AflTradeHpnPavSeasonInputSet>;
}
