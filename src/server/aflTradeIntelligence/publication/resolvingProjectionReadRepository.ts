import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import { createAflTradePrePublicationAvailability } from './prePublicationAvailability';
import type { AflTradePublicationReadSelection } from './publicationReadContracts';
import {
  isAflTradeProjectionArtifactReadError,
  type AflTradeProjectionArtifactReadRepository,
} from './projectionArtifactReadRepository';

function isTradeOutsideProjection(error: unknown): boolean {
  return isAflTradeProjectionArtifactReadError(error) && error.code === 'TRADE_NOT_IN_PROJECTION';
}

function createArchiveOnlyAvailability(
  view: Parameters<typeof createAflTradePrePublicationAvailability>[0]
) {
  return {
    ...createAflTradePrePublicationAvailability(view),
    reasonCode: 'trade-not-in-active-projection',
    message:
      'This factual archive trade is not included in the active numerical publication. Its facts remain available without a calculated value.',
  };
}

export interface AflTradeProjectionReadRepositoryFactory {
  (projectionId: string): Promise<AflTradeProjectionArtifactReadRepository>;
}

export function createResolvingAflTradeProjectionReadRepository(input: {
  factory: AflTradeProjectionReadRepositoryFactory;
  isFactualArchiveTrade(tradeId: string): Promise<boolean>;
  maxEntries?: number;
}): AflTradeProjectionArtifactReadRepository {
  const maxEntries = input.maxEntries ?? 4;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 16) {
    throw new TypeError('Projection repository cache size must be between 1 and 16.');
  }
  const cache = new Map<string, Promise<AflTradeProjectionArtifactReadRepository>>();

  async function resolve(
    selection: AflTradePublicationReadSelection
  ): Promise<AflTradeProjectionArtifactReadRepository> {
    const projectionId = aflTradeContentAddressedIdSchema('projection').parse(
      selection.projectionBuildId
    );
    const existing = cache.get(projectionId);
    if (existing !== undefined) {
      cache.delete(projectionId);
      cache.set(projectionId, existing);
      return existing;
    }

    const mounted = Promise.resolve().then(() => input.factory(projectionId));
    cache.set(projectionId, mounted);
    while (cache.size > maxEntries) {
      const leastRecentlyUsed = cache.keys().next().value as string | undefined;
      if (leastRecentlyUsed === undefined) break;
      cache.delete(leastRecentlyUsed);
    }
    try {
      return await mounted;
    } catch (error) {
      if (cache.get(projectionId) === mounted) cache.delete(projectionId);
      throw error;
    }
  }

  return {
    async list(selection, request) {
      const mounted = await resolve(selection);
      try {
        return await mounted.list(selection, request);
      } catch (error) {
        if (!isTradeOutsideProjection(error)) throw error;
      }
      const items = [];
      let metadata = null;
      for (const tradeId of request.tradeIds) {
        try {
          const single = await mounted.list(selection, {
            ...request,
            tradeIds: [tradeId],
            limit: 1,
          });
          metadata ??= single.metadata;
          items.push(...single.items);
        } catch (error) {
          if (!isTradeOutsideProjection(error)) throw error;
          if (!(await input.isFactualArchiveTrade(tradeId))) throw error;
          items.push({
            tradeId,
            valuation: createArchiveOnlyAvailability(request.requestedView),
          });
        }
      }
      metadata ??= (await mounted.read(selection)).metadata;
      return { metadata, items, nextCursor: null, total: items.length };
    },
    async detail(selection, request) {
      const mounted = await resolve(selection);
      try {
        return await mounted.detail(selection, request);
      } catch (error) {
        if (!isTradeOutsideProjection(error)) throw error;
        if (!(await input.isFactualArchiveTrade(request.tradeId))) throw error;
      }
      return {
        metadata: (await mounted.read(selection)).metadata,
        tradeId: request.tradeId,
        valuations: request.requestedViews.map(createArchiveOnlyAvailability),
        assets: [],
        lineageSummary: {
          status: 'unavailable' as const,
          totalAssetCount: null,
          resolvedAssetCount: null,
          unresolvedAssetCount: null,
          lineageEdgeCount: null,
          maximumDepth: null,
        },
      };
    },
    async read(selection) {
      return (await resolve(selection)).read(selection);
    },
    async exportRows(selection, request) {
      return (await resolve(selection)).exportRows(selection, request);
    },
  };
}
