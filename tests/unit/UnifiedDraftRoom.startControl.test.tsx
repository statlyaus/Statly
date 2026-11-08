import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UnifiedDraftRoom from '@/components/draft/UnifiedDraftRoom';

const room = vi.hoisted(() => ({ viewerCanManage: false }));
const startDraftSpy = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/ui/Modal', () => ({
  useConfirmation: () => ({ confirm: vi.fn(), ConfirmationModal: null }),
}));
vi.mock('@/components/league/social', () => ({
  useLeagueSocialWidget: () => ({ open: vi.fn(), setLeagueContext: vi.fn() }),
}));
vi.mock('@/components/ui/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/LivePickHeader', () => ({ default: () => null }));
vi.mock('@/components/PickFeed', () => ({ default: () => null }));
vi.mock('@/components/draft/DraftLeftRail', () => ({ default: () => null }));
vi.mock('@/components/DraftWatchlist', () => ({ default: () => null }));
vi.mock('@/components/draft/ConnectionStatus', () => ({ default: () => null }));
vi.mock('@/components/draft/DraftControls', () => ({ default: () => null }));
vi.mock('@/components/draft/DraftQueue', () => ({ default: () => null }));
vi.mock('@/components/draft/PlayerGrid', () => ({ default: () => null }));

vi.mock('@/contexts/DraftContext', () => ({
  useDraft: () => ({
    availablePlayers: [],
    canMakePick: false,
    isYourTurn: false,
    pickFeedback: null,
    dismissPickFeedback: vi.fn(),
    startFeedback: null,
    dismissStartFeedback: vi.fn(),
    startDraft: startDraftSpy,
    connection: { status: 'connected', needsResync: false },
    draft: {
      id: 'draft-1',
      name: 'Friendly League',
      leagueId: 'league-1',
      status: 'SCHEDULED',
      currentPick: 1,
      totalPicks: 88,
      round: 1,
      settings: {
        timePerPick: 60,
        totalRounds: 22,
        rosterSize: 4,
        startingLineup: { DEF: 1, MID: 1 },
        benchSize: 2,
      },
    },
    draftReadiness: { blockers: [] },
    error: null,
    forceRefresh: vi.fn(),
    isLoading: false,
    isSaving: false,
    liveState: { isYourTurn: false },
    makePick: vi.fn(),
    participants: [
      {
        id: 'member-1',
        userId: 'viewer',
        draftOrder: 1,
        canManageDraft: room.viewerCanManage,
        queue: [],
      },
      { id: 'member-2', userId: 'user-2', draftOrder: 2, queue: [] },
    ],
    picks: [],
    removeFromWatchlist: vi.fn(),
    selectedCategories: [],
    toggleWatchlist: vi.fn(),
    updateQueue: vi.fn(),
    watchlistItems: [],
  }),
}));

describe('UnifiedDraftRoom start control', () => {
  beforeEach(() => {
    room.viewerCanManage = false;
    startDraftSpy.mockReset();
  });

  it('offers the commissioner the early start', () => {
    room.viewerCanManage = true;
    render(<UnifiedDraftRoom draftId="draft-1" userId="viewer" />);

    expect(screen.getByRole('button', { name: 'Start draft now' })).toBeInTheDocument();
  });

  it('does not offer an ordinary manager a start the server would refuse', () => {
    render(<UnifiedDraftRoom draftId="draft-1" userId="viewer" />);

    expect(screen.queryByRole('button', { name: 'Start draft now' })).toBeNull();
    expect(
      screen.getByText(/The commissioner can start early, or it starts at the scheduled time\./)
    ).toBeInTheDocument();
  });
});
