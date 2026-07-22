import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LeagueTradeCentreSnapshot } from '@/server/leagues/trades/tradeContracts';

import { LeagueTradeCentrePanel } from './LeagueTradeCentrePanel';

const { replace, refresh, authenticatedFetch } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  authenticatedFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname: () => '/leagues/league-1',
  useSearchParams: () => new URLSearchParams('tab=trades&playerId=player-2'),
}));

vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch }));
vi.mock('@/components/league/LeagueSocialDiscussButton', () => ({
  LeagueSocialDiscussButton: ({
    context,
    label,
  }: {
    context: { title: string };
    label: string;
  }) => <button aria-label={`${label}: ${context.title}`}>{label}</button>,
}));

const snapshot: LeagueTradeCentreSnapshot = {
  leagueId: 'league-1',
  viewerMemberId: 'member-1',
  isCommissioner: false,
  rules: {
    limit: 10,
    reviewMode: 'admin',
    deadline: null,
    offerExpiryHours: 72,
    reviewHours: 24,
    vetoThreshold: 3,
  },
  playerStats: {
    context: {
      basis: 'PER_GAME',
      period: 'SEASON',
      season: 2026,
      availableSeasons: [2026],
      dataThrough: '2026-07-20',
    },
    columns: [
      {
        key: 'kicks',
        label: 'Kicks',
        shortLabel: 'K',
        format: 'number',
        direction: 'HIGH_WINS',
      },
    ],
    playersById: {
      'player-1': { gamesPlayed: 12, values: { kicks: 20 } },
      'player-2': { gamesPlayed: 12, values: { kicks: 24 } },
    },
  },
  teams: [
    {
      memberId: 'member-1',
      teamName: 'Alpha FC',
      teamLogoUrl: null,
      isViewer: true,
      players: [{ id: 'player-1', name: 'Alex Alpha', club: 'AAA', position: 'MID' }],
    },
    {
      memberId: 'member-2',
      teamName: 'Beta FC',
      teamLogoUrl: null,
      isViewer: false,
      players: [{ id: 'player-2', name: 'Bailey Beta', club: 'BBB', position: 'FWD' }],
    },
  ],
  trades: [
    {
      id: 'trade-1',
      status: 'PENDING',
      version: 2,
      memberOne: { memberId: 'member-2', teamName: 'Beta FC', teamLogoUrl: null },
      memberTwo: { memberId: 'member-1', teamName: 'Alpha FC', teamLogoUrl: null },
      currentOffer: {
        id: 'offer-1',
        sequence: 1,
        proposerMemberId: 'member-2',
        recipientMemberId: 'member-1',
        status: 'PENDING',
        message: 'A fair swap',
        expiresAt: '2026-07-24T10:00:00.000Z',
        reviewMode: 'admin',
        reviewEndsAt: null,
        vetoThreshold: 3,
        vetoCount: 0,
        players: [
          {
            id: 'player-2',
            name: 'Bailey Beta',
            club: 'BBB',
            position: 'FWD',
            fromMemberId: 'member-2',
            toMemberId: 'member-1',
          },
          {
            id: 'player-1',
            name: 'Alex Alpha',
            club: 'AAA',
            position: 'MID',
            fromMemberId: 'member-1',
            toMemberId: 'member-2',
          },
        ],
        createdAt: '2026-07-21T10:00:00.000Z',
        updatedAt: '2026-07-21T10:00:00.000Z',
      },
      offerHistory: [],
      events: [],
      completedAt: null,
      resolvedAt: null,
      createdAt: '2026-07-21T10:00:00.000Z',
      updatedAt: '2026-07-21T10:00:00.000Z',
      allowedActions: ['accept', 'decline', 'counter'],
    },
  ],
  counts: { inbox: 1, sent: 0, history: 0, review: 0 },
  activeView: 'inbox',
  nextCursor: null,
};

