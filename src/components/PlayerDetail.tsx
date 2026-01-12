'use client';

import { useEffect, useState } from 'react';

import { fetchApi } from '@/lib/api';
import type { MatchLog } from '@/types/matchLogs';
import type { Player } from '@/types/players';

import MatchLogTable from './MatchLogTable';
import PlayerChart from './PlayerChart';
import PlayerSummaryCard from './PlayerSummaryCard';
import { LoadingSpinner } from './ui';

type PlayerDetailProps = {
  player: Player;
};

export const PlayerDetail = ({ player }: PlayerDetailProps) => {
  const [matchLogs, setMatchLogs] = useState<MatchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!player || !player.id) {
      setLoading(false);
      return;
    }

    const getMatchLogs = async () => {
      try {
        setLoading(true);
        const data = await fetchApi(`players/${player.id}/matches`);
        const matches = Array.isArray(data) ? data : data?.data ?? [];

        // Transform API data to match MatchLog interface
        const processedMatches: MatchLog[] = matches.map((match: Record<string, unknown>) => ({
          round: match.round as number,
          opponent: (match.opponent as string) || (match.opposition as string) || '',
          goals: match.goals as number,
          disposals: match.disposals as number,
          marks: match.marks as number,
          tackles: match.tackles as number,
          fantasyPoints: (match.fantasyPoints as number) || (match.fantasyScore as number),
          matchDate: match.matchDate as string,
          venue: match.venue as string,
          result: match.result as 'W' | 'L' | 'D',
          margin: match.margin as number,
          kickingAccuracy: match.kickingAccuracy as string,
          timeOnGround: match.timeOnGround as number,
          superCoachScore: match.superCoachScore as number,
          dreamTeamScore: match.dreamTeamScore as number,
          totalValue: match.totalValue as number,
          fantasyScore: match.fantasyScore as number, // For backward compatibility
        }));

        // Sort matches by round in descending order
        processedMatches.sort((a, b) => b.round - a.round);

        setMatchLogs(processedMatches);
      } catch (err: unknown) {
        setError('Failed to load match history.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    getMatchLogs();
  }, [player]);

  if (!player) {
    return <p>No player data available.</p>;
  }

  return (
    <div className="space-y-10">
      <PlayerSummaryCard player={player} />

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-900">Recent Performance</h2>
            <span className="text-xs text-slate-500">Last matches</span>
          </div>
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <LoadingSpinner />
            </div>
          ) : error ? (
            <p className="text-red-500">{error}</p>
          ) : (
            <PlayerChart
              matchData={matchLogs.map((log) => ({
                round: log.round,
                totalValue: log.totalValue || log.fantasyPoints || 0,
                opposition: log.opponent,
              }))}
              playerName={player.name}
            />
          )}
        </div>
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-900">Match Logs</h2>
            <button
              type="button"
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </div>
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <LoadingSpinner />
            </div>
          ) : error ? (
            <p className="text-red-500">{error}</p>
          ) : (
            <MatchLogTable
              matchLogs={matchLogs}
              playerName={player.name}
              showAdvancedStats={true}
              onRefresh={() => window.location.reload()}
            />
          )}
        </div>
      </section>
    </div>
  );
};
