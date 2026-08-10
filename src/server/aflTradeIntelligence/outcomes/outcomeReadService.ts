import { z } from 'zod';

import {
  AFL_DRAFT_TRADE_OUTCOME_CONTRACT_VERSION,
  AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
  aflDraftTradeOutcomeCheckStatusSchema,
  aflDraftTradeOutcomeListResponseSchema,
  aflDraftTradeOutcomeMetricDefinitionSchema,
  aflDraftTradeOutcomeMetricSchema,
  aflDraftTradeOutcomeReleaseRefSchema,
  type AflDraftTradeOutcomeListItem,
  type AflDraftTradeOutcomeListResponse,
  type AflDraftTradeOutcomeMetricDefinition,
  type AflDraftTradeOutcomeReleaseRef,
} from '@/types/aflDraftTradeOutcomes';
import { aflTradePublicIdSchema, type AflTradePublicWarning } from '@/types/aflTradeIntelligence';

import type { AflTradeDecisionEnvironment } from '../governance/gateDecisionTypes';

export const AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE = 'public-afl-draft-trade-outcomes' as const;
export const AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION = 'afl-outcome-metrics-v1' as const;

export const AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS = Object.freeze([
  {
    metricDefinitionId:
      'metric-definition:4e2606c943f029f3307df7bc4dd7343dd1782922ee7a77b222710e94f4ef174f',
    metricRegistryVersion: AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
    metric: 'games',
    label: 'AFL games',
    unit: 'games',
    description:
      'AFL premiership-season games within the player, club-custody scope, and effective-through date stated by the release.',
    comparisonBasis:
      'Recorded and observed totals are compared only when identity, competition, custody scope, and observation window match exactly.',
  },
  {
    metricDefinitionId:
      'metric-definition:d794a7691ad0c642dfcbeaa0d8e4a2e965d63f5f3916ce1a6d36c139d3822eea',
    metricRegistryVersion: AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
    metric: 'goals',
    label: 'AFL goals',
    unit: 'goals',
    description:
      'AFL premiership-season goals within the player, club-custody scope, and effective-through date stated by the release.',
    comparisonBasis:
      'Recorded and observed totals are compared only when identity, competition, custody scope, and observation window match exactly.',
  },
  {
    metricDefinitionId:
      'metric-definition:85e322f1da9d314642a80496ce54d153db9875def3fb7fb9d1f598c4b88a849d',
    metricRegistryVersion: AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
    metric: 'coaches_votes',
    label: 'Coaches votes',
    unit: 'votes',
    description:
      'Published AFL Coaches Association votes covered by the exact source and seasons named by the release.',
    comparisonBasis:
      'A check requires an approved source with the same player identity, seasons, competition, and metric definition.',
  },
  {
    metricDefinitionId:
      'metric-definition:afbb9e92a72d0ee77193147734273d8217e0f458806da56ecd1d3ca9b520f40c',
    metricRegistryVersion: AFL_DRAFT_TRADE_OUTCOME_METRIC_REGISTRY_VERSION,
    metric: 'brownlow_votes',
    label: 'Brownlow votes',
    unit: 'votes',
    description:
      'Brownlow Medal votes covered by the exact source and seasons named by the release.',
    comparisonBasis:
      'A check requires an approved source with the same player identity, seasons, competition, and metric definition.',
  },
] satisfies readonly AflDraftTradeOutcomeMetricDefinition[]);

const listRequestSchema = z
  .object({
    scopeKey: aflTradePublicIdSchema,
    year: z.number().int().min(1897).max(2200).nullable(),
    club: z.string().trim().max(160),
    q: z.string().trim().max(160),
    metric: aflDraftTradeOutcomeMetricSchema.nullable(),
    status: aflDraftTradeOutcomeCheckStatusSchema.nullable(),
    limit: z.number().int().min(1).max(100),
    cursor: z.string().trim().min(1).max(1000).nullable(),
  })
  .strict();

export type AflDraftTradeOutcomeListReadRequest = z.infer<typeof listRequestSchema>;

export interface AflDraftTradeOutcomeReleaseSelection {
  registryRevision: number;
  scopeKey: string;
  environment: AflTradeDecisionEnvironment;
  release: AflDraftTradeOutcomeReleaseRef;
  metricDefinitions: readonly AflDraftTradeOutcomeMetricDefinition[];
  supportedScope: readonly string[];
  excludedScope: readonly string[];
}

export interface AflDraftTradeOutcomeSelectionSnapshot {
  registryRevision: number;
  selection: AflDraftTradeOutcomeReleaseSelection | null;
  unavailabilityReason?: 'no_active_release' | 'source_blocked';
}

