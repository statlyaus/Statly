'use client';

import { useEffect, useState } from 'react';

import StatFilters from '@/components/StatFilters';
import PlayerStatsTable from '@/components/stats/PlayerStatsTable';
import { LoadingSpinner } from '@/components/ui';
import { fetchApi } from '@/lib/api';
import type { AggregatedPlayerStat, AggregatedPlayerStatsResponse } from '@/hooks/usePlayerStats';
import type { Player } from '@/types/players';

const STATS_LIMIT = 1000;

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function aggregateStatToPlayer(row: AggregatedPlayerStat): Player {
  const averages = row.averages ?? {};
  const totals = row.totals ?? {};

  return {
    id: row.player_id || row.id,
    name: row.player_name,
    team: row.team,
    position: row.position,
    games: row.games,
    stats: { ...totals },
    avg: readNumber(averages.avgFantasyPoints) ?? readNumber(row.fantasy_points),
    kicks: readNumber(averages.kicks),
    handballs: readNumber(averages.handballs),
    marks: readNumber(averages.marks),
    tackles: readNumber(averages.tackles),
    goals: readNumber(averages.goals),
    hitouts: readNumber(averages.hitouts),
    clearances: readNumber(averages.clearances),
    inside50s: readNumber(averages.inside50s),
    rebound50s: readNumber(averages.rebound50s),
    contestedPossessions: readNumber(averages.contestedPossessions),
  };
}

export default function StatsClient() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statQualifier, setStatQualifier] = useState<string>('Kicks');
  const [statThreshold, setStatThreshold] = useState<number>(10);
  const [timeframe, setTimeframe] = useState<string>('Season');

  useEffect(() => {
    const getMatchData = async () => {
      try {
        setLoading(true);
        const response = (await fetchApi(
          `player-stats/aggregate?limit=${STATS_LIMIT}`
        )) as AggregatedPlayerStatsResponse;
        setPlayers(response.success ? response.data.map(aggregateStatToPlayer) : []);
      } catch (err: unknown) {
        setError('Failed to load player stats.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    getMatchData();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive text-center">{error}</p>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Player Statistics</h1>
      <StatFilters
        statQualifier={statQualifier}
        setStatQualifier={setStatQualifier}
        statThreshold={statThreshold}
        setStatThreshold={setStatThreshold}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
      />
      <div className="mt-6">
        <PlayerStatsTable players={players} />
      </div>
    </div>
  );
}
