import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  collectionMock,
  metaDocMock,
  metaGetMock,
  tradesGetMock,
  tradesLimitMock,
  tradesOrderByMock,
} = vi.hoisted(() => ({
  collectionMock: vi.fn(),
  metaDocMock: vi.fn(),
  metaGetMock: vi.fn(),
  tradesGetMock: vi.fn(),
  tradesLimitMock: vi.fn(),
  tradesOrderByMock: vi.fn(),
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

function configureFirestoreDocs(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  const metaCollection = {
    doc: metaDocMock,
  };
  const tradesCollection = {
    get: tradesGetMock,
    limit: tradesLimitMock,
    orderBy: tradesOrderByMock,
  };

  metaDocMock.mockReturnValue({ get: metaGetMock });
  metaGetMock.mockResolvedValue({
    exists: true,
    data: () => ({
      collections: {
        trades: 'draftTrades_active',
      },
    }),
  });
  tradesOrderByMock.mockReturnValue(tradesCollection);
  tradesLimitMock.mockReturnValue(tradesCollection);
  tradesGetMock.mockResolvedValue({
    docs: docs.map((doc) => ({
      id: doc.id,
      data: () => doc.data,
    })),
  });
  collectionMock.mockImplementation((name: string) => {
    if (name === 'draftMeta') return metaCollection;
    if (name === 'draftTrades_active') return tradesCollection;
    throw new Error(`Unexpected Firestore collection: ${name}`);
  });
}

describe('draft trade search', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('normalizes local fallback results before scoring and returning them', async () => {
    configureFirestoreDocs([
      {
        id: 'fallback-id',
        data: {
          tradeId: 123,
          year: '2025',
          seqInYear: '4',
          title: null,
          clubNames: ['Carlton', 99, null],
          clubSlugs: ['carlton', false],
        },
      },
    ]);

    const { searchDraftTrades } = await import('../../src/lib/draftTrades/search');
    const results = await searchDraftTrades('carlton');

    expect(results).toEqual([
      {
        tradeId: 'fallback-id',
        year: 0,
        seqInYear: 0,
        title: '',
        clubNames: ['Carlton'],
        clubSlugs: ['carlton'],
      },
    ]);
  });

  it('normalizes provider hits before returning them', async () => {
    vi.stubEnv('DRAFT_TRADE_SEARCH_ENDPOINT', 'https://search.example.test');
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: [
            {
              tradeId: 123,
              year: '2025',
              seqInYear: '4',
              title: null,
              clubNames: ['Carlton', 99, null],
              clubSlugs: ['carlton', false],
            },
          ],
        }),
        { status: 200 }
      )
    );

    const { searchDraftTrades } = await import('../../src/lib/draftTrades/search');
    const results = await searchDraftTrades('carlton');

    expect(results).toEqual([
      {
        tradeId: '',
        year: 0,
        seqInYear: 0,
        title: '',
        clubNames: ['Carlton'],
        clubSlugs: ['carlton'],
      },
    ]);
  });

  it('falls back to local search when the provider request times out', async () => {
    vi.useFakeTimers();
    vi.stubEnv('DRAFT_TRADE_SEARCH_ENDPOINT', 'https://search.example.test');
    vi.stubEnv('DRAFT_TRADE_SEARCH_TIMEOUT_MS', '10');
    configureFirestoreDocs([
      {
        id: 'trade-1',
        data: {
          tradeId: 'trade-1',
          year: 2025,
          seqInYear: 1,
          title: 'Trade for Player',
          clubNames: ['Carlton'],
          clubSlugs: ['carlton'],
        },
      },
    ]);
    vi.mocked(fetch).mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Request timed out', 'AbortError'));
        });
      });
    });

    const { searchDraftTrades } = await import('../../src/lib/draftTrades/search');
    const searchPromise = searchDraftTrades('carlton');
    await vi.advanceTimersByTimeAsync(11);
    const results = await searchPromise;

    expect(results).toEqual([
      {
        tradeId: 'trade-1',
        year: 2025,
        seqInYear: 1,
        title: 'Trade for Player',
        clubNames: ['Carlton'],
        clubSlugs: ['carlton'],
      },
    ]);
  });
});
