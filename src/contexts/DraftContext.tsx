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
import { getSlotForOverallPick } from '@/lib/draftRoomSequencing';
import type { DraftOperationalReadiness } from '@/types/draftReadiness';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import type {
  DraftState as DraftCore,
  DraftPlayer,
  DraftPick,
  DraftParticipant,
} from '@/types/draft';

type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface DraftLiveState {
  onClockTeamId?: string;
  currentPick?: number;
  isYourTurn?: boolean;
}

export interface DraftSnapshot {
  draft: DraftCore | null;
  participants:
    | DraftParticipant[]
    | Record<string, DraftParticipant>
    | Map<string, DraftParticipant>;
  picks: DraftPick[] | Record<string, DraftPick> | Map<string, DraftPick>;
  availablePlayers?: DraftPlayer[] | Record<string, DraftPlayer> | Map<string, DraftPlayer>;
  draftReadiness?: DraftOperationalReadiness | null;
  selectedCategories?: FantasyCategoryKey[] | null;
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

export interface DraftWatchlistItem {
  id: string;
  playerId: string;
  priority: number;
  rank: number;
  addedAt: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  player: {
    id: string;
    name: string;
    position: string;
    club: string;
  };
}

interface DraftState {
  draft: DraftCore | null;
  participants: DraftParticipant[];
  picks: DraftPick[];
  availablePlayers: DraftPlayer[];
  draftReadiness: DraftOperationalReadiness | null;
  selectedCategories: FantasyCategoryKey[];
  watchlistItems: DraftWatchlistItem[];
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
  startDraft: () => Promise<void>;
  updateQueue: (queue: string[]) => Promise<void>;
  addToWatchlist: (playerId: string) => Promise<void>;
  removeFromWatchlist: (playerId: string) => Promise<void>;
  toggleWatchlist: (playerId: string) => Promise<void>;
  isInWatchlist: (playerId: string) => boolean;
  forceRefresh: () => Promise<void>;
  canMakePick: boolean;
}

const DraftContext = createContext<DraftContextValue | undefined>(undefined);
const PERSISTED_PICK_BACKFILL_INTERVAL_MS = 5000;
const PERSISTED_PICK_PAGE_SIZE = 200;

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

export function shouldHydrateAvailablePlayers(players: DraftPlayer[]): boolean {
  return (
    players.length === 0 ||
    players.some((player) => typeof player.statlyZScore !== 'number')
  );
}

export function shouldStartAvailablePlayerHydration(
  players: DraftPlayer[],
  isHydrating: boolean
): boolean {
  return !isHydrating && shouldHydrateAvailablePlayers(players);
}

export function excludeDraftedAvailablePlayers(
  players: DraftPlayer[],
  picks: DraftPick[]
): DraftPlayer[] {
  const draftedPlayerIds = getDraftedPlayerIds(picks);
  return players.filter((player) => !draftedPlayerIds.has(String(player.id)));
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function firstPresent<T>(...values: T[]): T | undefined {
  return values.find((value) => value !== undefined && value !== null);
}

function getParticipantDraftOrder(
  participant: Record<string, any>,
  member: Record<string, any>,
  index: number
): number {
  return Number(firstPresent(participant.draftOrder, participant.slot, member.draftOrder, index + 1)) || index + 1;
}

function normalizeParticipant(participant: any, index: number): DraftParticipant {
  const participantRecord = asRecord(participant);
  const member = asRecord(firstPresent(participantRecord.member, participantRecord));
  const draftOrder = getParticipantDraftOrder(participantRecord, member, index);
  const timeRemaining = firstPresent(participantRecord.timeRemaining, member.timeRemaining);
  const queue = firstPresent(participantRecord.queue, member.queue);

  return {
    id: String(firstPresent(member.id, participantRecord.id, `participant-${draftOrder}`)),
    userId: String(firstPresent(member.userId, participantRecord.userId, '')),
    displayName: String(firstPresent(member.displayName, participantRecord.displayName, `Team ${draftOrder}`)),
    teamName: firstPresent(member.teamName, participantRecord.teamName),
    draftOrder,
    isOnline: Boolean(firstPresent(participantRecord.isOnline, member.isOnline, false)),
    lastSeen: new Date(firstPresent(participantRecord.lastSeen, member.lastSeen, 0)),
    isCurrentTurn: Boolean(firstPresent(participantRecord.isCurrentTurn, member.isCurrentTurn, false)),
    timeRemaining: typeof timeRemaining === 'number' ? Number(timeRemaining) : undefined,
    queue: Array.isArray(queue) ? queue : [],
  };
}

function normalizeParticipants(raw: unknown): DraftParticipant[] {
  return toArray<any>(raw).map(normalizeParticipant);
}

function participantQueueIncluded(raw: unknown): boolean {
  return toArray<any>(raw).some((participant) => {
    const member = participant?.member ?? participant;
    return 'queue' in (participant ?? {}) || 'queue' in (member ?? {});
  });
}

function mergeParticipantQueues(
  nextParticipants: DraftParticipant[],
  previousParticipants: DraftParticipant[]
): DraftParticipant[] {
  const previousById = new Map(
    previousParticipants.map((participant) => [String(participant.id), participant.queue ?? []])
  );

  return nextParticipants.map((participant) => {
    const previousQueue = previousById.get(String(participant.id));
    return previousQueue ? { ...participant, queue: previousQueue } : participant;
  });
}

function toOptionalDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeDraftCore(raw: unknown): DraftCore | null {
  if (!raw || typeof raw !== 'object') return null;
  if (
    !('id' in (raw as Record<string, unknown>)) ||
    !('currentPick' in (raw as Record<string, unknown>))
  ) {
    return null;
  }

  const source = raw as Record<string, any>;
  const participants = toArray(source.participants);

  return {
    ...source,
    id: String(source.id),
    leagueId: String(source.leagueId ?? ''),
    name: String(source.name ?? 'Draft'),
    status: String(source.status ?? 'LOBBY') as DraftCore['status'],
    currentPick: Number(source.currentPick ?? 0),
    totalPicks: Number(source.totalPicks ?? 0),
    round: Number(source.round ?? 0),
    direction: String(source.direction ?? 'FORWARD') as DraftCore['direction'],
    pickDeadlineAt: source.pickDeadlineAt ? (toOptionalDate(source.pickDeadlineAt) ?? null) : null,
    settings: {
      name: String(source.settings?.name ?? source.name ?? 'Draft'),
      leagueId: String(source.settings?.leagueId ?? source.leagueId ?? ''),
      leagueSize: Number(source.settings?.leagueSize ?? participants.length),
      draftType: String(
        source.settings?.draftType ?? source.draftType ?? 'SNAKE'
      ) as DraftCore['settings']['draftType'],
      timePerPick: Number(source.settings?.timePerPick ?? source.timePerPick ?? 120),
      timeZone: String(source.settings?.timeZone ?? 'Australia/Melbourne'),
      enableReminders: Boolean(source.settings?.enableReminders ?? true),
      totalRounds: Number(source.settings?.totalRounds ?? 0),
      rosterSize: Number(source.settings?.rosterSize ?? 0),
      startingLineup:
        source.settings?.startingLineup && typeof source.settings.startingLineup === 'object'
          ? source.settings.startingLineup
          : {},
      benchSize: Number(source.settings?.benchSize ?? 0),
      allowTrades: Boolean(source.settings?.allowTrades ?? false),
      autoPickEnabled: Boolean(source.settings?.autoPickEnabled ?? true),
      pauseOnDisconnect: Boolean(source.settings?.pauseOnDisconnect ?? false),
      maxPauseDuration: Number(source.settings?.maxPauseDuration ?? 0),
    },
    createdAt: toOptionalDate(source.createdAt) ?? new Date(0),
    updatedAt: toOptionalDate(source.updatedAt) ?? new Date(0),
    lastActivity: toOptionalDate(source.lastActivity) ?? new Date(0),
    scheduledStart: toOptionalDate(source.scheduledStart),
    startedAt: toOptionalDate(source.startedAt),
    completedAt: toOptionalDate(source.completedAt),
    pausedAt: toOptionalDate(source.pausedAt),
    pausedBy: source.pausedBy ? String(source.pausedBy) : undefined,
  } as DraftCore;
}

function getPickOrder(pick: Partial<DraftPick>): number {
  return Number((pick as any).overall ?? (pick as any).pickNo ?? 0);
}

function normalizeSnapshot(raw?: DraftSnapshot | null): {
  draft: DraftCore | null;
  participants: DraftParticipant[];
  picks: DraftPick[];
  availablePlayers: DraftPlayer[];
  draftReadiness: DraftOperationalReadiness | null;
  selectedCategories: FantasyCategoryKey[];
  liveState: DraftLiveState;
  includesParticipantQueues: boolean;
  includesPicks: boolean;
  includesAvailablePlayers: boolean;
  ts?: number;
} {
  if (!raw) {
    return {
      draft: null,
      participants: [],
      picks: [],
      availablePlayers: [],
      draftReadiness: null,
      selectedCategories: [],
      liveState: {},
      includesParticipantQueues: false,
      includesPicks: false,
      includesAvailablePlayers: false,
    };
  }

  const draftLike = normalizeDraftCore(raw.draft ?? raw);

  const participants = normalizeParticipants((raw as any).participants);
  const includesParticipantQueues = participantQueueIncluded((raw as any).participants);
  const includesPicks = 'picks' in raw;
  const includesAvailablePlayers = 'availablePlayers' in raw;

  const picks = toArray<DraftPick>(raw.picks)
    .slice()
    .sort((a, b) => {
      return getPickOrder(a) - getPickOrder(b);
    });

  const pickedIds = new Set<string>(
    picks.map((pk) => String((pk as any).player?.id ?? (pk as any).playerId))
  );

  const availablePlayers = toArray<DraftPlayer>(raw.availablePlayers).filter(
    (pl) => !pickedIds.has(String(pl.id))
  );
  const selectedCategories = toArray<FantasyCategoryKey>((raw as any).selectedCategories);
  const draftReadiness =
    ((raw as any).draftReadiness as DraftOperationalReadiness | null | undefined) ?? null;

  return {
    draft: draftLike,
    participants,
    picks,
    availablePlayers,
    draftReadiness,
    selectedCategories,
    liveState: raw.liveState ?? {},
    includesParticipantQueues,
    includesPicks,
    includesAvailablePlayers,
    ts: raw.ts,
  };
}

function computeCurrentSlotFromSnake(currentPick: number, teamCount: number): number | undefined {
  const slot = getSlotForOverallPick(currentPick, teamCount);
  return slot > 0 ? slot : undefined;
}

function normalizeCommandPick(raw: unknown, participants: DraftParticipant[]): DraftPick | null {
  const pick = raw as Partial<DraftPick> & {
    player?: Partial<DraftPlayer>;
    member?: Partial<DraftPick['member']>;
    timestamp?: string | Date;
  };

  if (!pick?.id || !pick.player?.id || !pick.member?.id) {
    return null;
  }

  const participant = participants.find((entry) => String(entry.id) === String(pick.member?.id));

  return {
    id: String(pick.id),
    overall: Number(pick.overall ?? 0),
    round: Number(pick.round ?? 0),
    slot: Number(pick.slot ?? 0),
    player: {
      id: String(pick.player.id),
      name: String(pick.player.name ?? 'Unknown'),
      position: String(pick.player.position ?? 'NA'),
      club: String(pick.player.club ?? 'NA'),
      isAvailable: false,
      averagePoints:
        typeof pick.player.averagePoints === 'number' ? pick.player.averagePoints : undefined,
      avgPoints: typeof pick.player.avgPoints === 'number' ? pick.player.avgPoints : undefined,
      tier: typeof pick.player.tier === 'number' ? pick.player.tier : undefined,
      adp: typeof pick.player.adp === 'number' ? pick.player.adp : undefined,
      stats: pick.player.stats,
      statsTotal: pick.player.statsTotal,
      gamesPlayed:
        typeof pick.player.gamesPlayed === 'number' ? pick.player.gamesPlayed : undefined,
    },
    member: {
      id: String(pick.member.id),
      userId: String(pick.member.userId ?? participant?.userId ?? ''),
      displayName: String(pick.member.displayName ?? participant?.displayName ?? 'Unknown'),
      teamName: String(pick.member.teamName ?? participant?.teamName ?? ''),
    },
    auto: Boolean(pick.auto),
    madeAt: new Date(pick.madeAt ?? pick.timestamp ?? Date.now()),
    timeToMake: typeof pick.timeToMake === 'number' ? pick.timeToMake : undefined,
  };
}

function preserveDraftLeagueAffiliation(
  incomingDraft: DraftCore | null,
  currentDraft: DraftCore | null
): DraftCore | null {
  if (!incomingDraft || !currentDraft?.leagueId || incomingDraft.leagueId) {
    return incomingDraft;
  }

  return {
    ...incomingDraft,
    leagueId: currentDraft.leagueId,
    settings: {
      ...incomingDraft.settings,
      leagueId:
        incomingDraft.settings?.leagueId ||
        currentDraft.settings?.leagueId ||
        currentDraft.leagueId,
    },
  };
}

function getLatestPickMadeAtMs(picks: DraftPick[]): number | undefined {
  const latest = picks.reduce((max, pick) => {
    const madeAt = pick.madeAt instanceof Date ? pick.madeAt : new Date(pick.madeAt);
    const ts = madeAt.getTime();
    return Number.isFinite(ts) ? Math.max(max, ts) : max;
  }, 0);

  return latest > 0 ? latest : undefined;
}

function getExpectedPersistedPickCount(draft: DraftCore | null): number {
  if (!draft) return 0;

  const summaryCount = Number((draft as any).picksSummary?.count ?? 0);
  if (Number.isFinite(summaryCount) && summaryCount > 0) {
    return summaryCount;
  }

  const totalPicks = Number(draft.totalPicks ?? 0);
  const currentPick = Number(draft.currentPick ?? 0);
  const status = String(draft.status ?? '').toUpperCase();

  if (status === 'COMPLETED') {
    return Number.isFinite(totalPicks) && totalPicks > 0 ? totalPicks : Math.max(0, currentPick - 1);
  }

  if (status === 'LIVE' || status === 'IN_PROGRESS') {
    const completedPicks = Math.max(0, currentPick - 1);
    return Number.isFinite(totalPicks) && totalPicks > 0
      ? Math.min(completedPicks, totalPicks)
      : completedPicks;
  }

  return 0;
}

function shouldHydratePersistedPicks(draft: DraftCore | null, picks: DraftPick[]): boolean {
  return getExpectedPersistedPickCount(draft) > picks.length;
}

function buildPersistedPickBackfillEndpoint(draftId: string, sinceMs?: number): string {
  if (!sinceMs) {
    return `drafts/${draftId}/picks?pageSize=100`;
  }

  return `drafts/${draftId}/picks?since=${encodeURIComponent(
    new Date(sinceMs).toISOString()
  )}&pageSize=100`;
}

function isLiveDraftStatus(status: unknown): boolean {
  const normalizedStatus = String(status ?? '').toUpperCase();
  return normalizedStatus === 'LIVE' || normalizedStatus === 'IN_PROGRESS';
}

function getPersistedPickBackfillSinceMs(input: {
  draft: DraftCore;
  picks: DraftPick[];
  lastEventAt?: number;
}): number | undefined {
  const shouldLoadInitialPersistedPicks =
    input.picks.length === 0 && Number(input.draft.currentPick ?? 0) > 1;

  if (shouldLoadInitialPersistedPicks) {
    return undefined;
  }

  const sinceMs = getLatestPickMadeAtMs(input.picks) ?? input.lastEventAt;
  return sinceMs !== undefined && Number.isFinite(sinceMs) ? sinceMs : undefined;
}

function buildPersistedPickBackfillDeltas(input: {
  rawPicks: unknown[];
  existingPicks: DraftPick[];
  participants: DraftParticipant[];
  lastEventAt?: number;
  loadInitialPicks: boolean;
}): DraftDelta[] {
  const existingPickIds = new Set(input.existingPicks.map((pick) => String(pick.id)));

  return input.rawPicks.flatMap((rawPick) => {
    const pick = normalizeCommandPick(rawPick, input.participants);
    if (!pick || existingPickIds.has(String(pick.id))) return [];

    const madeAtMs = pick.madeAt.getTime();
    const ts =
      input.loadInitialPicks
        ? Math.max(
            Number.isFinite(madeAtMs) ? madeAtMs : 0,
            input.lastEventAt ?? 0,
            Date.now()
          )
        : Number.isFinite(madeAtMs)
          ? madeAtMs
          : Date.now();

    return [
      {
        type: 'PICK_MADE' as const,
        payload: { pick },
        ts,
      },
    ];
  });
}

function buildDraftStateBackfillDelta(rawDraftState: unknown): DraftDelta | null {
  const source = asRecord(rawDraftState);
  const draftPatch: Partial<DraftCore> = {};
  const livePatch: DraftLiveState = {};

  if (typeof source.currentPick === 'number' && Number.isFinite(source.currentPick)) {
    draftPatch.currentPick = source.currentPick;
    livePatch.currentPick = source.currentPick;
  }

  if (typeof source.status === 'string') {
    draftPatch.status = source.status as DraftCore['status'];
  }

  if (typeof source.round === 'number' && Number.isFinite(source.round)) {
    draftPatch.round = source.round;
  }

  if (typeof source.direction === 'string') {
    draftPatch.direction = source.direction as DraftCore['direction'];
  }

  if ('pickDeadlineAt' in source) {
    draftPatch.pickDeadlineAt = source.pickDeadlineAt
      ? (toOptionalDate(source.pickDeadlineAt) ?? null)
      : null;
  }

  if (Object.keys(draftPatch).length === 0 && Object.keys(livePatch).length === 0) {
    return null;
  }

  return {
    type: 'STATE_PATCH',
    payload: {
      draft: draftPatch,
      liveState: livePatch,
    },
    ts: Date.now(),
  };
}

/* --------------------------------- Reducer --------------------------------- */

type Action =
  | { type: 'SET_SNAPSHOT'; snapshot: ReturnType<typeof normalizeSnapshot> }
  | {
      type: 'SET_AVAILABLE_PLAYERS';
      players: DraftPlayer[];
      selectedCategories?: FantasyCategoryKey[];
      draftReadiness?: DraftOperationalReadiness | null;
    }
  | { type: 'SET_WATCHLIST'; items: DraftWatchlistItem[] }
  | { type: 'SET_PERSISTED_PICKS'; picks: DraftPick[] }
  | { type: 'APPLY_DELTAS'; deltas: DraftDelta[] }
  | { type: 'SET_CONNECTION'; status: ConnectionStatus; latencyMs?: number }
  | { type: 'SET_SAVING'; saving: boolean }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null };

type NormalizedDraftSnapshot = ReturnType<typeof normalizeSnapshot>;

function shouldIgnoreSnapshot(state: DraftState, snapshot: NormalizedDraftSnapshot): boolean {
  const incomingTs = snapshot.ts;
  const lastEventAt = state.connection.lastEventAt ?? 0;
  return Boolean(incomingTs && incomingTs < lastEventAt);
}

function applySnapshotState(state: DraftState, snapshot: NormalizedDraftSnapshot): DraftState {
  if (shouldIgnoreSnapshot(state, snapshot)) {
    return { ...state, isLoading: false };
  }

  const draft = preserveDraftLeagueAffiliation(snapshot.draft, state.draft);
  const participants = snapshot.includesParticipantQueues
    ? snapshot.participants
    : mergeParticipantQueues(snapshot.participants, state.participants);

  return {
    ...state,
    draft,
    participants,
    picks: snapshot.includesPicks ? snapshot.picks : state.picks,
    availablePlayers: snapshot.includesAvailablePlayers
      ? snapshot.availablePlayers
      : state.availablePlayers,
    draftReadiness: snapshot.draftReadiness ?? state.draftReadiness,
    selectedCategories:
      snapshot.selectedCategories.length > 0
        ? snapshot.selectedCategories
        : state.selectedCategories,
    liveState: snapshot.liveState,
    isLoading: false,
    error: null,
    connection: {
      ...state.connection,
      lastEventAt: snapshot.ts ?? state.connection.lastEventAt,
    },
  };
}

function mergePersistedPicks(existing: DraftPick[], incoming: DraftPick[]): DraftPick[] {
  const picksById = new Map<string, DraftPick>();
  for (const pick of existing) picksById.set(String(pick.id), pick);
  for (const pick of incoming) picksById.set(String(pick.id), pick);
  return Array.from(picksById.values()).sort((a, b) => getPickOrder(a) - getPickOrder(b));
}

function getDraftedPlayerIds(picks: DraftPick[]): Set<string> {
  return new Set(picks.map((pick) => String((pick as any).player?.id ?? (pick as any).playerId)));
}

function applyPersistedPicksState(state: DraftState, incomingPicks: DraftPick[]): DraftState {
  const picks = mergePersistedPicks(state.picks, incomingPicks);
  const draftedPlayerIds = getDraftedPlayerIds(picks);

  return {
    ...state,
    picks,
    availablePlayers: state.availablePlayers.filter(
      (player) => !draftedPlayerIds.has(String(player.id))
    ),
    error: null,
  };
}

function applyDelta(state: DraftState, delta: DraftDelta): DraftState {
  const ts = delta.ts ?? Date.now();
  const lastEventAt = state.connection.lastEventAt ?? 0;
  if (ts < lastEventAt) {
    return state;
  }

  let next = { ...state, connection: { ...state.connection, lastEventAt: ts } };

  switch (delta.type) {
    case 'SNAPSHOT': {
      const snap = normalizeSnapshot(delta.payload as DraftSnapshot);
      const draft = preserveDraftLeagueAffiliation(snap.draft, next.draft);
      return {
        ...next,
        draft,
        participants: snap.participants,
        picks: snap.includesPicks ? snap.picks : next.picks,
        availablePlayers: snap.includesAvailablePlayers ? snap.availablePlayers : next.availablePlayers,
        draftReadiness: snap.draftReadiness,
        liveState: snap.liveState,
        error: null,
        isLoading: false,
        connection: { ...next.connection, lastEventAt: snap.ts ?? ts },
      };
    }
    case 'PICK_MADE': {
      const payload = delta.payload as {
        pick?: unknown;
        currentPick?: unknown;
        isComplete?: unknown;
        status?: unknown;
        round?: unknown;
        direction?: unknown;
        pickStartedAt?: unknown;
        pickDeadlineAt?: unknown;
      };
      const rawPick = payload?.pick;
      const pick = normalizeCommandPick(rawPick, next.participants);
      if (!pick) return next;
      const picks = [
        ...next.picks.filter((existing) => String(existing.id) !== String(pick.id)),
        pick,
      ].sort((a, b) => {
        return getPickOrder(a) - getPickOrder(b);
      });
      const pid = String((pick as any).player?.id ?? (pick as any).playerId);
      const availablePlayers = next.availablePlayers.filter((p) => String(p.id) !== pid);
      const participants = next.participants.map((participant) => ({
        ...participant,
        queue: Array.isArray(participant.queue)
          ? participant.queue.filter((queuedId) => String(queuedId) !== pid)
          : [],
      }));
      const nextCurrentPick =
        typeof payload.currentPick === 'number' && Number.isFinite(payload.currentPick)
          ? payload.currentPick
          : undefined;
      const isComplete = payload.isComplete === true;
      const nextStatus =
        typeof payload.status === 'string' ? payload.status : isComplete ? 'COMPLETED' : undefined;
      const draft = next.draft
        ? {
            ...next.draft,
            ...(nextCurrentPick !== undefined ? { currentPick: nextCurrentPick } : {}),
            ...(nextStatus ? { status: nextStatus as DraftCore['status'] } : {}),
            ...(typeof payload.round === 'number' && Number.isFinite(payload.round)
              ? { round: payload.round }
              : {}),
            ...(typeof payload.direction === 'string'
              ? { direction: payload.direction as DraftCore['direction'] }
              : {}),
            ...(payload.pickStartedAt !== undefined
              ? {
                  pickStartedAt:
                    payload.pickStartedAt === null
                      ? null
                      : (toOptionalDate(payload.pickStartedAt) ?? null),
                }
              : {}),
            ...(payload.pickDeadlineAt !== undefined
              ? {
                  pickDeadlineAt:
                    payload.pickDeadlineAt === null
                      ? null
                      : (toOptionalDate(payload.pickDeadlineAt) ?? next.draft.pickDeadlineAt ?? null),
                }
              : {}),
          }
        : next.draft;
      const liveState =
        nextCurrentPick !== undefined
          ? { ...next.liveState, currentPick: nextCurrentPick }
          : next.liveState;
      return { ...next, draft, liveState, picks, availablePlayers, participants };
    }
    case 'PLAYER_REMOVED': {
      const { playerId } = delta.payload as { playerId: string };
      if (!playerId) return next;
      return {
        ...next,
        participants: next.participants.map((participant) => ({
          ...participant,
          queue: Array.isArray(participant.queue)
            ? participant.queue.filter((queuedId) => String(queuedId) !== String(playerId))
            : [],
        })),
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
      const { memberId, userId, queue } = delta.payload as {
        memberId?: string;
        userId?: string;
        queue: string[];
      };
      const participants = next.participants.map((m) =>
        (memberId && String((m as any).id) === String(memberId)) ||
        (userId && String((m as any).userId) === String(userId))
          ? { ...m, queue: Array.isArray(queue) ? queue : [] }
          : m
      );
      return { ...next, participants };
    }
    case 'STATE_PATCH': {
      const { draft: draftPatch, liveState: livePatch } = (delta.payload ??
        {}) as Partial<DraftState>;
      return {
        ...next,
        draft:
          draftPatch && next.draft
            ? normalizeDraftCore({ ...next.draft, ...draftPatch })
            : draftPatch
              ? normalizeDraftCore(draftPatch)
              : next.draft,
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
      return applySnapshotState(state, action.snapshot);
    case 'SET_AVAILABLE_PLAYERS':
      return {
        ...state,
        availablePlayers: excludeDraftedAvailablePlayers(action.players, state.picks),
        draftReadiness: action.draftReadiness ?? state.draftReadiness,
        selectedCategories: action.selectedCategories ?? state.selectedCategories,
        error: null,
      };
    case 'SET_WATCHLIST':
      return {
        ...state,
        watchlistItems: action.items,
        error: null,
      };
    case 'SET_PERSISTED_PICKS':
      return applyPersistedPicksState(state, action.picks);
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
  const lastEventAtRef = useRef(lastEventAt);

  useEffect(() => {
    lastEventAtRef.current = lastEventAt;
  }, [lastEventAt]);

  useEffect(() => {
    if (!socket) return;

    const join = () => {
      setStatus('connected');
      socket.emit('draft:join', { draftId });
      socket.emit('draft:backfill', { draftId, since: lastEventAtRef.current ?? 0 });
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
  }, [socket, draftId, onSnapshot, onDelta, setStatus]);
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
  const hydratedQueueMemberIdRef = useRef<string | null>(null);
  const initialHydrateStartedRef = useRef(Boolean(initialSnapshot));
  const availablePlayersHydratingRef = useRef(false);
  const persistedPickHydratingRef = useRef(false);

  const initial = useMemo<DraftState>(() => {
    const snap = normalizeSnapshot(initialSnapshot ?? null);
    return {
      draft: snap.draft,
      participants: snap.participants,
      picks: snap.picks,
      availablePlayers: snap.availablePlayers,
      draftReadiness: snap.draftReadiness,
      selectedCategories: snap.selectedCategories,
      watchlistItems: [],
      liveState: snap.liveState,
      connection: { status: 'disconnected', lastEventAt: snap.ts },
      isLoading: !initialSnapshot,
      isSaving: false,
      error: null,
    };
  }, [initialSnapshot]);

  const [state, dispatch] = useReducer(reducer, initial);

  const memberId = useMemo(() => {
    const me = state.participants.find(
      (participant) => String((participant as any).userId) === String(userId)
    );
    return me ? String((me as any).id) : null;
  }, [state.participants, userId]);

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

  // Stable callbacks for socket handlers
  const handleSnapshot = useCallback((snapshot: DraftSnapshot) => {
    dispatch({ type: 'SET_SNAPSHOT', snapshot: normalizeSnapshot(snapshot) });
  }, []);

  const handleDelta = useCallback(
    (delta: DraftDelta) => {
      deltaQueueRef.current.push(delta);
      scheduleDeltaFlush();
    },
    [scheduleDeltaFlush]
  );

  const handleStatusChange = useCallback((s: ConnectionStatus) => {
    dispatch({ type: 'SET_CONNECTION', status: s });
  }, []);

  // Socket join + backfill
  useDraftSocket({
    socket,
    draftId,
    lastEventAt: state.connection.lastEventAt,
    onSnapshot: handleSnapshot,
    onDelta: handleDelta,
    setStatus: handleStatusChange,
  });

  const hydrateAvailablePlayers = useCallback(async () => {
    if (availablePlayersHydratingRef.current) return;

    availablePlayersHydratingRef.current = true;

    try {
      const pageSize = 100;
      let page = 1;
      let hasMore = true;
      const allPlayers: DraftPlayer[] = [];
      let selectedCategories: FantasyCategoryKey[] = [];
      let draftReadiness: DraftOperationalReadiness | null = null;

      while (hasMore) {
        const res = await fetchApi(`drafts/${draftId}/players?page=${page}&pageSize=${pageSize}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        const players = toArray<DraftPlayer>(res?.data?.players ?? res?.players);
        draftReadiness =
          (res?.data?.draftReadiness as DraftOperationalReadiness | null | undefined) ??
          draftReadiness;
        if (page === 1) {
          selectedCategories = toArray<FantasyCategoryKey>(
            res?.data?.selectedCategories ?? res?.selectedCategories
          );
        }

        if (players.length > 0) {
          allPlayers.push(...players);
        }

        if (page === 1 && players.length > 0 && isMounted.current) {
          dispatch({
            type: 'SET_AVAILABLE_PLAYERS',
            players: allPlayers,
            selectedCategories,
            draftReadiness,
          });
        }

        hasMore = Boolean(res?.data?.pagination?.hasMore) && players.length > 0;
        page += 1;
      }

      if (!isMounted.current) return;
      dispatch({
        type: 'SET_AVAILABLE_PLAYERS',
        players: allPlayers,
        selectedCategories,
        draftReadiness,
      });
    } catch {
      // Keep the draft usable even if the player pool hydrate fails.
    } finally {
      availablePlayersHydratingRef.current = false;
    }
  }, [draftId]);

  const hydrateMyQueue = useCallback(
    async (targetMemberId: string) => {
      try {
        const res = await fetchApi(
          `drafts/${draftId}/pre-queue?memberId=${encodeURIComponent(targetMemberId)}`
        );
        const persistedQueue = toArray<any>(res?.data?.queue ?? res?.queue)
          .slice()
          .sort((a, b) => Number(a?.rank ?? 0) - Number(b?.rank ?? 0))
          .map((item) => String(item?.playerId))
          .filter(Boolean);

        if (!isMounted.current) return;

        dispatch({
          type: 'APPLY_DELTAS',
          deltas: [
            {
              type: 'QUEUE_UPDATED',
              payload: { memberId: targetMemberId, queue: persistedQueue },
              ts: Date.now(),
            },
          ],
        });
      } catch {
        // Queue hydration is best-effort; keep the room usable if it fails.
      }
    },
    [draftId]
  );

  const hydrateMyWatchlist = useCallback(
    async (targetMemberId: string) => {
      try {
        const res = await fetchApi(
          `drafts/${draftId}/watchlist?memberId=${encodeURIComponent(targetMemberId)}`
        );
        const items = toArray<
          Omit<DraftWatchlistItem, 'rank' | 'addedAt'> & {
            rank?: number;
            addedAt?: string;
          }
        >(res?.data?.watchlist ?? res?.watchlist)
          .map((item) => ({
            ...item,
            rank: Number(item.rank ?? item.priority ?? 0),
            addedAt: item.addedAt ?? item.createdAt ?? new Date().toISOString(),
          }))
          .sort((a, b) => Number(a?.rank ?? 0) - Number(b?.rank ?? 0));

        if (!isMounted.current) return;
        dispatch({ type: 'SET_WATCHLIST', items });
      } catch {
        // Watchlist hydration is best-effort; keep the room usable if it fails.
      }
    },
    [draftId]
  );

  const hydratePersistedPickPages = useCallback(async () => {
    if (!state.draft || persistedPickHydratingRef.current) return;

    const expectedPickCount = getExpectedPersistedPickCount(state.draft);
    if (expectedPickCount <= state.picks.length) return;

    persistedPickHydratingRef.current = true;

    try {
      const persistedPicks: DraftPick[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore && persistedPicks.length < expectedPickCount) {
        const res = await fetchApi(
          `drafts/${draftId}/picks?page=${page}&pageSize=${PERSISTED_PICK_PAGE_SIZE}`,
          {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          }
        );
        const rawPicks = toArray<unknown>(res?.data?.picks ?? res?.picks);
        const normalizedPicks = rawPicks.flatMap((rawPick) => {
          const pick = normalizeCommandPick(rawPick, state.participants);
          return pick ? [pick] : [];
        });

        persistedPicks.push(...normalizedPicks);

        hasMore =
          Boolean(res?.data?.pagination?.hasMore) &&
          rawPicks.length > 0 &&
          normalizedPicks.length > 0;
        page += 1;
      }

      if (!isMounted.current || persistedPicks.length === 0) return;

      dispatch({ type: 'SET_PERSISTED_PICKS', picks: persistedPicks });
    } catch {
      // Persisted picks are a catch-up path; keep socket and draft controls usable if it fails.
    } finally {
      persistedPickHydratingRef.current = false;
    }
  }, [draftId, state.draft, state.participants, state.picks.length]);

  useEffect(() => {
    if (
      !state.draft ||
      !shouldStartAvailablePlayerHydration(
        state.availablePlayers,
        availablePlayersHydratingRef.current
      )
    ) {
      return;
    }
    void hydrateAvailablePlayers();
  }, [state.draft, state.availablePlayers, hydrateAvailablePlayers]);

  useEffect(() => {
    if (!shouldHydratePersistedPicks(state.draft, state.picks)) return;
    void hydratePersistedPickPages();
  }, [hydratePersistedPickPages, state.draft, state.picks]);

  useEffect(() => {
    if (!memberId) return;
    const hydrationKey = `${draftId}:${memberId}`;
    if (hydratedQueueMemberIdRef.current === hydrationKey) return;

    hydratedQueueMemberIdRef.current = hydrationKey;
    void Promise.all([hydrateMyQueue(memberId), hydrateMyWatchlist(memberId)]);
  }, [draftId, memberId, hydrateMyQueue, hydrateMyWatchlist]);

  /* ------------------------------- Action APIs ------------------------------ */

  const forceRefresh = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', loading: true });
    try {
      const res = await fetchApi(`drafts/${draftId}`);
      const snap = normalizeSnapshot(res?.data ?? res);
      if (!isMounted.current) return;
      dispatch({ type: 'SET_SNAPSHOT', snapshot: snap });
      if (
        snap.draft &&
        shouldStartAvailablePlayerHydration(
          snap.availablePlayers,
          availablePlayersHydratingRef.current
        )
      ) {
        await hydrateAvailablePlayers();
      }
      if (memberId) {
        await Promise.all([hydrateMyQueue(memberId), hydrateMyWatchlist(memberId)]);
      }
    } catch (err: any) {
      if (!isMounted.current) return;
      dispatch({
        type: 'SET_ERROR',
        error: err?.message ?? 'Failed to refresh draft state',
      });
    } finally {
      if (isMounted.current) dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [draftId, hydrateAvailablePlayers, hydrateMyQueue, hydrateMyWatchlist, memberId]);

  const fetchPersistedPickBackfill = useCallback(async () => {
    if (!state.draft) return;

    if (!isLiveDraftStatus(state.draft.status)) return;

    const shouldLoadInitialPersistedPicks =
      state.picks.length === 0 && Number(state.draft.currentPick ?? 0) > 1;
    const sinceMs = getPersistedPickBackfillSinceMs({
      draft: state.draft,
      picks: state.picks,
      lastEventAt: state.connection.lastEventAt,
    });

    try {
      const res = await fetchApi(buildPersistedPickBackfillEndpoint(draftId, sinceMs));
      const persistedPicks = toArray<unknown>(res?.data?.picks ?? res?.picks);
      const draftStateDelta = buildDraftStateBackfillDelta(res?.data?.draftState ?? res?.draftState);
      if (persistedPicks.length === 0) return;

      const deltas = buildPersistedPickBackfillDeltas({
        rawPicks: persistedPicks,
        existingPicks: state.picks,
        participants: state.participants,
        lastEventAt: state.connection.lastEventAt,
        loadInitialPicks: shouldLoadInitialPersistedPicks,
      });

      if (!isMounted.current || deltas.length === 0) return;

      dispatch({
        type: 'APPLY_DELTAS',
        deltas: draftStateDelta ? [...deltas, draftStateDelta] : deltas,
      });

      if (!draftStateDelta) {
        await forceRefresh();
      }
    } catch {
      // Socket delivery is still primary; persisted-pick polling is a silent catch-up path.
    }
  }, [
    draftId,
    forceRefresh,
    state.connection.lastEventAt,
    state.draft,
    state.participants,
    state.picks,
  ]);

  useEffect(() => {
    if (initialHydrateStartedRef.current || initialSnapshot || state.draft) return;

    initialHydrateStartedRef.current = true;
    void forceRefresh();
  }, [forceRefresh, initialSnapshot, state.draft]);

  useEffect(() => {
    if (!state.draft) return;

    const status = String(state.draft.status ?? '').toUpperCase();
    if (status !== 'LIVE' && status !== 'IN_PROGRESS') return;

    const intervalId = window.setInterval(() => {
      void fetchPersistedPickBackfill();
    }, PERSISTED_PICK_BACKFILL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [fetchPersistedPickBackfill, state.draft]);

  const startDraft = useCallback(async () => {
    dispatch({ type: 'SET_SAVING', saving: true });
    try {
      await fetchApi(`drafts/${draftId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      await forceRefresh();
    } catch (err: any) {
      if (isMounted.current) {
        dispatch({
          type: 'SET_ERROR',
          error: err?.message ?? 'Failed to start draft',
        });
      }
    } finally {
      if (isMounted.current) dispatch({ type: 'SET_SAVING', saving: false });
    }
  }, [draftId, forceRefresh]);

  const makePick = useCallback(
    async (playerId: string) => {
      if (!playerId || typeof playerId !== 'string') {
        dispatch({
          type: 'SET_ERROR',
          error: 'Invalid player ID provided',
        });
        return;
      }

      const playerExists = state.availablePlayers.some((p) => String(p.id) === playerId);
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
        const pick = normalizeCommandPick(res?.data?.pick ?? res?.pick, state.participants);
        if (pick) {
          const commandData = res?.data ?? res ?? {};
          const delta: DraftDelta = {
            type: 'PICK_MADE',
            payload: {
              pick,
              currentPick: commandData.currentPick,
              isComplete: commandData.isComplete,
              status: commandData.status,
              round: commandData.round,
              direction: commandData.direction,
              pickStartedAt: commandData.pickStartedAt,
              pickDeadlineAt: commandData.pickDeadlineAt,
            },
            ts: Date.now(),
          };
          dispatch({ type: 'APPLY_DELTAS', deltas: [delta] });
        } else if (isMounted.current) {
          dispatch({
            type: 'SET_ERROR',
            error: 'Draft pick succeeded but returned an invalid payload. Refresh the room.',
          });
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
                  : (err?.message ?? 'Failed to make pick'),
          });
        }
      } finally {
        if (isMounted.current) dispatch({ type: 'SET_SAVING', saving: false });
      }
    },
    [draftId, state.availablePlayers, state.participants]
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

      const availableIds = new Set(state.availablePlayers.map((p) => String(p.id)));
      const invalidIds = queue.filter((id) => !availableIds.has(id));
      if (invalidIds.length > 0) {
        dispatch({
          type: 'SET_ERROR',
          error: `Invalid player IDs in queue: ${invalidIds.join(', ')}`,
        });
        return;
      }

      const me = state.participants.find((p) => String((p as any).userId) === String(userId));
      const memberId = me ? String((me as any).id) : undefined;
      if (!memberId) {
        dispatch({
          type: 'SET_ERROR',
          error: 'Unable to identify your draft membership',
        });
        return;
      }

      dispatch({ type: 'SET_SAVING', saving: true });
      try {
        const queuePayload = queue.map((playerId, index) => ({
          playerId,
          rank: index + 1,
        }));

        const res = await fetchApi(`drafts/${draftId}/pre-queue`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            memberId,
            queue: queuePayload,
          }),
        });

        const persistedQueue = toArray<any>(res?.data?.queue ?? res?.queue)
          .slice()
          .sort((a, b) => Number(a?.rank ?? 0) - Number(b?.rank ?? 0))
          .map((item) => String(item?.playerId))
          .filter(Boolean);

        const delta: DraftDelta = {
          type: 'QUEUE_UPDATED',
          payload: { memberId, queue: persistedQueue },
          ts: Date.now(),
        };
        dispatch({ type: 'APPLY_DELTAS', deltas: [delta] });
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

  const addToWatchlist = useCallback(
    async (playerId: string) => {
      const player = state.availablePlayers.find((entry) => String(entry.id) === String(playerId));
      if (!player) {
        dispatch({
          type: 'SET_ERROR',
          error: 'Player is not available to add to watchlist',
        });
        return;
      }

      if (!memberId) {
        dispatch({
          type: 'SET_ERROR',
          error: 'Unable to identify your draft membership',
        });
        return;
      }

      if (state.watchlistItems.some((item) => String(item.playerId) === String(playerId))) {
        return;
      }

      dispatch({ type: 'SET_SAVING', saving: true });
      try {
        const nextPriority =
          Math.max(0, ...state.watchlistItems.map((item) => Number(item.priority ?? 0))) + 1;

        await fetchApi(`drafts/${draftId}/watchlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            memberId,
            playerId,
            priority: nextPriority,
          }),
        });

        await hydrateMyWatchlist(memberId);
      } catch (err: any) {
        if (isMounted.current) {
          dispatch({
            type: 'SET_ERROR',
            error: err?.message ?? 'Failed to add player to watchlist',
          });
        }
      } finally {
        if (isMounted.current) dispatch({ type: 'SET_SAVING', saving: false });
      }
    },
    [draftId, hydrateMyWatchlist, memberId, state.availablePlayers, state.watchlistItems]
  );

  const removeFromWatchlist = useCallback(
    async (playerId: string) => {
      if (!memberId) {
        dispatch({
          type: 'SET_ERROR',
          error: 'Unable to identify your draft membership',
        });
        return;
      }

      dispatch({ type: 'SET_SAVING', saving: true });
      try {
        await fetchApi(
          `drafts/${draftId}/watchlist?memberId=${encodeURIComponent(memberId)}&playerId=${encodeURIComponent(playerId)}`,
          { method: 'DELETE' }
        );

        dispatch({
          type: 'SET_WATCHLIST',
          items: state.watchlistItems.filter((item) => String(item.playerId) !== String(playerId)),
        });
      } catch (err: any) {
        if (isMounted.current) {
          dispatch({
            type: 'SET_ERROR',
            error: err?.message ?? 'Failed to remove player from watchlist',
          });
        }
      } finally {
        if (isMounted.current) dispatch({ type: 'SET_SAVING', saving: false });
      }
    },
    [draftId, memberId, state.watchlistItems]
  );

  const toggleWatchlist = useCallback(
    async (playerId: string) => {
      if (state.watchlistItems.some((item) => String(item.playerId) === String(playerId))) {
        await removeFromWatchlist(playerId);
        return;
      }

      await addToWatchlist(playerId);
    },
    [addToWatchlist, removeFromWatchlist, state.watchlistItems]
  );

  const isInWatchlist = useCallback(
    (playerId: string) =>
      state.watchlistItems.some((item) => String(item.playerId) === String(playerId)),
    [state.watchlistItems]
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
      startDraft,
      updateQueue,
      addToWatchlist,
      removeFromWatchlist,
      toggleWatchlist,
      isInWatchlist,
      forceRefresh,
      canMakePick,
    }),
    [
      addToWatchlist,
      canMakePick,
      draftId,
      forceRefresh,
      isInWatchlist,
      makePick,
      removeFromWatchlist,
      startDraft,
      state,
      toggleWatchlist,
      updateQueue,
      userId,
    ]
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
