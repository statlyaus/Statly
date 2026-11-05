import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FANTASY_CATEGORIES, REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';
import NineCategoryRankingsTable, {
  type PlayerCategoryRanking,
} from '../NineCategoryRankingsTable';

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
      tackles: { perGame: 3.2, zScore: 0.7 },
      inside50s: { perGame: 2.1, zScore: 0.2 },
      intercepts: { perGame: null, zScore: null },
      contestedMarks: { perGame: 0.8, zScore: 0.1 },
      rebound50s: { perGame: 0.5, zScore: -0.3 },
      contestedPossessions: { perGame: 9.4, zScore: 1.2 },
      effectiveDisposals: { perGame: 15.2, zScore: 0.9 },
      scoreInvolvements: { perGame: 4.8, zScore: 0.4 },
    },
  },
];

describe('NineCategoryRankingsTable', () => {
  it('has one column per league preset category, in preset order', () => {
    render(<NineCategoryRankingsTable players={players} />);

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    const categoryHeaders = headers.slice(6).map((text) => text?.replace('avg/z', ''));
    expect(categoryHeaders).toEqual(
      REAL_DATA_NINE_CATEGORY_PRESET.map((key) => FANTASY_CATEGORIES[key].shortLabel)
    );
  });

  it('shows a missing stat as no data instead of a number', () => {
    render(<NineCategoryRankingsTable players={players} />);

    const row = screen.getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    const interceptsCell = cells[6 + REAL_DATA_NINE_CATEGORY_PRESET.indexOf('intercepts')];
    expect(interceptsCell).toHaveTextContent('—');
    expect(within(interceptsCell).getByText('No data')).toBeInTheDocument();
  });
});
