'use client';

import { useEffect, useState } from 'react';
import teamLogos from '@/lib/teamLogos';
import { fetchApi } from '@/lib/api';

interface Match {
  matchDate?: string;
  homeTeam: string;  // Real AFL matches always have valid team names
  awayTeam: string;  // Real AFL matches always have valid team names
  scoreHome: number | null;
  scoreAway: number | null;
  round?: number;
}

interface Props {
  round: number;
}

export default function RoundMatchesBanner({ round }: Props) {
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    async function loadMatches() {
      try {
        const data = await fetchApi(
          `/api/matches?round=${round}`
        );
        // Support either {matches: Match[]} or Match[]
        setMatches(Array.isArray(data) ? data : (data.matches ?? []));
      } catch (err) {
        console.error(err);
      }
    }
    loadMatches();
  }, [round]);

  return (
    <div className="flex flex-wrap justify-center gap-4">
      {matches.map((match, idx) => {
        const homeTeam = match.homeTeam;
        const awayTeam = match.awayTeam;
        
        // Guard against missing team data
        if (!homeTeam || !awayTeam) {
          return null;
        }
        
        return (
          <div
            key={`${homeTeam}-${awayTeam}-${idx}`}
            className="flex items-center gap-2 rounded-md bg-gray-800/80 px-3 py-2 text-white"
          >
            <img
              src={teamLogos[homeTeam]}
              alt={homeTeam}
              className="h-8 w-8 object-contain"
            />
            <span className="font-semibold">{homeTeam}</span>
            <span className="mx-1 text-sm">vs</span>
            <img
              src={teamLogos[awayTeam]}
              alt={awayTeam}
              className="h-8 w-8 object-contain"
            />
            <span className="font-semibold">{awayTeam}</span>
          </div>
        );
      })}
    </div>
  );
}
