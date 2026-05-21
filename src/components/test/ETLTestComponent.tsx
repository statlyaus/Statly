import React, { useState } from 'react';

import { useEnhancedMatches } from '@/hooks/useEnhancedMatches';
import { usePlayerStatsETL } from '@/hooks/usePlayerStats';

const ETLTestComponent: React.FC = () => {
  const [season, setSeason] = useState('2025');
  const [round, setRound] = useState('1');

  // Test player stats hook
  const {
    data: playerStats,
    loading: playerStatsLoading,
    error: playerStatsError,
    refetch: refetchPlayerStats,
  } = usePlayerStatsETL(season, round);

  // Test enhanced matches hook
  const {
    data: matches,
    loading: matchesLoading,
    error: matchesError,
    refetch: refetchMatches,
  } = useEnhancedMatches(season, round);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-foreground dark:text-white">
        ETL Integration Test Dashboard
      </h1>

      {/* Controls */}
      <div className="mb-6 p-4 bg-muted dark:bg-muted rounded-lg">
        <h2 className="text-lg font-semibold mb-4 text-foreground dark:text-white">
          Test Parameters
        </h2>
        <div className="flex gap-4 items-center">
          <div>
            <label
              htmlFor="season-input"
              className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1"
            >
              Season
            </label>
            <input
              id="season-input"
              type="text"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="border border-border dark:border-border rounded px-3 py-2 text-black dark:text-white bg-white dark:bg-muted"
              placeholder="2025"
            />
          </div>
          <div>
            <label
              htmlFor="round-input"
              className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1"
            >
              Round
            </label>
            <input
              id="round-input"
              type="text"
              value={round}
              onChange={(e) => setRound(e.target.value)}
              className="border border-border dark:border-border rounded px-3 py-2 text-black dark:text-white bg-white dark:bg-muted"
              placeholder="1"
            />
          </div>
          <div className="flex gap-2 mt-6">
            <button
              onClick={refetchPlayerStats}
              className="bg-info hover:bg-info text-white px-4 py-2 rounded"
              disabled={playerStatsLoading}
            >
              Refresh Stats
            </button>
            <button
              onClick={refetchMatches}
              className="bg-success hover:bg-success text-white px-4 py-2 rounded"
              disabled={matchesLoading}
            >
              Refresh Matches
            </button>
          </div>
        </div>
      </div>

      {/* Player Stats Section */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-foreground dark:text-white">
          Player Stats API Test
        </h2>
        <div className="bg-white dark:bg-muted rounded-lg shadow p-4">
          {playerStatsLoading && (
            <div className="text-info dark:text-info">Loading player stats...</div>
          )}

          {playerStatsError && (
            <div className="text-destructive dark:text-destructive bg-destructive/10 dark:bg-destructive p-3 rounded">
              Error: {playerStatsError}
            </div>
          )}

          {!playerStatsLoading && !playerStatsError && (
            <div>
              <div className="mb-4 text-muted-foreground dark:text-muted-foreground">
                Found {playerStats.length} player stats records
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {playerStats.slice(0, 6).map((stat) => (
                  <div
                    key={stat.id}
                    className="border border-border dark:border-border rounded p-3"
                  >
                    <div className="font-semibold text-foreground dark:text-white">
                      {stat.player_name}
                    </div>
                    <div className="text-sm text-muted-foreground dark:text-muted-foreground">
                      {stat.team} • {stat.position}
                    </div>
                    <div className="mt-2 text-sm">
                      <div className="text-foreground dark:text-muted-foreground">
                        Disposals: {stat.disposals} • Goals: {stat.goals}
                      </div>
                      <div className="text-foreground dark:text-muted-foreground">
                        Fantasy: {stat.fantasy_points} pts
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {playerStats.length > 6 && (
                <div className="mt-4 text-muted-foreground dark:text-muted-foreground">
                  ... and {playerStats.length - 6} more records
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Enhanced Matches Section */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-foreground dark:text-white">
          Enhanced Matches API Test
        </h2>
        <div className="bg-white dark:bg-muted rounded-lg shadow p-4">
          {matchesLoading && (
            <div className="text-info dark:text-info">Loading enhanced matches...</div>
          )}

          {matchesError && (
            <div className="text-destructive dark:text-destructive bg-destructive/10 dark:bg-destructive p-3 rounded">
              Error: {matchesError}
            </div>
          )}

          {!matchesLoading && !matchesError && (
            <div>
              <div className="mb-4 text-muted-foreground dark:text-muted-foreground">
                Found {matches.length} enhanced matches
              </div>
              <div className="space-y-4">
                {matches.map((match) => (
                  <div
                    key={match.id}
                    className="border border-border dark:border-border rounded p-4"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-semibold text-foreground dark:text-white">
                          {match.home_team} vs {match.away_team}
                        </div>
                        <div className="text-sm text-muted-foreground dark:text-muted-foreground">
                          Round {match.round_number}, {match.season} • {match.venue}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg text-foreground dark:text-white">
                          {match.home_score} - {match.away_score}
                        </div>
                        <div className="text-sm text-muted-foreground dark:text-muted-foreground">
                          {match.player_count || 0} player stats
                        </div>
                      </div>
                    </div>

                    {match.player_stats && match.player_stats.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border dark:border-border">
                        <div className="text-sm text-muted-foreground dark:text-muted-foreground mb-2">
                          Top performers:
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {match.player_stats
                            .sort((a, b) => b.fantasy_points - a.fantasy_points)
                            .slice(0, 3)
                            .map((stat, idx) => (
                              <span
                                key={idx}
                                className="text-xs bg-muted dark:bg-muted text-foreground dark:text-muted-foreground px-2 py-1 rounded"
                              >
                                {stat.player_name}: {stat.fantasy_points}pts
                              </span>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* API Status */}
      <div className="bg-muted dark:bg-foreground rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-2 text-foreground dark:text-white">API Status</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium text-foreground dark:text-muted-foreground">Player Stats API:</span>
            <span className={`ml-2 ${playerStatsError ? 'text-destructive' : 'text-success'}`}>
              {playerStatsError ? 'Error' : 'Connected'}
            </span>
          </div>
          <div>
            <span className="font-medium text-foreground dark:text-muted-foreground">
              Enhanced Matches API:
            </span>
            <span className={`ml-2 ${matchesError ? 'text-destructive' : 'text-success'}`}>
              {matchesError ? 'Error' : 'Connected'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ETLTestComponent;
