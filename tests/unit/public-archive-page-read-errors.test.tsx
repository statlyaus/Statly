import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
const failure = new Error('outcomes database identity mismatch');

vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('not found');
  }),
}));
vi.mock('@/lib/draftTrades/read', () => ({
  getDraftTradeReleaseAvailability: vi.fn(),
  listDraftClubs: vi.fn(async () => {
    throw failure;
  }),
  listDraftTradeYears: vi.fn(async () => {
    throw failure;
  }),
  listDraftTradesByYear: vi.fn(),
}));
vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: vi.fn(async () => {
    throw failure;
  }),
}));

import DraftClubsPage from '@/app/(public)/draft/clubs/page';
import AflDraftHistoryIndexPage from '@/app/(public)/draft/drafts/page';
import AflDraftHistoryYearPage from '@/app/(public)/draft/drafts/[year]/page';
import DraftTradesPage from '@/app/(public)/draft/trades/page';

describe('public archive pages log read failures', () => {
  beforeEach(() => {
    logger.error.mockClear();
  });

  it.each([
    ['clubs', () => DraftClubsPage()],
    ['draft years', () => AflDraftHistoryIndexPage()],
    [
      'draft year',
      () =>
        AflDraftHistoryYearPage({
          params: Promise.resolve({ year: '2024' }),
          searchParams: Promise.resolve({}),
        }),
    ],
    ['trades', () => DraftTradesPage({ searchParams: Promise.resolve({}) })],
  ])('%s page logs the error behind its retry state', async (_name, render) => {
    await render();

    expect(logger.error).toHaveBeenCalledWith(expect.any(String), failure);
  });
});
