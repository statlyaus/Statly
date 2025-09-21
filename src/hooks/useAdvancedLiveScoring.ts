/**
 * Advanced Live Scoring Hook - ESPN/Yahoo Fantasy Level Real-time Features
 * 
 * Features:
 * - Real-time player stat updates with delta tracking
 * - Live leaderboards with position changes
 * - Instant fantasy point calculations
 * - Push notifications for big plays
 * - Live matchup tracking
 * - Player performance alerts
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { io, type Socket } from 'socket.io-client';

import { logger } from '@/lib/logger';
import { useLivePlayerStats } from '@/hooks/useLivePlayerStats';

export interface LivePlayer {
  playerId: string;
  name: string;
  team: string;
  position: string;
  currentScore: number;
  previousScore: number;
  scoreDelta: number;
  isPlaying: boolean;
  lastUpdate: string;
  gameStatus: 'pre-game' | 'playing' | 'break' | 'post-game';
  stats: {
    disposals: number;
    kicks: number;
    handballs: number;
    marks: number;
    tackles: number;
    goals: number;
    behinds: number;
    hitouts: number;
    contested_possessions: number;
    uncontested_possessions: number;
    inside50s: number;
    rebound50s: number;
    clearances: number;
    clangers: number;
    frees_for: number;
    frees_against: number;
  };
  deltaStats: Partial<typeof this.stats>;
  alerts: LivePlayerAlert[];
}

export interface LivePlayerAlert {
  id: string;
  type: 'goal' | 'milestone' | 'injury' | 'substitution' | 'big_play';
  message: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'success' | 'error';
  autoHide: boolean;
}

export interface LiveMatchup {
  id: string;
  homeTeam: {
    name: string;
    totalScore: number;
    players: LivePlayer[];
    projectedScore: number;
    winProbability: number;
  };
  awayTeam: {
    name: string;
    totalScore: number;
    players: LivePlayer[];
    projectedScore: number;
    winProbability: number;
  };
  status: 'scheduled' | 'live' | 'final';
  timeRemaining: string;
  lastUpdate: string;
}

export interface LiveLeaderboardEntry {
  rank: number;
  previousRank: number;
  userId: string;
  teamName: string;
  totalScore: number;
  projectedScore: number;
  activePlayers: number;
  benchPlayers: number;
  scoreDelta: number;
  winProbability: number;
  trend: 'up' | 'down' | 'stable';
}

export interface AdvancedLiveScoringOptions {
  leagueId: string;
  userId: string;
  weekId: string;
  enableNotifications: boolean;
  updateInterval: number; // milliseconds
  alertThresholds: {
    bigPlay: number;
    milestone: number;
    goalAlert: boolean;
  };
}

export interface UseAdvancedLiveScoringReturn {
  // Data
  liveMatchups: LiveMatchup[];
  leaderboard: LiveLeaderboardEntry[];
  myTeam: LiveLeaderboardEntry | null;
  liveAlerts: LivePlayerAlert[];
  
  // Status
  isLive: boolean;
  lastUpdate: string | null;
  connected: boolean;
  timeSinceUpdate: number;
  
  // Actions
  dismissAlert: (alertId: string) => void;
  refreshData: () => void;
  toggleNotifications: () => void;
  
  // Statistics
  stats: {
    totalActivePlayers: number;
    averageScore: number;
    highestIndividualScore: number;
    lowestIndividualScore: number;
    totalGoalsScored: number;
  };
}

export function useAdvancedLiveScoring(
  options: AdvancedLiveScoringOptions
): UseAdvancedLiveScoringReturn {
  const {
    leagueId,
    userId,
    weekId,
    enableNotifications,
    updateInterval = 10000, // 10 seconds
    alertThresholds,
  } = options;

  // State
  const [liveMatchups, setLiveMatchups] = useState<LiveMatchup[]>([]);
  const [leaderboard, setLeaderboard] = useState<LiveLeaderboardEntry[]>([]);
  const [liveAlerts, setLiveAlerts] = useState<LivePlayerAlert[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(enableNotifications);

  // Refs
  const socketRef = useRef<Socket | null>(null);
  const alertCounterRef = useRef(0);
  const previousScoresRef = useRef<Map<string, number>>(new Map());

  // Get base live data
  const { 
    players: basePlayers, 
    isLoading, 
    error,
    timeSinceUpdate
  } = useLivePlayerStats(null, { pollInterval: updateInterval });

  // Initialize Socket.IO connection for real-time updates
  const initializeSocket = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = io('/live-scoring', {
      auth: { leagueId, userId, weekId },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      setConnected(true);
      logger.info('Live scoring socket connected');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      logger.warn('Live scoring socket disconnected');
    });

    // Real-time player updates
    socket.on('player:score-update', (data: {
      playerId: string;
      newScore: number;
      deltaStats: Partial<LivePlayer['stats']>;
      timestamp: string;
    }) => {
      const { playerId, newScore, deltaStats, timestamp } = data;
      const previousScore = previousScoresRef.current.get(playerId) ?? 0;
      const scoreDelta = newScore - previousScore;

      // Update previous scores
      previousScoresRef.current.set(playerId, newScore);

      // Create alerts for significant events
      if (deltaStats.goals && deltaStats.goals > 0) {
        addAlert({
          type: 'goal',
          message: `${getPlayerName(playerId)} kicked ${deltaStats.goals} goal${deltaStats.goals > 1 ? 's' : ''}! (+${deltaStats.goals * 6} points)`,
          severity: 'success',
          autoHide: true,
        });
      }

      if (scoreDelta >= alertThresholds.bigPlay) {
        addAlert({
          type: 'big_play',
          message: `${getPlayerName(playerId)} with a big play! +${scoreDelta} fantasy points`,
          severity: 'info',
          autoHide: true,
        });
      }

      // Check for milestones
      if (newScore >= 100 && previousScore < 100) {
        addAlert({
          type: 'milestone',
          message: `${getPlayerName(playerId)} reaches 100 fantasy points!`,
          severity: 'success',
          autoHide: false,
        });
      }

      // Update matchups with new data
      updatePlayerInMatchups(playerId, newScore, deltaStats, timestamp);
    });

    // Real-time leaderboard updates
    socket.on('leaderboard:update', (data: LiveLeaderboardEntry[]) => {
      setLeaderboard(data);
      setLastUpdate(new Date().toISOString());
    });

    // Player status changes (injuries, substitutions)
    socket.on('player:status-change', (data: {
      playerId: string;
      status: string;
      message: string;
    }) => {
      addAlert({
        type: data.status === 'injured' ? 'injury' : 'substitution',
        message: data.message,
        severity: data.status === 'injured' ? 'error' : 'warning',
        autoHide: false,
      });
    });

    socketRef.current = socket;
  }, [leagueId, userId, weekId, alertThresholds.bigPlay]);

  // Helper functions
  const getPlayerName = (playerId: string): string => {
    // Find player name from current data
    const player = basePlayers.find(p => p.player_uid === playerId);
    return player?.name || playerId.replace('ply_', '').replace(/_/g, ' ');
  };

  const addAlert = (alertData: Omit<LivePlayerAlert, 'id' | 'timestamp'>) => {
    const alert: LivePlayerAlert = {
      id: `alert_${++alertCounterRef.current}`,
      timestamp: new Date().toISOString(),
      ...alertData,
    };

    setLiveAlerts(prev => [alert, ...prev.slice(0, 49)]); // Keep last 50 alerts

    // Send browser notification if enabled
    if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`Statly Fantasy`, {
        body: alert.message,
        icon: '/favicon.ico',
        tag: alert.id,
      });
    }

    // Auto-hide alerts
    if (alert.autoHide) {
      setTimeout(() => {
        setLiveAlerts(prev => prev.filter(a => a.id !== alert.id));
      }, 5000);
    }
  };

  const updatePlayerInMatchups = (
    playerId: string,
    newScore: number,
    deltaStats: Partial<LivePlayer['stats']>,
    timestamp: string
  ) => {
    setLiveMatchups(prev => prev.map(matchup => ({
      ...matchup,
      homeTeam: {
        ...matchup.homeTeam,
        players: matchup.homeTeam.players.map(player => 
          player.playerId === playerId
            ? {
                ...player,
                currentScore: newScore,
                previousScore: player.currentScore,
                scoreDelta: newScore - player.currentScore,
                deltaStats,
                lastUpdate: timestamp,
              }
            : player
        ),
      },
      awayTeam: {
        ...matchup.awayTeam,
        players: matchup.awayTeam.players.map(player => 
          player.playerId === playerId
            ? {
                ...player,
                currentScore: newScore,
                previousScore: player.currentScore,
                scoreDelta: newScore - player.currentScore,
                deltaStats,
                lastUpdate: timestamp,
              }
            : player
        ),
      },
      lastUpdate: timestamp,
    })));
  };

  // Actions
  const dismissAlert = useCallback((alertId: string) => {
    setLiveAlerts(prev => prev.filter(alert => alert.id !== alertId));
  }, []);

  const refreshData = useCallback(() => {
    // Force refresh of base data and socket reconnection
    if (socketRef.current) {
      socketRef.current.emit('force-refresh');
    }
  }, []);

  const toggleNotifications = useCallback(async () => {
    if (!('Notification' in window)) {
      addAlert({
        type: 'big_play',
        message: 'Browser notifications not supported',
        severity: 'warning',
        autoHide: true,
      });
      return;
    }

    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        addAlert({
          type: 'big_play',
          message: 'Notification permission denied',
          severity: 'warning',
          autoHide: true,
        });
        return;
      }
    }

    setNotificationsEnabled(prev => !prev);
  }, []);

  // Computed values
  const myTeam = useMemo(() => {
    return leaderboard.find(entry => entry.userId === userId) || null;
  }, [leaderboard, userId]);

  const isLive = useMemo(() => {
    return liveMatchups.some(matchup => matchup.status === 'live');
  }, [liveMatchups]);

  const stats = useMemo(() => {
    const allPlayers = liveMatchups.flatMap(matchup => [
      ...matchup.homeTeam.players,
      ...matchup.awayTeam.players,
    ]);

    const activePlayers = allPlayers.filter(p => p.isPlaying);
    const scores = activePlayers.map(p => p.currentScore);
    const totalGoals = allPlayers.reduce((sum, p) => sum + p.stats.goals, 0);

    return {
      totalActivePlayers: activePlayers.length,
      averageScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      highestIndividualScore: scores.length > 0 ? Math.max(...scores) : 0,
      lowestIndividualScore: scores.length > 0 ? Math.min(...scores) : 0,
      totalGoalsScored: totalGoals,
    };
  }, [liveMatchups]);

  // Effects
  useEffect(() => {
    if (leagueId && userId && weekId) {
      initializeSocket();
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [leagueId, userId, weekId, initializeSocket]);

  // Transform base player data to live matchups
  useEffect(() => {
    if (basePlayers.length > 0) {
      // This would normally come from your league/matchup API
      // For now, we'll create a sample matchup structure
      const sampleMatchup: LiveMatchup = {
        id: 'matchup_1',
        homeTeam: {
          name: 'Home Team',
          totalScore: 0,
          players: basePlayers.slice(0, 22).map(player => ({
            playerId: player.id,
            name: player.name,
            team: player.team,
            position: player.position,
            currentScore: player.fantasyScore,
            previousScore: previousScoresRef.current.get(player.id) ?? 0,
            scoreDelta: 0,
            isPlaying: true,
            lastUpdate: player.lastUpdated,
            gameStatus: 'playing',
            stats: {
              disposals: player.disposals,
              kicks: player.kicks,
              handballs: player.handballs,
              marks: player.marks,
              tackles: player.tackles,
              goals: player.goals,
              behinds: player.behinds,
              hitouts: player.hitouts || 0,
              contested_possessions: player.contested_possessions || 0,
              uncontested_possessions: player.uncontested_possessions || 0,
              inside50s: player.inside50s || 0,
              rebound50s: player.rebound50s || 0,
              clearances: player.clearances || 0,
              clangers: 0,
              frees_for: 0,
              frees_against: 0,
            },
            deltaStats: {},
            alerts: [],
          })),
          projectedScore: 0,
          winProbability: 0.5,
        },
        awayTeam: {
          name: 'Away Team',
          totalScore: 0,
          players: [],
          projectedScore: 0,
          winProbability: 0.5,
        },
        status: isLive ? 'live' : 'scheduled',
        timeRemaining: '0:00',
        lastUpdate: new Date().toISOString(),
      };

      // Calculate team totals
      sampleMatchup.homeTeam.totalScore = sampleMatchup.homeTeam.players
        .reduce((sum, player) => sum + player.currentScore, 0);

      setLiveMatchups([sampleMatchup]);
      setLastUpdate(new Date().toISOString());
    }
  }, [basePlayers, isLive]);

  return {
    // Data
    liveMatchups,
    leaderboard,
    myTeam,
    liveAlerts,
    
    // Status
    isLive,
    lastUpdate,
    connected,
    timeSinceUpdate,
    
    // Actions
    dismissAlert,
    refreshData,
    toggleNotifications,
    
    // Statistics
    stats,
  };
}

export default useAdvancedLiveScoring;