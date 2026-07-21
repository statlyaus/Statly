import { render, screen, waitFor } from '@testing-library/react';
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
  teams: [
    {
      memberId: 'member-1',
      userId: 'user-1',
      teamName: 'Alpha FC',
      teamLogoUrl: null,
      isViewer: true,
      players: [{ id: 'player-1', name: 'Alex Alpha', club: 'AAA', position: 'MID' }],
    },
    {
      memberId: 'member-2',
      userId: 'user-2',
      teamName: 'Beta FC',
      teamLogoUrl: null,
      isViewer: false,
      players: [{ id: 'player-2', name: 'Bailey Beta', club: 'BBB', position: 'FWD' }],
    },
  ],
  trades: [
    {
      id: 'trade-1',
      status: 'open',
      version: 2,
      memberOne: { memberId: 'member-2', teamName: 'Beta FC', teamLogoUrl: null },
      memberTwo: { memberId: 'member-1', teamName: 'Alpha FC', teamLogoUrl: null },
      currentOffer: {
        id: 'offer-1',
        sequence: 1,
        proposerMemberId: 'member-2',
        recipientMemberId: 'member-1',
        status: 'pending',
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

    expect(screen.getByRole('heading', { name: 'Trade Centre' })).toBeInTheDocument();
    expect(screen.getByText('Commissioner approval')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Players from Alpha FC' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Players from Beta FC' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Bailey Beta/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Accept trade' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Counteroffer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Inbox/ })).toHaveAttribute('aria-current', 'page');
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

  it('submits a roster-backed proposal with an idempotency key and refreshes', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('checkbox', { name: /Alex Alpha/ }));
    await user.type(screen.getByRole('textbox', { name: /Message/ }), 'Let us swap');
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
    await user.click(screen.getByRole('button', { name: 'Send proposal' }));
    await screen.findByText('Temporary response failure');
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
    await screen.findByText('Temporary response failure');
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

function renderPanel() {
  return render(
    <LeagueTradeCentrePanel
      leagueId="league-1"
      currentUserId="user-1"
      initialSnapshot={snapshot}
      requestedPlayerId="player-2"
      ownerMemberId="member-2"
    />
  );
}