describe('LeagueTradeCentrePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticatedFetch.mockResolvedValue(
      new Response(JSON.stringify({ threadId: 'trade-2', status: 'OPEN' }), { status: 201 })
    );
  });

  it('renders real rosters, governance, deep-link selection, filters, and available actions', () => {
    renderPanel();

    const title = screen.getByRole('heading', { name: 'Trade Centre' });
    const proposeHeading = screen.getByRole('heading', { name: 'Propose a trade' });
    const offersHeading = screen.getByRole('heading', { name: 'Offers' });
    const inboxButton = screen.getByRole('button', { name: /Inbox/ });
    expect(title).toHaveClass('text-[1.75rem]');
    expect(title.previousElementSibling).toHaveClass('text-xs');
    expect(proposeHeading).toHaveClass('text-lg');
    expect(offersHeading).toHaveClass('text-lg');
    expect(inboxButton).toHaveClass('h-11', 'bg-[color:var(--trade-selection)]');
    expect(screen.getByText('Commissioner approval')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alpha FC sends' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Beta FC sends' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Trade partner' })).toHaveValue('member-2');
    expect(screen.getByRole('checkbox', { name: /Bailey Beta/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Review trade' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Accept trade' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Counteroffer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trade with Beta FC' })).toBeInTheDocument();
    expect(screen.getByText(/^Offer 1 ·/)).toHaveClass('text-xs');
    expect(screen.getByText('Awaiting response')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'You send package from Alpha FC' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'You receive from Beta FC package from Beta FC' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: /Alpha FC sends.*Season 2026 per-game averages/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Discuss trade: Beta FC and Alpha FC' })
    ).toBeInTheDocument();
    expect(inboxButton).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the unavailable state title and warning surface in the approved hierarchy', () => {
    render(
      <LeagueTradeCentrePanel
        leagueId="league-1"
        currentUserId="user-1"
        initialSnapshot={null}
        initialError="Trade data is unavailable."
      />
    );

    expect(screen.getByRole('heading', { name: 'Trade Centre' })).toHaveClass('text-[1.75rem]');
    expect(screen.getByRole('alert')).toHaveClass('bg-[color:var(--trade-warning-soft)]');
  });

  it('keeps offer filters in the canonical league tab URL', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /History/ }));

    expect(replace).toHaveBeenCalledWith(
      '/leagues/league-1?tab=trades&playerId=player-2&tradeView=history',
      { scroll: false }
    );
  });

  it('keeps a local partner change when the deep-link preference has not changed', async () => {
    const user = userEvent.setup();
    const snapshotWithThirdTeam: LeagueTradeCentreSnapshot = {
      ...snapshot,
      teams: [
        ...snapshot.teams,
        {
          memberId: 'member-3',
          teamName: 'Gamma FC',
          teamLogoUrl: null,
          isViewer: false,
          players: [{ id: 'player-3', name: 'Gale Gamma', club: 'CCC', position: 'DEF' }],
        },
      ],
    };
    const rendered = renderPanel(snapshotWithThirdTeam);

    const partner = screen.getByRole('combobox', { name: 'Trade partner' });
    expect(partner).toHaveValue('member-2');
    expect(screen.getByRole('checkbox', { name: /Bailey Beta/ })).toBeChecked();

    await user.selectOptions(partner, 'member-3');

    expect(partner).toHaveValue('member-3');
    expect(screen.getByRole('heading', { name: 'Gamma FC sends' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Beta FC sends' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Gale Gamma/ })).not.toBeChecked();
    expect(screen.getByText('0 players selected')).toBeInTheDocument();

    rendered.rerender(createPanel(createSnapshotWithThirdTeam()));

    await waitFor(() => expect(partner).toHaveValue('member-3'));
    expect(screen.getByRole('heading', { name: 'Gamma FC sends' })).toBeInTheDocument();
    expect(screen.getByText('0 players selected')).toBeInTheDocument();
  });

  it('reinitializes the selected package when the deep-link tuple changes', async () => {
    const snapshotWithThirdTeam = createSnapshotWithThirdTeam();
    const rendered = render(
      createPanel(snapshotWithThirdTeam, {
        requestedPlayerId: 'player-2',
        ownerMemberId: 'member-2',
      })
    );

    expect(screen.getByRole('checkbox', { name: /Bailey Beta/ })).toBeChecked();

    rendered.rerender(
      createPanel(snapshotWithThirdTeam, {
        requestedPlayerId: 'player-3',
        ownerMemberId: 'member-3',
      })
    );

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Trade partner' })).toHaveValue('member-3')
    );
    expect(screen.getByRole('checkbox', { name: /Gale Gamma/ })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Bailey Beta/ })).not.toBeInTheDocument();
    expect(screen.getByText('1 player selected')).toBeInTheDocument();
  });

  it('uses roster ownership before a stale deep-link owner hint', () => {
    render(
      createPanel(createSnapshotWithThirdTeam(), {
        requestedPlayerId: 'player-3',
        ownerMemberId: 'member-2',
      })
    );

    expect(screen.getByRole('combobox', { name: 'Trade partner' })).toHaveValue('member-3');
    expect(screen.getByRole('checkbox', { name: /Gale Gamma/ })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Bailey Beta/ })).not.toBeInTheDocument();
  });

  it('falls back to a valid partner initially and when the selected partner leaves', async () => {
    const user = userEvent.setup();
    const snapshotWithThirdTeam = createSnapshotWithThirdTeam();
    const rendered = render(
      createPanel(snapshotWithThirdTeam, {
        requestedPlayerId: 'missing-player',
        ownerMemberId: 'missing-member',
      })
    );
    const partner = screen.getByRole('combobox', { name: 'Trade partner' });

    expect(partner).toHaveValue('member-2');
    await user.selectOptions(partner, 'member-3');
    expect(partner).toHaveValue('member-3');

    rendered.rerender(
      createPanel(snapshot, {
        requestedPlayerId: 'missing-player',
        ownerMemberId: 'missing-member',
      })
    );

    await waitFor(() => expect(partner).toHaveValue('member-2'));
    expect(screen.getByRole('heading', { name: 'Beta FC sends' })).toBeInTheDocument();
  });

  it('reviews before submitting a roster-backed proposal and preserves the request contract', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('checkbox', { name: /Alex Alpha/ }));
    const reviewButton = screen.getByRole('button', { name: 'Review trade' });
    expect(reviewButton).toBeEnabled();

    await user.click(reviewButton);

    expect(authenticatedFetch).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Review trade proposal' })).toHaveFocus()
    );
    expect(screen.getByRole('region', { name: 'You send package' })).toHaveTextContent(
      'Alex Alpha'
    );
    expect(screen.getByRole('region', { name: 'You receive package' })).toHaveTextContent(
      'Bailey Beta'
    );
    expect(screen.getByText('No league deadline')).toBeInTheDocument();
    expect(screen.getByText('Expires 72 hours after sending')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Package comparison' })).toHaveLength(1);

    await user.type(screen.getByRole('textbox', { name: 'Message (optional)' }), 'Let us swap');
    await user.click(screen.getByRole('button', { name: 'Send proposal' }));

    await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(1));
    const [path, request] = authenticatedFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/leagues/league-1/trades');
    expect(JSON.parse(String(request.body))).toEqual({
      recipientMemberId: 'member-2',
      sendingPlayerIds: ['player-1'],
      receivingPlayerIds: ['player-2'],
      message: 'Let us swap',
      idempotencyKey: expect.stringMatching(/^trade:proposal:/),
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Propose a trade' })).toHaveFocus()
    );
  });

  it('reconciles removed roster players before review rendering or submission', async () => {
    const user = userEvent.setup();
    const rendered = renderPanel();

    await user.click(screen.getByRole('checkbox', { name: /Alex Alpha/ }));
    await user.click(screen.getByRole('button', { name: 'Review trade' }));
    expect(screen.getByRole('region', { name: 'You send package' })).toHaveTextContent(
      'Alex Alpha'
    );

    const snapshotWithoutSelectedViewer: LeagueTradeCentreSnapshot = {
      ...snapshot,
      teams: snapshot.teams.map((team) =>
        team.memberId === 'member-1' ? { ...team, players: [] } : team
      ),
    };
    rendered.rerender(createPanel(snapshotWithoutSelectedViewer));

    const sendingPackage = screen.getByRole('region', { name: 'You send package' });
    expect(within(sendingPackage).queryByText('Alex Alpha')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send proposal' }));
    expect(authenticatedFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The selected trade package is incomplete. Return to edit and review it.'
    );

    await user.click(screen.getByRole('button', { name: 'Back to edit' }));
    expect(screen.getByText('1 player selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review trade' })).toBeDisabled();

    rendered.rerender(createPanel(snapshot));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Alex Alpha/ })).not.toBeChecked()
    );
    expect(screen.getByRole('checkbox', { name: /Bailey Beta/ })).toBeChecked();
    expect(screen.getByText('1 player selected')).toBeInTheDocument();
  });

  it('preserves selections and the controlled message when returning to edit', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('checkbox', { name: /Alex Alpha/ }));
    await user.click(screen.getByRole('button', { name: 'Review trade' }));
    const message = screen.getByRole('textbox', { name: 'Message (optional)' });
    await user.type(message, 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Back to edit' }));

    const reviewButton = screen.getByRole('button', { name: 'Review trade' });
    await waitFor(() => expect(reviewButton).toHaveFocus());
    expect(screen.getByRole('checkbox', { name: /Alex Alpha/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Bailey Beta/ })).toBeChecked();

    await user.click(reviewButton);
    expect(screen.getByRole('textbox', { name: 'Message (optional)' })).toHaveValue(
      'Keep this draft'
    );
    expect(authenticatedFetch).not.toHaveBeenCalled();
  });

  it('keeps the selection tray visible in a bounded composer and clears partial selections', async () => {
    const user = userEvent.setup();
    renderPanel();

    const composer = document.querySelector('[data-trade-composer]');
    const content = document.querySelector('[data-trade-composer-content]');
    const tray = document.querySelector('[data-trade-selection-tray]');
    expect(composer).toHaveClass('h-[clamp(28rem,65dvh,42rem)]', 'min-h-0');
    expect(content).toHaveClass(
      'min-h-0',
      'flex-1',
      'overflow-y-auto',
      'overscroll-contain',
      'min-w-0'
    );
    expect(tray).toHaveClass('shrink-0');
    expect(tray?.parentElement).toBe(composer);

    expect(screen.getByText('1 player selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review trade' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Clear selected players' }));

    expect(screen.getByText('0 players selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Bailey Beta/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Clear selected players' })).toBeDisabled();
    expect(authenticatedFetch).not.toHaveBeenCalled();
  });

  it('reuses the proposal idempotency key when a committed response must be retried', async () => {
    const user = userEvent.setup();
    authenticatedFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Temporary response failure' }), { status: 503 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ threadId: 'trade-2', status: 'OPEN' }), { status: 201 })
      );
    renderPanel();

    await user.click(screen.getByRole('checkbox', { name: /Alex Alpha/ }));
    await user.click(screen.getByRole('button', { name: 'Review trade' }));
    await user.type(screen.getByRole('textbox', { name: 'Message (optional)' }), 'Retry me');
    await user.click(screen.getByRole('button', { name: 'Send proposal' }));
    const submissionAlert = await screen.findByRole('alert');

    expect(submissionAlert).toHaveTextContent('Temporary response failure');
    expect(submissionAlert).toHaveClass('bg-[color:var(--trade-warning-soft)]');
    expect(submissionAlert.className).not.toMatch(/trade-(?:send|receive|positive|negative)/);
    expect(screen.getByRole('heading', { name: 'Review trade proposal' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message (optional)' })).toHaveValue('Retry me');
    expect(screen.getByRole('region', { name: 'You send package' })).toHaveTextContent(
      'Alex Alpha'
    );
    expect(screen.getByRole('region', { name: 'You receive package' })).toHaveTextContent(
      'Bailey Beta'
    );
    await user.click(screen.getByRole('button', { name: 'Send proposal' }));

    await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(2));
    const firstBody = JSON.parse(
      String((authenticatedFetch.mock.calls[0]?.[1] as RequestInit).body)
    );
    const secondBody = JSON.parse(
      String((authenticatedFetch.mock.calls[1]?.[1] as RequestInit).body)
    );
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the counteroffer partner locked and exposes cancellation in edit and review', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Counteroffer' }));
    expect(screen.getByRole('heading', { name: 'Build a counteroffer' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Trade partner' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Trade partner' })).toHaveValue('member-2');
    expect(screen.getByRole('button', { name: 'Cancel counteroffer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review trade' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Cancel counteroffer' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Propose a trade' })).toHaveFocus()
    );

    await user.click(screen.getByRole('button', { name: 'Counteroffer' }));
    await user.click(screen.getByRole('checkbox', { name: /Alex Alpha/ }));
    await user.click(screen.getByRole('checkbox', { name: /Bailey Beta/ }));
    await user.click(screen.getByRole('button', { name: 'Review trade' }));

    expect(screen.getByRole('button', { name: 'Send counteroffer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel counteroffer' })).toBeInTheDocument();
    expect(authenticatedFetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel counteroffer' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Propose a trade' })).toHaveFocus()
    );
  });

  it('invalidates a counteroffer instead of retargeting it when its partner leaves', async () => {
    const user = userEvent.setup();
    const snapshotWithThirdTeam = createSnapshotWithThirdTeam();
    const rendered = renderPanel(snapshotWithThirdTeam);

    await user.click(screen.getByRole('button', { name: 'Counteroffer' }));
    expect(screen.getByRole('combobox', { name: 'Trade partner' })).toHaveValue('member-2');

    rendered.rerender(
      createPanel({
        ...snapshotWithThirdTeam,
        teams: snapshotWithThirdTeam.teams.filter((team) => team.memberId !== 'member-2'),
      })
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This counteroffer is no longer available because the original trade partner is not active.'
    );
    expect(screen.queryByRole('combobox', { name: 'Trade partner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Gamma FC sends' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review trade' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel counteroffer' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Propose a trade' })).toHaveFocus()
    );
  });

  it('ignores proposal deep-link changes while a counteroffer is active', async () => {
    const user = userEvent.setup();
    const snapshotWithThirdTeam = createSnapshotWithThirdTeam();
    const rendered = renderPanel(snapshotWithThirdTeam);

    await user.click(screen.getByRole('button', { name: 'Counteroffer' }));
    await user.click(screen.getByRole('checkbox', { name: /Alex Alpha/ }));
    await user.click(screen.getByRole('checkbox', { name: /Bailey Beta/ }));

    rendered.rerender(
      createPanel(snapshotWithThirdTeam, {
        requestedPlayerId: 'player-3',
        ownerMemberId: 'member-3',
      })
    );

    expect(screen.getByRole('combobox', { name: 'Trade partner' })).toHaveValue('member-2');
    expect(screen.getByRole('checkbox', { name: /Alex Alpha/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Bailey Beta/ })).toBeChecked();
    expect(screen.queryByRole('heading', { name: 'Gamma FC sends' })).not.toBeInTheDocument();
  });

  it('focuses the stable composer heading after a successful counteroffer', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Counteroffer' }));
    await user.click(screen.getByRole('checkbox', { name: /Alex Alpha/ }));
    await user.click(screen.getByRole('checkbox', { name: /Bailey Beta/ }));
    await user.click(screen.getByRole('button', { name: 'Review trade' }));
    await user.click(screen.getByRole('button', { name: 'Send counteroffer' }));

    await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(1));
    expect(authenticatedFetch.mock.calls[0]?.[0]).toBe(
      '/api/leagues/league-1/trades/trade-1/actions'
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Propose a trade' })).toHaveFocus()
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps offer-action errors accessible while a counteroffer is active', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    authenticatedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'The offer changed before acceptance.' }), {
        status: 409,
      })
    );
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Counteroffer' }));
    await user.click(screen.getByRole('button', { name: 'Accept trade' }));

    const actionAlert = await screen.findByRole('alert');
    expect(actionAlert).toHaveTextContent('The offer changed before acceptance.');
    expect(actionAlert).toHaveClass('bg-[color:var(--trade-warning-soft)]');
    expect(screen.getByRole('heading', { name: 'Build a counteroffer' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Trade partner' })).toBeDisabled();
  });

  it('preserves a composer submission error when offer confirmation is cancelled', async () => {
    const user = userEvent.setup();
    authenticatedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Keep this composer error.' }), { status: 409 })
    );
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPanel();

    await user.click(screen.getByRole('checkbox', { name: /Alex Alpha/ }));
    await user.click(screen.getByRole('button', { name: 'Review trade' }));
    await user.click(screen.getByRole('button', { name: 'Send proposal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep this composer error.');

    await user.click(screen.getByRole('button', { name: 'Accept trade' }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Keep this composer error.');
    expect(screen.getByRole('heading', { name: 'Review trade proposal' })).toBeInTheDocument();
  });

  it('confirms acceptance before posting the expected trade version', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    authenticatedFetch.mockResolvedValue(
      new Response(JSON.stringify({ threadId: 'trade-1', status: 'PENDING_ADMIN_REVIEW' }), {
        status: 200,
      })
    );
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Accept trade' }));

    await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(1));
    const [path, request] = authenticatedFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/leagues/league-1/trades/trade-1/actions');
    expect(JSON.parse(String(request.body))).toEqual({
      action: 'accept',
      expectedVersion: 2,
      idempotencyKey: expect.stringMatching(/^trade:accept:/),
    });
  });

  it('reuses an action idempotency key when a committed response must be retried', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    authenticatedFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Temporary response failure' }), { status: 503 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ threadId: 'trade-1', status: 'PENDING_ADMIN_REVIEW' }), {
          status: 200,
        })
      );
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Accept trade' }));
    const actionAlert = await screen.findByRole('alert');
    expect(actionAlert).toHaveClass('bg-[color:var(--trade-warning-soft)]');
    expect(actionAlert.className).not.toMatch(/trade-(?:send|receive|positive|negative)/);
    await user.click(screen.getByRole('button', { name: 'Accept trade' }));

    await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(2));
    const firstBody = JSON.parse(
      String((authenticatedFetch.mock.calls[0]?.[1] as RequestInit).body)
    );
    const secondBody = JSON.parse(
      String((authenticatedFetch.mock.calls[1]?.[1] as RequestInit).body)
    );
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

function renderPanel(snapshotOverride: LeagueTradeCentreSnapshot = snapshot) {
  return render(createPanel(snapshotOverride));
}

function createPanel(
  snapshotOverride: LeagueTradeCentreSnapshot = snapshot,
  deepLink: { requestedPlayerId?: string | null; ownerMemberId?: string | null } = {
    requestedPlayerId: 'player-2',
    ownerMemberId: 'member-2',
  }
) {
  return (
    <LeagueTradeCentrePanel
      leagueId="league-1"
      currentUserId="user-1"
      initialSnapshot={snapshotOverride}
      requestedPlayerId={deepLink.requestedPlayerId}
      ownerMemberId={deepLink.ownerMemberId}
    />
  );
}

function createSnapshotWithThirdTeam(): LeagueTradeCentreSnapshot {
  return {
    ...snapshot,
    teams: [
      ...snapshot.teams,
      {
        memberId: 'member-3',
        teamName: 'Gamma FC',
        teamLogoUrl: null,
        isViewer: false,
        players: [{ id: 'player-3', name: 'Gale Gamma', club: 'CCC', position: 'DEF' }],
      },
    ],
  };
}
