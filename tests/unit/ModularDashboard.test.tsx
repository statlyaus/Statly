import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ManagerHomeLeague } from '@/server/dashboard/managerHome';

const fetchJsonMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ fetchJson: fetchJsonMock }));
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import ModularDashboard, {
  buildNeedsYou,
  sortLeagues,
  formatLeagueTime,
  leagueStatusLabel,
  matchupResultLine,
} from '@/components/ModularDashboard';

const now = new Date('2026-09-26T10:00:00.000Z');

function league(overrides: Partial<ManagerHomeLeague> = {}): ManagerHomeLeague {
  return {
    leagueId: 'league-1',
    leagueName: 'Friday Night League',
    teamName: 'Ball Magnets',
    role: 'manager',
    memberCount: 8,
    maxTeams: 10,
    logoUrl: null,
    timeZone: 'Australia/Melbourne',
    seasonLabel: '2026 Season',
    status: { kind: 'season_setup' },
    record: null,
    matchup: null,
    lineup: null,
    form: [],
    ladder: null,
    tradeOffersAwaitingYou: { count: 0, earliestExpiresAt: null },
    pendingWaiverClaims: 0,
    ...overrides,
  };
}

const user = { uid: 'user-1', email: 'tester@statly.dev' } as never;

describe('buildNeedsYou', () => {
  it('ranks a live draft above trade offers, live rounds and waiver claims', () => {
    const items = buildNeedsYou(
      [
        league({ leagueId: 'a', pendingWaiverClaims: 2 }),
        league({
          leagueId: 'b',
          status: { kind: 'round_live', roundLabel: 'Round 4', endsAt: null },
          tradeOffersAwaitingYou: { count: 1, earliestExpiresAt: '2026-09-27T09:00:00.000Z' },
        }),
        league({
          leagueId: 'c',
          status: { kind: 'draft_live', draftId: 'draft-1', currentPick: 12, totalPicks: 220 },
          lineup: { roundLabel: 'Round 5', filled: 15, required: 19, locksAt: null },
        }),
      ],
      now
    );

    expect(items.map((item) => item.title)).toEqual([
      'Your draft is live',
      '1 trade offer to answer',
      '4 empty lineup spots for Round 5',
      '2 waiver claims pending',
    ]);
    expect(items[0].detail).toBe('Pick 12 of 220 is on the clock.');
    expect(items[0].href).toBe('/drafts/draft-1');
    expect(items[1].href).toBe('/leagues/b?tab=trades');
    expect(items[2].href).toBe('/leagues/c?tab=lineup');
    expect(items[3].href).toBe('/leagues/a?tab=waivers');
  });

  it('asks only the commissioner to start an overdue draft', () => {
    const overdue = {
      kind: 'draft_scheduled',
      draftId: 'd',
      startsAt: '2026-09-01T00:00:00.000Z',
    } as const;
    expect(buildNeedsYou([league({ status: overdue })], now)).toEqual([]);
    expect(
      buildNeedsYou([league({ role: 'commissioner', status: overdue })], now).map(
        (item) => item.title
      )
    ).toEqual(['Your draft has not started']);
  });

  it('ignores drafts that have no start time or already started', () => {
    expect(
      buildNeedsYou(
        [
          league({ status: { kind: 'draft_scheduled', draftId: null, startsAt: null } }),
          league({
            leagueId: 'past',
            status: { kind: 'draft_scheduled', draftId: 'd', startsAt: '2026-09-01T00:00:00.000Z' },
          }),
        ],
        now
      )
    ).toEqual([]);
  });
});

