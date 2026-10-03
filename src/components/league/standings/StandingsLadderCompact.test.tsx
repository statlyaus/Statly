import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { buildStandingsHistory } from '@/server/leagues/standingsHistory';

import { StandingsLadderCompact } from './StandingsLadderCompact';

function team(memberId: string, teamName: string, wins: number, losses: number) {
  return {
    memberId,
    teamName,
    teamLogoUrl: null,
    wins,
    losses,
    draws: 0,
    categoryWins: wins * 6 + losses * 3,
    categoryLosses: wins * 3 + losses * 6,
    categoryDraws: 0,
    draftSlot: null,
  };
}

function game(round: number, home: string, away: string, homeWins: number, awayWins: number) {
  return {
    round,
    phase: 'REGULAR' as const,
    status: 'FINAL' as const,
    homeMemberId: home,
    awayMemberId: away,
    byeMemberId: null,
    homeCategoryWins: homeWins,
    awayCategoryWins: awayWins,
    drawnCategories: 9 - homeWins - awayWins,
    winnerMemberId: homeWins > awayWins ? home : away,
  };
}

const history = buildStandingsHistory({
  ladder: [
    team('alpha', 'Alpha FC', 2, 0),
    team('you', 'Robbo Rockers', 1, 1),
    team('gamma', 'Gamma United', 1, 1),
    team('delta', 'Delta Dogs', 0, 2),
  ],
  matchups: [
    game(1, 'alpha', 'you', 6, 3),
    game(1, 'gamma', 'delta', 5, 4),
    game(2, 'you', 'delta', 7, 2),
    game(2, 'alpha', 'gamma', 5, 4),
    { ...game(3, 'you', 'gamma', 0, 0), status: 'SCHEDULED' as const, winnerMemberId: null },
    { ...game(3, 'alpha', 'delta', 0, 0), status: 'SCHEDULED' as const, winnerMemberId: null },
  ],
  finalsTeams: 2,
});

describe('StandingsLadderCompact', () => {
  it('shows the ladder with movement, form, finals chances and the finals line', () => {
    render(
      <StandingsLadderCompact
        data={{ ...history, regularSeasonRounds: 3, viewerMemberId: 'you' }}
        leagueId="league-1"
      />
    );

    const yourRow = screen.getByRole('row', { name: '2. Robbo Rockers (your team)' });
    expect(within(yourRow).getByText('YOU')).toBeInTheDocument();
    expect(within(yourRow).getByText('1–1')).toBeInTheDocument();
    expect(within(yourRow).getByRole('img', { name: 'Last 2: L W' })).toBeInTheDocument();
    expect(within(yourRow).getByText(/^(\d+%|In|Out|>99%|<1%)$/)).toBeInTheDocument();
    expect(within(yourRow).getByRole('link', { name: 'Robbo Rockers' })).toHaveAttribute(
      'href',
      '/leagues/league-1/teams/you'
    );

    expect(screen.getByRole('columnheader', { name: 'Finals' })).toBeInTheDocument();
    // One divider for phones, one for wider screens.
    expect(screen.getAllByText('Finals', { selector: 'span' })).toHaveLength(2);
    // The finals line sits under second place.
    const rows = screen.getAllByRole('row', { hidden: true });
    const divider = rows.findIndex((row) => row.getAttribute('aria-hidden') === 'true');
    expect(rows[divider - 1]).toHaveAccessibleName('2. Robbo Rockers (your team)');
  });

  it('leaves out the finals column when the league has no finals', () => {
    const noFinals = buildStandingsHistory({
      ladder: [team('alpha', 'Alpha FC', 1, 0), team('you', 'Robbo Rockers', 0, 1)],
      matchups: [game(1, 'alpha', 'you', 6, 3)],
      finalsTeams: 0,
    });
    render(
      <StandingsLadderCompact
        data={{ ...noFinals, regularSeasonRounds: 1, viewerMemberId: 'you' }}
        leagueId="league-1"
      />
    );
    expect(screen.queryByRole('columnheader', { name: 'Finals' })).not.toBeInTheDocument();
    expect(screen.queryByText('Finals', { selector: 'span' })).not.toBeInTheDocument();
  });
});
