import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const player = {
  id: 'ply_nick_daicos',
  name: 'Nick Daicos',
  team: 'Collingwood',
  position: '',
  categories: {
    goals: 2,
    tackles: null,
    inside50s: 4,
    intercepts: 1,
    contestedMarks: 0,
    rebound50s: 2,
    contestedPossessions: 12,
    effectiveDisposals: 25,
    scoreInvolvements: 7,
  },
  hitouts: null,
  round: 3,
  season: 2026,
  lastUpdated: '2026-04-01T00:00:00Z',
  source: 'footywire',
};

vi.mock('@/hooks/useLiveData', () => ({
  useLiveData: () => ({
    playerStats: [player],
    liveMatches: [],
    isLive: true,
    lastUpdate: null,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import RealTimeMatchCenter from '@/components/advanced/RealTimeMatchCenter';

describe('Match Centre players tab', () => {
  it('shows the nine categories, "-" for an unreported stat, and no points score', async () => {
    render(<RealTimeMatchCenter />);
    fireEvent.click(screen.getByRole('tab', { name: /Players/ }));

    const card = (await screen.findByText('Nick Daicos')).closest('div.rounded-lg') as HTMLElement;
    expect(within(card).getByText('I50').previousSibling?.textContent).toBe('4');
    expect(within(card).getByText('T').previousSibling?.textContent).toBe('-');
    expect(within(card).getByText('CP').previousSibling?.textContent).toBe('12');
    expect(within(card).getByText('HO').previousSibling?.textContent).toBe('-');
    expect(screen.queryByText('Fantasy Pts')).toBeNull();
    expect(screen.queryByText('Top Performers')).toBeNull();
  });
});
