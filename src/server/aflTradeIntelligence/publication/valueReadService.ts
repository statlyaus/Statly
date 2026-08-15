import { z } from 'zod';

import type {
  AflTradeAssetBreakdown,
  AflTradeConsistencyEnvelope,
  AflTradeLineageSummary,
  AflTradePublicWarning,
  AflTradeValuationView,
  AflTradeValueDetailResponse,
  AflTradeValueListItem,
  AflTradeValueListResponse,
  AflTradeValueResult,
} from '@/types/aflTradeIntelligence';
import {
  AFL_TRADE_VALUATION_VIEWS,
  aflTradePublicIdSchema,
  aflTradeValuationViewSchema,
  aflTradeValueDetailResponseSchema,
  aflTradeValueListResponseSchema,
} from '@/types/aflTradeIntelligence';

import { createAflTradePrePublicationAvailability } from './prePublicationAvailability';
import type { AflTradeNoPublicationReason } from './prePublicationAvailability';
import type { AflTradePublicationReadSelection } from './publicationReadContracts';

const listRequestSchema = z
  .object({
    scopeKey: aflTradePublicIdSchema,
    requestedView: aflTradeValuationViewSchema,
    tradeIds: z.array(aflTradePublicIdSchema).min(1).max(100),
    limit: z.number().int().min(1).max(100),
    cursor: z.string().trim().min(1).max(1000).nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.tradeIds).size !== request.tradeIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['tradeIds'],
        message: 'Trade identifiers must be unique.',
      });
    }
    if (request.tradeIds.length > request.limit) {
      context.addIssue({
        code: 'custom',
        path: ['tradeIds'],
        message: 'The requested trade page cannot exceed its limit.',
      });
    }
    if (request.cursor !== null) {
      context.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'Explicit trade-identifier batches do not support cursor continuation.',
      });
    }
  });

const detailRequestSchema = z
  .object({
    scopeKey: aflTradePublicIdSchema,
    tradeId: aflTradePublicIdSchema,
    requestedViews: z
      .array(aflTradeValuationViewSchema)
      .min(1)
      .max(AFL_TRADE_VALUATION_VIEWS.length),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.requestedViews).size !== request.requestedViews.length) {
      context.addIssue({
        code: 'custom',
        path: ['requestedViews'],
        message: 'Requested valuation views must be unique.',
      });
    }
  });

export type AflTradeValueListReadRequest = z.infer<typeof listRequestSchema>;
export type AflTradeValueDetailReadRequest = z.infer<typeof detailRequestSchema>;

export interface AflTradePublicationSelectionSnapshot {
  registryRevision: number;
  selection: AflTradePublicationReadSelection | null;
  unavailabilityReason?: AflTradeNoPublicationReason;
}

export interface AflTradeProjectionReadMetadata {
  publicationId: string;
  projectionBuildId: string;
  scopeKey: string;
  calculationAsOf: string;
  knowledgeCutoffAt: string;
  freshness: 'current' | 'stale';
  warnings: readonly AflTradePublicWarning[];
}

export interface AflTradeProjectionListPage {
  metadata: AflTradeProjectionReadMetadata;
  items: readonly AflTradeValueListItem[];
  nextCursor: string | null;
  total: number | null;
}

export interface AflTradeProjectionDetail {
  metadata: AflTradeProjectionReadMetadata;
  tradeId: string;
  valuations: readonly AflTradeValueResult[];
  assets: readonly AflTradeAssetBreakdown[];
  lineageSummary: AflTradeLineageSummary;
}

export interface AflTradePublicationSelector {
  capture(scopeKey: string): Promise<AflTradePublicationSelectionSnapshot>;
}

export interface AflTradeValueProjectionRepository {
  list(
    selection: AflTradePublicationReadSelection,
    request: AflTradeValueListReadRequest
  ): Promise<AflTradeProjectionListPage>;
  detail(
    selection: AflTradePublicationReadSelection,
    request: AflTradeValueDetailReadRequest
  ): Promise<AflTradeProjectionDetail>;
}

export type AflTradeValueReadErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_VIEW'
  | 'PROJECTION_READ_FAILED'
  | 'PROJECTION_MISMATCH'
  | 'INVALID_PROJECTION_PAYLOAD';

export class AflTradeValueReadError extends Error {
  constructor(
    public readonly code: AflTradeValueReadErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeValueReadError';
  }
}

