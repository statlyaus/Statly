import type { PrismaClient } from '@prisma/client';

import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';

type DraftHistoryDb = Pick<PrismaClient, 'draft'>;

export interface DraftHistoryPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
}

export interface DraftHistoryMember {
  id: string;
  userId: string;
  displayName: string;
  teamName: string;
  role: string;
  slot: number | null;
}

export interface DraftHistoryPick {
  id: string;
  overall: number;
  round: number;
  slot: number;
  auto: boolean;
  madeAt: string;
  player: DraftHistoryPlayer;
  member: DraftHistoryMember;
}

export interface DraftHistoryParticipant extends DraftHistoryMember {
  pickCount: number;
  picks: DraftHistoryPick[];
  positions: Array<{ position: string; count: number }>;
}

export interface DraftHistoryRound {
  round: number;
  picks: DraftHistoryPick[];
}

export interface DraftHistorySummary {
  id: string;
  leagueId: string;
  name: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  totalPicks: number;
  picksMade: number;
  teamCount: number;
  totalRounds: number;
  autoPickCount: number;
  manualPickCount: number;
  completionPct: number;
  selectedCategories: FantasyCategoryKey[];
  firstPick: DraftHistoryPick | null;
  lastPick: DraftHistoryPick | null;
  participants: DraftHistoryParticipant[];
}

export interface DraftHistoryDetail extends DraftHistorySummary {
  rounds: DraftHistoryRound[];
  timeline: DraftHistoryPick[];
  positionCounts: Array<{ position: string; count: number }>;
}

export interface DraftHistoryListResult {
  drafts: DraftHistorySummary[];
  metrics: {
    draftCount: number;
    pickCount: number;
    teamCount: number;
    autoPickCount: number;
    manualPickCount: number;
  };
  pagination: {
    limit: number;
    hasMore: boolean;
  };
}

type DraftHistoryQueryOptions = {
  limit?: number;
};

type DraftRecord = Awaited<ReturnType<typeof fetchDraftHistoryRecords>>[number];

const MAX_HISTORY_LIMIT = 50;
const DEFAULT_HISTORY_LIMIT = 25;

export function parseDraftHistoryLimit(rawLimit: string | null): number {
  if (!rawLimit) return DEFAULT_HISTORY_LIMIT;

  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed)) return DEFAULT_HISTORY_LIMIT;

  return Math.min(Math.max(parsed, 1), MAX_HISTORY_LIMIT);
}

function parseSelectedCategories(raw: unknown): FantasyCategoryKey[] {
  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw.split(',').map((value) => value.trim());
    }
  }

  if (!Array.isArray(parsed)) return [];

  const validKeys = new Set(Object.keys(FANTASY_CATEGORIES));
  return parsed.map(String).filter((value): value is FantasyCategoryKey => validKeys.has(value));
}

function sortByCountThenLabel(
  values: Map<string, number>
): Array<{ position: string; count: number }> {
  return Array.from(values.entries())
    .map(([position, count]) => ({ position, count }))
    .sort((a, b) => b.count - a.count || a.position.localeCompare(b.position));
}

function buildMemberDisplayName(member: {
  user: { displayName: string | null; email?: string | null };
}): string {
  return member.user.displayName || member.user.email || 'Unknown manager';
}

function mapPick(
  pick: DraftRecord['picks'][number],
  slotByMemberId: Map<string, number | null>
): DraftHistoryPick {
  return {
    id: pick.id,
    overall: pick.overall,
    round: pick.round,
    slot: pick.slot,
    auto: pick.auto,
    madeAt: pick.madeAt.toISOString(),
    player: {
      id: pick.player.id,
      name: pick.player.name,
      position: pick.player.position,
      club: pick.player.club,
    },
    member: {
      id: pick.member.id,
      userId: pick.member.userId,
      displayName: buildMemberDisplayName(pick.member),
      teamName: pick.member.teamName,
      role: pick.member.role,
      slot: slotByMemberId.get(pick.memberId) ?? pick.slot ?? null,
    },
  };
}

export function groupPicksByRound(picks: DraftHistoryPick[]): DraftHistoryRound[] {
  const grouped = new Map<number, DraftHistoryPick[]>();

  for (const pick of picks) {
    const roundPicks = grouped.get(pick.round) ?? [];
    roundPicks.push(pick);
    grouped.set(pick.round, roundPicks);
  }

  return Array.from(grouped.entries())
    .map(([round, roundPicks]) => ({
      round,
      picks: roundPicks.sort((a, b) => a.overall - b.overall),
    }))
    .sort((a, b) => a.round - b.round);
}

export function calculateDraftCompletionPct(picksMade: number, totalPicks: number): number {
  if (totalPicks <= 0) return 0;
  return Math.min(100, Math.round((picksMade / totalPicks) * 100));
}

