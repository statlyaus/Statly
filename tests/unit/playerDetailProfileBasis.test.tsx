import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchApi = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ fetchApi }));
vi.mock('@/components/PlayerSummaryCard', () => ({ default: () => null }));
vi.mock('@/components/MatchLogTable', () => ({ default: () => null }));
vi.mock('@/components/PlayerChart', () => ({ default: () => null }));
vi.mock('@/components/PlayerLeagueAvailabilityPanel', () => ({
  PlayerLeagueAvailabilityPanel: () => null,
}));
vi.mock('@/components/league/LeagueSocialDiscussButton', () => ({
  LeagueSocialDiscussButton: () => null,
}));

import { PlayerDetail } from '@/components/PlayerDetail';

// getPlayerDetail fills `stats` with the latest single match (or season totals from JSON), so the
// player record is not a per-game basis.
const player = {
  id: 'nick-daicos',
  name: 'Nick Daicos',
  team: 'Collingwood',
  games: 20,
  goals: 3,
  stats: { goals: 3, disposals: 35 },
};

function categoryCell(label: string): HTMLElement {
  const profile = screen.getByRole('heading', { name: 'Category Profile' }).parentElement!;
  return within(profile).getByText(label).parentElement!;
}

describe('PlayerDetail category profile', () => {
  beforeEach(() => {
    fetchApi.mockReset();
  });

  it('does not present the player record as a season profile when there are no match logs', async () => {
    fetchApi.mockResolvedValue([]);

    render(<PlayerDetail player={player} />);

    // Header badge (once loaded) and Decision Hub badge.
    await waitFor(() => expect(screen.getAllByText('No match data')).toHaveLength(2));
    expect(screen.queryByText('Season profile')).toBeNull();
    expect(within(categoryCell('Goals')).getByText('-')).toBeTruthy();
    expect(within(categoryCell('Disposals')).getByText('-')).toBeTruthy();
  });

  it('shows per-game averages over the match logs', async () => {
    fetchApi.mockResolvedValue([
      { season: 2026, round: 2, opponent: 'Carlton', stats: { goals: 4, disposals: 30 } },
      { season: 2026, round: 1, opponent: 'Geelong', stats: { goals: 2, disposals: 20 } },
    ]);

    render(<PlayerDetail player={player} />);

    expect(await screen.findByText('Per-game averages')).toBeTruthy();
    expect(within(categoryCell('Goals')).getByText('3.0')).toBeTruthy();
    expect(within(categoryCell('Disposals')).getByText('25')).toBeTruthy();
  });
});
