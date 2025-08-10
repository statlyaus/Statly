'use client';

import { useEffect, useState } from 'react';
import teamLogos from '@/lib/teamLogos';

interface Match {
  homeTeam: string;
  awayTeam: string;
  [key: string]: any;
}

interface Props {
  round: number;
}

export default function RoundMatchesBanner({ round }: Props) {
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    async function loadMatches() {
      try {
        const res = await fetch(`/api/matches?round=${round}`);
        if (!res.ok) throw new Error('Failed to fetch matches');
        const data = await res.json();
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
      {matches.map((match, idx) => (
        <div
          key={`${match.homeTeam}-${match.awayTeam}-${idx}`}
          className="flex items-center gap-2 rounded-md bg-gray-800/80 px-3 py-2 text-white"
        >
          <img
            src={teamLogos[match.homeTeam]}
            alt={match.homeTeam}
            className="h-8 w-8 object-contain"
          />
          <span className="font-semibold">{match.homeTeam}</span>
          <span className="mx-1 text-sm">vs</span>
          <img
            src={teamLogos[match.awayTeam]}
            alt={match.awayTeam}
            className="h-8 w-8 object-contain"
          />
          <span className="font-semibold">{match.awayTeam}</span>
        </div>
      ))}
    </div>
  );
}
