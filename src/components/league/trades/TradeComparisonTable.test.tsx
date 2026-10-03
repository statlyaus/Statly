import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

import { TradeComparisonTable } from './TradeComparisonTable';

const playerStats: LeaguePlayerStatDatasetDto = {
  context: {
    basis: 'PER_GAME',
    period: 'SEASON',
    season: 2026,
    availableSeasons: [2026],
    dataThrough: null,
  },
  columns: [
    {
      key: 'goals',
      label: 'Goals',
      shortLabel: 'G',
      format: 'number',
      direction: 'HIGH_WINS',
    },
    {
      key: 'clangers',
      label: 'Clangers',
      shortLabel: 'CL',
      format: 'number',
      direction: 'LOW_WINS',
    },
    {
      key: 'marks',
      label: 'Marks',
      shortLabel: 'M',
      format: 'number',
      direction: 'HIGH_WINS',
    },
    {
      key: 'kicks',
      label: 'Kicks',
      shortLabel: 'K',
      format: 'number',
      direction: 'HIGH_WINS',
    },
  ],
  playersById: {
    sending: {
      gamesPlayed: 12,
      values: { goals: 10, clangers: 2, marks: 5, kicks: 18 },
    },
    receiving: {
      gamesPlayed: 12,
      values: { goals: 12, clangers: 4, marks: 5, kicks: null },
    },
  },
};

const defaultProps = {
  sendingTeamName: 'Robbo Rockers',
  receivingTeamName: 'AFL Legends',
  sendingPlayerIds: ['sending'],
  receivingPlayerIds: ['receiving'],
  playerStats,
};

describe('TradeComparisonTable', () => {
  it.each([
    { sendingPlayerIds: [], receivingPlayerIds: ['receiving'] },
    { sendingPlayerIds: ['sending'], receivingPlayerIds: [] },
  ])('shows an honest incomplete state without an impact summary', (selection) => {
    render(<TradeComparisonTable {...defaultProps} {...selection} />);

    expect(screen.getByText('Pick from both teams to compare.')).toBeInTheDocument();
    expect(screen.queryByText(/Category impact:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('summarizes categories from the sending team’s side', () => {
    render(<TradeComparisonTable {...defaultProps} />);

    expect(
      screen.getByText('For Robbo Rockers: 1 up · 1 down · 1 level · 1 no data')
    ).toBeInTheDocument();
  });

  it('uses team columns and one normalized difference column with signed accessible outcomes', () => {
    render(<TradeComparisonTable {...defaultProps} />);

    expect(screen.getByRole('heading', { level: 4, name: 'Category comparison' })).toHaveClass(
      'text-base'
    );
    const table = screen.getByRole('table', { name: /category comparison/i });
    expect(within(table).getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Robbo Rockers' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'AFL Legends' })).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader', { name: 'Gap' })).toHaveLength(1);
    expect(
      within(table).queryByRole('columnheader', { name: 'Difference' })
    ).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Result' })).not.toBeInTheDocument();

    expect(
      within(within(table).getByRole('row', { name: /Goals/ })).getByText('+2.0')
    ).toBeInTheDocument();
    const gained = within(within(table).getByRole('row', { name: /Goals/ })).getByText('Up');
    expect(gained.previousElementSibling).toHaveClass('text-[color:var(--trade-positive)]');
    expect(
      within(within(table).getByRole('row', { name: /Clangers/ })).getByText('−2.0')
    ).toBeInTheDocument();
    const lost = within(within(table).getByRole('row', { name: /Clangers/ })).getByText('Down');
    expect(lost.previousElementSibling).toHaveClass('text-[color:var(--trade-negative)]');
    expect(
      within(within(table).getByRole('row', { name: /Marks/ })).getByText('Level')
    ).toBeInTheDocument();
    expect(
      within(within(table).getByRole('row', { name: /Kicks/ })).getByText('No data')
    ).toBeInTheDocument();
  });

  it('explains its per-player per-game basis and direction normalization once', () => {
    render(<TradeComparisonTable {...defaultProps} />);

    expect(
      screen.getByText(
        'Per-game averages per player, 2026 season. Robbo Rockers: 1 player · 12 GP each. AFL Legends: 1 player · 12 GP each. For low-is-better categories a drop counts as up.'
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Goals, higher is better')).toBeInTheDocument();
    expect(screen.getByLabelText('Clangers, lower is better')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).queryAllByText(/(?:higher|lower) is better/i)
    ).toHaveLength(0);
  });

  it('keeps tiny calculated outcomes truthful without displaying signed rounded zero', () => {
    const tinyDifferenceStats: LeaguePlayerStatDatasetDto = {
      ...playerStats,
      columns: [playerStats.columns[0]],
      playersById: {
        sending: { gamesPlayed: 12, values: { goals: 10 } },
        receiving: { gamesPlayed: 12, values: { goals: 10.004 } },
      },
    };
    const { rerender } = render(
      <TradeComparisonTable {...defaultProps} playerStats={tinyDifferenceStats} />
    );

    const gainedRow = screen.getByRole('row', { name: /Goals/ });
    expect(within(gainedRow).getByText('+0.004')).toBeInTheDocument();
    expect(within(gainedRow).queryByText('+0.0')).not.toBeInTheDocument();
    expect(within(gainedRow).getByText('Up')).toBeInTheDocument();

    rerender(
      <TradeComparisonTable
        {...defaultProps}
        playerStats={{
          ...tinyDifferenceStats,
          playersById: {
            sending: { gamesPlayed: 12, values: { goals: 10 } },
            receiving: { gamesPlayed: 12, values: { goals: 10.0000005 } },
          },
        }}
      />
    );
    const evenRow = screen.getByRole('row', { name: /Goals/ });
    expect(within(evenRow).getByText('0.0')).toBeInTheDocument();
    expect(within(evenRow).queryByText(/[+−]0\.0/)).not.toBeInTheDocument();
    expect(within(evenRow).getByText('Level')).toBeInTheDocument();
  });

  it('uses unique accessible heading relationships across multiple instances', () => {
    render(
      <>
        <TradeComparisonTable {...defaultProps} />
        <TradeComparisonTable {...defaultProps} />
      </>
    );

    const headings = screen.getAllByRole('heading', { level: 4, name: 'Category comparison' });
    const regions = screen.getAllByRole('region', { name: 'Category comparison' });
    const headingIds = headings.map(({ id }) => id);
    expect(new Set(headingIds).size).toBe(2);
    expect(regions.map((region) => region.getAttribute('aria-labelledby'))).toEqual(headingIds);
    headingIds.forEach((id) =>
      expect(document.querySelectorAll(`#${CSS.escape(id)}`)).toHaveLength(1)
    );
  });

  it('uses at least 14px typography for numeric values and difference labels', () => {
    render(<TradeComparisonTable {...defaultProps} />);

    const goalsRow = screen.getByRole('row', { name: /Goals/ });
    expect(within(goalsRow).getByText('10.0')).toHaveClass('text-sm');
    expect(within(goalsRow).getByText('Up').parentElement).toHaveClass('text-sm');
  });
});