export interface AflDraftTradeOutcomeReleaseSelector {
  capture(scopeKey: string): Promise<AflDraftTradeOutcomeSelectionSnapshot>;
}

export interface AflDraftTradeOutcomeProjectionMetadata {
  scopeKey: string;
  release: AflDraftTradeOutcomeReleaseRef;
  freshness: 'current' | 'stale';
  warnings: readonly AflTradePublicWarning[];
}

export interface AflDraftTradeOutcomeProjectionPage {
  metadata: AflDraftTradeOutcomeProjectionMetadata;
  items: readonly AflDraftTradeOutcomeListItem[];
  nextCursor: string | null;
  total: number | null;
}

export interface AflDraftTradeOutcomeRepository {
  list(
    selection: AflDraftTradeOutcomeReleaseSelection,
    request: AflDraftTradeOutcomeListReadRequest
  ): Promise<AflDraftTradeOutcomeProjectionPage>;
}

export type AflDraftTradeOutcomeReadErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_METRIC'
  | 'PROJECTION_READ_FAILED'
  | 'PROJECTION_MISMATCH'
  | 'INVALID_PROJECTION_PAYLOAD';

export class AflDraftTradeOutcomeReadError extends Error {
  constructor(
    public readonly code: AflDraftTradeOutcomeReadErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflDraftTradeOutcomeReadError';
  }
}

export interface AflDraftTradeOutcomeReadService {
  list(request: AflDraftTradeOutcomeListReadRequest): Promise<AflDraftTradeOutcomeListResponse>;
}

function sameRelease(
  actual: AflDraftTradeOutcomeReleaseRef,
  expected: AflDraftTradeOutcomeReleaseRef
): boolean {
  return (
    actual.releaseId === expected.releaseId &&
    actual.projectionId === expected.projectionId &&
    actual.archiveDatasetId === expected.archiveDatasetId &&
    actual.metricRegistryVersion === expected.metricRegistryVersion &&
    actual.effectiveThrough === expected.effectiveThrough &&
    actual.publishedAt === expected.publishedAt
  );
}

function parseResponse(response: unknown): AflDraftTradeOutcomeListResponse {
  const parsed = aflDraftTradeOutcomeListResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new AflDraftTradeOutcomeReadError(
      'INVALID_PROJECTION_PAYLOAD',
      'The outcome projection did not produce a valid public response.'
    );
  }
  return parsed.data;
}

function createUnavailableResponse(
  request: AflDraftTradeOutcomeListReadRequest,
  snapshot: AflDraftTradeOutcomeSelectionSnapshot,
  servedAt: string
): AflDraftTradeOutcomeListResponse {
  return parseResponse({
    consistency: {
      contractVersion: AFL_DRAFT_TRADE_OUTCOME_CONTRACT_VERSION,
      publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
      selection: 'none',
      registryRevision: snapshot.registryRevision,
      release: null,
      servedAt,
      freshness: 'unavailable',
      supportedScope: [],
      excludedScope: [
        snapshot.unavailabilityReason === 'source_blocked'
          ? 'Checked AFL Draft & Trade outcomes blocked by non-current source authority'
          : 'Checked AFL Draft & Trade outcomes pending a reviewed active factual release',
      ],
      warnings: [],
    },
    metricDefinitions: AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS,
    items: [],
    page: { limit: request.limit, nextCursor: null, total: null },
  });
}

function requireSelection(
  snapshot: AflDraftTradeOutcomeSelectionSnapshot,
  request: AflDraftTradeOutcomeListReadRequest
): AflDraftTradeOutcomeReleaseSelection {
  const selection = snapshot.selection;
  if (!selection || selection.registryRevision !== snapshot.registryRevision) {
    throw new AflDraftTradeOutcomeReadError(
      'PROJECTION_MISMATCH',
      'The captured outcome release selection is inconsistent.'
    );
  }
  if (selection.scopeKey !== request.scopeKey) {
    throw new AflDraftTradeOutcomeReadError(
      'PROJECTION_MISMATCH',
      'The captured outcome release does not match the requested public scope.'
    );
  }
  const parsedRelease = aflDraftTradeOutcomeReleaseRefSchema.safeParse(selection.release);
  if (!parsedRelease.success) {
    throw new AflDraftTradeOutcomeReadError(
      'PROJECTION_MISMATCH',
      'The captured outcome release reference is invalid.'
    );
  }
  const metricDefinitions = z
    .array(aflDraftTradeOutcomeMetricDefinitionSchema)
    .min(1)
    .max(AFL_DRAFT_TRADE_OUTCOME_METRIC_DEFINITIONS.length)
    .safeParse([...selection.metricDefinitions]);
  if (
    !metricDefinitions.success ||
    new Set(metricDefinitions.data.map(({ metric }) => metric)).size !==
      metricDefinitions.data.length ||
    new Set(metricDefinitions.data.map(({ metricDefinitionId }) => metricDefinitionId)).size !==
      metricDefinitions.data.length ||
    metricDefinitions.data.some(
      ({ metricRegistryVersion }) =>
        metricRegistryVersion !== parsedRelease.data.metricRegistryVersion
    )
  ) {
    throw new AflDraftTradeOutcomeReadError(
      'PROJECTION_MISMATCH',
      'The captured outcome release has an invalid metric-definition set.'
    );
  }
  if (request.metric && !metricDefinitions.data.some(({ metric }) => metric === request.metric)) {
    throw new AflDraftTradeOutcomeReadError(
      'UNSUPPORTED_METRIC',
      'The selected outcome release does not support the requested metric.'
    );
  }
  return {
    ...selection,
    release: parsedRelease.data,
    metricDefinitions: metricDefinitions.data,
  };
}

