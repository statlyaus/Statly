import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UnifiedDraftRoom from './UnifiedDraftRoom';

const mocks = vi.hoisted(() => ({
  forceRefresh: vi.fn(),
  useDraft: vi.fn(),
}));

vi.mock('@/contexts/DraftContext', () => ({
  useDraft: mocks.useDraft,
}));

vi.mock('@/components/DraftWatchlist', () => ({
  default: () => <div>Draft watchlist</div>,
}));

vi.mock('@/components/LivePickHeader', () => ({
  default: () => <div>Live pick header</div>,
}));

vi.mock('@/components/PickFeed', () => ({
  default: () => <div>Pick feed</div>,
}));

vi.mock('@/components/ui', () => ({
  useConfirmation: () => ({
    confirm: vi.fn(),
    ConfirmationModal: null,
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    },
    useReducedMotion: () => true,
  };
});

vi.mock('./ConnectionStatus', () => ({
  default: () => <div>Connection connected</div>,
}));

vi.mock('./DraftAnalytics', () => ({
  default: () => <div>Draft analytics</div>,
}));

vi.mock('./DraftControls', () => ({
  default: () => <div>Draft controls</div>,
}));

vi.mock('./DraftQueue', () => ({
  default: () => <div>Draft queue</div>,
}));

vi.mock('./PlayerGrid', () => ({
  default: () => <div>Player grid</div>,
}));

function scheduledDraftContext() {
  const now = new Date('2026-05-20T10:00:00.000Z');

  return {
    draftId: 'draft-1',
    userId: 'owner-1',
    draft: {
      id: 'draft-1',
      leagueId: 'league-1',
      name: 'Fixture Draft',
      status: 'SCHEDULED',
      currentPick: 1,
      totalPicks: 24,
      round: 1,
      direction: 'FORWARD',
      participants: [],
      picks: [],
      availablePlayers: [],
      settings: {
        name: 'Fixture Draft',
        leagueId: 'league-1',
        leagueSize: 12,
        draftType: 'SNAKE',
        timePerPick: 120,
        timeZone: 'Australia/Melbourne',
        enableReminders: false,
        totalRounds: 2,
        rosterSize: 22,
        startingLineup: {},
        benchSize: 4,
        allowTrades: true,
        autoPickEnabled: true,
        pauseOnDisconnect: false,
        maxPauseDuration: 300,
      },
      createdAt: now,
      updatedAt: now,
      lastActivity: now,
    },
    participants: [
      {
        id: 'member-1',
        userId: 'owner-1',
        displayName: 'Owner',
        draftOrder: 1,
        isOnline: true,
        lastSeen: now,
        isCurrentTurn: false,
        queue: [],
      },
    ],
    picks: [],
    availablePlayers: [],
    selectedCategories: [],
    watchlistItems: [],
    liveState: {},
    connection: { status: 'connected' },
    isLoading: false,
    isSaving: false,
    error: null,
    appliedEventIds: [],
    makePick: vi.fn(),
    updateQueue: vi.fn(),
    addToWatchlist: vi.fn(),
    removeFromWatchlist: vi.fn(),
    toggleWatchlist: vi.fn(),
    isInWatchlist: vi.fn(() => false),
    forceRefresh: mocks.forceRefresh,
    canMakePick: false,
  };
}

describe('UnifiedDraftRoom scheduled draft controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    );
    mocks.useDraft.mockReturnValue(scheduledDraftContext());
  });

  it('starts a scheduled draft before refreshing the room state', async () => {
    render(<UnifiedDraftRoom draftId="draft-1" userId="owner-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Start draft now' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/drafts/draft-1/start', { method: 'POST' });
    });
    expect(mocks.forceRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft room visible for recoverable draft action errors', () => {
    mocks.useDraft.mockReturnValue({
      ...scheduledDraftContext(),
      error: 'That player was just drafted. Refreshing the board.',
    });

    render(<UnifiedDraftRoom draftId="draft-1" userId="owner-1" />);

    expect(screen.queryByRole('heading', { name: 'Draft Error' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Draft action failed. That player was just drafted. Refreshing the board.'
    );
    expect(screen.getByRole('button', { name: 'Start draft now' })).toBeInTheDocument();
  });

  it('surfaces scheduled draft start failures without hiding the room', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Draft service unavailable' }), { status: 503 })
    );

    render(<UnifiedDraftRoom draftId="draft-1" userId="owner-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Start draft now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Draft service unavailable');
    expect(screen.getByRole('button', { name: 'Start draft now' })).toBeInTheDocument();
    expect(mocks.forceRefresh).not.toHaveBeenCalled();
  });
});
