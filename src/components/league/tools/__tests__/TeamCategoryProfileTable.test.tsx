import { render, screen } from '@testing-library/react';

import type { TeamCategoryProfile } from '@/server/leagues/teamCategoryProfile';

import { TeamCategoryProfileTable } from '../TeamCategoryProfileTable';

function profile(ranks: number[]): TeamCategoryProfile {
  const keys = ['goals', 'tackles', 'clangers'] as const;
  return {
    memberId: 'you',
    teamName: 'Your Team',
    roundsPlayed: 3,
    teamCount: 4,
    categories: ranks.map((rank, index) => ({
      key: keys[index],
      label: ['Goals', 'Tackles', 'Clangers'][index],
      average: 10,
      leagueAverage: 9,
      rank,
      lowWins: keys[index] === 'clangers',
    })),
  };
}

describe('TeamCategoryProfileTable', () => {
  it('names the strongest and weakest categories by league rank', () => {
    render(<TeamCategoryProfileTable leagueId="league-1" profile={profile([2, 1, 4])} />);

    expect(
      screen.getByText(/Strongest: Tackles \(1st\)\. Weakest: Clangers \(4th\)\./)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('row', { name: /Clangers Lower wins 10 9 4th of 4/ })
    ).toBeInTheDocument();
  });

  it('does not call a category weakest when every category shares the same rank', () => {
    render(<TeamCategoryProfileTable leagueId="league-1" profile={profile([1, 1, 1])} />);

    expect(screen.queryByText(/Weakest/)).not.toBeInTheDocument();
    expect(screen.getByText(/Ranked 1st of 4 in every category\./)).toBeInTheDocument();
  });

  it('links to the viewer roster and explains the empty state before any round is final', () => {
    render(
      <TeamCategoryProfileTable
        leagueId="league-1"
        profile={{ ...profile([]), roundsPlayed: 0, categories: [] }}
      />
    );

    expect(
      screen.getByText('Your category profile appears after your first completed round.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View your roster' })).toHaveAttribute(
      'href',
      '/leagues/league-1/teams/you'
    );
  });
});
