import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import RankingsTable, { type PlayerRankingRow } from '../RankingsTable';

describe('RankingsTable accessibility', () => {
  it('exposes column headers and rows properly', () => {
    const players: PlayerRankingRow[] = [
      { id: '1', name: 'Player One', team: 'Team A', position: 'MID', totalValue: 1.23, rank: 1 },
      { id: '2', name: 'Player Two', team: 'Team B', position: 'DEF', totalValue: 0.98, rank: 2 },
    ];
    render(<RankingsTable players={players} />);

    const table = screen.getByRole('table', { name: /player rankings table/i });
    expect(table).toBeInTheDocument();

    const tableBody = within(table);
    const headers = tableBody.getAllByRole('columnheader');
    expect(headers.map(h => h.textContent)).toEqual(
      expect.arrayContaining(['Rank', 'Player', 'Team', 'Position', 'Total Value'])
    );

    const rows = tableBody.getAllByRole('row');
    // 1 header row + 2 body rows
    expect(rows.length).toEqual(3);
  });
});


