import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { MatchupView } from '@/server/basketball/readModels/matchupModel';
import type { PickupsView } from '@/server/basketball/readModels/pickupsModel';

import { OverviewInsights } from './OverviewInsights';

const ENOUGH_TAKEN = { taken: 80, expected: 80, enough: true };

const noOpponentMatchup = { status: 'NO_OPPONENT' } as unknown as MatchupView;
const noOpponentPickups = { status: 'NO_OPPONENT' } as unknown as PickupsView;

function category(id: string, winChance: number, call: 'WIN' | 'LOSS' | 'TOSS_UP') {
  return { category: id, me: 0, opponent: 0, margin: 0, call, sigma: 1, winChance };
}

const readyMatchup = {
  status: 'READY',
  projection: {
    calls: { wins: 5, losses: 3, tossUps: 1 },
    expectedCategoriesWon: 5.2,
    expectedCategoriesLost: 3.8,
    outcome: { win: 0.64, tie: 0, loss: 0.36 },
    categories: [
      category('PTS', 0.95, 'WIN'),
      category('REB', 0.52, 'TOSS_UP'),
      category('AST', 0.3, 'LOSS'),
      category('STL', 0.58, 'WIN'),
    ],
  },
} as unknown as MatchupView;

const readyPickups = {
  status: 'READY',
  drop: { playerId: 'p1', fullName: 'Drop Candidate', value: -1, onInjuredList: false },
  options: [
    {
      player: { playerId: 'fa1', fullName: 'Streaming Guard', teamCode: 'NYK' },
      gamesAdded: 3,
      categoryChange: 1.5,
    },
  ],
} as unknown as PickupsView;

describe('OverviewInsights', () => {
  it('renders nothing until there is an opponent', () => {
    const { container } = render(
      <OverviewInsights
        matchup={noOpponentMatchup}
        pickups={noOpponentPickups}
        taken={ENOUGH_TAKEN}
        leagueId="l1"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the win chance, the closest categories and the best adds', () => {
    render(
      <OverviewInsights
        matchup={readyMatchup}
        pickups={readyPickups}
        taken={ENOUGH_TAKEN}
        leagueId="l1"
      />
    );
    expect(screen.getByText(/chance to win the week/)).toBeInTheDocument();
    const closest = screen.getAllByRole('listitem').slice(0, 3);
    expect(closest.map((item) => item.textContent)).toEqual([
      expect.stringContaining('REB'),
      expect.stringContaining('STL'),
      expect.stringContaining('AST'),
    ]);
    expect(screen.getByText('Streaming Guard')).toBeInTheDocument();
    expect(screen.getByText(/If you drop Drop Candidate/)).toBeInTheDocument();
  });

  it('warns under the best adds while too few players are marked as taken', () => {
    const { rerender } = render(
      <OverviewInsights
        matchup={readyMatchup}
        pickups={readyPickups}
        taken={{ taken: 12, expected: 80, enough: false }}
        leagueId="l1"
      />
    );
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(
      'Only 12 players are marked as taken in this league, so some suggestions may already be on other teams.'
    );
    expect(screen.getByRole('link', { name: "Add the other teams' players" })).toHaveAttribute(
      'href',
      '/basketball/l1/roster#other-teams'
    );

    rerender(
      <OverviewInsights
        matchup={readyMatchup}
        pickups={readyPickups}
        taken={ENOUGH_TAKEN}
        leagueId="l1"
      />
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
