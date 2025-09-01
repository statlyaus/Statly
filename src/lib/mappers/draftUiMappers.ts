import type { DraftState, DraftParticipant, DraftPick } from '@/types/draft';

function formatDateToIso(value: unknown): string {
  // Handle Date instances
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Handle Firestore Timestamps
  if (value && typeof value === 'object' && typeof (value as any).toDate === 'function') {
    return (value as any).toDate().toISOString();
  }

  // Handle plain objects with seconds/nanoseconds (Firestore timestamp-like)
  if (
    value &&
    typeof value === 'object' &&
    'seconds' in (value as any) &&
    'nanoseconds' in (value as any)
  ) {
    const { seconds, nanoseconds } = value as { seconds: number; nanoseconds: number };
    const date = new Date(seconds * 1000 + Math.floor(nanoseconds / 1e6));
    return date.toISOString();
  }

  // Handle string/number inputs
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return !isNaN(date.getTime()) ? date.toISOString() : String(value);
  }

  return String(value);
}

// Shapes expected by LivePickHeader and PickFeed components
export type LivePickHeaderData = {
  id: string;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  status: string;
  participants: Array<{
    slot: number;
    member: { id: string; userId: string; displayName: string; email: string };
  }>;
  picks: Array<{
    id: string;
    overall: number;
    round: number;
    slot: number;
    player: { id: string; name: string; position: string; club: string };
    member: { id: string; displayName: string };
    auto: boolean;
    madeAt: string;
  }>;
};

export function toLivePickHeaderData(
  draft: DraftState,
  participants: DraftParticipant[],
  picks: DraftPick[]
): LivePickHeaderData {
  return {
    id: draft.id,
    currentPick: draft.currentPick,
    totalPicks: draft.totalPicks,
    round: draft.round,
    direction: draft.direction,
    status: draft.status,
    participants: participants.map((p) => ({
      slot: p.draftOrder,
      member: { id: p.id, userId: p.userId, displayName: p.displayName, email: '' },
    })),
    picks: picks.map((pk) => ({
      id: pk.id,
      overall: pk.overall,
      round: pk.round,
      slot: pk.slot,
      player: {
        id: pk.player.id,
        name: pk.player.name,
        position: pk.player.position,
        club: pk.player.club,
      },
      member: { id: pk.member.id, displayName: pk.member.displayName },
      auto: pk.auto,
      madeAt: formatDateToIso(pk.madeAt),
    })),
  };
}

export type FeedPick = LivePickHeaderData['picks'][number];
export type FeedParticipant = LivePickHeaderData['participants'][number];

export function toFeedPicks(picks: DraftPick[]): FeedPick[] {
  return picks.map((pk) => ({
    id: pk.id,
    overall: pk.overall,
    round: pk.round,
    slot: pk.slot,
    player: {
      id: pk.player.id,
      name: pk.player.name,
      position: pk.player.position,
      club: pk.player.club,
    },
    member: { id: pk.member.id, displayName: pk.member.displayName },
    auto: pk.auto,
    madeAt: formatDateToIso(pk.madeAt),
  }));
}

export function toFeedParticipants(participants: DraftParticipant[]): FeedParticipant[] {
  return participants.map((p) => ({
    slot: p.draftOrder,
    member: { id: p.id, userId: p.userId, displayName: p.displayName, email: '' },
  }));
}

// Watchlist mappers
export interface WatchlistItem {
  playerId: string;
  rank: number;
  addedAt: string;
  notes?: string;
}

export type WatchlistEntry = {
  id: string;
  name: string;
  position: string;
  club: string;
  avgPoints?: number;
  drafted: boolean;
  watchlist: WatchlistItem;
};

export function toWatchlistEntries(
  players: import('@/types/draft').DraftPlayer[],
  watchlistItems: WatchlistItem[],
  draftedPlayerIds: string[]
): WatchlistEntry[] {
  const byId = new Map(
    players.filter((p) => typeof p.id === 'string' && p.id).map((p) => [p.id as string, p] as const)
  );
  const drafted = new Set(draftedPlayerIds.filter(Boolean).map(String));
  const result: WatchlistEntry[] = [];
  for (const w of watchlistItems) {
    if (!w.playerId) continue;
    const p = byId.get(String(w.playerId));
    if (!p) continue;
    result.push({
      id: p.id,
      name: p.name,
      position: p.position,
      club: p.club,
      avgPoints: p.avgPoints,
      drafted: drafted.has(p.id),
      watchlist: w,
    });
  }
  return result;
}

// (Optional) Analytics input normalization; keeps the mapping centralized even if currently minimal
export function toAnalyticsInput(
  draft: DraftState,
  picks: DraftPick[],
  participants: DraftParticipant[]
) {
  return { draft, picks, participants };
}
