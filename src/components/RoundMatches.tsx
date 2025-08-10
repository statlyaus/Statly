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
            <th className="px-3 py-2 text-left">Home</th>
            <th className="px-3 py-2 text-left">Away</th>
            <th className="px-3 py-2 text-left">Score</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, idx) => (
            <tr
              key={`${m.homeTeam}-${m.awayTeam}-${idx}`}
              className="border-t hover:bg-gray-50"
            >
              <td className="px-3 py-2">
                {m.matchDate ? new Date(m.matchDate).toLocaleDateString() : '-'}
              </td>
              <td className="px-3 py-2">{m.homeTeam}</td>
              <td className="px-3 py-2">{m.awayTeam}</td>
              <td className="px-3 py-2">
                {m.scoreHome != null && m.scoreAway != null
                  ? `${m.scoreHome} - ${m.scoreAway}`
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RoundMatches;

