import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RoundMatches } from '@/components/RoundMatches';

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock('@/lib/api', () => ({ fetchApi: mocks.fetchApi }));

function match(id: string, status: 'scheduled' | 'in_progress' | 'final') {
  return {
    id,
    matchDate: '2025-09-27T04:30:00.000Z',
    homeTeam: 'Geelong',
    awayTeam: 'Brisbane Lions',
    scoreHome: null,
    scoreAway: null,
    round: 28,
    status,
  };
}

describe('RoundMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("labels each game with the fixture's status", () => {
    render(
      <RoundMatches
        round={28}
        season={2025}
        initialMatches={[match('a', 'scheduled'), match('b', 'in_progress'), match('c', 'final')]}
      />
    );

    expect(screen.getByText('Scheduled')).toBeVisible();
    expect(screen.getByText('Live')).toBeVisible();
    expect(screen.getByText('Final')).toBeVisible();
    expect(mocks.fetchApi).not.toHaveBeenCalled();
  });

  it('asks the API for the same season and round when nothing was preloaded', async () => {
    mocks.fetchApi.mockResolvedValue({ data: [match('a', 'final')] });

    render(<RoundMatches round={28} season={2025} initialMatches={[]} />);

    await waitFor(() => expect(screen.getByText('Final')).toBeVisible());
    expect(mocks.fetchApi).toHaveBeenCalledWith('matches?round=28&season=2025', {
      signal: expect.any(AbortSignal),
    });
  });
});
