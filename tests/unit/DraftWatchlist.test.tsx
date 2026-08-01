import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DraftWatchlist from '@/components/DraftWatchlist';
import type { DraftPlayer } from '@/types/draft';

function player(
  id: string,
  name: string,
  statlyZ: Pick<DraftPlayer, 'statlyZScore' | 'statlyZBreakdown' | 'statlyZMissingCategories'>
): DraftPlayer {
  return {
    id,
    name,
    position: 'MID',
    club: 'Test Club',
    isAvailable: true,
    ...statlyZ,
  };
}

const availablePlayers: DraftPlayer[] = [
  {
    ...player('positive', 'Positive Score', {
      statlyZScore: 1.24,
      statlyZBreakdown: [{ category: 'goals', value: 2, zScore: 1.24 }],
      statlyZMissingCategories: [],
    }),
    adp: 7,
  },
  player('zero', 'Zero Score', {
    statlyZScore: 0,
    statlyZBreakdown: [{ category: 'goals', value: 1, zScore: 0 }],
    statlyZMissingCategories: [],
  }),
  player('partial', 'Partial Score', {
    statlyZScore: 0.5,
    statlyZBreakdown: [{ category: 'goals', value: 1.5, zScore: 0.5 }],
    statlyZMissingCategories: ['tackles'],
  }),
  player('no-data', 'No Data', {
    statlyZScore: 0,
    statlyZBreakdown: [],
    statlyZMissingCategories: ['goals'],
  }),
  player('pending', 'Pending Score', {}),
];

const watchlistItems = [
  {
    playerId: 'positive',
    priority: 2,
    addedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    playerId: 'zero',
    priority: 1,
    addedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    playerId: 'partial',
    priority: 3,
    addedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    playerId: 'no-data',
    priority: 4,
    addedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    playerId: 'pending',
    priority: 5,
    addedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    playerId: 'drafted',
    priority: 6,
    addedAt: '2026-08-01T00:00:00.000Z',
    player: {
      id: 'drafted',
      name: 'Drafted Player',
      position: 'FWD',
      club: 'Drafted Club',
    },
  },
];

describe('DraftWatchlist', () => {
  it('uses Statly Z consistently and reports unavailable coverage honestly', () => {
    render(
      <DraftWatchlist
        players={availablePlayers}
        draftedPlayerIds={['drafted']}
        onDraftPlayer={vi.fn()}
        canDraft
        watchlistItems={watchlistItems}
        onRemoveFromWatchlist={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Statly Z 1.24')).toHaveTextContent('Statly Z 1.24');
    expect(screen.getByLabelText('Statly Z 0.00')).toHaveTextContent('Statly Z 0.00');
    expect(screen.getByLabelText('Statly Z 0.50, partial category coverage')).toHaveTextContent(
      'Statly Z 0.50'
    );
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Statly Z unavailable because category data is missing')
    ).toHaveTextContent('Statly Z —');
    expect(screen.getByLabelText('Statly Z pending')).toHaveTextContent('Statly Z Pending');
    expect(
      screen.getByLabelText('Statly Z unavailable for this drafted or unavailable player')
    ).toHaveTextContent('Statly Z —');

    const draftedRow = screen.getByText('Drafted Player').closest('li');
    expect(draftedRow).not.toBeNull();
    expect(within(draftedRow as HTMLElement).getByText('Drafted')).toBeInTheDocument();
    expect(screen.getByText('ADP 7')).toBeInTheDocument();
    expect(screen.queryByText(/\d+(?:\.\d+)? avg/i)).not.toBeInTheDocument();
  });

  it('preserves explicit watchlist priority order', () => {
    render(
      <DraftWatchlist
        players={availablePlayers}
        draftedPlayerIds={['drafted']}
        onDraftPlayer={vi.fn()}
        canDraft
        watchlistItems={watchlistItems}
        onRemoveFromWatchlist={vi.fn()}
      />
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('heading').textContent)).toEqual([
      'Zero Score',
      'Positive Score',
      'Partial Score',
      'No Data',
      'Pending Score',
      'Drafted Player',
    ]);
  });

  it('disables only queue actions while a queue update is pending', () => {
    render(
      <DraftWatchlist
        players={availablePlayers}
        draftedPlayerIds={['drafted']}
        onDraftPlayer={vi.fn()}
        canDraft
        watchlistItems={watchlistItems}
        onAddToQueue={vi.fn()}
        onRemoveFromWatchlist={vi.fn()}
        isQueueMutationPending
      />
    );

    expect(
      screen.getByRole('button', { name: 'Add Positive Score to draft queue' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Draft Positive Score' })).not.toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Remove Positive Score from watchlist' })
    ).not.toBeDisabled();
  });
});
