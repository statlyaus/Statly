'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';

import { useSocket } from '@/contexts/SocketContext';
import { fetchApi } from '@/lib/api';
import type { DraftState as DraftCore, DraftPlayer, DraftPick, DraftParticipant } from '@/types/draft';

type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface DraftLiveState {
  onClockTeamId?: string;
  currentPick?: number;
  isYourTurn?: boolean;
}

export interface DraftSnapshot {
  draft: DraftCore | null;
  participants: DraftParticipant[] | Record<string, DraftParticipant> | Map<string, DraftParticipant>;
  picks: DraftPick[] | Record<string, DraftPick> | Map<string, DraftPick>;
  availablePlayers: DraftPlayer[] | Record<string, DraftPlayer> | Map<string, DraftPlayer>;
  liveState?: DraftLiveState | null;
  ts?: number; // server event time (ms)
}

type DraftDeltaType =
  | 'PICK_MADE'
  | 'PLAYER_REMOVED'
  | 'PLAYER_ADDED'
  | 'QUEUE_UPDATED'
  | 'STATE_PATCH'
  | 'SNAPSHOT';

export interface DraftDelta {
  type: DraftDeltaType;
  payload: any;
  ts?: number;
}

interface DraftState {
  draft: DraftCore | null;
  participants: DraftParticipant[];
  picks: DraftPick[];
  availablePlayers: DraftPlayer[];
  liveState: DraftLiveState;
  connection: { status: ConnectionStatus; latencyMs?: number; lastEventAt?: number };
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

interface DraftContextValue extends DraftState {
  draftId: string;
  userId: string;
  makePick: (playerId: string) => Promise<void>;
  updateQueue: (queue: string[]) => Promise<void>;
  forceRefresh: () => Promise<void>;
  canMakePick: boolean;
}

const DraftContext = createContext<DraftContextValue | undefined>(undefined);

/* -------------------------------- Utilities -------------------------------- */

function toArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v == null) return [];
  if (v instanceof Map) return Array.from(v.values()) as T[];
  if (typeof v === 'object') return Object.values(v as Record<string, T>);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeSnapshot(raw?: DraftSnapshot | null): {
  draft: DraftCore | null;
  participants: DraftParticipant[];
  picks: DraftPick[];
  availablePlayers: DraftPlayer[];
  liveState: DraftLiveState;
  ts?: number;
} {
  if (!raw) {
    return {
      draft: null,
      participants: [],
      picks: [],
      availablePlayers: [],
      liveState: {},
    };
  }

  const participants = toArray<DraftParticipant>(raw.participants).map((p) => ({
    ...p,
    queue: Array.isArray((p as any).queue) ? (p as any).queue : [],
  }));

  const picks = toArray<DraftPick>(raw.picks).slice().sort((a, b) => {
    const ap = Number((a as any).pickNo ?? 0);
    const bp = Number((b as any).pickNo ?? 0);
    return ap - bp;
  });

  const pickedIds = new Set<string>(
    picks.map((pk) => String((pk as any).player?.id ?? (pk as any).playerId))
  );

  const availablePlayers = toArray<DraftPlayer>(raw.availablePlayers).filter(
    (pl) => !pickedIds.has(String(pl.id))
  );

  return {
    draft: raw.draft ?? null,
    participants,
    picks,
    availablePlayers,
    liveState: raw.liveState ?? {},
    ts: raw.ts,
  };
}

function computeCurrentSlotFromSnake(currentPick: number, teamCount: number): number | undefined {
  if (!currentPick || !teamCount) return undefined;
  const round = Math.ceil(currentPick / teamCount);
  const fwd = round % 2 === 1;
  const idx = ((currentPick - 1) % teamCount) + 1;
  return fwd ? idx : teamCount - ((currentPick - 1) % teamCount);
}

/* --------------------------------- Reducer --------------------------------- */

type Action =
  | { type: 'SET_SNAPSHOT'; snapshot: ReturnType<typeof normalizeSnapshot> }
  | { type: 'APPLY_DELTAS'; deltas: DraftDelta[] }
  | { type: 'SET_CONNECTION'; status: ConnectionStatus; latencyMs?: number }
  | { type: 'SET_SAVING'; saving: boolean }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null };

