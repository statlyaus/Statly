'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import type { Match } from '@/types/matches';
import { LoadingSpinner } from './ui';
import { getTeamLogo } from '@/lib/teamLogos';
import Image from 'next/image';

type RoundMatchesProps = {
  round: number;
};

export const RoundMatches = ({ round }: RoundMatchesProps) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof round !== 'number') return;

    const getMatchData = async () => {
      try {
        setLoading(true);
        const data = await fetchApi(`matches?round=${round}`);
        setMatches(data);
      } catch (err) {
        setError('Failed to load match data for this round.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    getMatchData();
  }, [round]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-500 text-center">{error}</p>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Round {round} Matches</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {matches.map((match) => (
          <div key={match.id} className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <div className="text-center text-lg mb-4">
              <div className="flex justify-around items-center">
                <span className="flex items-center gap-2">
                   <Image src={getTeamLogo(match.homeTeam)} alt={match.homeTeam} width={24} height={24} />
                  {match.homeTeam}
                </span>
                <span>vs</span>
                <span className="flex items-center gap-2">
                   <Image src={getTeamLogo(match.awayTeam)} alt={match.awayTeam} width={24} height={24} />
                  {match.awayTeam}
                </span>
              </div>
            </div>
            <div className="text-center">
              <p className="font-semibold text-xl">
                {match.homeScore} - {match.awayScore}
              </p>
              <p className="text-sm text-gray-500 mt-1">{match.venue}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};