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
  pickDeadlineAt?: string | null;
  participants: Array<{
    slot: number;
    member: { id: string; userId: string; displayName: string; email: string; teamName?: string };
  }>;
  picks: Array<{
    id: string;
    overall: number;
    round: number;
    slot: number;
    player: { id: string; name: string; position: string; club: string };
    member: { id: string; displayName: string; teamName?: string };
    auto: boolean;
    madeAt: string;
  }>;
};

export type DraftPickTrainSlot = {
  overall: number;
  round: number;
  slot: number;
  status: 'completed' | 'current' | 'upcoming';
  isUserPick: boolean;
  displayName: string;
  teamName?: string;
  player?: {
    id: string;
    name: string;
    position: string;
    club: string;
  };
};

export type DraftPickTrainState = {
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  slots: DraftPickTrainSlot[];
};

type DraftPickTrainParticipant = {
  slot: number;
  member: {
    id: string;
    userId?: string;
    displayName: string;
    email?: string;
    teamName?: string;
  };
};

type DraftPickTrainPick = {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player: {
    id: string;
    name: string;
    position: string;
    club: string;
  };
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
    pickDeadlineAt: draft.pickDeadlineAt ? formatDateToIso(draft.pickDeadlineAt) : null,
    participants: participants.map((p) => ({
      slot: p.draftOrder,
      member: {
        id: p.id,
        userId: p.userId,
        displayName: p.displayName,
        email: '',
        teamName: p.teamName,
      },
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
      member: {
        id: pk.member.id,
        displayName: pk.member.displayName,
        teamName: pk.member.teamName,
      },
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
    member: { id: pk.member.id, displayName: pk.member.displayName, teamName: pk.member.teamName },
    auto: pk.auto,
    madeAt: formatDateToIso(pk.madeAt),
  }));
}

export function toFeedParticipants(participants: DraftParticipant[]): FeedParticipant[] {
  return participants.map((p) => ({
    slot: p.draftOrder,
    member: {
      id: p.id,
      userId: p.userId,
      displayName: p.displayName,
      email: '',
      teamName: p.teamName,
    },
  }));
}

function getSlotForOverallPick(overall: number, teamCount: number): number {
  if (teamCount <= 0) return 0;

  const round = Math.ceil(overall / teamCount);
  const pickIndex = (overall - 1) % teamCount;

  return round % 2 === 1 ? pickIndex + 1 : teamCount - pickIndex;
}

function getPickWindow(currentPick: number, totalPicks: number, yourSlot?: number, teamCount = 0) {
  const safeCurrentPick = Math.max(1, Math.min(currentPick, Math.max(totalPicks, 1)));
  const start = Math.max(1, safeCurrentPick - 1);
  const end = Math.min(totalPicks, safeCurrentPick + 4);
  const picks = new Set<number>();

  for (let overall = start; overall <= end; overall += 1) {
    picks.add(overall);
  }

  if (yourSlot && teamCount > 0) {
    for (let overall = safeCurrentPick; overall <= totalPicks; overall += 1) {
      if (getSlotForOverallPick(overall, teamCount) === yourSlot) {
        picks.add(overall);
        break;
      }
    }
  }

  return [...picks].sort((a, b) => a - b);
}

function buildDraftPickTrainState(params: {
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  participants: DraftPickTrainParticipant[];
  picks: DraftPickTrainPick[];
  yourSlot?: number;
}): DraftPickTrainState {
  const { currentPick, totalPicks, round, direction, participants, picks, yourSlot } = params;
  const teamCount = participants.length;
  const participantsBySlot = new Map(participants.map((participant) => [participant.slot, participant]));
  const picksByOverall = new Map(picks.map((pick) => [pick.overall, pick]));

  const slots = getPickWindow(currentPick, totalPicks, yourSlot, teamCount).map((overall) => {
    const slot = getSlotForOverallPick(overall, teamCount);
    const participant = participantsBySlot.get(slot);
    const pick = picksByOverall.get(overall);
    const status: DraftPickTrainSlot['status'] =
      overall === currentPick ? 'current' : overall < currentPick || pick ? 'completed' : 'upcoming';

    return {
      overall,
      round: teamCount > 0 ? Math.ceil(overall / teamCount) : round,
      slot,
      status,
      isUserPick: slot === yourSlot,
      displayName: participant?.member.displayName ?? `Team ${slot}`,
      teamName: participant?.member.teamName,
      player: pick?.player,
    };
  });

  return {
    currentPick,
    totalPicks,
    round,
    direction,
    slots,
  };
}

export function toDraftPickTrainState(params: {
  draft: DraftState;
  participants: DraftParticipant[];
  picks: DraftPick[];
  yourSlot?: number;
}): DraftPickTrainState {
  return buildDraftPickTrainState({
    currentPick: params.draft.currentPick,
    totalPicks: params.draft.totalPicks,
    round: params.draft.round,
    direction: params.draft.direction,
    participants: params.participants.map((participant) => ({
      slot: participant.draftOrder,
      member: {
        id: participant.id,
        userId: participant.userId,
        displayName: participant.displayName,
        teamName: participant.teamName,
      },
    })),
    picks: params.picks,
    yourSlot: params.yourSlot,
  });
}

export function toDraftPickTrainStateFromHeaderData(params: {
  draftData: LivePickHeaderData;
  yourSlot?: number;
}): DraftPickTrainState {
  return buildDraftPickTrainState({
    currentPick: params.draftData.currentPick,
    totalPicks: params.draftData.totalPicks,
    round: params.draftData.round,
    direction: params.draftData.direction,
    participants: params.draftData.participants,
    picks: params.draftData.picks,
    yourSlot: params.yourSlot,
  });
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