export interface AflTradeValueReadService {
  list(request: AflTradeValueListReadRequest): Promise<AflTradeValueListResponse>;
  detail(request: AflTradeValueDetailReadRequest): Promise<AflTradeValueDetailResponse>;
}

function createNoPublicationConsistency(
  snapshot: AflTradePublicationSelectionSnapshot,
  servedAt: string
): AflTradeConsistencyEnvelope {
  return {
    contractVersion: 'afl-trade-value/v2',
    selection: 'none',
    publication: null,
    registryRevision: snapshot.registryRevision,
    projectionBuildId: null,
    servedAt,
    calculationAsOf: null,
    knowledgeCutoffAt: null,
    freshness: 'unavailable',
    supportedScope: [],
    excludedScope: [
      snapshot.unavailabilityReason === 'source_blocked'
        ? 'Numerical AFL trade valuation blocked by non-current source authority'
        : 'Numerical AFL trade valuation pending a reviewed active publication',
    ],
    warnings: [],
  };
}

function createNoPublicationListResponse(
  request: AflTradeValueListReadRequest,
  snapshot: AflTradePublicationSelectionSnapshot,
  servedAt: string
): AflTradeValueListResponse {
  return {
    consistency: createNoPublicationConsistency(snapshot, servedAt),
    requestedView: request.requestedView,
    items: request.tradeIds.map((tradeId) => ({
      tradeId,
      valuation: createAflTradePrePublicationAvailability(
        request.requestedView,
        snapshot.unavailabilityReason
      ),
    })),
    page: { limit: request.limit, nextCursor: null, total: null },
  };
}

function createNoPublicationDetailResponse(
  request: AflTradeValueDetailReadRequest,
  snapshot: AflTradePublicationSelectionSnapshot,
  servedAt: string
): AflTradeValueDetailResponse {
  return {
    consistency: createNoPublicationConsistency(snapshot, servedAt),
    tradeId: request.tradeId,
    valuations: request.requestedViews.map((view: AflTradeValuationView) =>
      createAflTradePrePublicationAvailability(view, snapshot.unavailabilityReason)
    ),
    assets: [],
    lineageSummary: {
      status: 'unavailable',
      totalAssetCount: null,
      resolvedAssetCount: null,
      unresolvedAssetCount: null,
      lineageEdgeCount: null,
      maximumDepth: null,
    },
  };
}

function sameOrderedValues(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((member, index) => member === expected[index])
  );
}

function requireSelection(
  snapshot: AflTradePublicationSelectionSnapshot,
  requestedViews: readonly AflTradeValuationView[]
): AflTradePublicationReadSelection {
  const selection = snapshot.selection;
  if (!selection) {
    throw new AflTradeValueReadError(
      'PROJECTION_MISMATCH',
      'An active publication selection was required.'
    );
  }
  if (selection.registryRevision !== snapshot.registryRevision) {
    throw new AflTradeValueReadError(
      'PROJECTION_MISMATCH',
      'The publication selection and registry revision do not match.'
    );
  }
  const unsupportedView = requestedViews.find((view) => !selection.supportedViews.includes(view));
  if (unsupportedView) {
    throw new AflTradeValueReadError(
      'UNSUPPORTED_VIEW',
      `The active publication does not support ${unsupportedView}.`
    );
  }
  return selection;
}

function requireProjectionMetadata(
  selection: AflTradePublicationReadSelection,
  metadata: AflTradeProjectionReadMetadata
) {
  if (
    metadata.publicationId !== selection.publication.publicationId ||
    metadata.projectionBuildId !== selection.projectionBuildId ||
    metadata.scopeKey !== selection.scopeKey
  ) {
    throw new AflTradeValueReadError(
      'PROJECTION_MISMATCH',
      'Projection metadata does not match the captured publication selection.'
    );
  }
}

function createActiveConsistency(
  selection: AflTradePublicationReadSelection,
  metadata: AflTradeProjectionReadMetadata,
  servedAt: string
): AflTradeConsistencyEnvelope {
  return {
    contractVersion: 'afl-trade-value/v2',
    selection: 'active',
    publication: selection.publication,
    registryRevision: selection.registryRevision,
    projectionBuildId: selection.projectionBuildId,
    servedAt,
    calculationAsOf: metadata.calculationAsOf,
    knowledgeCutoffAt: metadata.knowledgeCutoffAt,
    freshness: metadata.freshness,
    supportedScope: [...selection.supportedCohorts],
    excludedScope: [...selection.excludedCohorts],
    warnings: [...metadata.warnings],
  };
}

