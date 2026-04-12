/**
 * Advanced Live Scoring Dashboard - ESPN/Yahoo Fantasy Level UI
 *
 * Features:
 * - Real-time leaderboard with position changes
 * - Live player alerts and notifications
 * - Fantasy matchup head-to-head tracking
 * - Animated score updates and delta indicators
 * - Push notification support
 * - Live statistics and big play alerts
 */

'use client';

import React, { useState, useMemo } from 'react';

import {
  ChevronUpIcon,
  ChevronDownIcon,
  MinusIcon,
  BellIcon,
  BellSlashIcon,
  ArrowPathIcon,
  TrophyIcon,
  FireIcon,
  ExclamationTriangleIcon,
  HeartIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/solid';
import { motion, AnimatePresence } from 'framer-motion';

import { TeamLogo } from '@/components/TeamLogo';
import useAdvancedLiveScoring, {
  type LivePlayerAlert,
  type LiveLeaderboardEntry,
  type LiveMatchup,
} from '@/hooks/useAdvancedLiveScoring';

interface AdvancedLiveScoringDashboardProps {
  leagueId: string;
  userId: string;
  weekId: string;
  className?: string;
}

export default function AdvancedLiveScoringDashboard({
  leagueId,
  userId,
  weekId,
  className = '',
}: AdvancedLiveScoringDashboardProps) {
  const [view, setView] = useState<'leaderboard' | 'matchup' | 'alerts'>('leaderboard');
  const [selectedMatchup, setSelectedMatchup] = useState<string | null>(null);

  // Advanced live scoring hook
  const {
    liveMatchups,
    leaderboard,
    myTeam,
    liveAlerts,
    isLive,
    lastUpdate,
    connected,
    timeSinceUpdate,
    dismissAlert,
    refreshData,
    toggleNotifications,
    stats,
  } = useAdvancedLiveScoring({
    leagueId,
    userId,
    weekId,
    enableNotifications: true,
    updateInterval: 10000, // 10 seconds
    alertThresholds: {
      bigPlay: 15,
      milestone: 100,
      goalAlert: true,
    },
  });

  // Get trend icon for leaderboard entries
  const getTrendIcon = (trend: LiveLeaderboardEntry['trend']) => {
    switch (trend) {
      case 'up':
        return <ChevronUpIcon className="w-4 h-4 text-green-500" />;
      case 'down':
        return <ChevronDownIcon className="w-4 h-4 text-red-500" />;
      default:
        return <MinusIcon className="w-4 h-4 text-gray-400" />;
    }
  };

  // Get alert icon
  const getAlertIcon = (alert: LivePlayerAlert) => {
    switch (alert.type) {
      case 'goal':
        return <TrophyIcon className="w-5 h-5 text-yellow-400" />;
      case 'milestone':
        return <FireIcon className="w-5 h-5 text-orange-400" />;
      case 'injury':
        return <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />;
      case 'substitution':
        return <ArrowPathIcon className="w-5 h-5 text-blue-400" />;
      default:
        return <InformationCircleIcon className="w-5 h-5 text-blue-400" />;
    }
  };

  // Get alert background color
  const getAlertBgColor = (severity: LivePlayerAlert['severity']) => {
    switch (severity) {
      case 'success':
        return 'bg-green-50 border-green-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-blue-50 border-blue-200';
    }
  };

  // Active alerts count
  const activeAlerts = liveAlerts.filter((alert) => !alert.autoHide);

  return (
    <div
      className={`min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 ${className}`}
    >
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md border-b border-white/20">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-3xl font-bold text-white">Live Scoring</h1>
              <div className="flex items-center space-x-2">
                <div
                  className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'} ${isLive ? 'animate-pulse' : ''}`}
                />
                <span className="text-white/80 text-sm">
                  {isLive ? 'LIVE' : 'Not Live'} • {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {/* Notifications Toggle */}
              <button
                onClick={toggleNotifications}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                title="Toggle notifications"
              >
                <BellIcon className="w-5 h-5 text-white" />
              </button>

              {/* Refresh Button */}
              <button
                onClick={refreshData}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                title="Refresh data"
              >
                <ArrowPathIcon className={`w-5 h-5 text-white ${isLive ? 'animate-spin' : ''}`} />
              </button>

              {/* Last Update */}
              {lastUpdate && (
                <span className="text-white/60 text-sm">Updated {timeSinceUpdate}s ago</span>
              )}
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex space-x-1 mt-4">
            {[
              { id: 'leaderboard', label: 'Leaderboard', count: leaderboard.length },
              { id: 'matchup', label: 'My Matchup', count: liveMatchups.length },
              { id: 'alerts', label: 'Alerts', count: activeAlerts.length },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setView(tab.id as any)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  view === tab.id ? 'bg-white text-blue-900' : 'text-white/80 hover:bg-white/10'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span
                    className={`ml-2 px-2 py-1 rounded-full text-xs ${
                      view === tab.id ? 'bg-blue-100 text-blue-900' : 'bg-white/20 text-white'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          {[
            { label: 'Active Players', value: stats.totalActivePlayers, icon: '👥' },
            { label: 'Average Score', value: Math.round(stats.averageScore), icon: '📊' },
            { label: 'Highest Score', value: Math.round(stats.highestIndividualScore), icon: '🏆' },
            { label: 'Total Goals', value: stats.totalGoalsScored, icon: '⚽' },
            { label: 'My Rank', value: myTeam?.rank ?? '-', icon: '📈' },
          ].map((stat, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/60 text-sm">{stat.label}</p>
                  <p className="text-white text-2xl font-bold">{stat.value}</p>
                </div>
                <span className="text-2xl">{stat.icon}</span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Main Content */}
        <AnimatePresence mode="wait">
          {view === 'leaderboard' && (
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              <h2 className="text-2xl font-bold text-white mb-6">Live Leaderboard</h2>

              <div className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20">
                <div className="p-4 border-b border-white/10">
                  <div className="grid grid-cols-12 gap-4 text-white/60 text-sm font-medium">
                    <div className="col-span-1">Rank</div>
                    <div className="col-span-4">Team</div>
                    <div className="col-span-2">Score</div>
                    <div className="col-span-2">Projected</div>
                    <div className="col-span-2">Active</div>
                    <div className="col-span-1">Trend</div>
                  </div>
                </div>

                <div className="divide-y divide-white/10">
                  {leaderboard.slice(0, 10).map((entry, index) => (
                    <motion.div
                      key={entry.userId}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.05 }}
                      className={`p-4 hover:bg-white/5 transition-colors ${
                        entry.userId === userId ? 'bg-blue-500/20 border-l-4 border-blue-400' : ''
                      }`}
                    >
                      <div className="grid grid-cols-12 gap-4 items-center">
                        <div className="col-span-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-white font-bold">#{entry.rank}</span>
                            {entry.previousRank !== entry.rank && (
                              <div
                                className={`text-xs px-1.5 py-0.5 rounded-full ${
                                  entry.rank < entry.previousRank
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {entry.rank < entry.previousRank
                                  ? `+${entry.previousRank - entry.rank}`
                                  : entry.previousRank - entry.rank}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="col-span-4">
                          <p className="text-white font-medium">{entry.teamName}</p>
                          <p className="text-white/60 text-sm">
                            Win: {Math.round(entry.winProbability * 100)}%
                          </p>
                        </div>

                        <div className="col-span-2">
                          <p className="text-white text-lg font-bold">
                            {Math.round(entry.totalScore)}
                          </p>
                          {entry.scoreDelta !== 0 && (
                            <p
                              className={`text-xs ${
                                entry.scoreDelta > 0 ? 'text-green-400' : 'text-red-400'
                              }`}
                            >
                              {entry.scoreDelta > 0 ? '+' : ''}
                              {Math.round(entry.scoreDelta)}
                            </p>
                          )}
                        </div>

                        <div className="col-span-2">
                          <p className="text-white/80">{Math.round(entry.projectedScore)}</p>
                        </div>

                        <div className="col-span-2">
                          <p className="text-white/80">
                            {entry.activePlayers}/{entry.activePlayers + entry.benchPlayers}
                          </p>
                        </div>

                        <div className="col-span-1">{getTrendIcon(entry.trend)}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'matchup' && (
            <motion.div
              key="matchup"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-bold text-white mb-6">My Matchup</h2>

              {liveMatchups.map((matchup) => (
                <div
                  key={matchup.id}
                  className="bg-white/10 backdrop-blur-md rounded-lg border border-white/20 p-6"
                >
                  {/* Matchup Header */}
                  <div className="flex items-center justify-between mb-6">
                    <div className="text-center flex-1">
                      <h3 className="text-xl font-bold text-white">{matchup.homeTeam.name}</h3>
                      <p className="text-3xl font-bold text-white mt-2">
                        {Math.round(matchup.homeTeam.totalScore)}
                      </p>
                      <p className="text-white/60 text-sm">
                        {Math.round(matchup.homeTeam.winProbability * 100)}% win
                      </p>
                    </div>

                    <div className="text-center px-4">
                      <div className="text-white/60 text-sm">vs</div>
                      <div className="text-white/40 text-xs mt-1">{matchup.status}</div>
                    </div>

                    <div className="text-center flex-1">
                      <h3 className="text-xl font-bold text-white">{matchup.awayTeam.name}</h3>
                      <p className="text-3xl font-bold text-white mt-2">
                        {Math.round(matchup.awayTeam.totalScore)}
                      </p>
                      <p className="text-white/60 text-sm">
                        {Math.round(matchup.awayTeam.winProbability * 100)}% win
                      </p>
                    </div>
                  </div>

                  {/* Player Performance */}
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Home Team Players */}
                    <div>
                      <h4 className="text-white font-medium mb-3">Your Players</h4>
                      <div className="space-y-2">
                        {matchup.homeTeam.players.slice(0, 5).map((player) => (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
                          >
                            <div className="flex items-center space-x-3">
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  player.isPlaying ? 'bg-green-400' : 'bg-gray-400'
                                }`}
                              />
                              <div>
                                <p className="text-white font-medium text-sm">{player.name}</p>
                                <p className="flex items-center gap-1.5 text-xs text-white/60">
                                  {player.team ? (
                                    <TeamLogo team={player.team} size={14} withCircle decorative />
                                  ) : null}
                                  <span>
                                    {player.team} - {player.position}
                                  </span>
                                </p>
                              </div>
                            </div>

                            <div className="text-right">
                              <p className="text-white font-bold">
                                {Math.round(player.currentScore)}
                              </p>
                              {player.scoreDelta !== 0 && (
                                <p
                                  className={`text-xs ${
                                    player.scoreDelta > 0 ? 'text-green-400' : 'text-red-400'
                                  }`}
                                >
                                  {player.scoreDelta > 0 ? '+' : ''}
                                  {Math.round(player.scoreDelta)}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Opponent Players */}
                    <div>
                      <h4 className="text-white font-medium mb-3">Opponent Players</h4>
                      <div className="space-y-2">
                        {matchup.awayTeam.players.slice(0, 5).map((player) => (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
                          >
                            <div className="flex items-center space-x-3">
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  player.isPlaying ? 'bg-green-400' : 'bg-gray-400'
                                }`}
                              />
                              <div>
                                <p className="text-white font-medium text-sm">{player.name}</p>
                                <p className="flex items-center gap-1.5 text-xs text-white/60">
                                  {player.team ? (
                                    <TeamLogo team={player.team} size={14} withCircle decorative />
                                  ) : null}
                                  <span>
                                    {player.team} - {player.position}
                                  </span>
                                </p>
                              </div>
                            </div>

                            <div className="text-right">
                              <p className="text-white font-bold">
                                {Math.round(player.currentScore)}
                              </p>
                              {player.scoreDelta !== 0 && (
                                <p
                                  className={`text-xs ${
                                    player.scoreDelta > 0 ? 'text-green-400' : 'text-red-400'
                                  }`}
                                >
                                  {player.scoreDelta > 0 ? '+' : ''}
                                  {Math.round(player.scoreDelta)}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {view === 'alerts' && (
            <motion.div
              key="alerts"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              <h2 className="text-2xl font-bold text-white mb-6">Live Alerts</h2>

              <div className="space-y-3">
                {liveAlerts.length === 0 ? (
                  <div className="text-center py-8">
                    <BellSlashIcon className="w-12 h-12 text-white/40 mx-auto mb-4" />
                    <p className="text-white/60">
                      No alerts yet. They'll appear here when something exciting happens!
                    </p>
                  </div>
                ) : (
                  liveAlerts.map((alert) => (
                    <motion.div
                      key={alert.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className={`p-4 rounded-lg border ${getAlertBgColor(alert.severity)} backdrop-blur-md`}
                    >
                      <div className="flex items-start space-x-3">
                        <div className="flex-shrink-0 mt-0.5">{getAlertIcon(alert)}</div>

                        <div className="flex-1">
                          <p className="text-gray-900 font-medium">{alert.message}</p>
                          <p className="text-gray-600 text-sm mt-1">
                            {new Date(alert.timestamp).toLocaleTimeString()}
                          </p>
                        </div>

                        <button
                          onClick={() => dismissAlert(alert.id)}
                          className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          ×
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
