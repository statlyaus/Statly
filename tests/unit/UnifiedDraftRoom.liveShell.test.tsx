import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UnifiedDraftRoom from '@/components/draft/UnifiedDraftRoom';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
  useReducedMotion: () => true,
}));

vi.mock('@/components/ui', () => ({
  useConfirmation: () => ({
    confirm: vi.fn(),
    ConfirmationModal: null,
  }),
}));

vi.mock('@/components/ui/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/LivePickHeader', () => ({
  default: () => (
    <section role="banner" aria-label="Live draft status">
      Live pick header
    </section>
  ),
}));

vi.mock('@/components/PickFeed', () => ({
  default: () => <aside aria-label="Pick feed">Pick Feed</aside>,
}));

vi.mock('@/components/DraftWatchlist', () => ({
  default: () => <div>Watchlist panel</div>,
}));

vi.mock('@/components/draft/ConnectionStatus', () => ({
  default: () => <div>Connection status</div>,
}));

vi.mock('@/components/draft/DraftAnalytics', () => ({
  default: () => <div>Draft analytics panel</div>,
}));

vi.mock('@/components/draft/DraftControls', () => ({
  default: () => <div>Draft controls</div>,
}));

vi.mock('@/components/draft/DraftQueue', () => ({
  default: () => <div>Draft queue panel</div>,
}));

vi.mock('@/components/draft/DraftStatusBanner', () => ({
  default: () => <div>Draft status banner</div>,
}));

vi.mock('@/components/draft/PlayerGrid', () => ({
  default: () => <div>Available player grid</div>,
}));

vi.mock('@/contexts/DraftContext', () => ({
  useDraft: () => ({
    availablePlayers: [
      {
        id: 'player-1',
        name: 'Caleb Daniel',
        position: 'DEF',
        club: 'North Melbourne',
        adp: 1,
      },
    ],
    canMakePick: false,
    connection: { status: 'disconnected' },
    draft: {
      id: 'draft-1',
      name: 'Test AFL Champions League - LIVE',
      status: 'LIVE',
      currentPick: 1,
      totalPicks: 264,
      round: 1,
      settings: { timePerPick: 60, totalRounds: 22 },
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
        userId: 'statly-dev-tester',
        draftOrder: 1,
        role: 'OWNER',
        queue: [],
      },
      {
        id: 'member-2',
        userId: 'user-2',
        draftOrder: 2,
        queue: [],
      },
    ],
    picks: [],
    removeFromWatchlist: vi.fn(),
    selectedCategories: [],
    toggleWatchlist: vi.fn(),
    updateQueue: vi.fn(),
    watchlistItems: [],
  }),
}));

describe('UnifiedDraftRoom live shell composition', () => {
  it('uses the live pick header as the only live status shell', () => {
    render(<UnifiedDraftRoom draftId="draft-1" userId="statly-dev-tester" />);

    expect(screen.getByRole('banner', { name: 'Live draft status' })).toBeInTheDocument();
    expect(screen.getByText('Test AFL Champions League - LIVE')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to drafts' })).toHaveAttribute(
      'href',
      '/drafts'
    );
    expect(screen.getByText('Available player grid')).toBeInTheDocument();

    expect(screen.queryByText('Current snake or linear cycle.')).not.toBeInTheDocument();
    expect(screen.queryByText('Live board position.')).not.toBeInTheDocument();
    expect(screen.queryByText('Connection: disconnected')).not.toBeInTheDocument();
  });
});
