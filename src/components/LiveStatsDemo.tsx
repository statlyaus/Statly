'use client';

import { useState } from 'react';
import { useLivePlayerStats, useTimeSinceUpdate } from '@/hooks/useLivePlayerStats';

export default function LiveStatsDemo() {
  const [matchUid, setMatchUid] = useState('2025-R18-ADE-COL');
  const [pollInterval, setPollInterval] = useState(30000);
  
  const {
    data,
    players,
    isLoading,
    error,
    timeSinceUpdate,
    refresh,
    hasData,
    isEmpty,
    playerCount
  } = useLivePlayerStats(matchUid, { pollInterval });
  
  const timeSinceText = useTimeSinceUpdate(timeSinceUpdate);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-4">Live AFL Player Statistics</h1>
        
        {/* Controls */}
        <div className="bg-gray-50 p-4 rounded-lg mb-6 space-y-4">
          <div className="flex gap-4 items-center">
            <label htmlFor="match-uid" className="font-medium">Match UID:</label>
            <input
              id="match-uid"
              type="text"
              value={matchUid}
              onChange={(e) => setMatchUid(e.target.value)}
              className="px-3 py-2 border rounded-md flex-1"
              placeholder="e.g., 2025-R18-ADE-COL"
            />
            <button
              onClick={refresh}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
            >
              {isLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          
          <div className="flex gap-4 items-center">
            <label htmlFor="poll-interval" className="font-medium">Poll Interval:</label>
            <select
              id="poll-interval"
              value={pollInterval}
              onChange={(e) => setPollInterval(Number(e.target.value))}
              className="px-3 py-2 border rounded-md"
            >
              <option value={10000}>10 seconds</option>
              <option value={30000}>30 seconds</option>
              <option value={60000}>1 minute</option>
              <option value={120000}>2 minutes</option>
            </select>
          </div>
        </div>
        
        {/* Status */}
        <div className="bg-white border rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isLoading ? 'bg-yellow-400' : hasData ? 'bg-green-400' : 'bg-gray-400'}`} />
              <span className="font-medium">
                {isLoading ? 'Loading...' : hasData ? 'Live Data Connected' : 'No Data'}
              </span>
            </div>
            
            {timeSinceText && (
              <div className="text-sm text-gray-600">
                Last updated {timeSinceText} • Source: Footywire via fitzRoy
              </div>
            )}
          </div>
          
          {hasData && (
            <div className="text-sm text-gray-600 mt-2">
              {playerCount} players • Match: {data?.matchUid}
            </div>
          )}
        </div>
      </div>
      
      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <h3 className="font-medium text-red-800 mb-2">Error</h3>
          <p className="text-red-700">{error}</p>
        </div>
      )}
      
      {/* Empty State */}
      {isEmpty && !isLoading && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <h3 className="font-medium text-yellow-800 mb-2">No Data Available</h3>
          <p className="text-yellow-700">
            No player statistics found for match &quot;{matchUid}&quot;. This could mean:
          </p>
          <ul className="list-disc list-inside text-yellow-700 mt-2 space-y-1">
            <li>The match hasn&apos;t started yet</li>
            <li>The match UID is incorrect</li>
            <li>The ETL pipeline hasn&apos;t collected data for this match</li>
          </ul>
        </div>
      )}
      
      {/* Players Grid */}
      {hasData && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">Player Statistics</h2>
          
          <div className="grid gap-4">
            {players.map((player) => (
              <div key={player.player_uid} className="bg-white border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-lg">{player.player_uid.replace('ply_', '').replace(/_/g, ' ')}</h3>
                  <span className="text-sm text-gray-500">
                    {new Date(player.last_seen_at).toLocaleTimeString()}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {Object.entries(player.stats).map(([stat, value]) => (
                    <div key={stat} className="text-center">
                      <div className="text-xs text-gray-500 uppercase tracking-wider">
                        {stat.replace(/_/g, ' ')}
                      </div>
                      <div className="text-lg font-semibold">
                        {value ?? '-'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
