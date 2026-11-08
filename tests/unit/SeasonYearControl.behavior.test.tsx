import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SeasonYearControl } from '@/components/league/settings/SeasonYearControl';

const authenticatedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/authenticatedFetch', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

function seasonState(competitionStatus: string, year = 2026) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: { leagueId: 'league-1', season: { year }, competitionStatus, schedule: [] },
    }),
  };
}

describe('SeasonYearControl', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  it('lets the commissioner move the league to another season while in setup', async () => {
    authenticatedFetchMock.mockResolvedValueOnce(seasonState('SETUP')).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { year: 2027 } }),
    });

    render(<SeasonYearControl leagueId="league-1" currentUserId="owner" />);

    const select = (await screen.findByLabelText('Season')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('2026'));
    expect(select.disabled).toBe(false);

    fireEvent.change(select, { target: { value: '2027' } });

    await waitFor(() =>
      expect(authenticatedFetchMock).toHaveBeenLastCalledWith(
        '/api/leagues/league-1/season-state',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ year: 2027 }) }),
        'owner'
      )
    );
    expect(await screen.findByText('Season changed to 2027.')).toBeTruthy();
  });

  it('shows the season read-only with the reason once the competition is published', async () => {
    authenticatedFetchMock.mockResolvedValueOnce(seasonState('PENDING'));

    render(<SeasonYearControl leagueId="league-1" currentUserId="owner" />);

    expect(
      await screen.findByText('The season can only change while the competition is in setup.')
    ).toBeTruthy();
    expect((screen.getByLabelText('Season') as HTMLSelectElement).disabled).toBe(true);
  });
});
