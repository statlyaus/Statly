import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import PlayerGrid from '@/components/draft/PlayerGrid';
import type { DraftPlayer } from '@/types/draft';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

vi.mock('next/image', () => ({
  default: ({
    alt = '',
    unoptimized: _unoptimized,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));

const players: DraftPlayer[] = [
  {
    id: 'player-1',
    name: 'Marcus Bontempelli',
    position: 'MID',
    club: 'Western Bulldogs',
    avgPoints: 108.4,
    statlyZScore: 3.42,
    statlyZBreakdown: [
      { category: 'goals', value: 1.1, zScore: 0.4 },
      { category: 'tackles', value: 5.8, zScore: 1.2 },
    ],
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

function buildPlayer(index: number): DraftPlayer {
  return {
    ...players[0],
    id: `player-${index}`,
    name: `Player ${String(index).padStart(3, '0')}`,
    statlyZScore: 500 - index,
  };
}

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
    ).toEqual([
      'Player',
      'Profile',
      'League Stats',
      'Actions',
      'G',
      'T',
      'I50',
      'I',
      'CM',
      'R50',
      'CP',
      'ED',
      'SI',
    ]);

    const playerRow = within(table).getByRole('row', { name: /marcus bontempelli/i });
    expect(within(playerRow).getByText('Statly Z')).toBeInTheDocument();
    expect(within(playerRow).getByText('3.42')).toBeInTheDocument();
    expect(within(playerRow).getByRole('cell', { name: 'Goals: 1.1' })).toBeInTheDocument();
    expect(within(playerRow).getByRole('cell', { name: 'Inside 50s: 4.2' })).toBeInTheDocument();
    expect(
      within(playerRow).getByRole('cell', { name: 'Score Involvements: 7.4' })
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sort by Statly Z' })).toBeInTheDocument();
    expect(screen.queryByText('Fantasy avg')).not.toBeInTheDocument();
    expect(screen.queryByText('Fantasy average')).not.toBeInTheDocument();
    expect(screen.queryByText(/\+\d+ more/)).not.toBeInTheDocument();
    const logo = playerRow.querySelector('img');
    expect(logo).toHaveAttribute('src', '/logos/Western Bulldogs.svg');
    expect(logo).toHaveAttribute('alt', '');

    fireEvent.keyDown(playerRow, { key: 'Enter' });
    expect(onPlayerSelect).toHaveBeenCalledWith(players[0]);

    fireEvent.click(screen.getByRole('button', { name: /add marcus bontempelli to queue/i }));
    expect(onAddToQueue).toHaveBeenCalledWith(players[0]);
    expect(onPlayerSelect).toHaveBeenCalledTimes(1);
  });

  it('submits one selection while a pick is already processing', async () => {
    let resolvePick: (() => void) | undefined;
    const onPlayerSelect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePick = resolve;
        })
    );

    render(<PlayerGrid {...defaultProps} onPlayerSelect={onPlayerSelect} />);

    const selectButton = screen.getByRole('button', { name: /select marcus bontempelli/i });

    fireEvent.click(selectButton);
    fireEvent.click(selectButton);
    fireEvent.click(selectButton);

    expect(onPlayerSelect).toHaveBeenCalledTimes(1);
    expect(selectButton).toBeDisabled();
    expect(selectButton).toHaveTextContent('Selecting');

    resolvePick?.();

    await waitFor(() => {
      expect(selectButton).not.toBeDisabled();
    });
  });

  it('windows large draft player pools instead of mounting every row', () => {
    const largePool = Array.from({ length: 320 }, (_, index) => buildPlayer(index + 1));

    render(
      <PlayerGrid
        {...defaultProps}
        players={largePool}
        totalPlayers={largePool.length}
        selectedCategories={['goals', 'tackles']}
      />
    );

    expect(screen.getByText('Showing 320 of 320 players')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /select player 001/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /select player 320/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeLessThan(80);
  });

  it('keeps the draft player table aligned to semantic tokens and compact radii', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/draft/PlayerGrid.tsx'), 'utf8');

    expect(source).toContain('border border-border bg-card text-card-foreground');
    expect(source).toContain('bg-background');
    expect(source).toContain('text-muted-foreground');
    expect(source).toContain('focus-visible:ring-ring');
    expect(source).toContain('const PLAYER_COLUMN_WIDTH = 340');
    expect(source).toContain('const PROFILE_COLUMN_WIDTH = 180');
    expect(source).toContain('const STAT_COLUMN_WIDTH = 88');
    expect(source).toContain('const ACTIONS_COLUMN_WIDTH = 236');
    expect(source).toContain('grid grid-cols-3 items-center gap-2');
    expect(source).toContain('h-10 w-full justify-center');
    expect(source).toContain('inline-flex min-w-12 justify-center tabular-nums');
    expect(source).not.toContain('font-mono');
    expect(source).not.toMatch(/\btracking-\[-/);
    expect(source).not.toContain('motion.tr');
    expect(source).not.toContain("from 'framer-motion'");
    expect(source).not.toContain('flex flex-wrap items-center justify-center gap-2');
    expect(source).not.toContain('items-center justify-end gap-2');
    expect(source).not.toMatch(/\brounded-(xl|2xl|3xl)\b/);
    expect(source).not.toMatch(/\bbg-(gray|blue|slate|white|black|red|orange|yellow)-/);
    expect(source).not.toMatch(/\btext-(gray|blue|slate|white|black|red|orange|yellow)-/);
    expect(source).not.toMatch(/\bborder-(gray|blue|slate|red|orange|yellow)-/);
  });
});