function applyDelta(state: DraftState, delta: DraftDelta): DraftState {
  const ts = delta.ts ?? Date.now();
  let next = { ...state, connection: { ...state.connection, lastEventAt: ts } };

  switch (delta.type) {
    case 'SNAPSHOT': {
      const snap = normalizeSnapshot(delta.payload as DraftSnapshot);
      return {
        ...next,
        draft: snap.draft,
        participants: snap.participants,
        picks: snap.picks,
        availablePlayers: snap.availablePlayers,
        liveState: snap.liveState,
        error: null,
        isLoading: false,
        connection: { ...next.connection, lastEventAt: snap.ts ?? ts },
      };
    }
    case 'PICK_MADE': {
      const { pick } = delta.payload as { pick: DraftPick };
      if (!pick) return next;
      const picks = [...next.picks, pick].sort((a, b) => {
        const ap = Number((a as any).pickNo ?? 0);
        const bp = Number((b as any).pickNo ?? 0);
        return ap - bp;
      });
      const pid = String((pick as any).player?.id ?? (pick as any).playerId);
      const availablePlayers = next.availablePlayers.filter((p) => String(p.id) !== pid);
      return { ...next, picks, availablePlayers };
    }
    case 'PLAYER_REMOVED': {
      const { playerId } = delta.payload as { playerId: string };
      if (!playerId) return next;
      return {
        ...next,
        availablePlayers: next.availablePlayers.filter((p) => String(p.id) !== String(playerId)),
      };
    }
    case 'PLAYER_ADDED': {
      const { player } = delta.payload as { player: DraftPlayer };
      if (!player) return next;
      if (next.availablePlayers.some((p) => String(p.id) === String(player.id))) return next;
      return { ...next, availablePlayers: [...next.availablePlayers, player] };
    }
    case 'QUEUE_UPDATED': {
      const { memberId, queue } = delta.payload as { memberId: string; queue: string[] };
      const participants = next.participants.map((m) =>
        String((m as any).id) === String(memberId)
          ? { ...m, queue: Array.isArray(queue) ? queue : [] }
          : m
      );
      return { ...next, participants };
    }
    case 'STATE_PATCH': {
      const { draft: draftPatch, liveState: livePatch } = (delta.payload ?? {}) as Partial<DraftState>;
      return {
        ...next,
        draft: draftPatch ? ({ ...(next.draft ?? {}), ...draftPatch } as DraftCore) : next.draft,
        liveState: livePatch ? { ...(next.liveState ?? {}), ...livePatch } : next.liveState,
      };
    }
    default:
      return next;
  }
}

function reducer(state: DraftState, action: Action): DraftState {
  switch (action.type) {
    case 'SET_SNAPSHOT':
      return {
        ...state,
        draft: action.snapshot.draft,
        participants: action.snapshot.participants,
        picks: action.snapshot.picks,
        availablePlayers: action.snapshot.availablePlayers,
        liveState: action.snapshot.liveState,
        isLoading: false,
        error: null,
        connection: {
          ...state.connection,
          lastEventAt: action.snapshot.ts ?? state.connection.lastEventAt,
        },
      };
    case 'APPLY_DELTAS': {
      let next = state;
      for (const d of action.deltas) next = applyDelta(next, d);
      return next;
    }
    case 'SET_CONNECTION':
      return {
        ...state,
        connection: { ...state.connection, status: action.status, latencyMs: action.latencyMs },
      };
    case 'SET_SAVING':
      return { ...state, isSaving: action.saving };
    case 'SET_LOADING':
      return { ...state, isLoading: action.loading };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    default:
      return state;
  }
}

