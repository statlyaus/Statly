import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listYears: vi.fn(),
  listClubs: vi.fn(),
  availability: vi.fn(),
}));

vi.mock('@/lib/draftTrades/read', () => ({
  listDraftTradeYears: mocks.listYears,
  listDraftTradesByYear: vi.fn(),
  listDraftClubs: mocks.listClubs,
  getDraftTradeReleaseAvailability: mocks.availability,
}));

vi.mock('@/server/aflTradeIntelligence/runtime/publicReadRuntime', () => ({
  getPublicAflTradeReadRuntime: vi.fn(),
}));

import DraftTradesPage from '../../src/app/(public)/draft/trades/page';
import DraftClubsPage from '../../src/app/(public)/draft/clubs/page';

const renderTrades = async () =>
  render(await DraftTradesPage({ searchParams: Promise.resolve({}) }));
const renderClubs = async () => render(await DraftClubsPage());

describe('an empty public trade archive says why it is empty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listYears.mockResolvedValue([]);
    mocks.listClubs.mockResolvedValue([]);
  });

  it.each([
    ['no_active_release', /no reviewed trade release is active/i],
    ['source_blocked', /temporarily withdrawn/i],
    ['gate2_blocked', /temporarily withheld/i],
  ] as const)('trades and clubs pages describe %s plainly', async (availability, heading) => {
    mocks.availability.mockResolvedValue(availability);

    const trades = await renderTrades();
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByText(/imported yet/i)).not.toBeInTheDocument();
    trades.unmount();

    await renderClubs();
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByText(/imported yet/i)).not.toBeInTheDocument();
  });
});