function parseListResponse(response: unknown): AflTradeValueListResponse {
  const parsed = aflTradeValueListResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new AflTradeValueReadError(
      'INVALID_PROJECTION_PAYLOAD',
      'The projection did not produce a valid AFL trade list response.'
    );
  }
  return parsed.data;
}

function parseDetailResponse(response: unknown): AflTradeValueDetailResponse {
  const parsed = aflTradeValueDetailResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new AflTradeValueReadError(
      'INVALID_PROJECTION_PAYLOAD',
      'The projection did not produce a valid AFL trade detail response.'
    );
  }
  return parsed.data;
}

export function createAflTradeValueReadService(dependencies: {
  publicationSelector: AflTradePublicationSelector;
  projectionRepository: AflTradeValueProjectionRepository;
  now?: () => string;
}): AflTradeValueReadService {
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async list(input) {
      const parsedRequest = listRequestSchema.safeParse(input);
      if (!parsedRequest.success) {
        throw new AflTradeValueReadError(
          'INVALID_REQUEST',
          'The valuation list request is invalid.'
        );
      }
      const request = parsedRequest.data;
      const snapshot = await dependencies.publicationSelector.capture(request.scopeKey);
      const servedAt = now();
      if (!snapshot.selection) {
        return parseListResponse(createNoPublicationListResponse(request, snapshot, servedAt));
      }

      const selection = requireSelection(snapshot, [request.requestedView]);
      let projection: AflTradeProjectionListPage;
      try {
        projection = await dependencies.projectionRepository.list(selection, request);
      } catch (cause) {
        throw new AflTradeValueReadError(
          'PROJECTION_READ_FAILED',
          'The active AFL trade-value projection could not be read.',
          { cause }
        );
      }
      requireProjectionMetadata(selection, projection.metadata);
      if (
        !sameOrderedValues(
          projection.items.map((item) => item.tradeId),
          request.tradeIds
        ) ||
        projection.nextCursor !== null ||
        projection.total !== request.tradeIds.length
      ) {
        throw new AflTradeValueReadError(
          'PROJECTION_MISMATCH',
          'The projection list does not match the requested trade page.'
        );
      }

      return parseListResponse({
        consistency: createActiveConsistency(selection, projection.metadata, servedAt),
        requestedView: request.requestedView,
        items: projection.items,
        page: {
          limit: request.limit,
          nextCursor: projection.nextCursor,
          total: projection.total,
        },
      });
    },

    async detail(input) {
      const parsedRequest = detailRequestSchema.safeParse(input);
      if (!parsedRequest.success) {
        throw new AflTradeValueReadError(
          'INVALID_REQUEST',
          'The valuation detail request is invalid.'
        );
      }
      const request = parsedRequest.data;
      const snapshot = await dependencies.publicationSelector.capture(request.scopeKey);
      const servedAt = now();
      if (!snapshot.selection) {
        return parseDetailResponse(createNoPublicationDetailResponse(request, snapshot, servedAt));
      }

      const selection = requireSelection(snapshot, request.requestedViews);
      let projection: AflTradeProjectionDetail;
      try {
        projection = await dependencies.projectionRepository.detail(selection, request);
      } catch (cause) {
        throw new AflTradeValueReadError(
          'PROJECTION_READ_FAILED',
          'The active AFL trade-value projection could not be read.',
          { cause }
        );
      }
      requireProjectionMetadata(selection, projection.metadata);
      if (
        projection.tradeId !== request.tradeId ||
        !sameOrderedValues(
          projection.valuations.map((valuation) => valuation.view),
          request.requestedViews
        )
      ) {
        throw new AflTradeValueReadError(
          'PROJECTION_MISMATCH',
          'The projection detail does not match the requested trade and views.'
        );
      }

      return parseDetailResponse({
        consistency: createActiveConsistency(selection, projection.metadata, servedAt),
        tradeId: projection.tradeId,
        valuations: projection.valuations,
        assets: projection.assets,
        lineageSummary: projection.lineageSummary,
      });
    },
  };
}
