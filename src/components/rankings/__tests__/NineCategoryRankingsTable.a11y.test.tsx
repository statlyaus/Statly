import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import NineCategoryRankingsTable, {
  type PlayerCategoryRanking,
} from '../NineCategoryRankingsTable';
import { FANTASY_CATEGORIES, REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

const player: PlayerCategoryRanking = {
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
    intercepts: { perGame: 1.5, zScore: 0.4 },
    contestedMarks: { perGame: 0.8, zScore: 0.9 },
    rebound50s: { perGame: 0.5, zScore: -0.3 },
    contestedPossessions: { perGame: 9.4, zScore: 1.2 },
    effectiveDisposals: { perGame: 17.3, zScore: 0.6 },
    scoreInvolvements: { perGame: null, zScore: null },
  },
};

describe('NineCategoryRankingsTable accessibility', () => {
  it('heads one column per league category, labelled from the category definitions', () => {
    render(<NineCategoryRankingsTable players={[player]} />);

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent ?? '');
    const categoryHeaders = headers.slice(6).map((text) => text.replace('avg/z', ''));
    expect(categoryHeaders).toEqual(
      REAL_DATA_NINE_CATEGORY_PRESET.map((key) => FANTASY_CATEGORIES[key].shortLabel)
    );
    expect(screen.getByTitle('Score Involvements')).toBeInTheDocument();
  });

  it('shows a missing stat as a dash, never as zero', () => {
    render(<NineCategoryRankingsTable players={[player]} />);

    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells.at(-1)).toHaveTextContent('–');
    expect(cells.at(-1)).not.toHaveTextContent('0.0');
  });
});
