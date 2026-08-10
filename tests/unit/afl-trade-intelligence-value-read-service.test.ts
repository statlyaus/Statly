import { describe, expect, it, vi } from 'vitest';

import type { AflTradePublicationReadSelection } from '@/server/aflTradeIntelligence/publication/publicationState';
import {
  AflTradeValueReadError,
  createAflTradeValueReadService,
  type AflTradeProjectionReadMetadata,
  type AflTradeValueProjectionRepository,
} from '@/server/aflTradeIntelligence/publication/valueReadService';
import type { AflTradeValuationView, AflTradeValueUnavailable } from '@/types/aflTradeIntelligence';

const digest = (character: string) => character.repeat(64);
const servedAt = '2026-08-05T04:00:00.000Z';
const tradeIds = ['fixture-trade-1', 'fixture-trade-2'];

function unavailable(view: AflTradeValuationView): AflTradeValueUnavailable {
  return {
    availability: 'not_calculated',
    view,
    modelVintage: null,
    temporalContext: null,
    reasonCode: 'fixture-not-calculated',
    message: 'This fabricated projection value has not been calculated.',
    nextAction: {
      kind: 'await_calculation',
      label: 'Wait for calculation',
      href: null,
      expectedAfter: null,
    },
    warnings: [],
    methodologyHref: '/draft/trades/methodology',
  };
}

function selection(
  supportedViews: readonly AflTradeValuationView[] = [
    'at_trade',
    'realized',
    'remaining',
    'current',
  ]
): AflTradePublicationReadSelection {
  return {
    publication: {
      publicationId: `publication:${digest('a')}`,
      state: 'published',
      valuationBundleId: `valuation-bundle:${digest('b')}`,
      valueUnitId: 'fixture-value-unit',
      publishedAt: '2026-08-05T02:00:00.000Z',
    },
    projectionBuildId: `projection:${digest('c')}`,
    registryRevision: 7,
    scopeKey: 'public-afl-trades-current',
    supportedViews,
    supportedCohorts: ['Fabricated supported trades'],
    excludedCohorts: ['Fabricated unresolved trades'],
  };
}

function metadata(
  active: AflTradePublicationReadSelection = selection()
): AflTradeProjectionReadMetadata {
  return {
    publicationId: active.publication.publicationId,
    projectionBuildId: active.projectionBuildId,
    scopeKey: active.scopeKey,
    calculationAsOf: '2026-08-05T03:00:00.000Z',
    knowledgeCutoffAt: '2026-08-05T01:00:00.000Z',
    freshness: 'current',
    warnings: [],
  };
}

function repository(active: AflTradePublicationReadSelection = selection()) {
  return {
    list: vi.fn<AflTradeValueProjectionRepository['list']>(async (_selection, request) => ({
      metadata: metadata(active),
      items: request.tradeIds.map((tradeId) => ({
        tradeId,
        valuation: unavailable(request.requestedView),
      })),
      nextCursor: null as string | null,
      total: request.tradeIds.length as number | null,
    })),
    detail: vi.fn<AflTradeValueProjectionRepository['detail']>(async (_selection, request) => ({
      metadata: metadata(active),
      tradeId: request.tradeId,
      valuations: request.requestedViews.map(unavailable),
      assets: [],
      lineageSummary: {
        status: 'unavailable' as const,
        totalAssetCount: null,
        resolvedAssetCount: null,
        unresolvedAssetCount: null,
        lineageEdgeCount: null,
        maximumDepth: null,
      },
    })),
  } satisfies AflTradeValueProjectionRepository;
}

function service(
  active: AflTradePublicationReadSelection | null,
  projectionRepository = repository(active ?? selection()),
  registryRevision = active?.registryRevision ?? 3
) {
  const publicationSelector = {
    capture: vi.fn(async () => ({ selection: active, registryRevision })),
  };
  return {
    publicationSelector,
    projectionRepository,
    value: createAflTradeValueReadService({
      publicationSelector,
      projectionRepository,
      now: () => servedAt,
    }),
  };
}

const listRequest = {
  scopeKey: 'public-afl-trades-current',
  requestedView: 'current' as const,
  tradeIds,
  limit: 25,
  cursor: null,
};

