'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { joinDraft, emitPick, emitQueueUpdate } from '@/client/socket';
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
  const [draftData, setDraftData] = useState<DraftData>(initialDraftData);
  const [liveDraftState, setLiveDraftState] = useState<LiveDraftState>({ timeRemaining: 120, isYourTurn: false, picksUntilYourTurn: 0 });
  const [connectionState, setConnectionState] = useState<ConnectionState>({ status: 'connecting' });
  const [lastPickMade, setLastPickMade] = useState<DraftPick | undefined>(undefined);
  const [recentActivity, setRecentActivity] = useState<RealtimeDraftReturn['recentActivity']>([]);
  const socketRef = useRef<Socket | undefined>(undefined);

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
    if (!enabled || !initialDraftData.id) {
      setConnectionState({ status: 'disconnected' });
      return;
    }
    const { socket, cleanup } = joinDraft(initialDraftData.id, {
      onDraftUpdate: (data) => {
        setDraftData({
          id: data.draftId,
          currentPick: data.currentPick,
          totalPicks: data.totalPicks,
          round: data.round,
          direction: data.direction,
          status: data.status,
          picks: data.picks,
          participants: data.participants,
          completedAt: data.completedAt,
        });
        setConnectionState((s) => ({ ...s, lastUpdate: new Date().toISOString() }));
      },
      onPickMade: (data) => {
        setLastPickMade(data.pick);
        setDraftData((prev) => ({ ...prev, currentPick: data.currentPick, picks: [...prev.picks, data.pick], status: data.isComplete ? 'COMPLETED' : prev.status }));
        setRecentActivity((prev) => [{ id: `${Date.now()}-${Math.random()}`, timestamp: new Date().toISOString(), type: 'pick', message: `${data.pick.member.displayName} drafted ${data.pick.player.name}`, pick: data.pick }, ...prev.slice(0, 49)]);
        if (!data.isComplete) setLiveDraftState((prev) => ({ ...prev, timeRemaining: 120 }));
      },
      onStatusChange: (data) => {
        setDraftData((prev) => ({ ...prev, status: data.status }));
        setRecentActivity((prev) => [{ id: `${Date.now()}-${Math.random()}`, timestamp: new Date().toISOString(), type: 'status', message: `Draft status changed to ${data.status}` }, ...prev.slice(0, 49)]);
      },
      onConnectionChange: ({ connected, reconnecting }) => {
        setConnectionState({ status: connected ? 'connected' : reconnecting ? 'reconnecting' : 'disconnected', lastUpdate: new Date().toISOString() });
      },
      onError: (error) => setConnectionState((s) => ({ ...s, error: error.message })),
    });
    socketRef.current = socket;
    return () => { cleanup(); socketRef.current = undefined; };
  }, [enabled, initialDraftData.id]);

  const makePick = useCallback(async (playerId: string) => {
    const userParticipant = draftData.participants.find((p) => p.member.userId === currentUserId);
    if (!userParticipant || !socketRef.current) return;
    emitPick(socketRef.current, draftData.id, playerId, userParticipant.member.id);
  }, [draftData.participants, draftData.id, currentUserId]);

  const updateQueue = useCallback((queue: Array<{ playerId: string; rank: number }>) => {
    const userParticipant = draftData.participants.find((p) => p.member.userId === currentUserId);
    if (!userParticipant || !socketRef.current) return;
    emitQueueUpdate(socketRef.current, draftData.id, userParticipant.member.id, queue);
  }, [draftData.participants, draftData.id, currentUserId]);

  const forceRefresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/drafts/${draftData.id}`);
      if (res.ok) {
        const json = await res.json();
        if (json?.data) setDraftData((prev) => ({ ...prev, ...(json.data as Partial<DraftData>) }));
      }
    } catch {}
  }, [draftData.id]);

  return { draftData, liveDraftState, connectionState, lastPickMade, recentActivity, makePick, updateQueue, forceRefresh, socket: socketRef.current };
}
