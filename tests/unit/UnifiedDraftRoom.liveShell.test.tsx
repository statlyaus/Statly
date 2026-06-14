import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UnifiedDraftRoom from '@/components/draft/UnifiedDraftRoom';

type DraftRoomPlayerFixture = {
  id: string;
  name: string;
  position: string;
  club: string;
  adp: number;
  statlyZScore?: number;
};

const playerGridSpy = vi.hoisted(() => vi.fn());
const draftLeftRailSpy = vi.hoisted(() => vi.fn());

const draftContext = vi.hoisted<{
  status: 'SCHEDULED' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  availablePlayers: DraftRoomPlayerFixture[];
}>(() => ({
  status: 'LIVE',
  availablePlayers: [
    {
      id: 'player-1',
      name: 'Caleb Daniel',
      position: 'DEF',
      club: 'North Melbourne',
      adp: 1,
      statlyZScore: 1.2,
    },
  ],
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
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
  default: ({ contentId }: { contentId?: string }) => (
    <aside aria-label="Pick feed">
      <div id={contentId ?? 'pick-feed-content'}>
        Pick Feed
        <button type="button">Feed filter</button>
      </div>
    </aside>
  ),
}));

vi.mock('@/components/draft/DraftLeftRail', () => ({
  default: (props: {
    rosterSlots: Array<{ id: string; label: string; position?: string; player?: { name: string } }>;
    queuePanel: React.ReactNode;
    watchlistPanel: React.ReactNode;
  }) => {
    draftLeftRailSpy(props);

    return (
      <aside aria-label="Draft side panel">
        Draft left rail
        <ol aria-label="Roster slots">
          {props.rosterSlots.map((slot) => (
            <li key={slot.id}>
              {slot.label}
              {slot.player ? `: ${slot.player.name}` : null}
            </li>
          ))}
        </ol>
        <div>{props.queuePanel}</div>
        <div>{props.watchlistPanel}</div>
      </aside>
    );
  },
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
  default: (props: { players: Array<{ name: string }>; sortBy: string }) => {
    playerGridSpy(props);

    return (
      <div>
        Available player grid
        <ol aria-label="Rendered player order">
          {props.players.map((player) => (
            <li key={player.name}>{player.name}</li>
          ))}
        </ol>
      </div>
    );
  },
}));