function buildParticipants(record: DraftRecord, picks: DraftHistoryPick[]): DraftHistoryParticipant[] {
  const slotByMemberId = new Map(record.orders.map((order) => [order.memberId, order.slot]));
  const picksByMemberId = new Map<string, DraftHistoryPick[]>();

  for (const pick of picks) {
    const memberPicks = picksByMemberId.get(pick.member.id) ?? [];
    memberPicks.push(pick);
    picksByMemberId.set(pick.member.id, memberPicks);
  }

  return record.league.members
    .map((member) => {
      const memberPicks = (picksByMemberId.get(member.id) ?? []).sort(
        (a, b) => a.overall - b.overall
      );
      const positionCounts = new Map<string, number>();

      for (const pick of memberPicks) {
        positionCounts.set(pick.player.position, (positionCounts.get(pick.player.position) ?? 0) + 1);
      }

      return {
        id: member.id,
        userId: member.userId,
        displayName: buildMemberDisplayName(member),
        teamName: member.teamName,
        role: member.role,
        slot: slotByMemberId.get(member.id) ?? member.draftSlot ?? null,
        pickCount: memberPicks.length,
        picks: memberPicks,
        positions: sortByCountThenLabel(positionCounts),
      };
    })
    .sort((a, b) => (a.slot ?? Number.MAX_SAFE_INTEGER) - (b.slot ?? Number.MAX_SAFE_INTEGER));
}

function mapDraftHistoryRecord(record: DraftRecord): DraftHistoryDetail {
  const slotByMemberId = new Map(record.orders.map((order) => [order.memberId, order.slot]));
  const picks = record.picks
    .map((pick) => mapPick(pick, slotByMemberId))
    .sort((a, b) => a.overall - b.overall);
  const participants = buildParticipants(record, picks);
  const rounds = groupPicksByRound(picks);
  const positionCounts = new Map<string, number>();

  for (const pick of picks) {
    positionCounts.set(pick.player.position, (positionCounts.get(pick.player.position) ?? 0) + 1);
  }

  const totalRounds =
    record.league.settings.rosterSize + record.league.settings.benchSize ||
    (participants.length > 0 ? Math.ceil(record.totalPicks / participants.length) : 0);
  const autoPickCount = picks.filter((pick) => pick.auto).length;

  return {
    id: record.id,
    leagueId: record.leagueId,
    name: record.league.name,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    startedAt: record.startedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    totalPicks: record.totalPicks,
    picksMade: picks.length,
    teamCount: participants.length,
    totalRounds,
    autoPickCount,
    manualPickCount: picks.length - autoPickCount,
    completionPct: calculateDraftCompletionPct(picks.length, record.totalPicks),
    selectedCategories: parseSelectedCategories(record.league.categoriesJson),
    firstPick: picks[0] ?? null,
    lastPick: picks[picks.length - 1] ?? null,
    participants,
    rounds,
    timeline: [...picks].reverse(),
    positionCounts: sortByCountThenLabel(positionCounts),
  };
}

export async function getDraftHistoryList(
  db: DraftHistoryDb,
  userId: string,
  options: DraftHistoryQueryOptions = {}
): Promise<DraftHistoryListResult> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
  const records = await fetchDraftHistoryRecords(db, userId, limit + 1);
  const visibleRecords = records.slice(0, limit);
  const drafts = visibleRecords.map(mapDraftHistoryRecord);

  return {
    drafts,
    metrics: {
      draftCount: drafts.length,
      pickCount: drafts.reduce((sum, draft) => sum + draft.picksMade, 0),
      teamCount: drafts.reduce((max, draft) => Math.max(max, draft.teamCount), 0),
      autoPickCount: drafts.reduce((sum, draft) => sum + draft.autoPickCount, 0),
      manualPickCount: drafts.reduce((sum, draft) => sum + draft.manualPickCount, 0),
    },
    pagination: {
      limit,
      hasMore: records.length > limit,
    },
  };
}

export async function getDraftHistoryDetail(
  db: DraftHistoryDb,
  userId: string,
  draftId: string
): Promise<DraftHistoryDetail | null> {
  const record = await fetchDraftHistoryRecord(db, userId, draftId);
  return record ? mapDraftHistoryRecord(record) : null;
}

function historyDraftInclude() {
  return {
    league: {
      include: {
        settings: true,
        members: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                email: true,
              },
            },
          },
          orderBy: { draftSlot: 'asc' as const },
        },
      },
    },
    orders: {
      orderBy: { slot: 'asc' as const },
      select: {
        memberId: true,
        slot: true,
      },
    },
    picks: {
      include: {
        player: {
          select: {
            id: true,
            name: true,
            position: true,
            club: true,
          },
        },
        member: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { overall: 'asc' as const },
    },
  };
}

async function fetchDraftHistoryRecords(db: DraftHistoryDb, userId: string, take: number) {
  return db.draft.findMany({
    where: {
      status: 'COMPLETED',
      league: {
        members: {
          some: { userId },
        },
      },
    },
    include: historyDraftInclude(),
    orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    take,
  });
}

async function fetchDraftHistoryRecord(db: DraftHistoryDb, userId: string, draftId: string) {
  return db.draft.findFirst({
    where: {
      id: draftId,
      status: 'COMPLETED',
      league: {
        members: {
          some: { userId },
        },
      },
    },
    include: historyDraftInclude(),
  });
}
