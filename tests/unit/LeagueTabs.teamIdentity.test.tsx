import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeagueTabs from '@/components/league/LeagueTabs';
import type { League, LeagueMember } from '@/types/leagues';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/leagues/league-1',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'tab' ? 'team-settings' : null),
  }),
}));

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

const league: League = {
  id: 'league-1',
  name: 'Identity League',
  code: 'ABC12345',
  type: 'private',
  ownerId: 'owner-user',
  maxTeams: 12,
  categories: ['goals', 'tackles', 'inside50s'],
  tradeSettings: { tradeLimit: 10, tradeReview: 'none' },
  waiverWire: { waiverOrder: [], waiverPeriodHours: 24, waiverResetPolicy: 'weekly' },
  createdAt: '2026-06-01T00:00:00.000Z',
  status: 'preseason',
};

const members: LeagueMember[] = [
  {
    id: 'member-1',
    leagueId: 'league-1',
    userId: 'member-user',
    role: 'member',
    teamName: 'Member Team',
    notificationSettings: {
      tradePush: true,
      waiverPush: true,
      draftReminder: true,
      scoringAlerts: true,
    },
    joinedAt: '2026-06-01T00:00:00.000Z',
    isActive: true,
  },
];

const settingsPayload = {
  success: true,
  data: {
    league: {
      id: 'league-1',
      name: 'Identity League',
      code: 'ABC12345',
      maxTeams: 12,
      locked: false,
    },
    scoring: { scoringFormat: 'nine-category', categories: ['goals', 'tackles', 'inside50s'] },
    roster: {
      rosterSize: 18,
      benchSize: 4,
      positionLimits: { DEF: 6, MID: 8, RUC: 2, FWD: 6, BENCH: 4 },
    },
    draft: {
      draftDate: '2026-07-03T00:00:00.000Z',
      draftType: 'snake',
      timePerPick: 120,
      pickOrder: 'random',
      timeZone: 'Australia/Melbourne',
      autoPickRules: { enabled: true, strategy: 'queue-first' },
    },
    waiver: { waiverRule: 'weekly' },
  },
};

describe('LeagueTabs team identity settings', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  function mockLeagueFetches() {
    authenticatedFetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/trades/list')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ trades: [] }),
        });
      }

      if (url === '/api/leagues/league-1/settings') {
        return Promise.resolve({
          ok: true,
          json: async () => settingsPayload,
        });
      }

      if (url === '/api/leagues/league-1/members/me') {
        const body = typeof options?.body === 'string' ? JSON.parse(options.body) : {};
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              member: {
                ...members[0],
                teamName: body.teamName ?? members[0].teamName,
                teamLogoUrl: body.teamLogoUrl,
                teamLogoPositionX: body.teamLogoPositionX,
                teamLogoPositionY: body.teamLogoPositionY,
                teamLogoZoom: body.teamLogoZoom,
                notificationSettings: body.notificationSettings ?? members[0].notificationSettings,
              },
            },
          }),
        });
      }

      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({ success: false, error: `Unexpected URL ${url}` }),
      });
    });
  }

  it('lets an ordinary member save a pasted team symbol URL', async () => {
    mockLeagueFetches();

    render(<LeagueTabs league={league} members={members} currentUserId="member-user" />);

    expect(await screen.findByText('Team identity')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Team symbol URL'), {
      target: { value: 'https://cdn.example.com/member-team.png' },
    });
    fireEvent.change(screen.getByLabelText(/Horizontal centre/), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByLabelText(/Vertical centre/), {
      target: { value: '80' },
    });
    fireEvent.change(screen.getByLabelText(/Zoom/), {
      target: { value: '1.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save team symbol' }));

    await waitFor(() => {
      expect(authenticatedFetchMock).toHaveBeenCalledWith(
        '/api/leagues/league-1/members/me',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teamLogoUrl: 'https://cdn.example.com/member-team.png',
            teamLogoPositionX: 30,
            teamLogoPositionY: 80,
            teamLogoZoom: 1.5,
          }),
        },
        'member-user'
      );
    });

    expect(await screen.findByText('Team symbol saved.')).toBeInTheDocument();
    expect(screen.getByAltText('Member Team symbol preview')).toHaveStyle({
      objectPosition: '30% 80%',
      transform: 'scale(1.5)',
      transformOrigin: '30% 80%',
    });
  });

  it('lets an ordinary member save team name and league notification preferences', async () => {
    mockLeagueFetches();

    render(<LeagueTabs league={league} members={members} currentUserId="member-user" />);

    expect(await screen.findByRole('heading', { name: 'Team Settings' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Team name'), {
      target: { value: 'Updated Member Team' },
    });
    fireEvent.click(screen.getByLabelText('Trade offers'));
    fireEvent.click(screen.getByLabelText('Scoring alerts'));
    fireEvent.click(screen.getByRole('button', { name: 'Save team settings' }));

    await waitFor(() => {
      expect(authenticatedFetchMock).toHaveBeenCalledWith(
        '/api/leagues/league-1/members/me',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teamName: 'Updated Member Team',
            notificationSettings: {
              tradePush: false,
              waiverPush: true,
              draftReminder: true,
              scoringAlerts: false,
            },
          }),
        },
        'member-user'
      );
    });

    expect(await screen.findByText('Team settings saved.')).toBeInTheDocument();
    expect(authenticatedFetchMock).not.toHaveBeenCalledWith(
      '/api/leagues/league-1/settings',
      expect.anything(),
      expect.anything()
    );
  });

  it('rejects unsupported upload files before making a network request', async () => {
    mockLeagueFetches();

    render(<LeagueTabs league={league} members={members} currentUserId="member-user" />);

    const file = new File(['<svg></svg>'], 'symbol.svg', { type: 'image/svg+xml' });
    fireEvent.change(await screen.findByLabelText('Upload team symbol'), {
      target: { files: [file] },
    });

    expect(await screen.findByText('Upload a PNG, JPEG, or WebP image.')).toBeInTheDocument();
    expect(authenticatedFetchMock).not.toHaveBeenCalledWith(
      '/api/leagues/league-1/members/me',
      expect.anything(),
      expect.anything()
    );
  });

  it('previews supported upload files before saving so members can adjust the thumbnail', async () => {
    mockLeagueFetches();

    render(<LeagueTabs league={league} members={members} currentUserId="member-user" />);

    const file = new File(['png-bytes'], 'symbol.png', { type: 'image/png' });
    fireEvent.change(await screen.findByLabelText('Upload team symbol'), {
      target: { files: [file] },
    });

    const preview = await screen.findByAltText('Member Team symbol preview');
    await waitFor(() => {
      expect(preview).toHaveAttribute('src', expect.stringContaining('data:image/png;base64'));
    });
    expect(authenticatedFetchMock).not.toHaveBeenCalledWith(
      '/api/leagues/league-1/members/me',
      expect.anything(),
      expect.anything()
    );
  });
});
