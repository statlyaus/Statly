'use client';

import { useEffect, useState } from 'react';

import { AppLayout } from '@/components/navigation';

interface LeagueStanding {
  rank: number;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  percentage: number;
  gamesBehind: string;
}

export default function LeaderboardClient() {
  const [standings, setStandings] = useState<LeagueStanding[]>([]);

  useEffect(() => {
    setStandings([
      {
        rank: 1,
        teamName: "Matthew's Monstrous Team",
        wins: 14,
        losses: 3,
        ties: 1,
        percentage: 0.806,
        gamesBehind: '--',
      },
      {
        rank: 2,
        teamName: "Ronnie's Rowdy Team",
        wins: 13,
        losses: 5,
        ties: 0,
        percentage: 0.722,
        gamesBehind: '1.5',
      },
      {
        rank: 3,
        teamName: "Bambang's Best Team",
        wins: 11,
        losses: 6,
        ties: 1,
        percentage: 0.639,
        gamesBehind: '3.0',
      },
      {
        rank: 4,
        teamName: "Michael's Magnificent Team",
        wins: 10,
        losses: 8,
        ties: 0,
        percentage: 0.556,
        gamesBehind: '4.5',
      },
    ]);
  }, []);

  return (
    <AppLayout>
      <main className="p-6">
        <h1 className="text-2xl font-bold mb-4">Leaderboard</h1>
        <table className="min-w-full border border-border">
          <thead>
            <tr className="bg-muted">
              <th className="p-2 border">Rank</th>
              <th className="p-2 border">Team</th>
              <th className="p-2 border">W-L-T</th>
              <th className="p-2 border">Pct</th>
              <th className="p-2 border">GB</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((team) => (
              <tr key={team.rank}>
                <td className="p-2 border">{team.rank}</td>
                <td className="p-2 border">{team.teamName}</td>
                <td className="p-2 border">
                  {team.wins}-{team.losses}-{team.ties}
                </td>
                <td className="p-2 border">{team.percentage.toFixed(3)}</td>
                <td className="p-2 border">{team.gamesBehind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </AppLayout>
  );
}
