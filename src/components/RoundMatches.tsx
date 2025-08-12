'use client';

import { useEffect, useState } from 'react';
import { fetchFromAPI } from '@/lib/api';

interface Match {
  matchDate: string | null;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number | null;
  scoreAway: number | null;
}

interface RoundMatchesProps {
  round: number;
}

const RoundMatches = ({ round }: RoundMatchesProps) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMatches() {
      setLoading(true);
      try {
        const data = await fetchFromAPI<{ matches?: Match[] } | Match[]>(
          `/api/matches?round=${round}`
        );
        setMatches(Array.isArray(data) ? data : data.matches ?? []);
      } catch (err) {
        console.error(err);
        setMatches([]);
      } finally {
        setLoading(false);
      }
    }
    loadMatches();
  }, [round]);

  if (loading) {
    return <p className="text-sm text-gray-500">Loading matches...</p>;
  }

  if (!matches.length) {
    return <p className="text-sm text-gray-500">No match data available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full table-auto text-sm border-collapse">
                <thead className="bg-gray-100">
          <tr>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Home Team</th>
            <th className="px-3 py-2 text-left">Away Team</th>
            <th className="px-3 py-2 text-center">Score</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match, idx) => (
            <tr key={`${match.homeTeam}-${match.awayTeam}-${idx}`} className="border-t hover:bg-gray-50">
              <td className="px-3 py-2">
                {match.matchDate ? new Date(match.matchDate).toLocaleDateString() : 'TBD'}
              </td>
              <td className="px-3 py-2">{match.homeTeam}</td>
              <td className="px-3 py-2">{match.awayTeam}</td>
              <td className="px-3 py-2 text-center">
                {match.scoreHome !== null && match.scoreAway !== null 
                  ? `${match.scoreHome} - ${match.scoreAway}`
                  : '-'
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RoundMatches;