/* ----------------------- Socket join + backfill (hook) ---------------------- */
/** Minimal, resilient socket wiring (join, backfill, deltas). */
function useDraftSocket(opts: {
  socket: ReturnType<typeof useSocket>;
  draftId: string;
  lastEventAt?: number;
  onSnapshot: (snap: DraftSnapshot) => void;
  onDelta: (delta: DraftDelta) => void;
  setStatus: (s: ConnectionStatus) => void;
}) {
  const { socket, draftId, lastEventAt, onSnapshot, onDelta, setStatus } = opts;

  useEffect(() => {
    if (!socket) return;

    const join = () => {
      setStatus('connected');
      socket.emit('draft:join', { draftId });
      socket.emit('draft:backfill', { draftId, since: lastEventAt ?? 0 });
    };

    const onConnect = join;
    const onDisconnect = () => setStatus('disconnected');
    const onReconnecting = () => setStatus('reconnecting');

    const handleSnapshot = (snap: DraftSnapshot) => onSnapshot(snap);
    const handleDelta = (delta: DraftDelta) => onDelta(delta);
    const handleBackfill = (deltas: DraftDelta[] = []) => {
      for (const d of deltas) onDelta(d);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io?.on?.('reconnect_attempt', onReconnecting);

    socket.on('draft:snapshot', handleSnapshot);
    socket.on('draft:delta', handleDelta);
    socket.on('draft:backfill', handleBackfill);

    if (socket.connected) join();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io?.off?.('reconnect_attempt', onReconnecting);

      socket.off('draft:snapshot', handleSnapshot);
      socket.off('draft:delta', handleDelta);
      socket.off('draft:backfill', handleBackfill);

      try {
        socket.emit('draft:leave', { draftId });
      } catch {
        /* noop */
      }
    };
  }, [socket, draftId, lastEventAt, onSnapshot, onDelta, setStatus]);
}

/* --------------------------------- Provider -------------------------------- */

