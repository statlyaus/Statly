import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchDraftTradeArchiveMock } = vi.hoisted(() => ({
  searchDraftTradeArchiveMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('../../src/lib/draftTrades/read', () => ({
  searchDraftTradeArchive: searchDraftTradeArchiveMock,
}));

vi.mock('../../src/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: vi.fn(() => {
      throw new Error('Firestore search is forbidden');
    }),
  },
}));

function trade(input: {
  tradeId: string;
  year: number;
  seqInYear: number;
  title: string;
  clubNames: string[];
  clubSlugs: string[];
}) {
  return {
    ...input,
    partyCount: input.clubNames.length,
    assetCount: 1,
    hasPlayers: true,
    hasPicks: false,
    hasFuturePicks: false,
    receivesByClub: [],
  };
}

describe('draft trade search', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    searchDraftTradeArchiveMock.mockResolvedValue([
      trade({
        tradeId: 'trade-2024-title',
        year: 2024,
        seqInYear: 4,
        title: 'Carlton acquires a player',
        clubNames: ['Essendon'],
        clubSlugs: ['essendon'],
      }),
      trade({
        tradeId: 'trade-2025-clubs',
        year: 2025,
        seqInYear: 1,
        title: 'Three-club exchange',
        clubNames: ['Carlton', 'Richmond'],
        clubSlugs: ['carlton', 'richmond'],
      }),
    ]);
  });

  it('searches only the governed archive and ranks title matches before club matches', async () => {
    const { searchDraftTrades } = await import('../../src/lib/draftTrades/search');

    await expect(searchDraftTrades('carlton')).resolves.toEqual([
      {
        tradeId: 'trade-2024-title',
        year: 2024,
        seqInYear: 4,
        title: 'Carlton acquires a player',
        clubNames: ['Essendon'],
        clubSlugs: ['essendon'],
      },
      {
        tradeId: 'trade-2025-clubs',
        year: 2025,
        seqInYear: 1,
        title: 'Three-club exchange',
        clubNames: ['Carlton', 'Richmond'],
        clubSlugs: ['carlton', 'richmond'],
      },
    ]);
    expect(searchDraftTradeArchiveMock).toHaveBeenCalledWith('carlton', 50);
  });

  it('fails closed when the governed archive cannot be selected', async () => {
    searchDraftTradeArchiveMock.mockRejectedValue(new Error('no active factual release'));
    const { searchDraftTrades } = await import('../../src/lib/draftTrades/search');

    await expect(searchDraftTrades('carlton')).rejects.toThrow('no active factual release');
  });

  it('does not access the archive for an invalidly short query', async () => {
    const { searchDraftTrades } = await import('../../src/lib/draftTrades/search');

    await expect(searchDraftTrades('a')).resolves.toEqual([]);
    expect(searchDraftTradeArchiveMock).not.toHaveBeenCalled();
  });
});
