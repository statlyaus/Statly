/**
 * Advanced Draft Analytics Hook - ESPN/Yahoo Level Draft Features
 *
 * Features:
 * - Real-time draft analytics and insights
 * - Pick recommendations based on advanced metrics
 * - Draft room mood and activity tracking
 * - Live draft commentary and analysis
 * - Advanced timer management with auto-picks
 * - Draft performance metrics and grades
 * - Position scarcity tracking
 * - Value-based drafting recommendations
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import { io, type Socket } from 'socket.io-client';

import { useLiveDraft } from '@/hooks/useLiveDraft';
import { logger } from '@/lib/logger';

export interface DraftRecommendation {
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  reason: 'best_available' | 'positional_need' | 'value_pick' | 'sleeper' | 'breakout';
  confidence: number; // 0-100
  projectedPoints: number;
  adp: number; // Average Draft Position
  valueScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  analysis: string;
  tags: string[];
}

export interface DraftInsight {
  id: string;
  type: 'warning' | 'opportunity' | 'trend' | 'milestone';
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high';
  timestamp: string;
  actionable: boolean;
  relatedPlayers?: string[];
}

export interface PositionScarcity {
  position: string;
  totalAvailable: number;
  qualityAvailable: number; // Top tier remaining
  scarcityScore: number; // 0-100 (100 = most scarce)
  nextTierDropoff: number; // Picks until significant drop in quality
  recommendation: 'draft_now' | 'wait' | 'consider';
}

export interface DraftParticipantAnalysis {
  userId: string;
  teamName: string;
  draftGrade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D+' | 'D' | 'F';
  strengths: string[];
  weaknesses: string[];
  projectedFinish: number;
  riskLevel: 'conservative' | 'balanced' | 'aggressive';
  pickQuality: {
    reaches: number;
    steals: number;
    average: number;
  };
  positionBalance: Record<string, number>;
  upcomingNeeds: string[];
}

export interface DraftMood {
  overall: 'excited' | 'focused' | 'tense' | 'rushed' | 'casual';
  pickPace: 'slow' | 'normal' | 'fast' | 'frantic';
  surpriseLevel: number; // 0-100 based on unexpected picks
  competitiveness: number; // 0-100 based on pick timing and chat activity
  chatActivity: 'quiet' | 'moderate' | 'active' | 'chaotic';
}

export interface DraftTimer {
  timeRemaining: number;
  totalTime: number;
  isActive: boolean;
  isPaused: boolean;
  warningThreshold: number; // seconds when warning starts
  criticalThreshold: number; // seconds when critical warning starts
  autoPickEnabled: boolean;
  pausesUsed: number;
  maxPauses: number;
}

export interface AdvancedDraftAnalyticsOptions {
  draftId: string;
  userId: string;
  leagueSettings: {
    scoringSystem: 'standard' | 'ppr' | 'half_ppr' | 'custom';
    startingLineup: Record<string, number>; // position -> count
    benchSlots: number;
    totalRounds: number;
  };
  enableRecommendations: boolean;
  enableInsights: boolean;
  updateInterval: number;
}

export interface UseAdvancedDraftAnalyticsReturn {
  // Draft state from base hook
  draftState: ReturnType<typeof useLiveDraft>['draftState'];
  connected: boolean;
  loading: boolean;

  // Advanced analytics
  recommendations: DraftRecommendation[];
  insights: DraftInsight[];
  positionScarcity: PositionScarcity[];
  participantAnalysis: DraftParticipantAnalysis[];
  draftMood: DraftMood;

  // Timer management
  timer: DraftTimer;

  // Pick analysis
  lastPickAnalysis: {
    pick: {
      playerId: string;
      playerName: string;
      position: string;
      team: string;
    };
    analysis: {
      grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D+' | 'D' | 'F';
      reasoning: string;
      wasRecommended: boolean;
      valueScore: number;
      surprise: boolean;
    };
  } | null;

  // Actions
  refreshRecommendations: () => void;
  dismissInsight: (insightId: string) => void;
  pauseDraft: () => void;
  resumeDraft: () => void;
  enableAutoPick: () => void;
  disableAutoPick: () => void;

  // Statistics
  draftStats: {
    totalPicks: number;
    completedPicks: number;
    averagePickTime: number;
    fastestPick: number;
    slowestPick: number;
    surprisePickCount: number;
    valuePickCount: number;
  };
}

export function useAdvancedDraftAnalytics(
  options: AdvancedDraftAnalyticsOptions
): UseAdvancedDraftAnalyticsReturn {
  const {
    draftId,
    userId,
    leagueSettings,
    enableRecommendations = true,
    enableInsights = true,
    updateInterval = 5000,
  } = options;

  // Base draft state
  const liveDraft = useLiveDraft({
    draftId,
    userId,
    autoReconnect: true,
  });

  // Advanced state
  const [recommendations, setRecommendations] = useState<DraftRecommendation[]>([]);
  const [insights, setInsights] = useState<DraftInsight[]>([]);
  const [positionScarcity, setPositionScarcity] = useState<PositionScarcity[]>([]);
  const [participantAnalysis, setParticipantAnalysis] = useState<DraftParticipantAnalysis[]>([]);
  const [draftMood, setDraftMood] = useState<DraftMood>({
    overall: 'focused',
    pickPace: 'normal',
    surpriseLevel: 0,
    competitiveness: 50,
    chatActivity: 'moderate',
  });
  const [timer, setTimer] = useState<DraftTimer>({
    timeRemaining: 0,
    totalTime: 120,
    isActive: false,
    isPaused: false,
    warningThreshold: 30,
    criticalThreshold: 10,
    autoPickEnabled: false,
    pausesUsed: 0,
    maxPauses: 3,
  });
  const [lastPickAnalysis, setLastPickAnalysis] =
    useState<UseAdvancedDraftAnalyticsReturn['lastPickAnalysis']>(null);
  const [draftStats, setDraftStats] = useState({
    totalPicks: 0,
    completedPicks: 0,
    averagePickTime: 0,
    fastestPick: 0,
    slowestPick: 0,
    surprisePickCount: 0,
    valuePickCount: 0,
  });

  // Refs
  const analyticsSocketRef = useRef<Socket | null>(null);
  const pickTimerRef = useRef<number | null>(null);

  // Initialize analytics socket
  const initializeAnalyticsSocket = useCallback(() => {
    if (analyticsSocketRef.current?.connected) return;

    const socket = io('/draft-analytics', {
      auth: { draftId, userId, leagueSettings },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      logger.info('Draft analytics socket connected');
    });

    socket.on('disconnect', () => {
      logger.warn('Draft analytics socket disconnected');
    });

    // Recommendations updates
    socket.on('recommendations:update', (data: DraftRecommendation[]) => {
      if (enableRecommendations) {
        setRecommendations(data);
      }
    });

    // Draft insights
    socket.on('insights:new', (insight: DraftInsight) => {
      if (enableInsights) {
        setInsights((prev) => [insight, ...prev.slice(0, 19)]); // Keep last 20
      }
    });

    // Position scarcity updates
    socket.on('scarcity:update', (data: PositionScarcity[]) => {
      setPositionScarcity(data);
    });

    // Participant analysis
    socket.on('participants:analysis', (data: DraftParticipantAnalysis[]) => {
      setParticipantAnalysis(data);
    });

    // Draft mood tracking
    socket.on('mood:update', (mood: DraftMood) => {
      setDraftMood(mood);
    });

    // Pick analysis
    socket.on('pick:analysis', (analysis: UseAdvancedDraftAnalyticsReturn['lastPickAnalysis']) => {
      setLastPickAnalysis(analysis);

      // Update stats based on pick analysis
      if (analysis) {
        setDraftStats((prev) => ({
          ...prev,
          surprisePickCount: analysis.analysis.surprise
            ? prev.surprisePickCount + 1
            : prev.surprisePickCount,
          valuePickCount:
            analysis.analysis.valueScore > 80 ? prev.valuePickCount + 1 : prev.valuePickCount,
        }));
      }
    });

    // Timer updates
    socket.on('timer:tick', (data: { timeRemaining: number; isActive: boolean }) => {
      setTimer((prev) => ({
        ...prev,
        timeRemaining: data.timeRemaining,
        isActive: data.isActive,
      }));
    });

    socket.on('timer:warning', (data: { timeRemaining: number; level: 'warning' | 'critical' }) => {
      // Could trigger visual/audio warnings here
      logger.warn(`Draft timer ${data.level}`, { timeRemaining: data.timeRemaining });
    });

    socket.on('timer:expired', () => {
      setTimer((prev) => ({ ...prev, timeRemaining: 0, isActive: false }));

      // Add insight about auto-pick
      if (enableInsights) {
        setInsights((prev) => [
          {
            id: `insight_${Date.now()}`,
            type: 'warning',
            title: 'Timer Expired',
            message: 'Auto-pick will be triggered shortly',
            priority: 'high',
            timestamp: new Date().toISOString(),
            actionable: false,
          },
          ...prev.slice(0, 19),
        ]);
      }
    });

    // Draft statistics
    socket.on('stats:update', (stats: typeof draftStats) => {
      setDraftStats(stats);
    });

    analyticsSocketRef.current = socket;
  }, [draftId, userId, leagueSettings, enableRecommendations, enableInsights]);

  // Generate mock recommendations (replace with real API call)
  const generateMockRecommendations = useCallback(() => {
    if (!liveDraft.draftState) return;

    const mockRecommendations: DraftRecommendation[] = [
      {
        playerId: 'ply_patrick_cripps',
        playerName: 'Patrick Cripps',
        position: 'MID',
        team: 'Carlton',
        reason: 'best_available',
        confidence: 95,
        projectedPoints: 110,
        adp: 1.2,
        valueScore: 92,
        riskLevel: 'low',
        analysis: 'Elite midfield premium with consistent scoring. Captain material.',
        tags: ['Premium', 'Consistent', 'Captain'],
      },
      {
        playerId: 'ply_max_gawn',
        playerName: 'Max Gawn',
        position: 'RUC',
        team: 'Melbourne',
        reason: 'positional_need',
        confidence: 88,
        projectedPoints: 105,
        adp: 2.1,
        valueScore: 85,
        riskLevel: 'low',
        analysis: 'Dominant ruckman with excellent scoring consistency. Fill your ruck slot early.',
        tags: ['Premium', 'Ruck', 'Consistent'],
      },
      {
        playerId: 'ply_nick_daicos',
        playerName: 'Nick Daicos',
        position: 'DEF',
        team: 'Collingwood',
        reason: 'value_pick',
        confidence: 82,
        projectedPoints: 95,
        adp: 4.8,
        valueScore: 78,
        riskLevel: 'medium',
        analysis: 'Breakout defender with high upside. Great value at current ADP.',
        tags: ['Breakout', 'Value', 'Young'],
      },
    ];

    setRecommendations(mockRecommendations);
  }, [liveDraft.draftState]);

  // Generate mock position scarcity
  const generateMockScarcity = useCallback(() => {
    const positions = ['MID', 'DEF', 'FWD', 'RUC'];
    const mockScarcity: PositionScarcity[] = positions.map((pos) => ({
      position: pos,
      totalAvailable: Math.floor(Math.random() * 50) + 20,
      qualityAvailable: Math.floor(Math.random() * 10) + 5,
      scarcityScore: Math.floor(Math.random() * 100),
      nextTierDropoff: Math.floor(Math.random() * 5) + 1,
      recommendation: ['draft_now', 'wait', 'consider'][Math.floor(Math.random() * 3)] as any,
    }));

    setPositionScarcity(mockScarcity);
  }, []);

  // Actions
  const refreshRecommendations = useCallback(() => {
    if (analyticsSocketRef.current) {
      analyticsSocketRef.current.emit('recommendations:refresh');
    } else {
      generateMockRecommendations();
    }
  }, [generateMockRecommendations]);

  const dismissInsight = useCallback((insightId: string) => {
    setInsights((prev) => prev.filter((insight) => insight.id !== insightId));
  }, []);

  const pauseDraft = useCallback(() => {
    if (analyticsSocketRef.current && timer.pausesUsed < timer.maxPauses) {
      analyticsSocketRef.current.emit('timer:pause');
      setTimer((prev) => ({ ...prev, isPaused: true, pausesUsed: prev.pausesUsed + 1 }));
    }
  }, [timer.pausesUsed, timer.maxPauses]);

  const resumeDraft = useCallback(() => {
    if (analyticsSocketRef.current) {
      analyticsSocketRef.current.emit('timer:resume');
      setTimer((prev) => ({ ...prev, isPaused: false }));
    }
  }, []);

  const enableAutoPick = useCallback(() => {
    if (analyticsSocketRef.current) {
      analyticsSocketRef.current.emit('autopick:enable');
      setTimer((prev) => ({ ...prev, autoPickEnabled: true }));
    }
  }, []);

  const disableAutoPick = useCallback(() => {
    if (analyticsSocketRef.current) {
      analyticsSocketRef.current.emit('autopick:disable');
      setTimer((prev) => ({ ...prev, autoPickEnabled: false }));
    }
  }, []);

  // Effects
  useEffect(() => {
    if (draftId && userId) {
      initializeAnalyticsSocket();
      generateMockRecommendations();
      generateMockScarcity();
    }

    return () => {
      if (analyticsSocketRef.current) {
        analyticsSocketRef.current.disconnect();
      }
      if (pickTimerRef.current) {
        clearInterval(pickTimerRef.current);
      }
    };
  }, [
    draftId,
    userId,
    initializeAnalyticsSocket,
    generateMockRecommendations,
    generateMockScarcity,
  ]);

  // Update recommendations when draft state changes
  useEffect(() => {
    if (liveDraft.draftState && enableRecommendations) {
      const timeout = setTimeout(refreshRecommendations, 1000);
      return () => clearTimeout(timeout);
    }
  }, [liveDraft.draftState?.currentPick, refreshRecommendations, enableRecommendations]);

  return {
    // Draft state
    draftState: liveDraft.draftState,
    connected: liveDraft.connected,
    loading: liveDraft.loading,

    // Advanced analytics
    recommendations,
    insights,
    positionScarcity,
    participantAnalysis,
    draftMood,

    // Timer
    timer,

    // Analysis
    lastPickAnalysis,

    // Actions
    refreshRecommendations,
    dismissInsight,
    pauseDraft,
    resumeDraft,
    enableAutoPick,
    disableAutoPick,

    // Statistics
    draftStats,
  };
}

export default useAdvancedDraftAnalytics;
