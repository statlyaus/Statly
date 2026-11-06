import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { fetchJson } = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('@/lib/api', () => ({ fetchJson }));

import LiveStatsDemo from '@/components/LiveStatsDemo';

describe('LiveStatsDemo', () => {
  afterEach(() => {
    fetchJson.mockReset();
  });

  it('loads nothing until a match is entered and says so', () => {
    render(<LiveStatsDemo />);

    expect(screen.getByRole('heading', { name: 'No match selected' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Match UID' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Load' })).toBeDisabled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('requests the match the manager entered', async () => {
    fetchJson.mockResolvedValue({
      matchUid: '2026-R1-CAR-RIC',
      players: [],
      count: 0,
      lastUpdated: '2026-03-12T09:00:00Z',
      source: 'footywire',
    });
    render(<LiveStatsDemo />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Match UID' }), {
      target: { value: ' 2026-R1-CAR-RIC ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));

    expect(fetchJson).toHaveBeenCalledWith(
      '/api/live-player-stats?matchUid=2026-R1-CAR-RIC',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(await screen.findByRole('heading', { name: 'No Data Available' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No match selected' })).not.toBeInTheDocument();
  });
});
