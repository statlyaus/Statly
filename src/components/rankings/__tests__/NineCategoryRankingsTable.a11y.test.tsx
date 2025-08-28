import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import NineCategoryRankingsTable, {
  type PlayerCategoryRanking,
} from '../NineCategoryRankingsTable';

describe('NineCategoryRankingsTable accessibility', () => {
  it('renders table with column headers for nine categories', () => {
    const players: PlayerCategoryRanking[] = [
      {
        playerId: 'p1',
        playerName: 'Alpha',
        team: 'TEAM',
        position: 'MID',
        games: 10,
        overall: 1.2,
        rank: 1,
        categories: {
          goals: { perGame: 1.1, zScore: 0.5 },
          goal_assists: { perGame: 0.3, zScore: 0.1 },
          tackles: { perGame: 3.2, zScore: 0.7 },
          clearances: { perGame: 4.2, zScore: 1.2 },
          inside_50s: { perGame: 2.1, zScore: 0.2 },
          rebound_50s: { perGame: 0.5, zScore: -0.3 },
          hitouts: { perGame: 0.0, zScore: -1.0 },
          intercepts: { perGame: 1.5, zScore: 0.4 },
          marks: { perGame: 4.8, zScore: 0.9 },
        },
      },
    ];

    render(<NineCategoryRankingsTable players={players} />);

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    const headers = screen.getAllByRole('columnheader');
    // Expect at least the fixed headers + 9 category headers
    expect(headers.length).toBeGreaterThanOrEqual(6 + 9);
  });
});
