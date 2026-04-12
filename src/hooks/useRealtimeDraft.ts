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
  pickDeadlineAt?: string | null;
  timePerPick?: number;
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
  recentActivity: Array<{
    id: string;
    type: 'pick' | 'join' | 'leave' | 'status';
    message: string;
    timestamp: string;
    participant?: DraftParticipant;
    pick?: DraftPick;
  }>;
  makePick: (playerId: string) => Promise<void>;
  updateQueue: (queue: Array<{ playerId: string; rank: number }>) => void;
  forceRefresh: () => Promise<void>;
  socket?: Socket;
}

export function useRealtimeDraft(
  initialDraftData: DraftData,
  currentUserId: string,
  enabled: boolean = true
): RealtimeDraftReturn {
  const getTimeRemainingFromDraft = useCallback((draft: DraftData) => {
    if (draft.status !== 'LIVE' || !draft.pickDeadlineAt) {
      return 0;
    }

    const deadline = new Date(draft.pickDeadlineAt).getTime();
    if (Number.isNaN(deadline)) {
      return 0;
    }

    return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }, []);

  const normalizeDraftData = useCallback((payload: unknown, previous: DraftData): DraftData => {
    if (!payload || typeof payload !== 'object') {
      return previous;
    }

    const candidate = payload as Record<string, unknown>;

    if (typeof candidate.currentPick === 'number') {
      return {
        ...previous,
        ...(typeof candidate.id === 'string' ? { id: candidate.id } : {}),
        ...(typeof candidate.currentPick === 'number'
          ? { currentPick: candidate.currentPick }
          : {}),
        ...(typeof candidate.totalPicks === 'number' ? { totalPicks: candidate.totalPicks } : {}),
        ...(typeof candidate.round === 'number' ? { round: candidate.round } : {}),
        ...(typeof candidate.direction === 'string' ? { direction: candidate.direction } : {}),
        ...(typeof candidate.status === 'string' ? { status: candidate.status } : {}),
        ...(Array.isArray(candidate.participants)
          ? { participants: candidate.participants as DraftParticipant[] }
          : {}),
        ...(Array.isArray(candidate.picks) ? { picks: candidate.picks as DraftPick[] } : {}),
        ...(typeof candidate.completedAt === 'string'
          ? { completedAt: candidate.completedAt }
          : {}),
        ...('pickDeadlineAt' in candidate
          ? { pickDeadlineAt: (candidate.pickDeadlineAt as string | null | undefined) ?? null }
          : {}),
        ...(typeof candidate.timePerPick === 'number'
          ? { timePerPick: candidate.timePerPick }
          : {}),
      };
    }

    const currentPick = candidate.currentPick as
      | { pickNumber?: unknown; round?: unknown; expiresAt?: unknown }
      | undefined;
    const draftSettings = candidate.draftSettings as
      | {
          totalRounds?: unknown;
          totalTeams?: unknown;
          draftType?: unknown;
          pickTimeLimit?: unknown;
        }
      | undefined;
    const participants = Array.isArray(candidate.participants)
      ? candidate.participants.map((participant) => {
          const entry = participant as Record<string, unknown>;
          return {
            slot: Number(entry.draftOrder ?? 0),
            member: {
              id: String(entry.memberId ?? ''),
              userId: String(entry.userId ?? ''),
              displayName: String(entry.displayName ?? 'Unknown'),
              email: '',
            },
          };
        })
      : previous.participants;

    return {
      ...previous,
      ...(typeof candidate.draftId === 'string' ? { id: candidate.draftId } : {}),
      currentPick:
        typeof currentPick?.pickNumber === 'number' ? currentPick.pickNumber : previous.currentPick,
      totalPicks:
        typeof draftSettings?.totalRounds === 'number' &&
        typeof draftSettings?.totalTeams === 'number'
          ? draftSettings.totalRounds * draftSettings.totalTeams
          : previous.totalPicks,
      round: typeof currentPick?.round === 'number' ? currentPick.round : previous.round,
      direction:
        typeof draftSettings?.draftType === 'string'
          ? draftSettings.draftType === 'LINEAR'
            ? 'FORWARD'
            : typeof currentPick?.round === 'number' && currentPick.round % 2 === 0
              ? 'REVERSE'
              : 'FORWARD'
          : previous.direction,
      status: typeof candidate.status === 'string' ? candidate.status : previous.status,
      participants,
      picks: previous.picks,
      completedAt:
        typeof candidate.updatedAt === 'string' && candidate.status === 'COMPLETED'
          ? candidate.updatedAt
          : previous.completedAt,
      pickDeadlineAt:
        currentPick?.expiresAt instanceof Date
          ? currentPick.expiresAt.toISOString()
          : typeof currentPick?.expiresAt === 'string'
            ? currentPick.expiresAt
            : previous.pickDeadlineAt,
      timePerPick:
        typeof draftSettings?.pickTimeLimit === 'number'
          ? draftSettings.pickTimeLimit
          : previous.timePerPick,
    };
  }, []);

  const [draftData, setDraftData] = useState<DraftData>(initialDraftData);
  const [liveDraftState, setLiveDraftState] = useState<LiveDraftState>({
    timeRemaining: getTimeRemainingFromDraft(initialDraftData),
    isYourTurn: false,
    picksUntilYourTurn: 0,
  });
  const [connectionState, setConnectionState] = useState<ConnectionState>({ status: 'connecting' });
  const [lastPickMade, setLastPickMade] = useState<DraftPick | undefined>(undefined);
  const [recentActivity, setRecentActivity] = useState<RealtimeDraftReturn['recentActivity']>([]);
  const socketRef = useRef<Socket | undefined>(undefined);

  // Derive simple turn information
  useEffect(() => {
    const teamCount = draftData.participants.length || 1;
    const round = Math.ceil(draftData.currentPick / teamCount);
    const direction = round % 2 === 1 ? 'FORWARD' : 'REVERSE';
    const currentSlot =
      direction === 'FORWARD'
        ? ((draftData.currentPick - 1) % teamCount) + 1
        : teamCount - ((draftData.currentPick - 1) % teamCount);
    const currentTurnParticipant = draftData.participants.find((p) => p.slot === currentSlot);
    const isYourTurn = currentTurnParticipant?.member.userId === currentUserId;
    setLiveDraftState((prev) => ({
      ...prev,
      currentTurn: currentTurnParticipant
        ? { round, slot: currentSlot, member: currentTurnParticipant.member }
        : undefined,
      isYourTurn,
      timeRemaining: getTimeRemainingFromDraft(draftData),
    }));
  }, [draftData, currentUserId, getTimeRemainingFromDraft]);

  useEffect(() => {
    const id = setInterval(() => {
      setLiveDraftState((prev) => ({
        ...prev,
        timeRemaining: getTimeRemainingFromDraft(draftData),
      }));
    }, 1000);

    return () => clearInterval(id);
  }, [draftData, getTimeRemainingFromDraft]);

  useEffect(() => {
    if (!enabled || !initialDraftData.id) {
      setConnectionState({ status: 'disconnected' });
      return;
    }
    const { socket, cleanup } = joinDraft(initialDraftData.id, {
      onDraftUpdate: (data) => {
        setDraftData((prev) => {
          const next = normalizeDraftData(data, prev);
          setLiveDraftState((state) => ({
            ...state,
            timeRemaining: getTimeRemainingFromDraft(next),
          }));
          return next;
        });
        setConnectionState((s) => ({ ...s, lastUpdate: new Date().toISOString() }));
      },
      onPickMade: (data) => {
        setLastPickMade(data.pick);
        setDraftData((prev) => ({
          ...prev,
          currentPick: data.currentPick,
          picks: [...prev.picks, data.pick],
          status: data.isComplete ? 'COMPLETED' : prev.status,
        }));
        setRecentActivity((prev) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            timestamp: new Date().toISOString(),
            type: 'pick',
            message: `${data.pick.member.displayName} drafted ${data.pick.player.name}`,
            pick: data.pick,
          },
          ...prev.slice(0, 49),
        ]);
        if (!data.isComplete) {
          setLiveDraftState((prev) => ({ ...prev, timeRemaining: 0 }));
        }
      },
      onTimerUpdate: (data) => {
        setLiveDraftState((prev) => ({
          ...prev,
          timeRemaining: data.timeRemaining,
          currentTurn: data.currentTurn,
        }));
      },
      onStatusChange: (data) => {
        setDraftData((prev) => ({ ...prev, status: data.status }));
        setRecentActivity((prev) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            timestamp: new Date().toISOString(),
            type: 'status',
            message: `Draft status changed to ${data.status}`,
          },
          ...prev.slice(0, 49),
        ]);
      },
      onConnectionChange: ({ connected, reconnecting }) => {
        setConnectionState({
          status: connected ? 'connected' : reconnecting ? 'reconnecting' : 'disconnected',
          lastUpdate: new Date().toISOString(),
        });
      },
      onError: (error) => setConnectionState((s) => ({ ...s, error: error.message })),
    });
    socketRef.current = socket;
    return () => {
      cleanup();
      socketRef.current = undefined;
    };
  }, [enabled, initialDraftData.id]);

  const makePick = useCallback(
    async (playerId: string) => {
      const userParticipant = draftData.participants.find((p) => p.member.userId === currentUserId);
      if (!userParticipant || !socketRef.current) return;
      emitPick(socketRef.current, draftData.id, playerId, userParticipant.member.id);
    },
    [draftData.participants, draftData.id, currentUserId]
  );

  const updateQueue = useCallback(
    (queue: Array<{ playerId: string; rank: number }>) => {
      const userParticipant = draftData.participants.find((p) => p.member.userId === currentUserId);
      if (!userParticipant || !socketRef.current) return;
      emitQueueUpdate(socketRef.current, draftData.id, userParticipant.member.id, queue);
    },
    [draftData.participants, draftData.id, currentUserId]
  );

  const forceRefresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/drafts/${draftData.id}`);
      if (res.ok) {
        const json = await res.json();
        if (json?.data) {
          setDraftData((prev) => {
            const next = normalizeDraftData(json.data as Partial<DraftData>, prev);
            setLiveDraftState((state) => ({
              ...state,
              timeRemaining: getTimeRemainingFromDraft(next),
            }));
            return next;
          });
        }
      }
    } catch {}
  }, [draftData.id, getTimeRemainingFromDraft, normalizeDraftData]);

  return {
    draftData,
    liveDraftState,
    connectionState,
    lastPickMade,
    recentActivity,
    makePick,
    updateQueue,
    forceRefresh,
    socket: socketRef.current,
  };
}
