import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDevelopmentRepository: vi.fn(),
  firestoreListYears: vi.fn(),
  firestoreListTrades: vi.fn(),
  firestoreGetById: vi.fn(),
  firestoreListRefs: vi.fn(),
  firestoreListClubs: vi.fn(),
  developmentListYears: vi.fn(),
  developmentListTrades: vi.fn(),
  developmentGetById: vi.fn(),
  developmentListRefs: vi.fn(),
  developmentListClubs: vi.fn(),
}));

vi.mock('@/lib/draftTrades/developmentWorkbook', () => ({
  getDevelopmentWorkbookDraftTradeReadRepository: mocks.getDevelopmentRepository,
}));

vi.mock('@/lib/draftTrades/firestore', () => ({
  listDraftTradeYears: mocks.firestoreListYears,
  listDraftTradesByYear: mocks.firestoreListTrades,
  getDraftTradeById: mocks.firestoreGetById,
  listDraftTradeRefsByClub: mocks.firestoreListRefs,
  listDraftClubs: mocks.firestoreListClubs,
}));

import {
  getDraftTradeById,
  listDraftClubs,
  listDraftTradeRefsByClub,
  listDraftTradesByYear,
  listDraftTradeYears,
} from '@/lib/draftTrades/read';

const developmentRepository = {
  listYears: mocks.developmentListYears,
  listTradesByYear: mocks.developmentListTrades,
  getById: mocks.developmentGetById,
  listRefsByClub: mocks.developmentListRefs,
  listClubs: mocks.developmentListClubs,
};

describe('draft-trade read facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDevelopmentRepository.mockResolvedValue(null);
  });

  it('uses Firestore when the development source is disabled', async () => {
    mocks.firestoreListYears.mockResolvedValue([2025]);
    mocks.firestoreListTrades.mockResolvedValue([]);

    await expect(listDraftTradeYears()).resolves.toEqual([2025]);
    await expect(listDraftTradesByYear(2025, { q: 'trade' })).resolves.toEqual([]);
    expect(mocks.firestoreListTrades).toHaveBeenCalledWith(2025, { q: 'trade' });
    expect(mocks.developmentListYears).not.toHaveBeenCalled();
  });

  it('uses the workbook repository consistently when enabled', async () => {
    mocks.getDevelopmentRepository.mockResolvedValue(developmentRepository);
    mocks.developmentListYears.mockResolvedValue([2025, 2024]);
    mocks.developmentListTrades.mockResolvedValue([]);
    mocks.developmentGetById.mockResolvedValue(null);
    mocks.developmentListRefs.mockResolvedValue([]);
    mocks.developmentListClubs.mockResolvedValue([]);

    await expect(listDraftTradeYears()).resolves.toEqual([2025, 2024]);
    await listDraftTradesByYear(2025);
    await getDraftTradeById('trade-1');
    await listDraftTradeRefsByClub('carlton');
    await listDraftClubs();

    expect(mocks.developmentListTrades).toHaveBeenCalledWith(2025, undefined);
    expect(mocks.developmentGetById).toHaveBeenCalledWith('trade-1');
    expect(mocks.developmentListRefs).toHaveBeenCalledWith('carlton');
    expect(mocks.developmentListClubs).toHaveBeenCalledOnce();
    expect(mocks.firestoreListYears).not.toHaveBeenCalled();
    expect(mocks.firestoreListTrades).not.toHaveBeenCalled();
  });
});
