import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MatchLogRow } from '@/lib/matchLogs';
import type { Player } from '@/types/players';

import { PlayerDetail } from './PlayerDetail';

type PlayerChartProps = {
  matchData: Array<{
    round: number | undefined;
    value: number | null;
    opposition: string | undefined;
  }>;
  metricLabel: string;
  playerName: string;
};

const mocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
  playerChart: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  fetchApi: mocks.fetchApi,
}));

vi.mock('./PlayerSummaryCard', () => ({
  default: ({ player }: { player: Player }) => <div data-testid="player-summary">{player.name}</div>,
}));

vi.mock('./ui', () => ({
  LoadingSpinner: () => <div role="status">Loading</div>,
}));

vi.mock('./PlayerChart', () => ({
  default: (props: PlayerChartProps) => {
    mocks.playerChart(props);
    return <div data-testid="player-chart" />;
  },
}));

const basePlayer: Player = {
  id: 'player-1',
  name: 'Test Player',
  team: 'Brisbane',
  position: 'MID',
  stats: {},
};

const nullableAdvancedStats = {
  clearances: null,
  inside50s: null,
  rebound50s: null,
  contestedPossessions: null,
  uncontestedPossessions: null,
  freesFor: null,
  freesAgainst: null,
  onePercenters: null,
  goalAssists: null,
  turnovers: null,
  intercepts: null,
  metresGained: null,
  contestedMarks: null,
  effectiveDisposals: null,
  scoreInvolvements: null,
  timeOnGroundPct: null,
  disposalEffPct: null,
  minutes: null,
};

const matchLog: MatchLogRow = {
  matchId: 'match-1',
  season: 2026,
  roundNumber: 1,
  date: '2026-03-20T08:00:00.000Z',
  opponent: 'Richmond',
  stats: {
    goals: 1,
    behinds: 0,
    kicks: 10,
    handballs: 8,
    disposals: 18,
    marks: 5,
    tackles: 4,
    hitouts: 0,
    clangers: 2,
    ...nullableAdvancedStats,
  },
};

describe('PlayerDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchApi.mockResolvedValue([matchLog]);
  });

  it('passes unavailable nullable advanced stats to PlayerChart as null instead of zero', async () => {
    const user = userEvent.setup();

    render(<PlayerDetail player={basePlayer} />);

    await screen.findByTestId('player-chart');

    await user.selectOptions(screen.getByRole('combobox', { name: /stat/i }), 'disposalEffPct');

    await waitFor(() => {
      const latestProps = mocks.playerChart.mock.calls.at(-1)?.[0] as PlayerChartProps | undefined;

      expect(latestProps).toMatchObject({
        metricLabel: 'Disposal Eff. %',
        matchData: [{ round: 1, value: null, opposition: 'Richmond' }],
      });
    });
  });
});
