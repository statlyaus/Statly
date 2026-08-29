import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeCurrentValuationRefreshRequestSchema,
  aflTradeCurrentValuationRefreshResultSchema,
  type AflTradeCurrentValuationRefreshRequest,
  type AflTradeCurrentValuationRefreshResult,
} from './currentValuationRefresh';

export const AFL_TRADE_CURRENT_VALUATION_EVIDENCE_ORCHESTRATION_RESULT_SCHEMA_VERSION =
  'afl-current-valuation-evidence-orchestration-result-v1' as const;
export const AFL_TRADE_CURRENT_VALUATION_EVIDENCE_ORCHESTRATION_LIMITATION =
  'Private local non-production evidence orchestration only; human review, public release, production activation, and publication authority are not granted.' as const;

const instantSchema = z.iso.datetime({ offset: true });
const resultBaseShape = {
  schemaVersion: z.literal(
    AFL_TRADE_CURRENT_VALUATION_EVIDENCE_ORCHESTRATION_RESULT_SCHEMA_VERSION
  ),
  operationId: aflTradeContentAddressedIdSchema(
    'current-valuation-evidence-orchestration-operation'
  ),
  scopeKey: aflTradeCurrentValuationRefreshRequestSchema.shape.scopeKey,
  trigger: aflTradeCurrentValuationRefreshRequestSchema.shape.trigger,
  stableOperationKey: aflTradeCurrentValuationRefreshRequestSchema.shape.stableOperationKey,
  capturedAt: instantSchema,
  completedAt: instantSchema,
  executionLocation: z.literal('local'),
  visibility: z.literal('private'),
  environment: z.literal('non_production'),
  publicationEligible: z.literal(false),
  publicationProhibited: z.literal(true),
  limitation: z.literal(AFL_TRADE_CURRENT_VALUATION_EVIDENCE_ORCHESTRATION_LIMITATION),
} as const;

export const aflTradeCurrentValuationEvidenceOrchestrationResultSchema = z
  .discriminatedUnion('state', [
    z
      .object({
        ...resultBaseShape,
        state: z.literal('unavailable'),
        stage: z.enum([
          'capture_authority',
          'capture',
          'normalization_authority',
          'normalization',
          'reconciliation_authority',
          'reconciliation',
          'reviewed_authority',
        ]),
        cause: z.enum(['missing', 'stale', 'mismatched', 'unauthenticated', 'review_required']),
      })
      .strict(),
    z
      .object({
        ...resultBaseShape,
        state: z.literal('complete'),
        stage: z.literal('private_factual_authority'),
        cause: z.undefined().optional(),
        currentValuationRefresh: aflTradeCurrentValuationRefreshResultSchema,
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    if (
      result.state === 'unavailable' &&
      result.cause === 'review_required' &&
      result.stage !== 'reviewed_authority'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cause'],
        message: 'Human review is required only at the reviewed-authority boundary.',
      });
    }
    if (Date.parse(result.completedAt) < Date.parse(result.capturedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Evidence orchestration cannot complete before its authority capture.',
      });
    }
  });

export type AflTradeCurrentValuationEvidenceOrchestrationResult = z.infer<
  typeof aflTradeCurrentValuationEvidenceOrchestrationResultSchema
>;

export const AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES = [
  ...[2021, 2022, 2023, 2024, 2025].map((seasonYear) => ({
    sourceKey: `afl_tables:afl-tables-player-stats:${seasonYear}`,
    provider: 'afl_tables' as const,
    capabilityId: 'afl-tables-player-stats' as const,
    seasonYear,
  })),
  {
    sourceKey: 'official_afl:official-afl-player-stats:2026',
    provider: 'official_afl' as const,
    capabilityId: 'official-afl-player-stats' as const,
    seasonYear: 2026,
  },
  {
    sourceKey: 'afl_tables:afl-tables-results:2026',
    provider: 'afl_tables' as const,
    capabilityId: 'afl-tables-results' as const,
    seasonYear: 2026,
  },
] as const;

export type AflTradeCurrentValuationEvidenceSource =
  (typeof AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES)[number];

export function createAflTradeCurrentValuationEvidenceFactualHandoffKey(
  request: AflTradeCurrentValuationRefreshRequest
): string {
  return createAflTradeContentAddress('current-valuation-evidence-factual-handoff', {
    scopeKey: request.scopeKey,
    trigger: request.trigger,
    stableOperationKey: request.stableOperationKey,
  });
}

export type AflTradeCurrentValuationEvidenceUnavailable = Readonly<{
  stage:
    | 'capture_authority'
    | 'capture'
    | 'normalization_authority'
    | 'normalization'
    | 'reconciliation_authority'
    | 'reconciliation'
    | 'reviewed_authority';
  cause: 'missing' | 'stale' | 'mismatched' | 'unauthenticated' | 'review_required';
}>;

export type AflTradeCurrentValuationNormalizedSource = Readonly<{
  state: 'ready';
  sourceKey: string;
  captureId: string;
  normalizationRunId: string;
}>;

