'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui';

// Types
interface LiveMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  startTime: Date;
  status: 'pre-game' | 'live' | 'quarter-time' | 'half-time' | 'three-quarter-time' | 'full-time';
  currentQuarter?: number;
  timeRemaining?: string;
  homeScore: number;
  awayScore: number;
  lastGoal?: {
    player: string;
    team: string;
    timestamp: Date;
  };
}

interface LivePlayer {
  id: string;
  name: string;
  team: string;
  position: string;
  fantasyScore: number;
  realTimeStats: {
    disposals: number;
    marks: number;
    tackles: number;
    goals: number;
    behinds: number;
    hitouts?: number;
  };
  isPlaying: boolean;
  injuryStatus?: 'injured' | 'substituted';
}

interface RealTimeMatchCenterProps {
  selectedLeague?: string;
  favoriteTeams?: string[];
  watchlistPlayers?: string[];
  onPlayerSelect?: (player: LivePlayer) => void;
}

// Mock data
const mockMatches: LiveMatch[] = [
  {
    id: '1',
    homeTeam: 'Carlton',
    awayTeam: 'Collingwood',
    venue: 'MCG',
    startTime: new Date(),
    status: 'live',
    currentQuarter: 2,
    timeRemaining: '8:45',
    homeScore: 45,
    awayScore: 32,
    lastGoal: {
      player: 'Charlie Curnow',
      team: 'Carlton',
      timestamp: new Date(Date.now() - 120000),
    },
  },
  {
    id: '2',
    homeTeam: 'Richmond',
    awayTeam: 'Brisbane',
    venue: 'Gabba',
    startTime: new Date(Date.now() + 3600000),
    status: 'pre-game',
    homeScore: 0,
    awayScore: 0,
  },
];

const mockLivePlayers: LivePlayer[] = [
  {
    id: '1',
    name: 'Charlie Curnow',
    team: 'Carlton',
    position: 'FWD',
    fantasyScore: 89,
    realTimeStats: {
      disposals: 12,
      marks: 8,
      tackles: 2,
      goals: 3,
      behinds: 1,
    },
    isPlaying: true,
  },
  {
    id: '2',
    name: 'Scott Pendlebury',
    team: 'Collingwood',
    position: 'MID',
    fantasyScore: 76,
    realTimeStats: {
      disposals: 18,
      marks: 4,
      tackles: 6,
      goals: 0,
      behinds: 0,
    },
    isPlaying: true,
  },
];

