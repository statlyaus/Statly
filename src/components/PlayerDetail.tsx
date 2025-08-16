'use client';

import { useEffect, useState } from 'react';
import type { Player } from '@/types/players';
import { fetchApi } from '@/lib/api';
import PlayerSummaryCard from './PlayerSummaryCard';
import MatchLogTable from './MatchLogTable';
import PlayerChart from './PlayerChart';
import { LoadingSpinner } from './ui';

type PlayerDetailProps = {
  player: Player;
};

interface MatchData {
  round: number;
  fantasyScore: number;
  totalValue: number;
  opposition: string;
  opponent: string;
}

export const PlayerDetail = ({ player }: PlayerDetailProps) => {
  const [matchLogs, setMatchLogs] = useState<MatchData[]>([]);
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
        
        // Assuming the API returns an array of match objects
        const processedMatches = data.map((match: Record<string, unknown>) => ({
          round: match.round as number,
          fantasyScore: match.fantasyScore as number,
          totalValue: match.totalValue as number || 0,
          opposition: match.opposition as string || '',
          opponent: match.opponent as string || match.opposition as string || '',
        }));

        // Sort matches by round in descending order
        processedMatches.sort((a: MatchData, b: MatchData) => b.round - a.round);
        
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
    <div className="space-y-8">
      <PlayerSummaryCard player={player} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Recent Performance</h2>
          {loading ? (
            <div className="flex justify-center items-center h-48">
              <LoadingSpinner />
            </div>
          ) : error ? (
            <p className="text-red-500">{error}</p>
          ) : (
            <PlayerChart matchData={matchLogs} playerName={player.name} />
          )}
        </div>
        <div>
          <h2 className="text-2xl font-semibold mb-4">Match Logs</h2>
           {loading ? (
            <div className="flex justify-center items-center h-48">
              <LoadingSpinner />
            </div>
          ) : error ? (
            <p className="text-red-500">{error}</p>
          ) : (
            <MatchLogTable matchLogs={matchLogs} />
          )}
        </div>
      </div>
    </div>
  );
};