import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDraftTradeByIdMock, getRuntimeMock, valueDetailMock, valueListMock } = vi.hoisted(
  () => ({
    getDraftTradeByIdMock: vi.fn(),
    getRuntimeMock: vi.fn(),
    valueDetailMock: vi.fn(),
    valueListMock: vi.fn(),
  })
);

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found');
  }),
}));

vi.mock('@/lib/draftTrades/read', () => ({
  getDraftTradeById: getDraftTradeByIdMock,
}));

vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: getRuntimeMock,
}));

import DraftTradeDetailPage from '@/app/(public)/draft/trades/[tradeId]/page';

describe('public AFL trade detail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRuntimeMock.mockResolvedValue({
      valueReadService: {
        detail: valueDetailMock,
        list: valueListMock,
      },
    });
    valueDetailMock.mockResolvedValue({ status: 'unavailable' });
    valueListMock.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('decodes the canonical trade id once before every archive and valuation read', async () => {
    const tradeId =
      'external-transaction:c1a851b7fbdb99383ca071519ee382d44a296ac3e969e33c4502aa31a29a77f2';
    const detail = {
      trade: { tradeId },
      parties: [],
      assets: [],
    };
    getDraftTradeByIdMock.mockResolvedValue(detail);

    const result = await DraftTradeDetailPage({
      params: Promise.resolve({ tradeId: encodeURIComponent(tradeId) }),
    });

    expect(getDraftTradeByIdMock).toHaveBeenCalledWith(tradeId);
    expect(valueDetailMock).toHaveBeenCalledWith(expect.objectContaining({ tradeId }));
    expect(valueListMock).toHaveBeenCalledTimes(2);
    expect(valueListMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tradeIds: [tradeId], requestedView: 'at_trade' })
    );
    expect(valueListMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tradeIds: [tradeId], requestedView: 'current' })
    );
    expect(result.props.detail).toBe(detail);
  });

  it('fails at the route boundary when the encoded trade id is malformed', async () => {
    await expect(
      DraftTradeDetailPage({ params: Promise.resolve({ tradeId: 'external-transaction%3' }) })
    ).rejects.toThrow('not found');

    expect(getDraftTradeByIdMock).not.toHaveBeenCalled();
    expect(getRuntimeMock).not.toHaveBeenCalled();
  });
});
