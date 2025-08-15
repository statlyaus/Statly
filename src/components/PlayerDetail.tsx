'use client';

import { useEffect, useState } from 'react';
import { fetchFromAPI } from '@/lib/api';
import PlayerStatsDisplay from './PlayerStatsDisplay';
import PlayerChart from './PlayerChart';
import type { PlayerStats } from '@/types/fantasyCategories';

interface PlayerDetailProps {
  player: {
    name: string;
    team: string;
    position: string;
  };
}

type PlayerMatchStat = {
  id: string;
  player_name: string;
  team: string;
  position: string;
  totalValue: number;
  categories: {
    goals: number;
    tackles: number;
    inside50s: number;
    intercepts: number;
    contestedMarks: number;
    rebound50s: number;
    contestedPossessions: number;
    effectiveDisposals: number;
    scoreInvolvements: number;
  };
  perGameLog: PlayerStats;
  round: number;
  opposition: string;
  match_id: string;
  season: number;
};

export default function PlayerDetail({ player }: PlayerDetailProps) {
  const [matchData, setMatchData] = useState<PlayerMatchStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { name, team, position } = player;

  useEffect(() => {
    // Fetch real match data for this player
    fetchFromAPI<{ data: PlayerMatchStat[] }>('/api/player-stats?season=2025')
      .then((response) => {
        // Filter for this specific player
        const playerMatches = response.data.filter(
          match => match.player_name.toLowerCase() === name.toLowerCase()
        );
        setMatchData(playerMatches.sort((a, b) => a.round - b.round));
        setLoading(false);
      })
      .catch((_err) => {
        setError('Failed to load player match data');
        setLoading(false);
      });
  }, [name]);

  if (loading) return <div className="p-4">Loading player data...</div>;
  if (error) return <div className="p-4 text-red-500">{error}</div>;

  // Calculate season averages
  const totalGames = matchData.length;
  const seasonAverages: PlayerStats | undefined = totalGames > 0 ? {
    games: totalGames,
    kicks: matchData.reduce((sum, m) => sum + m.perGameLog.kicks, 0) / totalGames,
    handballs: matchData.reduce((sum, m) => sum + m.perGameLog.handballs, 0) / totalGames,
    marks: matchData.reduce((sum, m) => sum + m.perGameLog.marks, 0) / totalGames,
    tackles: matchData.reduce((sum, m) => sum + m.categories.tackles, 0) / totalGames,
    goals: matchData.reduce((sum, m) => sum + m.categories.goals, 0) / totalGames,
    hitouts: matchData.reduce((sum, m) => sum + m.perGameLog.hitouts, 0) / totalGames,
    clearances: matchData.reduce((sum, m) => sum + m.perGameLog.clearances, 0) / totalGames,
    inside50s: matchData.reduce((sum, m) => sum + m.categories.inside50s, 0) / totalGames,
    rebound50s: matchData.reduce((sum, m) => sum + m.categories.rebound50s, 0) / totalGames,
    clangers: matchData.reduce((sum, m) => sum + m.perGameLog.clangers, 0) / totalGames,
    contestedPossessions: matchData.reduce((sum, m) => sum + m.categories.contestedPossessions, 0) / totalGames,
    uncontestedPossessions: matchData.reduce((sum, m) => sum + m.perGameLog.uncontestedPossessions, 0) / totalGames,
    freesFor: matchData.reduce((sum, m) => sum + m.perGameLog.freesFor, 0) / totalGames,
    freesAgainst: matchData.reduce((sum, m) => sum + m.perGameLog.freesAgainst, 0) / totalGames,
    onePercenters: matchData.reduce((sum, m) => sum + m.perGameLog.onePercenters, 0) / totalGames,
    goalAssists: matchData.reduce((sum, m) => sum + m.perGameLog.goalAssists, 0) / totalGames,
    timeOnGroundPct: matchData.reduce((sum, m) => sum + m.perGameLog.timeOnGroundPct, 0) / totalGames,
    disposalEffPct: matchData.reduce((sum, m) => sum + m.perGameLog.disposalEffPct, 0) / totalGames,
    turnovers: matchData.reduce((sum, m) => sum + m.perGameLog.turnovers, 0) / totalGames,
    intercepts: matchData.reduce((sum, m) => sum + m.categories.intercepts, 0) / totalGames,
    metresGained: matchData.reduce((sum, m) => sum + m.perGameLog.metresGained, 0) / totalGames,
    contestedMarks: matchData.reduce((sum, m) => sum + m.categories.contestedMarks, 0) / totalGames,
    effectiveDisposals: matchData.reduce((sum, m) => sum + m.categories.effectiveDisposals, 0) / totalGames,
    scoreInvolvements: matchData.reduce((sum, m) => sum + m.categories.scoreInvolvements, 0) / totalGames,
  } : undefined;

  const avgTotalValue = totalGames > 0 ? 
    matchData.reduce((sum, m) => sum + m.totalValue, 0) / totalGames : 0;

  let bio: string;
  if (position && team) {
    bio = `${name} plays ${position} for ${team}.`;
  } else if (team) {
    bio = `${name} plays for ${team}.`;
  } else if (position) {
    bio = `${name} is a ${position}.`;
  } else {
    bio = 'Biography information is unavailable.';
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Player Overview</h2>
        <p className="text-neutral-700">{bio}</p>
        {totalGames > 0 && (
          <div className="mt-3 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium text-lg mb-2">2025 Season Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-gray-500">Games Played</div>
                <div className="text-xl font-bold">{totalGames}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Avg Total Value</div>
                <div className="text-xl font-bold text-purple-600">{avgTotalValue.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Avg Goals</div>
                <div className="text-xl font-bold text-green-600">{(seasonAverages?.goals || 0).toFixed(1)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Avg Tackles</div>
                <div className="text-xl font-bold text-red-600">{(seasonAverages?.tackles || 0).toFixed(1)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {seasonAverages && (
        <div>
          <h2 className="text-xl font-semibold">Season Averages (9-Category System)</h2>
          <PlayerStatsDisplay 
            stats={seasonAverages} 
            selectedCategories={[
              'goals', 'tackles', 'inside50s', 'intercepts', 'contestedMarks',
              'rebound50s', 'contestedPossessions', 'effectiveDisposals', 'scoreInvolvements'
            ]} 
            layout="grid"
          />
        </div>
      )}

      {matchData.length > 0 && (
        <div>
          <PlayerChart 
            playerName={name}
            matchData={matchData.map(match => ({
              round: match.round,
              totalValue: match.totalValue,
              opposition: match.opposition
            }))}
          />
        </div>
      )}

      {matchData.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold">Match-by-Match Results</h2>
          <div className="space-y-3">
            {matchData.map((match, index) => (
              <div key={`${match.match_id}-${index}`} className="border rounded-lg p-4 bg-white">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-semibold">Round {match.round} vs {match.opposition}</h3>
                    <p className="text-sm text-gray-500">Match ID: {match.match_id}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-purple-600">{match.totalValue}</div>
                    <div className="text-xs text-gray-500">Total Value</div>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 md:grid-cols-5 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Goals:</span>
                    <span className="ml-1 font-medium text-green-600">{match.categories.goals}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Tackles:</span>
                    <span className="ml-1 font-medium text-red-600">{match.categories.tackles}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Inside 50s:</span>
                    <span className="ml-1 font-medium text-orange-600">{match.categories.inside50s}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Intercepts:</span>
                    <span className="ml-1 font-medium text-green-600">{match.categories.intercepts}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Eff. Disposals:</span>
                    <span className="ml-1 font-medium text-blue-600">{match.categories.effectiveDisposals}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
