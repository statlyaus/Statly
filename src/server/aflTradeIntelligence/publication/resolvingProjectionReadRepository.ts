import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import type { AflTradePublicationReadSelection } from './publicationReadContracts';
import type { AflTradeProjectionArtifactReadRepository } from './projectionArtifactReadRepository';

export interface AflTradeProjectionReadRepositoryFactory {
  (projectionId: string): Promise<AflTradeProjectionArtifactReadRepository>;
}

export function createResolvingAflTradeProjectionReadRepository(input: {
  factory: AflTradeProjectionReadRepositoryFactory;
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
      return (await resolve(selection)).list(selection, request);
    },
    async detail(selection, request) {
      return (await resolve(selection)).detail(selection, request);
    },
    async read(selection) {
      return (await resolve(selection)).read(selection);
    },
    async exportRows(selection, request) {
      return (await resolve(selection)).exportRows(selection, request);
    },
  };
}