describe('time and status labels', () => {
  it('formats times in the league timezone with its abbreviation', () => {
    expect(formatLeagueTime('2026-10-03T09:30:00.000Z', 'Australia/Melbourne')).toMatch(
      /Sat,? 3 Oct.*7:30.*pm.*AEST/i
    );
  });

  it('falls back to UTC for an unknown timezone', () => {
    expect(formatLeagueTime('2026-10-03T09:30:00.000Z', 'Not/AZone')).toMatch(/UTC/);
  });

  it('describes a scheduled draft without a date honestly', () => {
    expect(
      leagueStatusLabel({ kind: 'draft_scheduled', draftId: null, startsAt: null }, 'UTC', now)
    ).toBe('Draft not scheduled');
  });

  it('does not present a past draft time as upcoming', () => {
    expect(
      leagueStatusLabel(
        { kind: 'draft_scheduled', draftId: 'd', startsAt: '2026-09-01T00:00:00.000Z' },
        'UTC',
        now
      )
    ).toMatch(/^Draft not started \(was set for /);
  });
});

describe('matchupResultLine', () => {
  const base = {
    roundLabel: 'Round 4',
    startsAt: null,
    endsAt: null,
    opponent: null,
    categories: [],
  };
  it('describes live, final and unstarted matchups in plain language', () => {
    expect(
      matchupResultLine({ ...base, status: 'live', yourCategoryWins: 6, opponentCategoryWins: 3 })
    ).toBe('You lead by 3 categories');
    expect(
      matchupResultLine({ ...base, status: 'final', yourCategoryWins: 4, opponentCategoryWins: 5 })
    ).toBe('You lost by 1 category');
    expect(
      matchupResultLine({
        ...base,
        status: 'scheduled',
        yourCategoryWins: 0,
        opponentCategoryWins: 0,
      })
    ).toBe('Not started');
  });
});

describe('sortLeagues', () => {
  it('puts live rounds and live drafts ahead of leagues waiting on a draft', () => {
    const sorted = sortLeagues([
      league({
        leagueId: 'waiting',
        status: { kind: 'draft_scheduled', draftId: null, startsAt: null },
      }),
      league({
        leagueId: 'drafting',
        status: { kind: 'draft_live', draftId: 'd', currentPick: 1, totalPicks: 2 },
      }),
      league({
        leagueId: 'live',
        status: { kind: 'round_live', roundLabel: 'Round 1', endsAt: null },
      }),
    ]);
    expect(sorted.map((item) => item.leagueId)).toEqual(['live', 'drafting', 'waiting']);
  });
});

describe('ModularDashboard', () => {
  it('shows the first four decisions and reveals the rest on request', async () => {
    fetchJsonMock.mockResolvedValue({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        leagues: Array.from({ length: 6 }, (_, index) =>
          league({ leagueId: `l${index}`, pendingWaiverClaims: 1 })
        ),
      },
    });

    render(<ModularDashboard user={user} />);

    const rail = await screen.findByRole('region', { name: /Needs you now/ });
    expect(within(rail).getAllByRole('link')).toHaveLength(4);
    const toggle = within(rail).getByRole('button', { name: 'Show 2 more' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(within(rail).getAllByRole('link')).toHaveLength(6);
    expect(within(rail).getByRole('button', { name: 'Show fewer' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a live scoreboard with category results that do not rely on colour', async () => {
    fetchJsonMock.mockResolvedValue({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        leagues: [
          league({
            status: { kind: 'round_live', roundLabel: 'Round 4', endsAt: null },
            record: { wins: 2, losses: 1, draws: 0, rank: 3, teams: 10 },
            form: ['W', 'L'],
            matchup: {
              roundLabel: 'Round 4',
              status: 'live',
              startsAt: null,
              endsAt: null,
              yourCategoryWins: 5,
              opponentCategoryWins: 4,
              opponent: { teamName: 'Hard Ball Gets', logoUrl: null },
              categories: [
                {
                  key: 'goals',
                  label: 'Goals',
                  shortLabel: 'G',
                  result: 'won',
                  yourValue: 12,
                  opponentValue: 9,
                },
                {
                  key: 'tackles',
                  label: 'Tackles',
                  shortLabel: 'T',
                  result: 'lost',
                  yourValue: 61,
                  opponentValue: 70,
                },
              ],
            },
          }),
        ],
      },
    });

    render(<ModularDashboard user={user} />);

    const card = await screen.findByRole('article', { name: 'Ball Magnets' });
    expect(within(card).getByText('2–1')).toBeVisible();
    expect(within(card).getByText('3rd of 10')).toBeVisible();
    expect(within(card).getByLabelText('You lead by 1 category. 5 categories to 4.')).toBeVisible();
    expect(within(card).getByText('Goals: won')).toBeInTheDocument();
    expect(
      within(card).getByRole('list', { name: 'Last results, most recent first' })
    ).toHaveTextContent(/W.*won.*L.*lost/);
    expect(within(card).getByText('Tackles: lost')).toBeInTheDocument();
    const boxScore = within(card).getByRole('table', { name: /Round 4 category box score/ });
    expect(
      within(boxScore).getByRole('row', { name: /You 12 \(won Goals\) 61/ })
    ).toBeInTheDocument();
    expect(
      within(boxScore).getByRole('row', { name: /Opp 9 70 \(won Tackles\)/ })
    ).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Match centre' })).toHaveAttribute(
      'href',
      '/leagues/league-1?tab=matchups'
    );
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(fetchJsonMock).toHaveBeenCalledWith(
      '/api/dashboard/home',
      expect.objectContaining({ userId: 'user-1' })
    );
  });

  it('offers joining or creating when the user has no leagues', async () => {
    fetchJsonMock.mockResolvedValue({
      success: true,
      data: { generatedAt: now.toISOString(), leagues: [] },
    });

    render(<ModularDashboard user={user} />);

    expect(await screen.findByText('You are not in a league yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join league' })).toHaveAttribute(
      'href',
      '/leagues/join'
    );
  });

  it('shows a retry when loading fails', async () => {
    fetchJsonMock.mockRejectedValue(new Error('offline'));

    render(<ModularDashboard user={user} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load your leagues.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
