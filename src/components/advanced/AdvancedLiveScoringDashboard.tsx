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

import React, { useState } from 'react';

import {
  Bell as BellIcon,
  BellOff as BellSlashIcon,
  ChevronDown as ChevronDownIcon,
  ChevronUp as ChevronUpIcon,
  Flame as FireIcon,
  Info as InformationCircleIcon,
  Minus as MinusIcon,
  RefreshCw as ArrowPathIcon,
  Trophy as TrophyIcon,
  TriangleAlert as ExclamationTriangleIcon,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { TeamLogo } from '@/components/TeamLogo';
import useAdvancedLiveScoring, {
  type LivePlayerAlert,
  type LiveLeaderboardEntry,
} from '@/hooks/useAdvancedLiveScoring';
import { cn } from '@/lib/utils';

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
        return <ChevronUpIcon className="h-4 w-4 text-primary" />;
      case 'down':
        return <ChevronDownIcon className="h-4 w-4 text-destructive" />;
      default:
        return <MinusIcon className="h-4 w-4 text-background/60" />;
    }
  };

  // Get alert icon
  const getAlertIcon = (alert: LivePlayerAlert) => {
    switch (alert.type) {
      case 'goal':
        return <TrophyIcon className="h-5 w-5 text-accent-foreground" />;
      case 'milestone':
        return <FireIcon className="h-5 w-5 text-primary" />;
      case 'injury':
        return <ExclamationTriangleIcon className="h-5 w-5 text-destructive" />;
      case 'substitution':
        return <ArrowPathIcon className="h-5 w-5 text-primary" />;
      default:
        return <InformationCircleIcon className="h-5 w-5 text-primary" />;
    }
  };

  // Get alert background color
  const getAlertBgColor = (severity: LivePlayerAlert['severity']) => {
    switch (severity) {
      case 'success':
        return 'border-primary/20 bg-primary/10';
      case 'warning':
        return 'border-accent bg-accent';
      case 'error':
        return 'border-destructive/20 bg-destructive/10';
      default:
        return 'border-border bg-card';
    }
  };

  // Active alerts count
  const activeAlerts = liveAlerts.filter((alert) => !alert.autoHide);
  const tabs = [
    { id: 'leaderboard', label: 'Leaderboard', count: leaderboard.length },
    { id: 'matchup', label: 'My Matchup', count: liveMatchups.length },
    { id: 'alerts', label: 'Alerts', count: activeAlerts.length },
  ] as const;

  return (
    <div className={cn('min-h-screen bg-foreground', className)}>
      {/* Header */}
      <div className="border-b border-background/20 bg-background/10 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-3xl font-bold text-background">Live Scoring</h1>
              <div className="flex items-center space-x-2">
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    connected ? 'bg-primary' : 'bg-destructive',
                    isLive ? 'animate-pulse' : ''
                  )}
                />
                <span className="text-sm text-background/80">
                  {isLive ? 'LIVE' : 'Not Live'} • {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {/* Notifications Toggle */}
              <button
                onClick={toggleNotifications}
                className="rounded-lg bg-background/10 p-2 text-background transition-colors hover:bg-background/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Toggle notifications"
                aria-label="Toggle notifications"
              >
                <BellIcon className="h-5 w-5" />
              </button>

              {/* Refresh Button */}
              <button
                onClick={refreshData}
                className="rounded-lg bg-background/10 p-2 text-background transition-colors hover:bg-background/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Refresh data"
                aria-label="Refresh data"
              >
                <ArrowPathIcon className={cn('h-5 w-5', isLive ? 'animate-spin' : '')} />
              </button>

              {/* Last Update */}
              {lastUpdate && (
                <span className="text-sm text-background/60">Updated {timeSinceUpdate}s ago</span>
              )}
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="mt-4 flex space-x-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setView(tab.id)}
                className={cn(
                  'rounded-lg px-4 py-2 font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  view === tab.id
                    ? 'bg-background text-foreground'
                    : 'text-background/80 hover:bg-background/10 hover:text-background'
                )}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span
                    className={cn(
                      'ml-2 rounded-full px-2 py-1 text-xs',
                      view === tab.id
                        ? 'bg-primary/10 text-primary'
                        : 'bg-background/20 text-background'
                    )}
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
              className="rounded-lg border border-background/20 bg-background/10 p-4 backdrop-blur-md"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-background/60">{stat.label}</p>
                  <p className="text-2xl font-bold text-background">{stat.value}</p>
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
              <h2 className="mb-6 text-2xl font-bold text-background">Live Leaderboard</h2>

              <div className="rounded-lg border border-background/20 bg-background/10 backdrop-blur-md">
                <div className="border-b border-background/20 p-4">
                  <div className="grid grid-cols-12 gap-4 text-sm font-medium text-background/60">
                    <div className="col-span-1">Rank</div>
                    <div className="col-span-4">Team</div>
                    <div className="col-span-2">Score</div>
                    <div className="col-span-2">Projected</div>
                    <div className="col-span-2">Active</div>
                    <div className="col-span-1">Trend</div>
                  </div>
                </div>

                <div className="divide-y divide-background/20">
                  {leaderboard.slice(0, 10).map((entry, index) => (
                    <motion.div
                      key={entry.userId}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.05 }}
                      className={cn(
                        'p-4 transition-colors hover:bg-background/10',
                        entry.userId === userId ? 'border-l-4 border-primary bg-primary/15' : ''
                      )}
                    >
                      <div className="grid grid-cols-12 gap-4 items-center">
                        <div className="col-span-1">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-background">#{entry.rank}</span>
                            {entry.previousRank !== entry.rank && (
                              <div
                                className={`rounded-full px-1.5 py-0.5 text-xs ${
                                  entry.rank < entry.previousRank
                                    ? 'bg-primary/10 text-primary'
                                    : 'bg-destructive/10 text-destructive'
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
                          <p className="font-medium text-background">{entry.teamName}</p>
                          <p className="text-sm text-background/60">
                            Win: {Math.round(entry.winProbability * 100)}%
                          </p>
                        </div>

                        <div className="col-span-2">
                          <p className="text-lg font-bold text-background">
                            {Math.round(entry.totalScore)}
                          </p>
                          {entry.scoreDelta !== 0 && (
                            <p
                              className={`text-xs ${
                                entry.scoreDelta > 0 ? 'text-primary' : 'text-destructive'
                              }`}
                            >
                              {entry.scoreDelta > 0 ? '+' : ''}
                              {Math.round(entry.scoreDelta)}
                            </p>
                          )}
                        </div>

                        <div className="col-span-2">
                          <p className="text-background/80">{Math.round(entry.projectedScore)}</p>
                        </div>

                        <div className="col-span-2">
                          <p className="text-background/80">
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
              <h2 className="mb-6 text-2xl font-bold text-background">My Matchup</h2>

              {liveMatchups.map((matchup) => (
                <div
                  key={matchup.id}
                  className="rounded-lg border border-background/20 bg-background/10 p-6 backdrop-blur-md"
                >
                  {/* Matchup Header */}
                  <div className="flex items-center justify-between mb-6">
                    <div className="text-center flex-1">
                      <h3 className="text-xl font-bold text-background">{matchup.homeTeam.name}</h3>
                      <p className="mt-2 text-3xl font-bold text-background">
                        {Math.round(matchup.homeTeam.totalScore)}
                      </p>
                      <p className="text-sm text-background/60">
                        {Math.round(matchup.homeTeam.winProbability * 100)}% win
                      </p>
                    </div>

                    <div className="text-center px-4">
                      <div className="text-sm text-background/60">vs</div>
                      <div className="mt-1 text-xs text-background/60">{matchup.status}</div>
                    </div>

                    <div className="text-center flex-1">
                      <h3 className="text-xl font-bold text-background">{matchup.awayTeam.name}</h3>
                      <p className="mt-2 text-3xl font-bold text-background">
                        {Math.round(matchup.awayTeam.totalScore)}
                      </p>
                      <p className="text-sm text-background/60">
                        {Math.round(matchup.awayTeam.winProbability * 100)}% win
                      </p>
                    </div>
                  </div>

                  {/* Player Performance */}
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Home Team Players */}
                    <div>
                      <h4 className="mb-3 font-medium text-background">Your Players</h4>
                      <div className="space-y-2">
                        {matchup.homeTeam.players.slice(0, 5).map((player) => (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between rounded-lg bg-background/10 p-3"
                          >
                            <div className="flex items-center space-x-3">
                              <div
                                className={cn(
                                  'h-2 w-2 rounded-full',
                                  player.isPlaying ? 'bg-primary' : 'bg-background/40'
                                )}
                              />
                              <div>
                                <p className="text-sm font-medium text-background">{player.name}</p>
                                <p className="flex items-center gap-1.5 text-xs text-background/60">
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
                              <p className="font-bold text-background">
                                {Math.round(player.currentScore)}
                              </p>
                              {player.scoreDelta !== 0 && (
                                <p
                                  className={`text-xs ${
                                    player.scoreDelta > 0 ? 'text-primary' : 'text-destructive'
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
                      <h4 className="mb-3 font-medium text-background">Opponent Players</h4>
                      <div className="space-y-2">
                        {matchup.awayTeam.players.slice(0, 5).map((player) => (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between rounded-lg bg-background/10 p-3"
                          >
                            <div className="flex items-center space-x-3">
                              <div
                                className={cn(
                                  'h-2 w-2 rounded-full',
                                  player.isPlaying ? 'bg-primary' : 'bg-background/40'
                                )}
                              />
                              <div>
                                <p className="text-sm font-medium text-background">{player.name}</p>
                                <p className="flex items-center gap-1.5 text-xs text-background/60">
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
                              <p className="font-bold text-background">
                                {Math.round(player.currentScore)}
                              </p>
                              {player.scoreDelta !== 0 && (
                                <p
                                  className={`text-xs ${
                                    player.scoreDelta > 0 ? 'text-primary' : 'text-destructive'
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
              <h2 className="mb-6 text-2xl font-bold text-background">Live Alerts</h2>

              <div className="space-y-3">
                {liveAlerts.length === 0 ? (
                  <div className="text-center py-8">
                    <BellSlashIcon className="mx-auto mb-4 h-12 w-12 text-background/40" />
                    <p className="text-background/60">
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
                      className={`rounded-lg border p-4 ${getAlertBgColor(alert.severity)} backdrop-blur-md`}
                    >
                      <div className="flex items-start space-x-3">
                        <div className="flex-shrink-0 mt-0.5">{getAlertIcon(alert)}</div>

                        <div className="flex-1">
                          <p className="font-medium text-card-foreground">{alert.message}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {new Date(alert.timestamp).toLocaleTimeString()}
                          </p>
                        </div>

                        <button
                          onClick={() => dismissAlert(alert.id)}
                          className="flex-shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label="Dismiss alert"
                        >
                          <X className="h-4 w-4" />
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