const detailRequest = {
  scopeKey: 'public-afl-trades-current',
  tradeId: tradeIds[0],
  requestedViews: ['at_trade', 'realized', 'remaining', 'current'] as AflTradeValuationView[],
};

describe('AFL trade-value read service', () => {
  it('serves view-correct no-publication states without reading a projection when none is active', async () => {
    const context = service(null);
    const list = await context.value.list({ ...listRequest, requestedView: 'at_trade' });
    const detail = await context.value.detail(detailRequest);

    expect(list.consistency).toMatchObject({
      contractVersion: 'afl-trade-value/v2',
      selection: 'none',
      registryRevision: 3,
      publication: null,
      projectionBuildId: null,
      freshness: 'unavailable',
    });
    expect(list.items.map((item) => item.valuation.view)).toEqual(['at_trade', 'at_trade']);
    expect(list.items.every((item) => item.valuation.availability === 'not_calculated')).toBe(true);
    expect(detail.valuations.map((valuation) => valuation.view)).toEqual(
      detailRequest.requestedViews
    );
    expect(
      detail.valuations.every((valuation) => valuation.availability === 'not_calculated')
    ).toBe(true);
    expect(context.projectionRepository.list).not.toHaveBeenCalled();
    expect(context.projectionRepository.detail).not.toHaveBeenCalled();
  });

  it('composes list and detail responses from one exact active publication selection', async () => {
    const active = selection();
    const context = service(active);
    const list = await context.value.list(listRequest);
    const detail = await context.value.detail(detailRequest);

    expect(list.consistency).toMatchObject({
      contractVersion: 'afl-trade-value/v2',
      selection: 'active',
      publication: active.publication,
      projectionBuildId: active.projectionBuildId,
      registryRevision: active.registryRevision,
      calculationAsOf: '2026-08-05T03:00:00.000Z',
      knowledgeCutoffAt: '2026-08-05T01:00:00.000Z',
      supportedScope: active.supportedCohorts,
      excludedScope: active.excludedCohorts,
    });
    expect(list.items.map((item) => item.tradeId)).toEqual(tradeIds);
    expect(detail.tradeId).toBe(detailRequest.tradeId);
    expect(detail.valuations.map((valuation) => valuation.view)).toEqual(
      detailRequest.requestedViews
    );
    expect(context.projectionRepository.list).toHaveBeenCalledWith(active, listRequest);
    expect(context.projectionRepository.detail).toHaveBeenCalledWith(active, detailRequest);
  });

  it('rejects invalid pages and views before reading a projection', async () => {
    const active = selection(['current']);
    const context = service(active);

    await expect(
      context.value.list({ ...listRequest, tradeIds: [tradeIds[0], tradeIds[0]] })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(context.value.detail(detailRequest)).rejects.toMatchObject({
      code: 'UNSUPPORTED_VIEW',
    });
    expect(context.projectionRepository.list).not.toHaveBeenCalled();
    expect(context.projectionRepository.detail).not.toHaveBeenCalled();
  });

  it('rejects cursor continuation for an explicit trade-identifier batch before capture', async () => {
    const active = selection();
    const context = service(active);

    await expect(
      context.value.list({ ...listRequest, cursor: 'opaque-cursor' })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(context.publicationSelector.capture).not.toHaveBeenCalled();
    expect(context.projectionRepository.list).not.toHaveBeenCalled();
  });

  it('does not substitute source-blocked output when the active projection read fails', async () => {
    const active = selection();
    const projectionRepository = repository(active);
    projectionRepository.list.mockRejectedValueOnce(new Error('Fabricated projection failure.'));
    const context = service(active, projectionRepository);

    const error = await context.value.list(listRequest).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AflTradeValueReadError);
    expect(error).toMatchObject({ code: 'PROJECTION_READ_FAILED' });
    expect(String((error as Error).message)).not.toMatch(/source.*blocked/i);
  });

  it('rejects registry, publication, projection, scope, trade, and view drift', async () => {
    const active = selection();

    await expect(
      service(active, repository(active), active.registryRevision + 1).value.list(listRequest)
    ).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });

    for (const mismatchedMetadata of [
      { publicationId: `publication:${digest('f')}` },
      { projectionBuildId: `projection:${digest('f')}` },
      { scopeKey: 'other-public-scope' },
    ]) {
      const projectionRepository = repository(active);
      projectionRepository.list.mockResolvedValueOnce({
        metadata: { ...metadata(active), ...mismatchedMetadata },
        items: tradeIds.map((tradeId) => ({ tradeId, valuation: unavailable('current') })),
        nextCursor: null,
        total: tradeIds.length,
      });
      await expect(
        service(active, projectionRepository).value.list(listRequest)
      ).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });
    }

    const wrongListRepository = repository(active);
    wrongListRepository.list.mockResolvedValueOnce({
      metadata: metadata(active),
      items: [{ tradeId: tradeIds[0], valuation: unavailable('current') }],
      nextCursor: null,
      total: 1,
    });
    await expect(
      service(active, wrongListRepository).value.list(listRequest)
    ).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });

    const wrongDetailRepository = repository(active);
    wrongDetailRepository.detail.mockResolvedValueOnce({
      metadata: metadata(active),
      tradeId: detailRequest.tradeId,
      valuations: [unavailable('current')],
      assets: [],
      lineageSummary: {
        status: 'unavailable',
        totalAssetCount: null,
        resolvedAssetCount: null,
        unresolvedAssetCount: null,
        lineageEdgeCount: null,
        maximumDepth: null,
      },
    });
    await expect(
      service(active, wrongDetailRepository).value.detail(detailRequest)
    ).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });
  });

  it('rejects reordered, duplicated, or paginated explicit-batch projection output', async () => {
    const active = selection();
    const variants = [
      {
        items: [...tradeIds]
          .reverse()
          .map((tradeId) => ({ tradeId, valuation: unavailable('current') })),
        nextCursor: null,
        total: tradeIds.length,
      },
      {
        items: tradeIds.map(() => ({ tradeId: tradeIds[0], valuation: unavailable('current') })),
        nextCursor: null,
        total: tradeIds.length,
      },
      {
        items: tradeIds.map((tradeId) => ({ tradeId, valuation: unavailable('current') })),
        nextCursor: 'fabricated-continuation',
        total: tradeIds.length,
      },
      {
        items: tradeIds.map((tradeId) => ({ tradeId, valuation: unavailable('current') })),
        nextCursor: null,
        total: null,
      },
      {
        items: tradeIds.map((tradeId) => ({ tradeId, valuation: unavailable('current') })),
        nextCursor: null,
        total: tradeIds.length + 1,
      },
    ];

    for (const variant of variants) {
      const projectionRepository = repository(active);
      projectionRepository.list.mockResolvedValueOnce({
        metadata: metadata(active),
        ...variant,
      });
      await expect(
        service(active, projectionRepository).value.list(listRequest)
      ).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });
    }
  });

  it('rejects schema-valid detail valuations returned in a different view order', async () => {
    const active = selection();
    const projectionRepository = repository(active);
    projectionRepository.detail.mockResolvedValueOnce({
      metadata: metadata(active),
      tradeId: detailRequest.tradeId,
      valuations: [...detailRequest.requestedViews].reverse().map(unavailable),
      assets: [],
      lineageSummary: {
        status: 'unavailable',
        totalAssetCount: null,
        resolvedAssetCount: null,
        unresolvedAssetCount: null,
        lineageEdgeCount: null,
        maximumDepth: null,
      },
    });

    await expect(
      service(active, projectionRepository).value.detail(detailRequest)
    ).rejects.toMatchObject({ code: 'PROJECTION_MISMATCH' });
  });

  it('rejects projection chronology that cannot form a valid v2 response', async () => {
    const active = selection();
    const projectionRepository = repository(active);
    projectionRepository.list.mockResolvedValueOnce({
      metadata: {
        ...metadata(active),
        calculationAsOf: '2026-08-05T05:00:00.000Z',
      },
      items: tradeIds.map((tradeId) => ({ tradeId, valuation: unavailable('current') })),
      nextCursor: null,
      total: tradeIds.length,
    });

    await expect(
      service(active, projectionRepository).value.list(listRequest)
    ).rejects.toMatchObject({ code: 'INVALID_PROJECTION_PAYLOAD' });
  });
});
