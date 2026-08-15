import { describe, expect, it, vi } from 'vitest';

import type { AflTradePublicationReadSelection } from '@/server/aflTradeIntelligence/publication/publicationReadContracts';
import {
  AflTradeProjectionArtifactReadError,
  type AflTradeProjectionArtifactReadRepository,
} from '@/server/aflTradeIntelligence/publication/projectionArtifactReadRepository';
import { createResolvingAflTradeProjectionReadRepository } from '@/server/aflTradeIntelligence/publication/resolvingProjectionReadRepository';

const id = (prefix: string, digit: string) => `${prefix}:${digit.repeat(64)}`;

function selection(digit: string): AflTradePublicationReadSelection {
  return {
    publication: {
      publicationId: id('publication', digit),
      state: 'published',
      valuationBundleId: id('valuation-bundle', digit),
      valueUnitId: 'fixture-unit',
      publishedAt: '2026-08-08T00:00:00.000Z',
    },
    projectionBuildId: id('projection', digit),
    registryRevision: Number(digit),
    scopeKey: 'fixture-current',
    supportedViews: ['current'],
    supportedCohorts: ['fixture-supported'],
    excludedCohorts: [],
  };
}

function projectionRepository(projectionId: string): AflTradeProjectionArtifactReadRepository {
  return {
    list: vi.fn(async () => ({ projectionId, kind: 'list' })) as never,
    detail: vi.fn(async () => ({ projectionId, kind: 'detail' })) as never,
    read: vi.fn(async () => ({ projectionId, kind: 'methodology' })) as never,
    exportRows: vi.fn(async () => ({ projectionId, kind: 'export' })) as never,
  };
}

describe('resolving AFL trade projection repository', () => {
  it('mounts and delegates by each captured immutable projection ID', async () => {
    const factory = vi.fn(async (projectionId: string) => projectionRepository(projectionId));
    const repository = createResolvingAflTradeProjectionReadRepository({
      factory,
      isFactualArchiveTrade: async () => true,
      maxEntries: 2,
    });
    const first = selection('1');
    const second = selection('2');

    const firstResult = await repository.list(first, {} as never);
    const repeated = await repository.detail(first, {} as never);
    const rotated = await repository.read(second);

    expect(firstResult).toMatchObject({ projectionId: first.projectionBuildId });
    expect(repeated).toMatchObject({ projectionId: first.projectionBuildId });
    expect(rotated).toMatchObject({ projectionId: second.projectionBuildId });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenNthCalledWith(1, first.projectionBuildId);
    expect(factory).toHaveBeenNthCalledWith(2, second.projectionBuildId);
  });

  it('deduplicates concurrent mounts and evicts the least recently used projection', async () => {
    const factory = vi.fn(async (projectionId: string) => projectionRepository(projectionId));
    const repository = createResolvingAflTradeProjectionReadRepository({
      factory,
      isFactualArchiveTrade: async () => true,
      maxEntries: 2,
    });
    const first = selection('1');
    const second = selection('2');
    const third = selection('3');

    await Promise.all([repository.list(first, {} as never), repository.detail(first, {} as never)]);
    expect(factory).toHaveBeenCalledTimes(1);
    await repository.read(second);
    await repository.exportRows(third, { tradeIds: [], requestedViews: [] });
    await repository.read(first);

    expect(factory).toHaveBeenCalledTimes(4);
    expect(factory.mock.calls.map(([projectionId]) => projectionId)).toEqual([
      first.projectionBuildId,
      second.projectionBuildId,
      third.projectionBuildId,
      first.projectionBuildId,
    ]);
  });

  it('preserves projected values while returning not-calculated results for archive-only trades', async () => {
    const active = selection('1');
    const metadata = {
      publicationId: active.publication.publicationId,
      projectionBuildId: active.projectionBuildId,
      scopeKey: active.scopeKey,
      calculationAsOf: '2026-08-08T00:00:00.000Z',
      knowledgeCutoffAt: '2026-08-08T00:00:00.000Z',
      freshness: 'current' as const,
      warnings: [],
    };
    const valuedTradeId = 'trade-valued';
    const archiveOnlyTradeId = 'trade-archive-only';
    const mounted = projectionRepository(active.projectionBuildId);
    mounted.list = vi.fn(async (_selection, request) => {
      if (request.tradeIds.includes(archiveOnlyTradeId)) {
        throw new AflTradeProjectionArtifactReadError('TRADE_NOT_IN_PROJECTION');
      }
      return {
        metadata,
        items: [
          {
            tradeId: valuedTradeId,
            valuation: {
              availability: 'available',
              view: request.requestedView,
              unit: 'fixture-unit',
              received: 100,
              surrendered: 90,
              net: 10,
              grade: null,
              confidence: null,
              explanation: null,
            },
          },
        ],
        nextCursor: null,
        total: 1,
      } as never;
    }) as never;
    mounted.detail = vi.fn(async () => {
      throw new AflTradeProjectionArtifactReadError('TRADE_NOT_IN_PROJECTION');
    }) as never;
    mounted.read = vi.fn(async () => ({ metadata })) as never;
    const repository = createResolvingAflTradeProjectionReadRepository({
      factory: vi.fn(async () => mounted),
      isFactualArchiveTrade: async (tradeId) =>
        tradeId === valuedTradeId || tradeId === archiveOnlyTradeId,
    });

    const list = await repository.list(active, {
      scopeKey: active.scopeKey,
      requestedView: 'current',
      tradeIds: [valuedTradeId, archiveOnlyTradeId],
      limit: 2,
      cursor: null,
    });
    const detail = await repository.detail(active, {
      scopeKey: active.scopeKey,
      tradeId: archiveOnlyTradeId,
      requestedViews: ['current'],
    });

    expect(list.items.map(({ tradeId, valuation }) => [tradeId, valuation.availability])).toEqual([
      [valuedTradeId, 'available'],
      [archiveOnlyTradeId, 'not_calculated'],
    ]);
    expect(detail).toMatchObject({
      metadata,
      tradeId: archiveOnlyTradeId,
      valuations: [{ view: 'current', availability: 'not_calculated' }],
      assets: [],
      lineageSummary: { status: 'unavailable' },
    });
    await expect(
      repository.detail(active, {
        scopeKey: active.scopeKey,
        tradeId: 'trade-unknown',
        requestedViews: ['current'],
      })
    ).rejects.toMatchObject({ code: 'TRADE_NOT_IN_PROJECTION' });
  });
});
