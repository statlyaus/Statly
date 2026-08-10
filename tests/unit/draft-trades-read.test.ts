import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicRuntime: vi.fn(),
  archiveListYears: vi.fn(),
  archiveListTrades: vi.fn(),
  archiveGetById: vi.fn(),
  archiveListRefs: vi.fn(),
  archiveListClubs: vi.fn(),
}));

vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: mocks.getPublicRuntime,
}));

import {
  getDraftTradeById,
  listDraftClubs,
  listDraftTradeRefsByClub,
  listDraftTradesByYear,
  listDraftTradeYears,
} from '@/lib/draftTrades/read';

const archiveRepository = {
  listYears: mocks.archiveListYears,
  listTradesByYear: mocks.archiveListTrades,
  getById: mocks.archiveGetById,
  listRefsByClub: mocks.archiveListRefs,
  listClubs: mocks.archiveListClubs,
};

describe('draft-trade read facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicRuntime.mockResolvedValue({ archiveReadRepository: archiveRepository });
  });

  it('uses the governed PostgreSQL runtime as the only public archive source', async () => {
    mocks.archiveListYears.mockResolvedValue([2025]);
    mocks.archiveListTrades.mockResolvedValue([]);

    await expect(listDraftTradeYears()).resolves.toEqual([2025]);
    await expect(listDraftTradesByYear(2025, { q: 'trade' })).resolves.toEqual([]);
    expect(mocks.archiveListTrades).toHaveBeenCalledWith(2025, { q: 'trade' });
    expect(mocks.getPublicRuntime).toHaveBeenCalledTimes(2);
  });

  it('routes detail and club queries through the same governed archive', async () => {
    mocks.archiveGetById.mockResolvedValue(null);
    mocks.archiveListRefs.mockResolvedValue([]);
    mocks.archiveListClubs.mockResolvedValue([]);

    await getDraftTradeById('trade-1');
    await listDraftTradeRefsByClub('carlton');
    await listDraftClubs();

    expect(mocks.archiveGetById).toHaveBeenCalledWith('trade-1');
    expect(mocks.archiveListRefs).toHaveBeenCalledWith('carlton');
    expect(mocks.archiveListClubs).toHaveBeenCalledOnce();
  });
});
