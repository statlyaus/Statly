import { describe, expect, it, vi } from 'vitest';

import type { AflTradePublicationReadSelection } from '@/server/aflTradeIntelligence/publication/publicationReadContracts';
import type { AflTradeProjectionArtifactReadRepository } from '@/server/aflTradeIntelligence/publication/projectionArtifactReadRepository';
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
    const repository = createResolvingAflTradeProjectionReadRepository({ factory, maxEntries: 2 });
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
    const repository = createResolvingAflTradeProjectionReadRepository({ factory, maxEntries: 2 });
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
});