export function DraftProvider({
  draftId,
  userId,
  initialSnapshot,
  children,
}: {
  draftId: string;
  userId: string;
  initialSnapshot?: DraftSnapshot | null;
  children: React.ReactNode;
}) {
  const socket = useSocket();
  const isMounted = useRef(true);
  const deltaQueueRef = useRef<DraftDelta[]>([]);
  const rafScheduledRef = useRef(false);

  const initial = useMemo<DraftState>(() => {
    const snap = normalizeSnapshot(initialSnapshot ?? null);
    return {
      draft: snap.draft,
      participants: snap.participants,
      picks: snap.picks,
      availablePlayers: snap.availablePlayers,
      liveState: snap.liveState,
      connection: { status: 'disconnected', lastEventAt: snap.ts },
      isLoading: !initialSnapshot,
      isSaving: false,
      error: null,
    };
  }, [initialSnapshot]);

  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // rAF-batched delta application
  const scheduleDeltaFlush = useCallback(() => {
    if (rafScheduledRef.current) return;
    rafScheduledRef.current = true;
    requestAnimationFrame(() => {
      rafScheduledRef.current = false;
      if (!isMounted.current) return;
      const deltas = deltaQueueRef.current.splice(0, deltaQueueRef.current.length);
      if (deltas.length) dispatch({ type: 'APPLY_DELTAS', deltas });
    });
  }, []);

  // Socket join + backfill
  useDraftSocket({
    socket,
    draftId,
    lastEventAt: state.connection.lastEventAt,
    onSnapshot: (snapshot) => {
      dispatch({ type: 'SET_SNAPSHOT', snapshot: normalizeSnapshot(snapshot) });
    },
    onDelta: (delta) => {
      deltaQueueRef.current.push(delta);
      scheduleDeltaFlush();
    },
    setStatus: (s) => dispatch({ type: 'SET_CONNECTION', status: s }),
  });

  /* ------------------------------- Action APIs ------------------------------ */

  const forceRefresh = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', loading: true });
    try {
      const res = await fetchApi(`drafts/${draftId}`);
      const snap = normalizeSnapshot(res?.data ?? res);
      if (!isMounted.current) return;
      dispatch({ type: 'SET_SNAPSHOT', snapshot: snap });
    } catch (err: any) {
      if (!isMounted.current) return;
      dispatch({
        type: 'SET_ERROR',
        error: err?.message ?? 'Failed to refresh draft state',
      });
    } finally {
      if (isMounted.current) dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [draftId]);

  const makePick = useCallback(
    async (playerId: string) => {
      if (!playerId || typeof playerId !== 'string') {
        dispatch({
          type: 'SET_ERROR',
          error: 'Invalid player ID provided',
        });
        return;
      }

      const playerExists = state.availablePlayers.some(p => String(p.id) === playerId);
      if (!playerExists) {
        dispatch({
          type: 'SET_ERROR',
          error: 'Player is not available for selection',
        });
        return;
      }

       dispatch({ type: 'SET_SAVING', saving: true });
       try {
         const res = await fetchApi(`drafts/${draftId}/picks`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ playerId }),
         });
         const pick: DraftPick | undefined = res?.data?.pick;
         if (pick) {
           const delta: DraftDelta = { type: 'PICK_MADE', payload: { pick }, ts: Date.now() };
           dispatch({ type: 'APPLY_DELTAS', deltas: [delta] });
         }
       } catch (err: any) {
         if (isMounted.current) {
           dispatch({
             type: 'SET_ERROR',
             error:
               err?.status === 409
                 ? 'That player was just drafted by someone else.'
                 : err?.status === 423
                 ? 'Not your turn to pick.'
                 : err?.message ?? 'Failed to make pick',
           });
         }
       } finally {
         if (isMounted.current) dispatch({ type: 'SET_SAVING', saving: false });
       }
     },
    [draftId, state.availablePlayers]
   );

  const updateQueue = useCallback(
    async (queue: string[]) => {
      if (!Array.isArray(queue)) {
        dispatch({
          type: 'SET_ERROR',
          error: 'Queue must be an array',
        });
        return;
      }

      const availableIds = new Set(state.availablePlayers.map(p => String(p.id)));
      const invalidIds = queue.filter(id => !availableIds.has(id));
      if (invalidIds.length > 0) {
        dispatch({
          type: 'SET_ERROR',
          error: `Invalid player IDs in queue: ${invalidIds.join(', ')}`,
        });
        return;
      }

      dispatch({ type: 'SET_SAVING', saving: true });
      try {
        await fetchApi(`drafts/${draftId}/pre-queue`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queue: Array.isArray(queue) ? queue : [] }),
        });

        const me = state.participants.find((p) => String((p as any).userId) === String(userId));
        const memberId = me ? String((me as any).id) : undefined;
        if (memberId) {
          const delta: DraftDelta = {
            type: 'QUEUE_UPDATED',
            payload: { memberId, queue: Array.isArray(queue) ? queue : [] },
            ts: Date.now(),
          };
          dispatch({ type: 'APPLY_DELTAS', deltas: [delta] });
        }
      } catch (err: any) {
        if (isMounted.current) {
          dispatch({
            type: 'SET_ERROR',
            error: err?.message ?? 'Failed to update queue',
          });
        }
      } finally {
        if (isMounted.current) dispatch({ type: 'SET_SAVING', saving: false });
      }
    },
    [draftId, state.participants, userId, state.availablePlayers]
  );

  /* ------------------------------- Derivations ------------------------------ */

  const me = useMemo(
    () => state.participants.find((p) => String((p as any).userId) === String(userId)),
    [state.participants, userId]
  );
  const yourSlot = me?.draftOrder ?? (me as any)?.slot;

  const canMakePick = useMemo(() => {
    if (!state.draft) return false;
    if (state.liveState?.isYourTurn) return true;

    const teamCount = state.participants.length;
    const currentPick = Number(
      (state.draft as any).currentPick ?? state.liveState?.currentPick ?? 0
    );
    const currentSlot = computeCurrentSlotFromSnake(currentPick, teamCount);
    const onClock = currentSlot && yourSlot && Number(currentSlot) === Number(yourSlot);

    const status = String((state.draft as any).status ?? '').toUpperCase();
    const live = status === 'LIVE' || status === 'IN_PROGRESS';

    return !!(live && onClock && !state.isSaving);
  }, [state.draft, state.liveState, state.participants.length, yourSlot, state.isSaving]);

  /* ------------------------------- Provide value ---------------------------- */

  const value: DraftContextValue = useMemo(
    () => ({
      draftId,
      userId,
      ...state,
      makePick,
      updateQueue,
      forceRefresh,
      canMakePick,
    }),
    [draftId, userId, state, makePick, updateQueue, forceRefresh, canMakePick]
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

/* ---------------------------------- Hook ----------------------------------- */

export function useDraft(): DraftContextValue {
  const ctx = useContext(DraftContext);
  if (!ctx) {
    throw new Error('useDraft must be used within a DraftProvider');
  }
  return ctx;
}
