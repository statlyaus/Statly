/**
 * Real-time Trades & Waivers Hook - ESPN/Yahoo Fantasy Level Features
 * 
 * Features:
 * - Live trade proposals and negotiations
 * - Real-time waiver wire activity
 * - Instant roster move notifications
 * - Trade analyzer and fairness scoring
 * - Waiver claim priority tracking
 * - Free agent acquisition notifications
 * - Trade deadline countdown
 * - League activity feed
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

import { logger } from '@/lib/logger';

export interface TradeProposal {
  id: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'vetoed';
  proposedAt: string;
  expiresAt: string;
  offeredPlayers: TradePlayer[];
  requestedPlayers: TradePlayer[];
  analysis: TradeAnalysis;
  messages: TradeMessage[];
  reviewPeriod?: {
    startsAt: string;
    endsAt: string;
    vetoVotes: number;
    votesRequired: number;
    votingUsers: Array<{
      userId: string;
      vote: 'approve' | 'veto';
      timestamp: string;
    }>;
  };
}

export interface TradePlayer {
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  currentScore: number;
  projectedScore: number;
  value: number;
  contractStatus?: 'keeper' | 'rental';
  injuryStatus?: 'healthy' | 'questionable' | 'injured' | 'out';
}

export interface TradeAnalysis {
  fairnessScore: number; // -100 to 100 (negative means favors toUser)
  analysis: string;
  keyFactors: string[];
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: 'accept' | 'reject' | 'consider';
  impactAnalysis: {
    fromUserImpact: {
      strengthChange: number;
      weaknessChange: number;
      projectedFinish: number;
    };
    toUserImpact: {
      strengthChange: number;
      weaknessChange: number;
      projectedFinish: number;
    };
  };
}

export interface TradeMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: string;
  type: 'comment' | 'counter_offer' | 'system';
}

export interface WaiverClaim {
  id: string;
  userId: string;
  userName: string;
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  dropPlayerId?: string;
  dropPlayerName?: string;
  priority: number;
  waiverPriority: number;
  claimType: 'add' | 'add_drop';
  status: 'pending' | 'successful' | 'failed' | 'cancelled';
  processedAt?: string;
  submittedAt: string;
  faabBid?: number; // If using FAAB
  failureReason?: string;
}

export interface WaiverPeriod {
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  droppedBy: string;
  waiverUntil: string;
  claimCount: number;
  topBid?: number;
}

export interface FreeAgent {
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  addedAt: string;
  trending: 'up' | 'down' | 'stable';
  addPercent: number; // % added in last 24 hours
  dropPercent: number; // % dropped in last 24 hours
}

export interface RosterMove {
  id: string;
  userId: string;
  userName: string;
  type: 'add' | 'drop' | 'trade' | 'waiver_claim' | 'free_agent_add';
  playersInvolved: Array<{
    playerId: string;
    playerName: string;
    action: 'added' | 'dropped' | 'traded_in' | 'traded_out';
  }>;
  timestamp: string;
  details?: string;
}

export interface LeagueActivity {
  id: string;
  type: 'trade_proposal' | 'trade_accepted' | 'trade_rejected' | 'waiver_claim' | 'free_agent' | 'roster_move';
  userId: string;
  userName: string;
  message: string;
  timestamp: string;
  priority: 'low' | 'medium' | 'high';
  relatedUsers?: string[];
  relatedPlayers?: string[];
}

export interface RealtimeTradesWaiversOptions {
  leagueId: string;
  userId: string;
  enableNotifications: boolean;
  updateInterval: number;
}

export interface UseRealtimeTradesWaiversReturn {
  // Trade data
  incomingTrades: TradeProposal[];
  outgoingTrades: TradeProposal[];
  recentTrades: TradeProposal[];
  
  // Waiver data
  myWaiverClaims: WaiverClaim[];
  allWaiverClaims: WaiverClaim[];
  waiverPeriodPlayers: WaiverPeriod[];
  freeAgents: FreeAgent[];
  
  // Activity
  recentActivity: LeagueActivity[];
  rosterMoves: RosterMove[];
  
  // Status
  connected: boolean;
  tradeDeadline: string | null;
  waiverProcessTime: string;
  myWaiverPriority: number;
  
  // Actions
  proposeTrader: (proposal: Omit<TradeProposal, 'id' | 'status' | 'proposedAt' | 'analysis' | 'messages'>) => Promise<void>;
  acceptTrade: (tradeId: string) => Promise<void>;
  rejectTrade: (tradeId: string, reason?: string) => Promise<void>;
  addTradeMessage: (tradeId: string, message: string) => Promise<void>;
  
  submitWaiverClaim: (claim: Omit<WaiverClaim, 'id' | 'status' | 'submittedAt'>) => Promise<void>;
  cancelWaiverClaim: (claimId: string) => Promise<void>;
  addFreeAgent: (playerId: string) => Promise<void>;
  dropPlayer: (playerId: string) => Promise<void>;
  
  // Utility
  refreshData: () => void;
  markActivityAsRead: (activityId: string) => void;
}

export function useRealtimeTradesWaivers(
  options: RealtimeTradesWaiversOptions
): UseRealtimeTradesWaiversReturn {
  const {
    leagueId,
    userId,
    enableNotifications = true,
    updateInterval = 30000, // 30 seconds
  } = options;

  // Trade state
  const [incomingTrades, setIncomingTrades] = useState<TradeProposal[]>([]);
  const [outgoingTrades, setOutgoingTrades] = useState<TradeProposal[]>([]);
  const [recentTrades, setRecentTrades] = useState<TradeProposal[]>([]);

  // Waiver state
  const [myWaiverClaims, setMyWaiverClaims] = useState<WaiverClaim[]>([]);
  const [allWaiverClaims, setAllWaiverClaims] = useState<WaiverClaim[]>([]);
  const [waiverPeriodPlayers, setWaiverPeriodPlayers] = useState<WaiverPeriod[]>([]);
  const [freeAgents, setFreeAgents] = useState<FreeAgent[]>([]);

  // Activity state
  const [recentActivity, setRecentActivity] = useState<LeagueActivity[]>([]);
  const [rosterMoves, setRosterMoves] = useState<RosterMove[]>([]);

  // Status state
  const [connected, setConnected] = useState(false);
  const [tradeDeadline, setTradeDeadline] = useState<string | null>(null);
  const [waiverProcessTime, setWaiverProcessTime] = useState('');
  const [myWaiverPriority, setMyWaiverPriority] = useState(1);

  // Socket ref
  const socketRef = useRef<Socket | null>(null);

  // Initialize socket connection
  const initializeSocket = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = io('/trades-waivers', {
      auth: { leagueId, userId },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      setConnected(true);
      logger.info('Trades & waivers socket connected');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      logger.warn('Trades & waivers socket disconnected');
    });

    // Trade events
    socket.on('trade:proposed', (trade: TradeProposal) => {
      if (trade.toUserId === userId) {
        setIncomingTrades(prev => [trade, ...prev]);
        addActivity({
          type: 'trade_proposal',
          userId: trade.fromUserId,
          userName: trade.fromUserName,
          message: `${trade.fromUserName} proposed a trade`,
          priority: 'high',
          relatedUsers: [trade.toUserId],
        });
      } else {
        setRecentActivity(prev => [{
          id: `activity_${Date.now()}`,
          type: 'trade_proposal',
          userId: trade.fromUserId,
          userName: trade.fromUserName,
          message: `${trade.fromUserName} proposed a trade to ${trade.toUserName}`,
          timestamp: new Date().toISOString(),
          priority: 'medium',
          relatedUsers: [trade.fromUserId, trade.toUserId],
        }, ...prev.slice(0, 49)]);
      }

      // Browser notification
      if (enableNotifications && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Trade Proposal', {
          body: `${trade.fromUserName} proposed a trade`,
          icon: '/favicon.ico',
        });
      }
    });

    socket.on('trade:accepted', (trade: TradeProposal) => {
      setRecentTrades(prev => [trade, ...prev.slice(0, 19)]);
      setIncomingTrades(prev => prev.filter(t => t.id !== trade.id));
      setOutgoingTrades(prev => prev.filter(t => t.id !== trade.id));
      
      addActivity({
        type: 'trade_accepted',
        userId: trade.toUserId,
        userName: trade.toUserName,
        message: `Trade completed between ${trade.fromUserName} and ${trade.toUserName}`,
        priority: 'high',
        relatedUsers: [trade.fromUserId, trade.toUserId],
      });
    });

    socket.on('trade:rejected', (trade: TradeProposal) => {
      setIncomingTrades(prev => prev.filter(t => t.id !== trade.id));
      setOutgoingTrades(prev => prev.filter(t => t.id !== trade.id));
      
      if (trade.fromUserId === userId || trade.toUserId === userId) {
        addActivity({
          type: 'trade_rejected',
          userId: trade.toUserId,
          userName: trade.toUserName,
          message: `Trade rejected by ${trade.toUserName}`,
          priority: 'medium',
        });
      }
    });

    socket.on('trade:message', (data: { tradeId: string; message: TradeMessage }) => {
      setIncomingTrades(prev => prev.map(trade => 
        trade.id === data.tradeId 
          ? { ...trade, messages: [...trade.messages, data.message] }
          : trade
      ));
      setOutgoingTrades(prev => prev.map(trade => 
        trade.id === data.tradeId 
          ? { ...trade, messages: [...trade.messages, data.message] }
          : trade
      ));
    });

    // Waiver events
    socket.on('waiver:claimed', (claim: WaiverClaim) => {
      if (claim.userId === userId) {
        setMyWaiverClaims(prev => prev.map(c => 
          c.id === claim.id ? claim : c
        ));
      }
      
      setAllWaiverClaims(prev => prev.map(c => 
        c.id === claim.id ? claim : c
      ));

      addActivity({
        type: 'waiver_claim',
        userId: claim.userId,
        userName: claim.userName,
        message: `${claim.userName} ${claim.status === 'successful' ? 'claimed' : 'attempted to claim'} ${claim.playerName}`,
        priority: claim.status === 'successful' ? 'high' : 'medium',
        relatedPlayers: [claim.playerId],
      });
    });

    socket.on('waiver:processed', (results: WaiverClaim[]) => {
      setMyWaiverClaims(prev => prev.map(claim => 
        results.find(r => r.id === claim.id) || claim
      ));
      setAllWaiverClaims(results);
      
      // Add activity for successful claims
      results.filter(c => c.status === 'successful').forEach(claim => {
        addActivity({
          type: 'waiver_claim',
          userId: claim.userId,
          userName: claim.userName,
          message: `${claim.userName} successfully claimed ${claim.playerName}`,
          priority: 'high',
          relatedPlayers: [claim.playerId],
        });
      });
    });

    socket.on('free_agent:added', (data: { userId: string; userName: string; player: FreeAgent }) => {
      addActivity({
        type: 'free_agent',
        userId: data.userId,
        userName: data.userName,
        message: `${data.userName} added ${data.player.playerName}`,
        priority: 'low',
        relatedPlayers: [data.player.playerId],
      });
    });

    // Activity feed
    socket.on('activity:new', (activity: LeagueActivity) => {
      setRecentActivity(prev => [activity, ...prev.slice(0, 49)]);
    });

    // Status updates
    socket.on('status:update', (data: {
      tradeDeadline: string;
      waiverProcessTime: string;
      waiverPriority: number;
    }) => {
      setTradeDeadline(data.tradeDeadline);
      setWaiverProcessTime(data.waiverProcessTime);
      setMyWaiverPriority(data.waiverPriority);
    });

    socketRef.current = socket;
  }, [leagueId, userId, enableNotifications]);

  // Helper to add activity
  const addActivity = useCallback((activity: Omit<LeagueActivity, 'id' | 'timestamp'>) => {
    const fullActivity: LeagueActivity = {
      ...activity,
      id: `activity_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    setRecentActivity(prev => [fullActivity, ...prev.slice(0, 49)]);
  }, []);

  // Actions
  const proposeTrader = useCallback(async (proposal: Omit<TradeProposal, 'id' | 'status' | 'proposedAt' | 'analysis' | 'messages'>) => {
    if (!socketRef.current) return;

    const fullProposal: TradeProposal = {
      ...proposal,
      id: `trade_${Date.now()}`,
      status: 'pending',
      proposedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48 hours
      analysis: {
        fairnessScore: 0,
        analysis: 'Analyzing trade...',
        keyFactors: [],
        riskLevel: 'medium',
        recommendation: 'consider',
        impactAnalysis: {
          fromUserImpact: { strengthChange: 0, weaknessChange: 0, projectedFinish: 0 },
          toUserImpact: { strengthChange: 0, weaknessChange: 0, projectedFinish: 0 },
        },
      },
      messages: [],
    };

    setOutgoingTrades(prev => [fullProposal, ...prev]);
    socketRef.current.emit('trade:propose', fullProposal);
  }, []);

  const acceptTrade = useCallback(async (tradeId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('trade:accept', { tradeId });
  }, []);

  const rejectTrade = useCallback(async (tradeId: string, reason?: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('trade:reject', { tradeId, reason });
  }, []);

  const addTradeMessage = useCallback(async (tradeId: string, message: string) => {
    if (!socketRef.current) return;
    
    const tradeMessage: TradeMessage = {
      id: `msg_${Date.now()}`,
      userId,
      userName: 'You',
      message,
      timestamp: new Date().toISOString(),
      type: 'comment',
    };

    socketRef.current.emit('trade:message', { tradeId, message: tradeMessage });
  }, [userId]);

  const submitWaiverClaim = useCallback(async (claim: Omit<WaiverClaim, 'id' | 'status' | 'submittedAt'>) => {
    if (!socketRef.current) return;

    const fullClaim: WaiverClaim = {
      ...claim,
      id: `claim_${Date.now()}`,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };

    setMyWaiverClaims(prev => [fullClaim, ...prev]);
    socketRef.current.emit('waiver:claim', fullClaim);
  }, []);

  const cancelWaiverClaim = useCallback(async (claimId: string) => {
    if (!socketRef.current) return;
    
    setMyWaiverClaims(prev => prev.filter(c => c.id !== claimId));
    socketRef.current.emit('waiver:cancel', { claimId });
  }, []);

  const addFreeAgent = useCallback(async (playerId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('free_agent:add', { playerId });
  }, []);

  const dropPlayer = useCallback(async (playerId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('player:drop', { playerId });
  }, []);

  const refreshData = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.emit('data:refresh');
    }
  }, []);

  const markActivityAsRead = useCallback((activityId: string) => {
    setRecentActivity(prev => prev.map(activity =>
      activity.id === activityId
        ? { ...activity, priority: 'low' }
        : activity
    ));
  }, []);

  // Effects
  useEffect(() => {
    if (leagueId && userId) {
      initializeSocket();
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [leagueId, userId, initializeSocket]);

  // Mock data initialization
  useEffect(() => {
    // Initialize with some mock data
    const mockFreeAgents: FreeAgent[] = [
      {
        playerId: 'ply_josh_kelly',
        playerName: 'Josh Kelly',
        position: 'MID',
        team: 'GWS Giants',
        addedAt: new Date().toISOString(),
        trending: 'up',
        addPercent: 15,
        dropPercent: 2,
      },
    ];

    setFreeAgents(mockFreeAgents);
    setWaiverProcessTime('Wed 3:00 AM EST');
    setMyWaiverPriority(5);
  }, []);

  return {
    // Trade data
    incomingTrades,
    outgoingTrades,
    recentTrades,
    
    // Waiver data
    myWaiverClaims,
    allWaiverClaims,
    waiverPeriodPlayers,
    freeAgents,
    
    // Activity
    recentActivity,
    rosterMoves,
    
    // Status
    connected,
    tradeDeadline,
    waiverProcessTime,
    myWaiverPriority,
    
    // Actions
    proposeTrader,
    acceptTrade,
    rejectTrade,
    addTradeMessage,
    submitWaiverClaim,
    cancelWaiverClaim,
    addFreeAgent,
    dropPlayer,
    
    // Utility
    refreshData,
    markActivityAsRead,
  };
}

export default useRealtimeTradesWaivers;