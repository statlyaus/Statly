import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import PlayerGrid from '@/components/draft/PlayerGrid';
import type { DraftPlayer } from '@/types/draft';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

const players: DraftPlayer[] = [
  {
    id: 'player-1',
    name: 'Marcus Bontempelli',
    position: 'MID',
    club: 'Western Bulldogs',
    avgPoints: 108.4,
    adp: 3,
    isAvailable: true,
    gamesPlayed: 21,
    stats: {
      goals: 1.1,
      tackles: 5.8,
      inside50s: 4.2,
      intercepts: 3.1,
      contestedMarks: 0.8,
      rebound50s: 1.4,
      contestedPossessions: 13.6,
      effectiveDisposals: 18.9,
      scoreInvolvements: 7.4,
    },
  },
];

const defaultProps = {
  players,
  totalPlayers: players.length,
  onPlayerSelect: vi.fn(),
  onAddToQueue: vi.fn(),
  onToggleWatchlist: vi.fn(),
  canMakePick: true,
  queuedPlayerIds: [],
  watchedPlayerIds: [],
  selectedCategories: [...REAL_DATA_NINE_CATEGORY_PRESET],
  searchQuery: '',
  onSearchChange: vi.fn(),
  positionFilter: 'ALL',
  onPositionFilterChange: vi.fn(),
  availablePositions: ['ALL', 'MID'],
  sortBy: 'adp' as const,
  onSortChange: vi.fn(),
  isLoading: false,
};

describe('PlayerGrid accessibility', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders the player list as a native table with accessible actions', () => {
    const onPlayerSelect = vi.fn();
    const onAddToQueue = vi.fn();

    render(
      <PlayerGrid {...defaultProps} onPlayerSelect={onPlayerSelect} onAddToQueue={onAddToQueue} />
    );

    const table = screen.getByRole('table', { name: /available draft players/i });
    expect(table).toBeInTheDocument();

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent)
    ).toEqual(['Player', 'Profile', 'League Stats', 'Actions']);

    const playerRow = within(table).getByRole('row', { name: /marcus bontempelli/i });
    expect(within(playerRow).getByLabelText('Goals: 1.1')).toBeInTheDocument();
    expect(within(playerRow).getByLabelText('Inside 50s: 4.2')).toBeInTheDocument();
    expect(within(playerRow).getByLabelText('Score Involvements: 7.4')).toBeInTheDocument();
    expect(screen.queryByText(/\+\d+ more/)).not.toBeInTheDocument();

    fireEvent.keyDown(playerRow, { key: 'Enter' });
    expect(onPlayerSelect).toHaveBeenCalledWith(players[0]);

    fireEvent.click(screen.getByRole('button', { name: /add marcus bontempelli to queue/i }));
    expect(onAddToQueue).toHaveBeenCalledWith(players[0]);
    expect(onPlayerSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft player table aligned to semantic tokens and compact radii', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/draft/PlayerGrid.tsx'),
      'utf8'
    );

    expect(source).toContain('border border-border bg-card text-card-foreground');
    expect(source).toContain('bg-background');
    expect(source).toContain('text-muted-foreground');
    expect(source).toContain('focus-visible:ring-ring');
    expect(source).not.toMatch(/\brounded-(xl|2xl|3xl)\b/);
    expect(source).not.toMatch(/\bbg-(gray|blue|slate|white|black|red|orange|yellow)-/);
    expect(source).not.toMatch(/\btext-(gray|blue|slate|white|black|red|orange|yellow)-/);
    expect(source).not.toMatch(/\bborder-(gray|blue|slate|red|orange|yellow)-/);
  });
});
