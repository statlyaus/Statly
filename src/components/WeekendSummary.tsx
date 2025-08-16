'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { LoadingSpinner } from './ui';
import type { Player } from '@/types/players';
import Image from 'next/image';
import { getTeamLogo } from '@/lib/teamLogos';

interface TopPerformer extends Player {
  fantasyScore: number;
}

interface WeekendSummaryData {
  topPerformers: TopPerformer[];
  biggestUpset: {
    winner: string;
    loser: string;
    margin: number;
  };
}

export const WeekendSummary = () => {
  const [summary, setSummary] = useState<WeekendSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getSummaryData = async () => {
      try {
        setLoading(true);
        const data = await fetchApi('weekend-summary');
        setSummary(data);
      } catch (err) {
        setError('Failed to load weekend summary.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    getSummaryData();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-500">{error}</p>;
  }

  if (!summary) {
    return <p>No summary data available for the weekend.</p>;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-xl font-semibold">Weekend Wrap-Up</h2>
      </div>
      <div className="p-6 space-y-6">
        <div>
          <h3 className="font-semibold text-lg mb-2">Top Performers</h3>
          <ul className="space-y-2">
            {summary.topPerformers.map((player) => (
              <li key={player.id} className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                   <Image src={getTeamLogo(player.team || '') || '/default-logo.png'} alt={player.team || 'Team'} width={20} height={20} />
                  <span>{player.name} ({player.position})</span>
                </div>
                <span className="font-bold">{player.fantasyScore}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold text-lg mb-2">Biggest Upset</h3>
          <div className="flex justify-between items-center bg-gray-50 p-3 rounded-md">
            <div>
              <p>
                <span className="font-bold">{summary.biggestUpset.winner}</span> defeated
              </p>
              <p>{summary.biggestUpset.loser}</p>
            </div>
            <p className="text-lg font-bold text-green-600">
              by {summary.biggestUpset.margin}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};