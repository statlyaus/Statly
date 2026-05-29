import React from 'react';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '@testing-library/jest-dom/vitest';

import PlayersPageClient, { mergeLeaguePlayerRows } from './PlayersPageClient';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/players',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/components/league/LeagueViewHeader', () => ({
  default: ({ title }: { title: string }) => React.createElement('div', null, title),
}));

vi.mock('@/components/TeamLogo', () => ({
  TeamLogo: () => React.createElement('span', { 'data-testid': 'team-logo' }),
}));

vi.mock('@/hooks/useLeagueStatColumns', () => ({
  useLeagueStatColumns: () => ({
    visibleKeys: ['goals', 'disposals'],
    allKeys: ['goals', 'disposals'],
    toggleKey: vi.fn(),
    defaultKeys: ['goals', 'disposals'],
    setVisibleKeys: vi.fn(),
    loading: false,
  }),
}));

vi.mock('@/hooks/useUserLeagues', () => ({
  useUserLeagues: () => ({
    leagues: [],
    loading: false,
  }),
}));

vi.mock('@/lib/api', () => ({
  fetchApi: vi.fn(),
}));

describe('mergeLeaguePlayerRows', () => {
  it('overlays league metadata onto global player rows', () => {
    const merged = mergeLeaguePlayerRows(
      [
        {
          id: 'player-1',
          name: 'Player One',
          team: 'AAA',
          position: 'MID',
          ownership: 0,
          stats: { tackles: 4.2 },
        },
      ],
      [
        {
          id: 'player-1',
          name: 'Player One',
          team: 'AAA',
          position: 'MID',
          ownership: 50,
          ownershipStatus: 'Owned',
          ownerTeamName: 'Alpha',
          statsSummary: { disposals: 22.3, tackles: 5.1 },
        },
      ]
    );

    expect(merged).toEqual([
      expect.objectContaining({
        id: 'player-1',
        ownership: 50,
        ownershipStatus: 'Owned',
        ownerTeam: 'Alpha',
        ownerTeamName: 'Alpha',
        stats: expect.objectContaining({
          disposals: 22.3,
          tackles: 4.2,
        }),
      }),
    ]);
  });

  it('retains league-only players instead of dropping them', () => {
    const merged = mergeLeaguePlayerRows(
      [],
      [
        {
          id: 'player-2',
          name: 'Player Two',
          team: 'BBB',
          position: 'DEF',
          ownership: 0,
          ownershipStatus: 'Available',
          statsSummary: { marks: 6.4 },
        },
      ]
    );

    expect(merged).toEqual([
      expect.objectContaining({
        id: 'player-2',
        name: 'Player Two',
        team: 'BBB',
        position: 'DEF',
        ownershipStatus: 'Available',
        stats: expect.objectContaining({
          marks: 6.4,
        }),
      }),
    ]);
  });

  it('does not duplicate players when league and global sources use different ids', () => {
    const merged = mergeLeaguePlayerRows(
      [
        {
          id: 'nick-blakey-sydney',
          name: 'Nick Blakey',
          team: 'Sydney',
          position: 'DEF',
          stats: { tackles: 3.1 },
        },
      ],
      [
        {
          id: 'nick_blakey',
          name: 'Nick Blakey',
          team: 'Sydney',
          position: 'DEF',
          ownership: 50,
          ownershipStatus: 'Owned',
          ownerTeamName: 'Alpha',
          statsSummary: { disposals: 24.4 },
        },
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(
      expect.objectContaining({
        id: 'nick-blakey-sydney',
        name: 'Nick Blakey',
        team: 'Sydney',
        ownership: 50,
        ownershipStatus: 'Owned',
        ownerTeam: 'Alpha',
        stats: expect.objectContaining({
          disposals: 24.4,
          tackles: 3.1,
        }),
      })
    );
  });
});

describe('PlayersPageClient table typography', () => {
  it('renders ownership and stat values with readable numeric table classes', () => {
    render(
      React.createElement(PlayersPageClient, {
        embedded: true,
        players: [
          {
            id: 'player-1',
            name: 'Player One',
            team: 'Adelaide',
            position: 'MID',
            ownership: 33,
            stats: {
              goals: 1.25,
              disposals: 24.4,
            },
          },
        ],
      })
    );

    const ownershipCell = screen.getByRole('cell', { name: '33%' });
    const goalsCell = screen.getByRole('cell', { name: '1.3' });
    const disposalsCell = screen.getByRole('cell', { name: '24.4' });

    for (const numericCell of [ownershipCell, goalsCell, disposalsCell]) {
      expect(numericCell).toHaveClass('font-medium');
      expect(numericCell).toHaveClass('tracking-normal');
      expect(numericCell).not.toHaveClass('font-mono');
      expect(numericCell).not.toHaveClass('tracking-[-0.015em]');
    }
  });
});
