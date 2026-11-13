/**
 * Bloodsucker 9/9 (#1286; BR-04b, US-2 AC1b): the lobby draw. The reveal plays from the committed
 * draw the server returns; a draw already settled on load shows its winner and refreshes nothing;
 * a refused draw names its code.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/authenticatedFetch', () => ({ authenticatedFetch: fetchMock }));

import { BloodsuckerDrawPanel } from '@/components/league/bloodsucker/BloodsuckerDrawPanel';

const NOW = Date.parse('2026-11-14T00:00:00.000Z');
const candidates = [
  { memberId: 'm-a', teamName: 'Alphas' },
  { memberId: 'm-b', teamName: 'Betas' },
  { memberId: 'm-c', teamName: 'Gammas' },
];
const empty = {
  leagueFormat: 'BLOODSUCKER',
  bloodsucker: null,
  method: null,
  draw: null,
  canManage: true,
  canDraw: true,
  drawBlockedReason: null,
  serverNow: new Date(NOW).toISOString(),
};
const drawn = (drawnAtMs: number, serverNowMs: number) => ({
  ...empty,
  bloodsucker: { memberId: 'm-b', teamName: 'Betas' },
  method: 'DRAW',
  canDraw: false,
  draw: {
    drawId: 'draw-1',
    drawnAt: new Date(drawnAtMs).toISOString(),
    winnerMemberId: 'm-b',
    candidates,
    revealMs: 6000,
  },
  serverNow: new Date(serverNowMs).toISOString(),
});
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fetchMock.mockReset();
});
afterEach(() => vi.useRealTimers());

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('BloodsuckerDrawPanel', () => {
  it('draws once, reveals the committed winner, then refreshes the room', async () => {
    // Once the draw commits, every later poll reads it too.
    let committed = false;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') committed = true;
      return json(200, committed ? drawn(NOW, Date.now()) : empty);
    });
    const onSettled = vi.fn();
    render(<BloodsuckerDrawPanel leagueId="league-1" onSettled={onSettled} />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Draw the Bloodsucker' }));
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/leagues/league-1/bloodsucker/draw',
      { method: 'POST' },
      undefined
    );
    expect(screen.getByText('Drawing the Bloodsucker.')).toBeInTheDocument();
    expect(onSettled).not.toHaveBeenCalled();

    for (let step = 0; step < 62; step += 1) {
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(screen.getByText('The Bloodsucker is Betas.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Draw the Bloodsucker' })).not.toBeInTheDocument();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('shows a draw settled before load at once, without refreshing the room', async () => {
    fetchMock.mockImplementation(() => json(200, drawn(NOW - 60_000, NOW)));
    const onSettled = vi.fn();
    render(<BloodsuckerDrawPanel leagueId="league-1" onSettled={onSettled} />);
    await flush();

    expect(screen.getByText('The Bloodsucker is Betas.')).toBeInTheDocument();
    expect(screen.getByText(/the draw cannot be repeated/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('names the code when the server refuses the draw', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? json(409, { code: 'BLOODSUCKER_ALREADY_DRAWN', error: 'Already drawn.' })
        : json(200, empty)
    );
    render(<BloodsuckerDrawPanel leagueId="league-1" />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Draw the Bloodsucker' }));
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The draw did not run (BLOODSUCKER_ALREADY_DRAWN). Already drawn.'
    );
  });

  it('renders nothing outside a Bloodsucker league', async () => {
    fetchMock.mockImplementation(() => json(200, { ...empty, leagueFormat: 'STANDARD' }));
    const { container } = render(<BloodsuckerDrawPanel leagueId="league-1" />);
    await flush();
    expect(container).toBeEmptyDOMElement();
  });
});