export default function RealTimeMatchCenter({
  selectedLeague: _selectedLeague,
  favoriteTeams: _favoriteTeams = [],
  watchlistPlayers = [],
  onPlayerSelect,
}: RealTimeMatchCenterProps) {
  const [activeTab, setActiveTab] = useState<'matches' | 'live-players' | 'my-players'>('matches');
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  // Simulate real-time updates
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      setLastUpdate(new Date());
      // In real app, this would trigger data fetches
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const liveMatches = useMemo(() => {
    return mockMatches.filter((match) => match.status === 'live');
  }, []);

  const upcomingMatches = useMemo(() => {
    return mockMatches.filter((match) => match.status === 'pre-game');
  }, []);

  const getStatusBadge = (status: LiveMatch['status']) => {
    const variants = {
      'pre-game': 'default',
      live: 'success',
      'quarter-time': 'warning',
      'half-time': 'warning',
      'three-quarter-time': 'warning',
      'full-time': 'secondary',
    } as const;

    const labels = {
      'pre-game': 'Pre-Game',
      live: 'LIVE',
      'quarter-time': 'QT Break',
      'half-time': 'Half Time',
      'three-quarter-time': '3QT Break',
      'full-time': 'Full Time',
    };

    return (
      <Badge variant={variants[status]} className={status === 'live' ? 'animate-pulse' : ''}>
        {labels[status]}
      </Badge>
    );
  };

  const renderMatchCard = (match: LiveMatch) => (
    <motion.div
      key={match.id}
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-lg border-2 p-4 cursor-pointer transition-all duration-200 ${
        selectedMatch === match.id
          ? 'border-blue-500 shadow-lg'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
      }`}
      onClick={() => setSelectedMatch(match.id)}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {getStatusBadge(match.status)}
          <span className="text-sm text-gray-600">{match.venue}</span>
        </div>
        {match.status === 'live' && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-green-600 font-medium">Q{match.currentQuarter}</span>
            <span className="text-gray-600">{match.timeRemaining}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 items-center gap-4">
        <div className="text-right">
          <div className="font-semibold text-gray-900">{match.homeTeam}</div>
          <div className="text-2xl font-bold text-blue-600">{match.homeScore}</div>
        </div>

        <div className="text-center">
          <div className="text-gray-400 text-sm">vs</div>
        </div>

        <div className="text-left">
          <div className="font-semibold text-gray-900">{match.awayTeam}</div>
          <div className="text-2xl font-bold text-blue-600">{match.awayScore}</div>
        </div>
      </div>

      {match.lastGoal && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            <span className="text-gray-600">
              Goal: <span className="font-medium">{match.lastGoal.player}</span> (
              {match.lastGoal.team})
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );

  const renderLivePlayerCard = (player: LivePlayer) => (
    <motion.div
      key={player.id}
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => onPlayerSelect?.(player)}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-semibold text-gray-900">{player.name}</div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>{player.team}</span>
            <Badge variant="outline" size="sm">
              {player.position}
            </Badge>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-green-600">{player.fantasyScore}</div>
          <div className="text-xs text-gray-500">Fantasy Pts</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="text-center">
          <div className="font-medium text-gray-900">{player.realTimeStats.disposals}</div>
          <div className="text-gray-500">Disposals</div>
        </div>
        <div className="text-center">
          <div className="font-medium text-gray-900">{player.realTimeStats.marks}</div>
          <div className="text-gray-500">Marks</div>
        </div>
        <div className="text-center">
          <div className="font-medium text-gray-900">{player.realTimeStats.goals}</div>
          <div className="text-gray-500">Goals</div>
        </div>
      </div>

      {watchlistPlayers.includes(player.id) && (
        <div className="mt-3 flex items-center gap-1">
          <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          <span className="text-xs text-yellow-600">Watchlist</span>
        </div>
      )}
    </motion.div>
  );

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Live Match Center</h1>
          <p className="text-gray-600 mt-1">Real-time scores and fantasy updates</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Auto-refresh</span>
            </label>
          </div>

          <div className="text-sm text-gray-500">
            Last updated: {lastUpdate.toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg mb-6">
        {[
          { id: 'matches', label: 'Live Matches', count: liveMatches.length },
          { id: 'live-players', label: 'Top Performers', count: mockLivePlayers.length },
          { id: 'my-players', label: 'My Players', count: watchlistPlayers.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <Badge variant="secondary" size="sm">
                {tab.count}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'matches' && (
          <motion.div
            key="matches"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {liveMatches.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Live Now</h2>
                <div className="grid gap-4 md:grid-cols-2">{liveMatches.map(renderMatchCard)}</div>
              </div>
            )}

            {upcomingMatches.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Upcoming</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {upcomingMatches.map(renderMatchCard)}
                </div>
              </div>
            )}

            {mockMatches.length === 0 && (
              <div className="text-center py-12">
                <div className="text-gray-400 text-lg mb-2">No matches scheduled</div>
                <div className="text-gray-500">
                  Check back during the AFL season for live updates
                </div>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'live-players' && (
          <motion.div
            key="live-players"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {mockLivePlayers.map(renderLivePlayerCard)}
            </div>
          </motion.div>
        )}

        {activeTab === 'my-players' && (
          <motion.div
            key="my-players"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="text-center py-12"
          >
            <div className="text-gray-400 text-lg mb-2">Your watchlist is empty</div>
            <div className="text-gray-500">
              Add players to your watchlist to see their live scores here
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
