import { z } from 'zod';

import type {
  AflTradeConsistencyEnvelope,
  AflTradeMethodologyResponse,
  AflTradePublishedMethodology,
} from '@/types/aflTradeIntelligence';
import {
  AFL_TRADE_METHODOLOGY_HREF,
  AFL_TRADE_VALUATION_VIEWS,
  aflTradeMethodologyResponseSchema,
  aflTradePublicIdSchema,
} from '@/types/aflTradeIntelligence';

import type { AflTradePublicationReadSelection } from './publicationReadContracts';
import type {
  AflTradeProjectionReadMetadata,
  AflTradePublicationSelector,
  AflTradePublicationSelectionSnapshot,
} from './valueReadService';

const methodologyRequestSchema = z.object({ scopeKey: aflTradePublicIdSchema }).strict();

export type AflTradeMethodologyReadRequest = z.infer<typeof methodologyRequestSchema>;

export interface AflTradeMethodologyProjection {
  metadata: AflTradeProjectionReadMetadata;
  methodologyHref: string;
  methodology: AflTradePublishedMethodology;
}

export interface AflTradeMethodologyProjectionRepository {
  read(selection: AflTradePublicationReadSelection): Promise<AflTradeMethodologyProjection>;
}

export type AflTradeMethodologyReadErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_PUBLICATION'
  | 'PROJECTION_READ_FAILED'
  | 'PROJECTION_MISMATCH'
  | 'INVALID_PROJECTION_PAYLOAD';

export class AflTradeMethodologyReadError extends Error {
  constructor(
    public readonly code: AflTradeMethodologyReadErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeMethodologyReadError';
  }
}

export interface AflTradeMethodologyReadService {
  read(request: AflTradeMethodologyReadRequest): Promise<AflTradeMethodologyResponse>;
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

function parseResponse(response: unknown): AflTradeMethodologyResponse {
  const parsed = aflTradeMethodologyResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new AflTradeMethodologyReadError(
      'INVALID_PROJECTION_PAYLOAD',
      'The projection did not produce valid public AFL trade methodology metadata.'
    );
  }
  return parsed.data;
}

function validateSelection(selection: AflTradePublicationReadSelection) {
  const supportedViews = new Set(selection.supportedViews);
  if (AFL_TRADE_VALUATION_VIEWS.some((view) => !supportedViews.has(view))) {
    throw new AflTradeMethodologyReadError(
      'UNSUPPORTED_PUBLICATION',
      'The active publication does not support every public valuation view.'
    );
  }
}

function validateProjection(
  selection: AflTradePublicationReadSelection,
  projection: AflTradeMethodologyProjection
) {
  if (
    projection.metadata.publicationId !== selection.publication.publicationId ||
    projection.metadata.projectionBuildId !== selection.projectionBuildId ||
    projection.metadata.scopeKey !== selection.scopeKey
  ) {
    throw new AflTradeMethodologyReadError(
      'PROJECTION_MISMATCH',
      'Methodology projection metadata does not match the captured publication selection.'
    );
  }
}

export function createAflTradeMethodologyReadService(dependencies: {
  publicationSelector: AflTradePublicationSelector;
  projectionRepository: AflTradeMethodologyProjectionRepository;
  now?: () => Date;
}): AflTradeMethodologyReadService {
  const now = dependencies.now ?? (() => new Date());

  return {
    async read(request) {
      const parsedRequest = methodologyRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        throw new AflTradeMethodologyReadError(
          'INVALID_REQUEST',
          'The methodology request is invalid.'
        );
      }

      const snapshot = await dependencies.publicationSelector.capture(parsedRequest.data.scopeKey);
      const servedAt = now().toISOString();
      if (!snapshot.selection) {
        const blocked = snapshot.unavailabilityReason === 'source_blocked';
        return parseResponse({
          consistency: createNoPublicationConsistency(snapshot, servedAt),
          availability: 'unavailable',
          reasonCode: blocked ? 'source-authority-not-current' : 'no-active-publication',
          message: blocked
            ? 'The published methodology is unavailable because its exact source authority is no longer current.'
            : 'There is no active reviewed AFL trade-value methodology publication yet.',
          nextAction: {
            kind: blocked ? 'view_methodology' : 'await_calculation',
            label: 'Read methodology and current limits',
            href: AFL_TRADE_METHODOLOGY_HREF,
            expectedAfter: null,
          },
          methodologyHref: AFL_TRADE_METHODOLOGY_HREF,
          methodology: null,
        });
      }

      const selection = snapshot.selection;
      if (selection.registryRevision !== snapshot.registryRevision) {
        throw new AflTradeMethodologyReadError(
          'PROJECTION_MISMATCH',
          'The publication selection and registry revision do not match.'
        );
      }
      validateSelection(selection);

      let projection: AflTradeMethodologyProjection;
      try {
        projection = await dependencies.projectionRepository.read(selection);
      } catch (error) {
        if (error instanceof AflTradeMethodologyReadError) throw error;
        throw new AflTradeMethodologyReadError(
          'PROJECTION_READ_FAILED',
          'The published methodology projection could not be read.'
        );
      }
      validateProjection(selection, projection);

      return parseResponse({
        consistency: createActiveConsistency(selection, projection.metadata, servedAt),
        availability: 'published',
        methodologyHref: projection.methodologyHref,
        methodology: projection.methodology,
      });
    },
  };
}

const unavailableMethodologyProjectionRepository: AflTradeMethodologyProjectionRepository = {
  async read() {
    throw new Error('No AFL trade-value methodology projection is active.');
  },
};

export const aflTradePrePublicationMethodologyReadService = createAflTradeMethodologyReadService({
  publicationSelector: {
    async capture() {
      return {
        registryRevision: 0,
        selection: null,
        unavailabilityReason: 'no_active_publication',
      };
    },
  },
  projectionRepository: unavailableMethodologyProjectionRepository,
});
