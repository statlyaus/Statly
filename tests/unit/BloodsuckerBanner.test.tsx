/**
 * #1343 (BR-35, BR-40): the banner tells the Bloodsucker about each bite it has to make on every
 * league tab, tells the victim its team is held, gives a commissioner outside the bite the way to
 * cancel or redo it, and keeps refreshing without Socket.IO (NFR-7).
 */
import { act, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: fetchMock }));

import { BloodsuckerBanner } from '@/components/league/bloodsucker/BloodsuckerBanner';
import {
  useBloodsuckerSummary,
  type BloodsuckerSummaryView,
} from '@/components/league/bloodsucker/useBloodsuckerSummary';

type Bite = BloodsuckerSummaryView['bites'][number];
const bite = (overrides: Partial<Bite> = {}): Bite => ({
  biteId: 'bite-1',
  round: 3,
  status: 'OPEN',
  victim: { memberId: 'victim', teamName: 'Brunswick Bats' },
  takenPlayer: null,
  returnedPlayer: null,
  deadlineAt: '2026-06-03T10:00:00.000Z',
  executedAt: null,
  commissionerActions: [],
  ...overrides,
});
const summary = (
  viewer: Partial<BloodsuckerSummaryView['viewer']>,
  bites: Bite[] = [bite()]
): BloodsuckerSummaryView => ({
  leagueFormat: 'BLOODSUCKER',
  bloodsucker: { memberId: 'bs', teamName: 'Night Shift' },
  record: { wins: 2, losses: 1, draws: 0 },
  bites,
  viewer: { memberId: 'other', isBloodsucker: false, isCommissioner: false, ...viewer },
});

describe('BloodsuckerBanner', () => {
  it('links the Bloodsucker to each bite it has to make, in the full and the compact banner', () => {
    const mine = summary({ memberId: 'bs', isBloodsucker: true });
    const { rerender } = render(
      <BloodsuckerBanner leagueId="league-1" summary={mine} failed={false} />
    );
    const link = screen.getByRole('link', { name: 'Bite Brunswick Bats (round 3)' });
    expect(link).toHaveAttribute('href', '/leagues/league-1/bites/bite-1');
    expect(screen.getByText('Bites this season')).toBeInTheDocument();

    rerender(<BloodsuckerBanner leagueId="league-1" summary={mine} failed={false} compact />);
    expect(screen.getByRole('link', { name: 'Bite Brunswick Bats (round 3)' })).toBeInTheDocument();
    expect(screen.getByText(/The Bloodsucker is Night Shift \(you\)/)).toBeInTheDocument();
    expect(screen.queryByText('Bites this season')).not.toBeInTheDocument();
  });

  it('tells the victim its team is held while a bite waits', () => {
    render(
      <BloodsuckerBanner
        leagueId="league-1"
        summary={summary({ memberId: 'victim' })}
        failed={false}
        compact
      />
    );

    expect(screen.getByText(/has a bite waiting on your team \(round 3\)/)).toHaveTextContent(
      'your drops and trades are held'
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('gives a commissioner outside the bite a labelled way to cancel or redo it', () => {
    render(
      <BloodsuckerBanner
        leagueId="league-1"
        summary={summary({ memberId: 'owner', isCommissioner: true }, [
          bite({
            status: 'EXECUTED',
            takenPlayer: { id: 'v', name: 'Max Gawn' },
            returnedPlayer: { id: 'b', name: 'Tim English' },
            commissionerActions: ['cancel', 'redo'],
          }),
          bite({ biteId: 'bite-2', round: 4, status: 'CANCELLED' }),
        ])}
        failed={false}
      />
    );

    const rows = screen.getAllByRole('listitem');
    expect(
      within(rows[0]!).getByRole('link', {
        name: 'Cancel or redo the round 3 bite on Brunswick Bats',
      })
    ).toHaveAttribute('href', '/leagues/league-1/bites/bite-1');
    expect(within(rows[1]!).queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers a commissioner only cancel on an open bite, and nothing to other members', () => {
    const { rerender } = render(
      <BloodsuckerBanner
        leagueId="league-1"
        summary={summary({ memberId: 'owner', isCommissioner: true }, [
          bite({ commissionerActions: ['cancel'] }),
        ])}
        failed={false}
      />
    );
    expect(
      screen.getByRole('link', { name: 'Cancel the round 3 bite on Brunswick Bats' })
    ).toBeInTheDocument();

    rerender(<BloodsuckerBanner leagueId="league-1" summary={summary({})} failed={false} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows a bite in a status this build does not know', () => {
    render(
      <BloodsuckerBanner
        leagueId="league-1"
        summary={summary({}, [bite({ status: 'UNPAIRABLE' })])}
        failed={false}
      />
    );

    expect(screen.getByText('Brunswick Bats: ended without a swap')).toBeInTheDocument();
  });

  it('keeps the last loaded record when a refresh fails, and says so', () => {
    const { rerender } = render(<BloodsuckerBanner leagueId="league-1" summary={null} failed />);
    expect(screen.getByText(/could not load/)).toBeInTheDocument();

    rerender(<BloodsuckerBanner leagueId="league-1" summary={summary({})} failed />);
    expect(screen.getByText(/The Bloodsucker is Night Shift/)).toBeInTheDocument();
    expect(screen.getByText(/could not refresh/)).toBeInTheDocument();
  });
});

describe('useBloodsuckerSummary', () => {
  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => ok(summary({})));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads, then refreshes on focus, on a modest interval and when the tab changes', async () => {
    const { result, rerender } = renderHook(
      ({ tab }) => useBloodsuckerSummary('league-1', true, 'user-1', tab),
      { initialProps: { tab: 'overview' } }
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.summary?.bites).toHaveLength(1);

    fetchMock.mockImplementation(() => ok(summary({}, [bite(), bite({ biteId: 'bite-2' })])));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.summary?.bites).toHaveLength(2);

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    rerender({ tab: 'lineup' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps the last summary when a refresh fails, and recovers', async () => {
    const { result } = renderHook(() => useBloodsuckerSummary('league-1', true));
    await act(() => vi.advanceTimersByTimeAsync(0));

    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 500 })));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(result.current.failed).toBe(true);
    expect(result.current.summary).not.toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(result.current.failed).toBe(false);
  });

  it('does nothing outside a Bloodsucker league', async () => {
    renderHook(() => useBloodsuckerSummary('league-1', false));
    await act(() => vi.advanceTimersByTimeAsync(120_000));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