export interface AflTradeCurrentValuationEvidenceOrchestrationRepository {
  loadOperation(request: AflTradeCurrentValuationRefreshRequest): Promise<{
    readonly terminalResult: AflTradeCurrentValuationEvidenceOrchestrationResult | null;
    readonly retainedSourceKeys: readonly string[];
  }>;
  retainNormalizedSource(
    input: AflTradeCurrentValuationNormalizedSource & {
      readonly request: AflTradeCurrentValuationRefreshRequest;
    }
  ): Promise<void>;
  retainUnavailable(
    request: AflTradeCurrentValuationRefreshRequest,
    unavailable: AflTradeCurrentValuationEvidenceUnavailable
  ): Promise<AflTradeCurrentValuationEvidenceOrchestrationResult>;
  retainComplete(
    request: AflTradeCurrentValuationRefreshRequest,
    factualRefresh: AflTradeCurrentValuationRefreshResult
  ): Promise<AflTradeCurrentValuationEvidenceOrchestrationResult>;
}

export interface AflTradeCurrentValuationEvidenceSourceRuntime {
  ensureCurrent(
    source: AflTradeCurrentValuationEvidenceSource
  ): Promise<
    | AflTradeCurrentValuationNormalizedSource
    | ({ readonly state: 'unavailable' } & AflTradeCurrentValuationEvidenceUnavailable)
  >;
}

export interface AflTradeCurrentValuationReviewedAuthority {
  assessCurrent(input: {
    readonly valuationScopeKey: string;
  }): Promise<
    | { readonly state: 'ready' }
    | ({ readonly state: 'unavailable' } & AflTradeCurrentValuationEvidenceUnavailable)
  >;
}

export interface AflTradeCurrentValuationReconciliationAuthority {
  assessCurrent(): Promise<
    | { readonly state: 'ready' }
    | ({ readonly state: 'unavailable' } & AflTradeCurrentValuationEvidenceUnavailable)
  >;
}

export interface AflTradeCurrentValuationEvidenceOrchestration {
  refreshCurrent(
    request: AflTradeCurrentValuationRefreshRequest
  ): Promise<AflTradeCurrentValuationEvidenceOrchestrationResult>;
}

export function createAflTradeCurrentValuationEvidenceCoordinator(dependencies: {
  readonly repository: AflTradeCurrentValuationEvidenceOrchestrationRepository;
  readonly source: AflTradeCurrentValuationEvidenceSourceRuntime;
  readonly reconciliationAuthority: AflTradeCurrentValuationReconciliationAuthority;
  readonly reviewedAuthority: AflTradeCurrentValuationReviewedAuthority;
  readonly factualRefresh: {
    refreshCurrent(
      request: AflTradeCurrentValuationRefreshRequest
    ): Promise<AflTradeCurrentValuationRefreshResult>;
  };
}): AflTradeCurrentValuationEvidenceOrchestration {
  return {
    async refreshCurrent(unparsedRequest) {
      const request = aflTradeCurrentValuationRefreshRequestSchema.parse(unparsedRequest);
      const retained = await dependencies.repository.loadOperation(request);
      if (retained.terminalResult !== null) return retained.terminalResult;
      const retainedSourceKeys = new Set(retained.retainedSourceKeys);
      for (const source of AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES) {
        if (retainedSourceKeys.has(source.sourceKey)) continue;
        const result = await dependencies.source.ensureCurrent(source);
        if (result.state === 'unavailable') {
          return dependencies.repository.retainUnavailable(request, {
            stage: result.stage,
            cause: result.cause,
          });
        }
        if (result.sourceKey !== source.sourceKey) {
          throw new TypeError('Normalized source custody belongs to another evidence lane.');
        }
        await dependencies.repository.retainNormalizedSource({ ...result, request });
      }
      const reconciliation = await dependencies.reconciliationAuthority.assessCurrent();
      if (reconciliation.state === 'unavailable') {
        return dependencies.repository.retainUnavailable(request, {
          stage: reconciliation.stage,
          cause: reconciliation.cause,
        });
      }
      const reviewed = await dependencies.reviewedAuthority.assessCurrent({
        valuationScopeKey: request.scopeKey,
      });
      if (reviewed.state === 'unavailable') {
        return dependencies.repository.retainUnavailable(request, {
          stage: reviewed.stage,
          cause: reviewed.cause,
        });
      }
      const factualRefresh = await dependencies.factualRefresh.refreshCurrent({
        ...request,
        stableOperationKey: createAflTradeCurrentValuationEvidenceFactualHandoffKey(request),
      });
      if (factualRefresh.state === 'unavailable') {
        const cause = {
          source_authority_missing: 'missing',
          source_authority_stale: 'stale',
          source_authority_mismatched: 'mismatched',
          source_authority_unauthenticated: 'unauthenticated',
        }[factualRefresh.cause] as 'missing' | 'stale' | 'mismatched' | 'unauthenticated';
        return dependencies.repository.retainUnavailable(request, {
          stage: 'reviewed_authority',
          cause,
        });
      }
      return dependencies.repository.retainComplete(request, factualRefresh);
    },
  };
}
