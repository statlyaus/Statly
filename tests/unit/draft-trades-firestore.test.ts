import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  collectionMock,
  metaDocMock,
  metaGetMock,
  tradesGetMock,
  tradesOrderByMock,
  tradesWhereMock,
} = vi.hoisted(() => ({
  collectionMock: vi.fn(),
  metaDocMock: vi.fn(),
  metaGetMock: vi.fn(),
  tradesGetMock: vi.fn(),
  tradesOrderByMock: vi.fn(),
  tradesWhereMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('../../src/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: collectionMock,
  },
}));

vi.mock('../../src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

function tradeDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  };
}

describe('draft trade Firestore reads', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    const metaCollection = {
      doc: metaDocMock,
    };
    const tradesCollection = {
      get: tradesGetMock,
      orderBy: tradesOrderByMock,
      where: tradesWhereMock,
    };

    metaDocMock.mockReturnValue({ get: metaGetMock });
    metaGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        collections: {
          trades: 'draftTrades_active',
          clubs: 'draftClubs_active',
          meta: 'draftMeta_active',
        },
      }),
    });
    tradesWhereMock.mockReturnValue(tradesCollection);
    tradesOrderByMock.mockReturnValue(tradesCollection);
    collectionMock.mockImplementation((name: string) => {
      if (name === 'draftMeta') return metaCollection;
      if (name === 'draftTrades_active') return tradesCollection;
      throw new Error(`Unexpected Firestore collection: ${name}`);
    });
  });

  it('lists a public year without requiring a composite sort/filter index', async () => {
    tradesGetMock.mockResolvedValue({
      docs: [
        tradeDoc('trade-2', {
          tradeId: 'trade-2',
          year: 2025,
          seqInYear: 2,
          title: 'Trade for Bailey',
          clubSlugs: ['essendon'],
          clubNames: ['Essendon'],
          hasPicks: true,
        }),
        tradeDoc('trade-1', {
          tradeId: 'trade-1',
          year: 2025,
          seqInYear: 1,
          title: 'Trade for Liam Reidy',
          clubSlugs: ['carlton', 'fremantle'],
          clubNames: ['Carlton', 'Fremantle'],
          hasPicks: true,
        }),
      ],
    });

    const { listDraftTradesByYear } = await import('../../src/lib/draftTrades/firestore');

    const trades = await listDraftTradesByYear(2025, {
      clubSlug: 'carlton',
      type: 'pick',
      q: 'liam',
    });

    expect(tradesWhereMock).toHaveBeenCalledTimes(1);
    expect(tradesWhereMock).toHaveBeenCalledWith('year', '==', 2025);
    expect(tradesOrderByMock).not.toHaveBeenCalled();
    expect(trades.map((trade) => trade.tradeId)).toEqual(['trade-1']);
  });
});
