import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeagueTradesClient from '@/components/trades/LeagueTradesClient';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useLeagueTrades: vi.fn(),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/components/trades/useLeagueTrades', () => ({
  useLeagueTrades: mocks.useLeagueTrades,
}));

vi.mock('@/components/trades/TradeInboxRail', () => ({
  default: () => <section aria-label="Trade inbox rail">Trade inbox rail</section>,
}));

vi.mock('@/components/trades/TradeReviewPanel', () => ({
  default: () => <section aria-label="Trade review panel">Trade review panel</section>,
}));

vi.mock('@/components/trades/TradeCreatePanel', () => ({
  default: () => <section aria-label="Trade create panel">Trade create panel</section>,
}));

vi.mock('@/components/trades/TradeConfirmModal', () => ({
  default: () => null,
}));

function tradeState(overrides: Record<string, unknown> = {}) {
  return {
    showCreate: false,
    setShowCreate: vi.fn(),
    error: null,
    confirmCreate: false,
    createSubmitting: false,
    createSummary: null,
    createNetImpact: null,
    visibleKeys: [],
    outgoingPlayers: [],
    incomingPlayers: [],
    submitTrade: vi.fn(),
    selectedTrade: null,
    selectedDetails: null,
    detailLoading: false,
    gives: [],
    receives: [],
    teamNameByUserId: {},
    rosterCache: {},
    labels: {},
    reviewNetImpact: null,
    reviewTopGains: [],
    reviewTopRisks: [],
    reviewImpactLoading: false,
    reviewImpact: null,
    acceptEnabled: false,
    declineEnabled: false,
    counterEnabled: false,
    cancelEnabled: false,
    actionLoading: false,
    actionType: null,
    actionTradeId: null,
    runAction: vi.fn(),
    beginCounter: vi.fn(),
    reviewControls: null,
    loading: false,
    inboxStatusFilter: 'ALL',
    setInboxStatusFilter: vi.fn(),
    filteredIncomingTrades: [],
    filteredOutgoingTrades: [],
    pendingIncomingCount: 0,
    pendingOutgoingCount: 0,
    closedTradeCount: 0,
    details: {},
    setSelectedTradeId: vi.fn(),
    runActionForTrade: vi.fn(),
    ...overrides,
  };
}

describe('LeagueTradesClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuth.mockReturnValue({
      user: { uid: 'manager-1' },
    });
  });

  it('announces trade action errors while preserving the trade workspace', () => {
    mocks.useLeagueTrades.mockReturnValue(
      tradeState({
        error: 'This trade changed before your action completed. The latest trade state has been refreshed.',
      })
    );

    render(<LeagueTradesClient leagueId="league-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This trade changed before your action completed. The latest trade state has been refreshed.'
    );
    expect(screen.getByRole('button', { name: 'Create Trade' })).toBeInTheDocument();
    expect(screen.getByLabelText('Trade inbox rail')).toBeInTheDocument();
    expect(screen.getByLabelText('Trade review panel')).toBeInTheDocument();
  });
});
