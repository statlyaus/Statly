import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeaguePage from '@/app/(app)/leagues/[id]/page';
import LeagueSocialPage from '@/app/(app)/leagues/[id]/social/page';
import LeagueTeamRosterPage from '@/app/(app)/leagues/[id]/teams/[memberId]/page';

const mocks = vi.hoisted(() => ({
  userId: 'outsider' as string | null,
  detail: vi.fn(),
  memberLeagues: vi.fn(),
  teamRoster: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

vi.mock('@/server/leagues/teamRosterReadModel', () => ({
  loadAuthorizedLeagueTeamRoster: mocks.teamRoster,
}));

vi.mock('@/app/(app)/leagues/[id]/social/SocialPageClient', () => ({
  default: () => <div>Social client</div>,
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserIdFromServerContext: async () => mocks.userId,
}));

vi.mock('@/server/leagues/leagueDetail', () => ({
  loadAuthorizedLeagueDetail: mocks.detail,
}));

vi.mock('@/server/leagues/memberLeagueOptions', () => ({
  loadMemberLeagueOptions: mocks.memberLeagues,
}));

vi.mock('@/server/leagues/trades/tradeReadModel', () => ({
  loadAuthorizedLeagueTradeCentre: vi.fn(),
  loadAuthorizedLeagueTradeDigest: vi.fn(),
}));

vi.mock('@/app/(app)/leagues/[id]/LeaguePageClient', () => ({
  default: ({ errorMsg }: { errorMsg?: string | null }) => <div>League client {errorMsg}</div>,
}));

async function renderLeague(id = 'someone-elses-league') {
  return render(await LeaguePage({ params: Promise.resolve({ id }) }));
}

describe('league page for a signed-in viewer who is not a member', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId = 'outsider';
    mocks.detail.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    mocks.memberLeagues.mockResolvedValue([
      { id: 'league-a', name: 'Bayside Battlers' },
      { id: 'league-b', name: 'Northern Nines' },
    ]);
  });

  it('says they are not in the league and offers their own leagues, a code and a new league', async () => {
    await renderLeague();

    expect(
      screen.getByRole('heading', { level: 1, name: "You're not in this league" })
    ).toBeVisible();
    expect(mocks.memberLeagues).toHaveBeenCalledWith('outsider');

    const yourLeagues = screen.getByRole('list', { name: 'Your leagues' });
    expect(within(yourLeagues).getByRole('link', { name: 'Bayside Battlers' })).toHaveAttribute(
      'href',
      '/leagues/league-a'
    );
    expect(within(yourLeagues).getByRole('link', { name: 'Northern Nines' })).toHaveAttribute(
      'href',
      '/leagues/league-b'
    );
    expect(screen.getByRole('link', { name: 'Enter a league code' })).toHaveAttribute(
      'href',
      '/leagues/join'
    );
    expect(screen.getByRole('link', { name: 'Start a new league' })).toHaveAttribute(
      'href',
      '/leagues/new'
    );
    expect(screen.queryByText(/League client/)).not.toBeInTheDocument();
  });

  it('links to the leagues page when they have no league of their own', async () => {
    mocks.memberLeagues.mockResolvedValue([]);
    await renderLeague();

    expect(screen.queryByRole('list', { name: 'Your leagues' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your leagues' })).toHaveAttribute(
      'href',
      '/leagues'
    );
  });

  it('shows a missing league and a private league identically, so neither existence leaks', async () => {
    const forbidden = (await renderLeague('private-league')).container.innerHTML;

    mocks.detail.mockResolvedValue({ ok: false, status: 404, error: 'League not found' });
    const missing = (await renderLeague('private-league')).container.innerHTML;

    expect(missing).toBe(forbidden);
  });

  it('keeps the error state for failures that are not about membership', async () => {
    mocks.detail.mockResolvedValue({ ok: false, status: 500, error: 'boom' });
    await renderLeague();

    expect(screen.queryByRole('heading', { name: "You're not in this league" })).toBeNull();
    expect(screen.getByText(/League client/)).toBeVisible();
    expect(mocks.memberLeagues).not.toHaveBeenCalled();
  });
});

describe('other league pages for a signed-in viewer who is not a member', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId = 'outsider';
    mocks.detail.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    mocks.memberLeagues.mockResolvedValue([{ id: 'league-a', name: 'Bayside Battlers' }]);
  });

  it('shows the same guidance on league social', async () => {
    render(
      await LeagueSocialPage({
        params: Promise.resolve({ id: 'private-league' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(screen.getByRole('heading', { name: "You're not in this league" })).toBeVisible();
    expect(screen.queryByText('Social client')).not.toBeInTheDocument();
  });

  it('shows the same guidance on a team roster in a league they are not in', async () => {
    mocks.teamRoster.mockResolvedValue({ ok: false, status: 'forbidden' });
    render(
      await LeagueTeamRosterPage({
        params: Promise.resolve({ id: 'private-league', memberId: 'member-1' }),
      })
    );

    expect(screen.getByRole('heading', { name: "You're not in this league" })).toBeVisible();
  });

  it('keeps a missing team in their own league as not found', async () => {
    mocks.teamRoster.mockResolvedValue({ ok: false, status: 'not-found' });

    await expect(
      LeagueTeamRosterPage({ params: Promise.resolve({ id: 'league-a', memberId: 'gone' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