function itemMatchesRequest(
  item: AflDraftTradeOutcomeListItem,
  request: AflDraftTradeOutcomeListReadRequest
): boolean {
  if (request.year !== null && item.year !== request.year) return false;
  if (
    (request.metric || request.status) &&
    !item.checks.some(
      (check) =>
        (!request.metric || check.metric === request.metric) &&
        (!request.status || check.status === request.status)
    )
  ) {
    return false;
  }
  return true;
}

export function createAflDraftTradeOutcomeReadService(dependencies: {
  releaseSelector: AflDraftTradeOutcomeReleaseSelector;
  repository: AflDraftTradeOutcomeRepository;
  now?: () => string;
}): AflDraftTradeOutcomeReadService {
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async list(input) {
      const parsedRequest = listRequestSchema.safeParse(input);
      if (!parsedRequest.success) {
        throw new AflDraftTradeOutcomeReadError(
          'INVALID_REQUEST',
          'The AFL Draft & Trade outcome request is invalid.'
        );
      }
      const request = parsedRequest.data;
      const snapshot = await dependencies.releaseSelector.capture(request.scopeKey);
      const servedAt = now();
      if (!snapshot.selection) {
        return createUnavailableResponse(request, snapshot, servedAt);
      }

      const selection = requireSelection(snapshot, request);

      let projection: AflDraftTradeOutcomeProjectionPage;
      try {
        projection = await dependencies.repository.list(selection, request);
      } catch {
        throw new AflDraftTradeOutcomeReadError(
          'PROJECTION_READ_FAILED',
          'The selected AFL Draft & Trade outcome projection could not be read.'
        );
      }

      if (
        projection.metadata.scopeKey !== selection.scopeKey ||
        !sameRelease(projection.metadata.release, selection.release)
      ) {
        throw new AflDraftTradeOutcomeReadError(
          'PROJECTION_MISMATCH',
          'The outcome projection does not match the exact captured release.'
        );
      }
      if (projection.items.length > request.limit) {
        throw new AflDraftTradeOutcomeReadError(
          'PROJECTION_MISMATCH',
          'The outcome projection exceeded the requested page limit.'
        );
      }
      if (projection.items.some((item) => !itemMatchesRequest(item, request))) {
        throw new AflDraftTradeOutcomeReadError(
          'PROJECTION_MISMATCH',
          'The outcome projection returned rows outside the requested filters.'
        );
      }
      const definitionsByMetric = new Map(
        selection.metricDefinitions.map((definition) => [definition.metric, definition])
      );
      if (
        projection.items.some((item) =>
          item.checks.some((check) => {
            const definition = definitionsByMetric.get(check.metric);
            return (
              !definition ||
              check.sources.some(
                ({ metricDefinitionId }) => metricDefinitionId !== definition.metricDefinitionId
              )
            );
          })
        )
      ) {
        throw new AflDraftTradeOutcomeReadError(
          'PROJECTION_MISMATCH',
          'The outcome projection returned evidence outside the captured metric definitions.'
        );
      }

      return parseResponse({
        consistency: {
          contractVersion: AFL_DRAFT_TRADE_OUTCOME_CONTRACT_VERSION,
          publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
          selection: 'active',
          registryRevision: selection.registryRevision,
          release: selection.release,
          servedAt,
          freshness: projection.metadata.freshness,
          supportedScope: [...selection.supportedScope],
          excludedScope: [...selection.excludedScope],
          warnings: [...projection.metadata.warnings],
        },
        metricDefinitions: [...selection.metricDefinitions],
        items: [...projection.items],
        page: {
          limit: request.limit,
          nextCursor: projection.nextCursor,
          total: projection.total,
        },
      });
    },
  };
}