vi.mock('@/contexts/DraftContext', () => ({
  useDraft: () => ({
    availablePlayers: draftContext.availablePlayers,
    canMakePick: false,
    connection: { status: 'disconnected' },
    draft: {
      id: 'draft-1',
      name: 'Test AFL Champions League - LIVE',
      leagueId: 'league-1',
      status: draftContext.status,
      currentPick: 1,
      totalPicks: 264,
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
    picks: [
      {
        id: 'pick-1',
        overall: 1,
        round: 1,
        slot: 1,
        player: {
          id: 'roster-player-1',
          name: 'Nick Daicos',
          position: 'DEF',
          club: 'Collingwood',
          isAvailable: false,
        },
        member: {
          id: 'member-1',
          userId: 'statly-dev-tester',
          displayName: 'Tester',
          teamName: 'Tester FC',
        },
        auto: false,
        madeAt: new Date('2026-06-01T10:00:00.000Z'),
      },
    ],
    removeFromWatchlist: vi.fn(),
    selectedCategories: [],
    toggleWatchlist: vi.fn(),
    updateQueue: vi.fn(),
    watchlistItems: [],
  }),
}));

describe('UnifiedDraftRoom live shell composition', () => {
  beforeEach(() => {
    playerGridSpy.mockClear();
    draftLeftRailSpy.mockClear();
    draftContext.status = 'LIVE';
    draftContext.availablePlayers = [
      {
        id: 'player-1',
        name: 'Caleb Daniel',
        position: 'DEF',
        club: 'North Melbourne',
        adp: 1,
        statlyZScore: 1.2,
      },
    ];
  });

  it('uses the live pick header as the only live status shell', () => {
    render(<UnifiedDraftRoom draftId="draft-1" userId="statly-dev-tester" />);

    expect(screen.getByRole('banner', { name: 'Live draft status' })).toBeInTheDocument();
    expect(screen.getByText('Test AFL Champions League - LIVE')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to drafts' })).toHaveAttribute(
      'href',
      '/drafts'
    );
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute(
      'href',
      '/drafts/history?leagueId=league-1'
    );
    expect(screen.getByText('Available player grid')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Draft side panel' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Pick feed' })).toBeInTheDocument();
    expect(screen.getByText('Draft queue panel')).toBeInTheDocument();
    expect(screen.getByText('Watchlist panel')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Draft room sections' })).not.toBeInTheDocument();

    expect(screen.queryByText('Current snake or linear cycle.')).not.toBeInTheDocument();
    expect(screen.queryByText('Live board position.')).not.toBeInTheDocument();
    expect(screen.queryByText('Connection: disconnected')).not.toBeInTheDocument();
  });

  it.each(['SCHEDULED', 'PAUSED', 'COMPLETED'] as const)(
    'renders the unified draft status header for %s drafts',
    (status) => {
      draftContext.status = status;

      render(<UnifiedDraftRoom draftId="draft-1" userId="statly-dev-tester" />);

      expect(screen.getByRole('banner', { name: 'Live draft status' })).toBeInTheDocument();
    }
  );

  it('links completed drafts directly to the archived roster review', () => {
    draftContext.status = 'COMPLETED';

    render(<UnifiedDraftRoom draftId="draft-1" userId="statly-dev-tester" />);

    expect(screen.getByRole('link', { name: 'Review completed draft' })).toHaveAttribute(
      'href',
      '/drafts/history/draft-1?leagueId=league-1'
    );
  });

  it('moves completed drafts into a distinct post-draft action flow', () => {
    draftContext.status = 'COMPLETED';

    render(<UnifiedDraftRoom draftId="draft-1" userId="statly-dev-tester" />);

    const nextSteps = screen.getByRole('region', { name: 'Draft complete next steps' });
    expect(nextSteps).toHaveTextContent('Draft complete');

    expect(
      screen.getByRole('link', { name: 'Go back to league hub' })
    ).toHaveAttribute('href', '/leagues/league-1');
    expect(
      screen.getByRole('link', { name: 'Review completed draft' })
    ).toHaveAttribute('href', '/drafts/history/draft-1?leagueId=league-1');
    expect(screen.getByRole('link', { name: 'Review my roster' })).toHaveAttribute(
      'href',
      '/leagues/league-1?tab=roster'
    );

    const background = screen.getByRole('region', { name: 'Completed draft background' });
    expect(background).toHaveAttribute('aria-disabled', 'true');
    expect(background).toHaveClass('opacity-45');
  });

  it('builds left-rail roster slots from draft settings and current user picks', () => {
    render(<UnifiedDraftRoom draftId="draft-1" userId="statly-dev-tester" />);

    const leftRailProps = draftLeftRailSpy.mock.calls.at(-1)?.[0];
    expect(leftRailProps.rosterSlots.map((slot: { label: string }) => slot.label)).toEqual([
      'DEF 1',
      'MID 1',
      'Bench 1',
      'Bench 2',
    ]);
    expect(leftRailProps.rosterSlots[0]).toEqual(
      expect.objectContaining({
        label: 'DEF 1',
        position: 'DEF',
        player: expect.objectContaining({ name: 'Nick Daicos' }),
      })
    );
    expect(leftRailProps.rosterSlots[1]).not.toHaveProperty('player');
    expect(leftRailProps.rosterSlots[2]).not.toHaveProperty('player');
    expect(leftRailProps.rosterSlots[3]).not.toHaveProperty('player');
  });

  it('defaults the player grid to Statly Z sorting with missing scores last', () => {
    draftContext.availablePlayers = [
      {
        id: 'player-1',
        name: 'Average Scored',
        position: 'MID',
        club: 'Adelaide',
        adp: 1,
        statlyZScore: 1.2,
      },
      {
        id: 'player-2',
        name: 'Pending Score',
        position: 'MID',
        club: 'Brisbane',
        adp: 2,
      },
      {
        id: 'player-3',
        name: 'Elite Scored',
        position: 'MID',
        club: 'Carlton',
        adp: 3,
        statlyZScore: 3.4,
      },
    ];

    render(<UnifiedDraftRoom draftId="draft-1" userId="statly-dev-tester" />);

    const playerGridProps = playerGridSpy.mock.calls.at(-1)?.[0];
    expect(playerGridProps.sortBy).toBe('statlyZ');
    expect(playerGridProps.players.map((player: { name: string }) => player.name)).toEqual([
      'Elite Scored',
      'Average Scored',
      'Pending Score',
    ]);
  });

  it('keeps desktop and mobile pick feed content ids unique when the mobile feed is open', () => {
    render(<UnifiedDraftRoom draftId="draft-1" userId="statly-dev-tester" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Pick Feed' }));

    expect(screen.getByRole('dialog', { name: 'Pick Feed' })).toBeInTheDocument();

    const feedContentIds = Array.from(
      document.querySelectorAll('[id^="pick-feed-content:draft-1"]')
    ).map((element) => element.id);

    expect(feedContentIds).toEqual([
      'pick-feed-content:draft-1:desktop',
      'pick-feed-content:draft-1:mobile',
    ]);
  });

  it('does not close the mobile pick feed when keyboard actions bubble from feed controls', () => {
    render(<UnifiedDraftRoom draftId="draft-1" userId="statly-dev-tester" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Pick Feed' }));

    const dialog = screen.getByRole('dialog', { name: 'Pick Feed' });
    const mobileFeedButton = screen.getAllByRole('button', { name: 'Feed filter' }).at(-1);

    expect(mobileFeedButton).toBeDefined();
    fireEvent.keyDown(mobileFeedButton as HTMLElement, { key: 'Enter' });

    expect(dialog).toBeInTheDocument();
  });

  it('closes the mobile pick feed when Escape bubbles from focused feed controls', () => {
    render(<UnifiedDraftRoom draftId="draft-1" userId="statly-dev-tester" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Pick Feed' }));

    const mobileFeedButton = screen.getAllByRole('button', { name: 'Feed filter' }).at(-1);

    expect(mobileFeedButton).toBeDefined();
    fireEvent.keyDown(mobileFeedButton as HTMLElement, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Pick Feed' })).not.toBeInTheDocument();
  });
});
