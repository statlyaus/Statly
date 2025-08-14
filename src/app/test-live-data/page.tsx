// Test page for live data integration
// This page demonstrates the complete data flow from Firebase to React components

'use client';

import { useState } from 'react';
import { useLiveData } from '@/hooks/useLiveData';
import { LiveDataExample } from '@/components/examples/LiveDataExample';

export default function TestLiveDataPage() {
  const { 
    playerStats, 
    liveMatches, 
    isLoading, 
    error, 
    lastUpdate, 
    isLive 
  } = useLiveData();

  const [selectedTab, setSelectedTab] = useState<'overview' | 'players' | 'matches' | 'example'>('overview');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 p-6">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-4">
            🔴 Live Data Integration Test
          </h1>
          <p className="text-xl text-slate-300">
            Testing the complete Firebase → API → React data flow
          </p>
        </div>

        {/* Status Banner */}
        <div className={`p-4 rounded-lg mb-6 ${
          isLive 
            ? 'bg-green-900/50 border border-green-500' 
            : 'bg-yellow-900/50 border border-yellow-500'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className={`w-3 h-3 rounded-full ${
                isLive ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'
              }`}></div>
              <span className="text-white font-medium">
                {isLive ? '🔴 LIVE DATA ACTIVE' : '⏸️ No Live Matches'}
              </span>
            </div>
            {lastUpdate && (
              <span className="text-slate-300 text-sm">
                Last update: {new Date(lastUpdate).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-slate-300">Loading live data from Firebase...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-900/50 border border-red-500 p-4 rounded-lg mb-6">
            <p className="text-red-200">
              <strong>Error:</strong> {error}
            </p>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-6">
          {[
            { id: 'overview' as const, label: 'Overview', icon: '📊' },
            { id: 'players' as const, label: 'Players', icon: '👤' },
            { id: 'matches' as const, label: 'Matches', icon: '🏈' },
            { id: 'example' as const, label: 'Example Component', icon: '🧪' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                selectedTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-slate-800/50 rounded-lg p-6 backdrop-blur-sm">
          
          {/* Overview Tab */}
          {selectedTab === 'overview' && !isLoading && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-white mb-4">Data Overview</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-700/50 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-2">Player Stats</h3>
                  <p className="text-3xl font-bold text-blue-400">{playerStats.length}</p>
                  <p className="text-slate-300 text-sm">Total player records</p>
                </div>
                
                <div className="bg-slate-700/50 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-2">Live Matches</h3>
                  <p className="text-3xl font-bold text-green-400">{liveMatches.length}</p>
                  <p className="text-slate-300 text-sm">Currently in progress</p>
                </div>
                
                <div className="bg-slate-700/50 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-2">Data Status</h3>
                  <p className="text-3xl font-bold text-purple-400">
                    {isLive ? 'LIVE' : 'STATIC'}
                  </p>
                  <p className="text-slate-300 text-sm">Current mode</p>
                </div>
              </div>

              {playerStats.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold text-white mb-3">Sample Player Data</h3>
                  <div className="bg-slate-900/50 p-4 rounded-lg">
                    <pre className="text-slate-300 text-sm overflow-x-auto">
                      {JSON.stringify(playerStats[0], null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Players Tab */}
          {selectedTab === 'players' && !isLoading && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-4">Player Statistics</h2>
              
              {playerStats.length === 0 ? (
                <p className="text-slate-300">No player data available. ETL pipeline may not be running.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-600">
                        <th className="text-white p-3">Player</th>
                        <th className="text-white p-3">Team</th>
                        <th className="text-white p-3">Fantasy Score</th>
                        <th className="text-white p-3">Disposals</th>
                        <th className="text-white p-3">Goals</th>
                        <th className="text-white p-3">Last Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {playerStats.slice(0, 10).map((player, index) => (
                        <tr key={index} className="border-b border-slate-700">
                          <td className="text-slate-300 p-3">{player.name}</td>
                          <td className="text-slate-300 p-3">{player.team}</td>
                          <td className="text-blue-400 p-3 font-medium">{player.fantasyScore}</td>
                          <td className="text-slate-300 p-3">{player.disposals}</td>
                          <td className="text-green-400 p-3">{player.goals}</td>
                          <td className="text-slate-400 p-3 text-sm">
                            {new Date(player.lastUpdated).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Matches Tab */}
          {selectedTab === 'matches' && !isLoading && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-4">Live Matches</h2>
              
              {liveMatches.length === 0 ? (
                <p className="text-slate-300">No live matches currently in progress.</p>
              ) : (
                <div className="space-y-4">
                  {liveMatches.map((match, index) => (
                    <div key={index} className="bg-slate-700/50 p-4 rounded-lg">
                      <div className="flex justify-between items-center">
                        <div>
                          <h3 className="text-white font-semibold">
                            {match.home_team} vs {match.away_team}
                          </h3>
                          <p className="text-slate-300 text-sm">
                            Round {match.round_number}, {match.season}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                            match.status === 'in_progress' 
                              ? 'bg-green-600 text-white' 
                              : 'bg-slate-600 text-slate-300'
                          }`}>
                            {match.status.replace('_', ' ').toUpperCase()}
                          </span>
                          <p className="text-slate-400 text-sm mt-1">
                            {new Date(match.start_time_utc).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Example Component Tab */}
          {selectedTab === 'example' && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-4">Live Data Example Component</h2>
              <p className="text-slate-300 mb-6">
                This demonstrates how to use the live data integration in a real component.
              </p>
              <LiveDataExample />
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-slate-400 text-sm">
            🔧 This is a development test page. Data source: Firebase Firestore
          </p>
        </div>

      </div>
    </div>
  );
}
