// Example integration of live data with existing components
// Place this in src/components/examples/LiveDataExample.tsx

import React from 'react';
import { useLiveData, useMatchData, usePlayerData } from '@/hooks/useLiveData';

interface LiveDataExampleProps {
  className?: string;
}

export function LiveDataExample({ className = '' }: LiveDataExampleProps) {
  // Use the live data hook to get real-time player stats
  const { 
    playerStats, 
    rawPlayerStats, 
    liveMatches, 
    isLive, 
    lastUpdate, 
    minutesSinceUpdate, 
    isLoading, 
    error,
    refresh 
  } = useLiveData({
    enablePolling: true,
    pollingInterval: 30000, // 30 seconds
    transformToLegacy: true
  });

  // Example of using match-specific data
  const matchUid = liveMatches.length > 0 ? `match_${liveMatches[0].season}_${liveMatches[0].round_number}_${liveMatches[0].home_team}_${liveMatches[0].away_team}` : null;
  const _matchData = useMatchData(matchUid); // Available for use

  // Example of using player-specific data
  const samplePlayerUid = rawPlayerStats.length > 0 ? rawPlayerStats[0].player_uid : null;
  const playerData = usePlayerData(samplePlayerUid, 5);

  if (isLoading) {
    return (
      <div className={`p-6 text-center ${className}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading live data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-6 text-center ${className}`}>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-semibold">Error Loading Live Data</h3>
          <p className="text-red-600 mt-2">{error}</p>
          <button 
            onClick={refresh}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Data Status Header */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Live Data Status</h2>
            <div className="flex items-center space-x-4 mt-2">
              <div className="flex items-center">
                <div className={`w-3 h-3 rounded-full mr-2 ${isLive ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                <span className="text-sm text-gray-600">
                  {isLive ? 'Live Data Active' : 'No Live Matches'}
                </span>
              </div>
              {lastUpdate && (
                <span className="text-sm text-gray-500">
                  Last update: {minutesSinceUpdate}m ago
                </span>
              )}
            </div>
          </div>
          <button 
            onClick={refresh}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Live Matches Summary */}
      {liveMatches.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Live Matches ({liveMatches.length})</h3>
          <div className="space-y-3">
            {liveMatches.map((match, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <div>
                  <span className="font-medium">{match.home_team} vs {match.away_team}</span>
                  <span className="text-sm text-gray-600 ml-2">Round {match.round_number}</span>
                </div>
                <span className="bg-green-600 text-white px-2 py-1 rounded text-sm">
                  {match.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Player Statistics Summary */}
      {playerStats.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Recent Player Statistics ({playerStats.length} players)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {playerStats.slice(0, 6).map((player, index) => (
              <div key={index} className="p-3 border border-gray-200 rounded-lg">
                <div className="font-medium text-gray-900">{player.name}</div>
                <div className="text-sm text-gray-600">{player.team}</div>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Fantasy Score:</span>
                    <span className="font-medium">{player.fantasyScore}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Disposals:</span>
                    <span>{player.disposals}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Goals:</span>
                    <span>{player.goals}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Integration Examples */}
      <div className="space-y-6">
        <h3 className="text-lg font-semibold text-gray-900">Component Integration Examples</h3>
        
        {/* Example 1: Live data integration pattern */}
        {liveMatches.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h4 className="font-medium text-gray-900 mb-4">Live Scoring Integration Pattern</h4>
            <div className="bg-gray-50 p-4 rounded">
              <p className="text-sm text-gray-600">
                Your LiveScoringMatchup component can now access live player stats via the useLiveData hook.
                Replace mock data with real-time statistics from the ETL pipeline.
              </p>
            </div>
          </div>
        )}

        {/* Example 2: Player analysis integration pattern */}
        {samplePlayerUid && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h4 className="font-medium text-gray-900 mb-4">Player Analysis Integration Pattern</h4>
            <div className="bg-gray-50 p-4 rounded">
              <p className="text-sm text-gray-600">
                Your PlayerAnalysis component can now access player profiles and recent stats via the usePlayerData hook.
                Show real player performance trends and current season statistics.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Debug Information */}
      <details className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <summary className="font-medium text-gray-900 cursor-pointer">Debug Information</summary>
        <div className="mt-4 space-y-4">
          <div>
            <h4 className="font-medium text-gray-700">Raw Player Stats Sample:</h4>
            <pre className="mt-2 text-xs bg-white p-3 rounded border overflow-auto max-h-40">
              {JSON.stringify(rawPlayerStats.slice(0, 2), null, 2)}
            </pre>
          </div>
          <div>
            <h4 className="font-medium text-gray-700">Live Matches:</h4>
            <pre className="mt-2 text-xs bg-white p-3 rounded border overflow-auto max-h-40">
              {JSON.stringify(liveMatches, null, 2)}
            </pre>
          </div>
          {playerData.profile && (
            <div>
              <h4 className="font-medium text-gray-700">Sample Player Profile:</h4>
              <pre className="mt-2 text-xs bg-white p-3 rounded border overflow-auto max-h-40">
                {JSON.stringify(playerData.profile, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

// Usage instructions component
export function LiveDataUsageInstructions() {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-blue-900 mb-4">How to Use Live Data in Your Components</h3>
      
      <div className="space-y-4 text-sm">
        <div>
          <h4 className="font-medium text-blue-800">1. Basic Live Data Hook</h4>
          <pre className="mt-2 bg-white p-3 rounded border text-xs overflow-auto">
{`import { useLiveData } from '@/hooks/useLiveData';

function MyComponent() {
  const { playerStats, isLive, isLoading, error } = useLiveData();
  
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return (
    <div>
      {isLive && <div>🔴 Live data active</div>}
      {playerStats.map(player => (
        <div key={player.id}>{player.name}: {player.fantasyScore}</div>
      ))}
    </div>
  );
}`}
          </pre>
        </div>

        <div>
          <h4 className="font-medium text-blue-800">2. Player-Specific Data</h4>
          <pre className="mt-2 bg-white p-3 rounded border text-xs overflow-auto">
{`import { usePlayerData } from '@/hooks/useLiveData';

function PlayerProfile({ playerUid }) {
  const { profile, recentStats, isLoading } = usePlayerData(playerUid);
  
  if (isLoading) return <div>Loading player...</div>;
  
  return (
    <div>
      <h3>{profile?.full_name}</h3>
      <p>Team: {profile?.current_team}</p>
      <div>Recent games: {recentStats.length}</div>
    </div>
  );
}`}
          </pre>
        </div>

        <div>
          <h4 className="font-medium text-blue-800">3. Match-Specific Data</h4>
          <pre className="mt-2 bg-white p-3 rounded border text-xs overflow-auto">
{`import { useMatchData } from '@/hooks/useLiveData';

function MatchStats({ matchUid }) {
  const { playerStats, isLoading } = useMatchData(matchUid);
  
  return (
    <div>
      <h3>Match Statistics</h3>
      {playerStats.map(stat => (
        <div key={stat.player_uid}>
          Player: {stat.player_uid} - Fantasy: {calculateFantasyScore(stat.stats)}
        </div>
      ))}
    </div>
  );
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}
