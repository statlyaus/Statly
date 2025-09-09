'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
}

interface DraftPick {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player: DraftPlayer;
  member: { id: string; displayName: string };
  auto: boolean;
  madeAt: string;
}

interface DraftParticipant {
  slot: number;
  member: { id: string; userId: string; displayName: string; email: string };
}

interface DraftData {
  id: string;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  status: string;
  participants: DraftParticipant[];
  picks: DraftPick[];
  completedAt?: string;
}

interface LiveDraftState {
  currentTurn?: { round: number; slot: number; member: { id: string; displayName: string } };
  timeRemaining: number;
  isYourTurn: boolean;
  nextTurn?: { round: number; slot: number; member: { id: string; displayName: string } };
  picksUntilYourTurn: number;
}

interface ConnectionState {
  status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  lastUpdate?: string;
  error?: string;
}

interface RealtimeDraftReturn {
  draftData: DraftData;
  liveDraftState: LiveDraftState;
  connectionState: ConnectionState;
  lastPickMade?: DraftPick;
  recentActivity: Array<{ id: string; type: 'pick' | 'join' | 'leave' | 'status'; message: string; timestamp: string; participant?: DraftParticipant; pick?: DraftPick }>;
  makePick: (playerId: string) => Promise<void>;
  updateQueue: (queue: Array<{ playerId: string; rank: number }>) => void;
  forceRefresh: () => Promise<void>;
  socket?: Socket;
}

export function useRealtimeDraft(initialDraftData: DraftData, currentUserId: string, enabled: boolean = true): RealtimeDraftReturn {
  const [draftData] = useState<DraftData>(initialDraftData);
  const [liveDraftState, setLiveDraftState] = useState<LiveDraftState>({ timeRemaining: 120, isYourTurn: false, picksUntilYourTurn: 0 });
  const [connectionState, setConnectionState] = useState<ConnectionState>({ status: enabled ? 'connected' : 'disconnected', lastUpdate: new Date().toISOString() });
  const [lastPickMade] = useState<DraftPick | undefined>(undefined);
  const [recentActivity] = useState<RealtimeDraftReturn['recentActivity']>([]);

  // Derive simple turn information
  useEffect(() => {
    const teamCount = draftData.participants.length || 1;
    const round = Math.ceil(draftData.currentPick / teamCount);
    const direction = round % 2 === 1 ? 'FORWARD' : 'REVERSE';
    const currentSlot = direction === 'FORWARD' ? ((draftData.currentPick - 1) % teamCount) + 1 : teamCount - ((draftData.currentPick - 1) % teamCount);
    const currentTurnParticipant = draftData.participants.find((p) => p.slot === currentSlot);
    const isYourTurn = currentTurnParticipant?.member.userId === currentUserId;
    setLiveDraftState((prev) => ({ ...prev, currentTurn: currentTurnParticipant ? { round, slot: currentSlot, member: currentTurnParticipant.member } : undefined, isYourTurn }));
  }, [draftData, currentUserId]);

  // Simple timer decrement
  useEffect(() => {
    const id = setInterval(() => {
      setLiveDraftState((prev) => ({ ...prev, timeRemaining: Math.max(0, prev.timeRemaining - 1) }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setConnectionState((prev) => ({ ...prev, status: enabled ? 'connected' : 'disconnected', lastUpdate: new Date().toISOString() }));
  }, [enabled]);

  const makePick = useCallback(async (_playerId: string) => {}, []);
  const updateQueue = useCallback((_queue: Array<{ playerId: string; rank: number }>) => {}, []);
  const forceRefresh = useCallback(async () => {}, []);

  return { draftData, liveDraftState, connectionState, lastPickMade, recentActivity, makePick, updateQueue, forceRefresh, socket: undefined };
}
