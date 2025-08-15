'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';

// ───────────────────────────────────────────────────────────────────────────────
// Shared types - Import from existing types for consistency
// ───────────────────────────────────────────────────────────────────────────────

import type {
  LeagueType,
  LeagueStatus,
  MemberRole,
  TradeReview,
  WaiverResetPolicy,
} from '@/types/leagues';

export type ActivityKind = 'trade' | 'waiver' | 'draft' | 'admin';

export interface LeagueMeta {
  id: string;
  name: string;
  code?: string;
  type: LeagueType;
  ownerId: string;
  maxTeams: number;
  memberCount: number;
  status: LeagueStatus;
  categories: string[];
  nextEvent?: { label: string; iso: string };
  description?: string;
}

export interface Membership {
  userId: string;
  teamName: string;
  role: MemberRole;
  joinedAt: string; // ISO
  teamId?: string; // Add teamId for consistency
}

export interface TeamSlot {
  slot: string; // e.g., "FWD1", "MID2", "RUC", "BENCH1"
  playerId?: string; // player doc id
}

export interface MyTeam {
  teamId: string;
  teamName: string;
  roster: TeamSlot[];
  bench: TeamSlot[];
  ir?: TeamSlot[]; // optional injured reserve
}

export interface StandingRow {
  rank: number;
  teamId: string;
  teamName: string;
  record?: { w: number; l: number; t?: number };
  points?: number;
}

export interface MatchupSummary {
  roundLabel: string;
  opponentTeam: { id: string; name: string };
  projected?: number;
  actual?: number;
  categoryLeads?: Array<{ key: string; you: number; opp: number }>;
}

export interface WaiverSnapshot {
  nextRunIso: string;
  orderTop: Array<{ teamId: string; teamName: string }>;
}

export interface TradeItem {
  id: string;
  summary: string;
  status: 'pending' | 'approved' | 'rejected' | 'vetoed' | 'cancelled';
  createdAtIso: string;
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  iso: string;
  text: string;
}

export interface LeagueRules {
  scoringCategories: string[];
  rosterSlots: string[];
  trades: {
    limit?: number;
    review: TradeReview;
    deadlineIso?: string;
  };
  waivers: {
    periodHours?: number;
    resetPolicy?: WaiverResetPolicy;
  };
  draft: {
    type: 'snake' | 'linear';
    pickClockSeconds?: number;
    scheduledIso?: string;
  };
  lockout: 'round' | 'game' | 'rolling';
}

export interface DraftRoom {
  draftId: string;
  leagueId: string;
  type: 'snake' | 'linear';
  order: string[]; // teamIds in order
  pickClockSeconds?: number;
  scheduledIso?: string;
  started?: boolean;
}

export interface PlayerLite {
  id: string;
  name: string;
  team?: string;
  position?: string;
  ownedByTeamId?: string; // if in a team
}

export interface LeagueOverviewData {
  league: LeagueMeta;
  membership: Membership;
  standingsTop: StandingRow[]; // top 5
  matchup?: MatchupSummary; // optional
  waiver?: WaiverSnapshot; // optional
  activity: ActivityItem[]; // up to 10
}

// ───────────────────────────────────────────────────────────────────────────────
// Error handling types
// ───────────────────────────────────────────────────────────────────────────────

export class LeagueApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'LeagueApiError';
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Overview (top-level)
// ───────────────────────────────────────────────────────────────────────────────

export async function getLeagueOverview(
  db: Firestore,
  leagueId: string,
  userId: string
): Promise<LeagueOverviewData> {
  try {
    const [league, membership, standingsTop, matchup, waiver, activity] = await Promise.allSettled([
      getLeagueMeta(db, leagueId),
      getMembership(db, leagueId, userId),
      getStandingsTop(db, leagueId, 5),
      getMatchupSummary(db, leagueId, userId),
      getWaiverSnapshot(db, leagueId, 5),
      getActivityFeed(db, leagueId, 10),
    ]);

    // Handle fulfilled/rejected promises gracefully
    const resolvedLeague = league.status === 'fulfilled' ? league.value : null;
    const resolvedMembership = membership.status === 'fulfilled' ? membership.value : null;

    if (!resolvedLeague || !resolvedMembership) {
      throw new LeagueApiError(
        `Failed to load essential league data for ${leagueId}`,
        'LEAGUE_DATA_ERROR'
      );
    }

    return {
      league: resolvedLeague,
      membership: resolvedMembership,
      standingsTop: standingsTop.status === 'fulfilled' ? standingsTop.value : [],
      matchup: matchup.status === 'fulfilled' ? matchup.value : undefined,
      waiver: waiver.status === 'fulfilled' ? waiver.value : undefined,
      activity: activity.status === 'fulfilled' ? activity.value : [],
    };
  } catch (error) {
    throw new LeagueApiError(
      `Failed to get league overview for ${leagueId}`,
      'OVERVIEW_ERROR',
      error
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// League meta & membership
// ───────────────────────────────────────────────────────────────────────────────

export async function getLeagueMeta(db: Firestore, leagueId: string): Promise<LeagueMeta> {
  try {
    const ref = doc(db, 'leagues', leagueId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      throw new LeagueApiError(`League ${leagueId} not found`, 'LEAGUE_NOT_FOUND');
    }

    const d = snap.data();

    return {
      id: snap.id,
      name: String(d.name ?? ''),
      code: d.code ?? undefined,
      type: (d.type ?? 'private') as LeagueType,
      ownerId: String(d.ownerId ?? ''),
      maxTeams: Number(d.maxTeams ?? 10),
      memberCount: Number(d.memberCount ?? 0),
      status: (d.status ?? 'preseason') as LeagueStatus,
      categories: Array.isArray(d.categories) ? d.categories.map(String) : [],
      nextEvent: d.nextEvent
        ? {
            label: String(d.nextEvent.label ?? ''),
            iso: String(d.nextEvent.iso ?? ''),
          }
        : undefined,
      description: d.description ? String(d.description) : undefined,
    };
  } catch (error) {
    if (error instanceof LeagueApiError) throw error;
    throw new LeagueApiError(
      `Failed to get league meta for ${leagueId}`,
      'LEAGUE_META_ERROR',
      error
    );
  }
}

export async function getMembership(
  db: Firestore,
  leagueId: string,
  userId: string
): Promise<Membership> {
  try {
    const q = query(
      collection(db, 'leagueMembers'), // Updated collection name to match existing schema
      where('leagueId', '==', leagueId),
      where('userId', '==', userId),
      where('isActive', '==', true), // Add isActive filter for consistency
      limit(1)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      // Safe fallback so UI still renders
      return {
        userId,
        teamName: 'My Team',
        role: 'member',
        joinedAt: new Date().toISOString(),
      };
    }

    const doc = snap.docs[0];
    const d = doc.data();

    return {
      userId: String(d.userId),
      teamName: String(d.teamName ?? 'My Team'),
      role: (d.role ?? 'member') as MemberRole,
      joinedAt: toIso(d.joinedAt),
      teamId: doc.id, // Include document ID as teamId
    };
  } catch (error) {
    throw new LeagueApiError(
      `Failed to get membership for user ${userId} in league ${leagueId}`,
      'MEMBERSHIP_ERROR',
      error
    );
  }
}

export async function listLeagueMembers(
  db: Firestore,
  leagueId: string
): Promise<Array<{ teamId: string; teamName: string; role: MemberRole; userId: string }>> {
  try {
    const q = query(
      collection(db, 'leagueMembers'),
      where('leagueId', '==', leagueId),
      where('isActive', '==', true),
      orderBy('teamName')
    );

    const snap = await getDocs(q);

    return snap.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        teamId: docSnap.id,
        teamName: String(d.teamName ?? 'Team'),
        role: (d.role ?? 'member') as MemberRole,
        userId: String(d.userId ?? ''),
      };
    });
  } catch (error) {
    throw new LeagueApiError(
      `Failed to list league members for ${leagueId}`,
      'LIST_MEMBERS_ERROR',
      error
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// My Team
// ───────────────────────────────────────────────────────────────────────────────

export async function getMyTeam(
  db: Firestore,
  leagueId: string,
  userId: string
): Promise<MyTeam | null> {
  try {
    // team doc pattern: /leagueMembers/{teamId} stores roster structure
    const qTeam = query(
      collection(db, 'leagueMembers'),
      where('leagueId', '==', leagueId),
      where('userId', '==', userId),
      where('isActive', '==', true),
      limit(1)
    );

    const s = await getDocs(qTeam);
    if (s.empty) return null;

    const teamDoc = s.docs[0];
    const d = teamDoc.data();

    return {
      teamId: teamDoc.id,
      teamName: String(d.teamName ?? 'My Team'),
      roster: Array.isArray(d.roster) ? d.roster.map(normSlot) : [],
      bench: Array.isArray(d.bench) ? d.bench.map(normSlot) : [],
      ir: Array.isArray(d.ir) ? d.ir.map(normSlot) : undefined,
    };
  } catch (error) {
    throw new LeagueApiError(
      `Failed to get team for user ${userId} in league ${leagueId}`,
      'GET_TEAM_ERROR',
      error
    );
  }
}

function normSlot(x: unknown): TeamSlot {
  const slot = x as Record<string, unknown>;
  return {
    slot: String(slot?.slot ?? ''),
    playerId: slot?.playerId ? String(slot.playerId) : undefined,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Standings
// ───────────────────────────────────────────────────────────────────────────────

export async function getStandingsTop(
  db: Firestore,
  leagueId: string,
  topN = 10
): Promise<StandingRow[]> {
  try {
    // MVP: derive from leagueMembers (alphabetical teamName). Replace with computed standings later.
    const q = query(
      collection(db, 'leagueMembers'),
      where('leagueId', '==', leagueId),
      where('isActive', '==', true),
      orderBy('teamName'),
      limit(topN)
    );

    const snap = await getDocs(q);
    let rank = 1;

    return snap.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        rank: rank++,
        teamId: docSnap.id,
        teamName: String(d.teamName ?? 'Team'),
        record: d.record
          ? {
              w: Number(d.record.w ?? 0),
              l: Number(d.record.l ?? 0),
              t: d.record.t != null ? Number(d.record.t) : undefined,
            }
          : { w: 0, l: 0 },
        points: d.points != null ? Number(d.points) : undefined,
      } as StandingRow;
    });
  } catch (error) {
    throw new LeagueApiError(
      `Failed to get standings for league ${leagueId}`,
      'STANDINGS_ERROR',
      error
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Matchups
// ───────────────────────────────────────────────────────────────────────────────

export async function getMatchupSummary(
  db: Firestore,
  leagueId: string,
  userId: string
): Promise<MatchupSummary | undefined> {
  try {
    const matchupsCol = collection(db, 'matchups');
    const q1 = query(
      matchupsCol,
      where('leagueId', '==', leagueId),
      where('participants', 'array-contains', userId),
      where('current', '==', true),
      limit(1)
    );

    const snap = await getDocs(q1);
    if (snap.empty) return undefined;

    const d = snap.docs[0].data();
    const me = String(userId);
    const oppUserId =
      (Array.isArray(d.participants) ? d.participants : []).find((p: string) => p !== me) ??
      'opponent';

    return {
      roundLabel: String(d.roundLabel ?? 'This Week'),
      opponentTeam: {
        id: String(d.opponentTeamId ?? oppUserId),
        name: String(d.opponentTeamName ?? 'Opponent'),
      },
      projected: d.projected != null ? Number(d.projected) : undefined,
      actual: d.actual != null ? Number(d.actual) : undefined,
      categoryLeads: Array.isArray(d.categoryLeads)
        ? d.categoryLeads.map((c: Record<string, unknown>) => ({
            key: String(c.key ?? ''),
            you: Number(c.you ?? 0),
            opp: Number(c.opp ?? 0),
          }))
        : undefined,
    };
  } catch (error) {
    // Don't throw for optional matchup data
    console.warn(`Failed to get matchup summary for user ${userId} in league ${leagueId}:`, error);
    return undefined;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Transactions (Waivers & Trades) + Activity
// ───────────────────────────────────────────────────────────────────────────────

export async function getWaiverSnapshot(
  db: Firestore,
  leagueId: string,
  topN = 5
): Promise<WaiverSnapshot | undefined> {
  try {
    const waiversCol = collection(db, 'waivers');
    const q1 = query(
      waiversCol,
      where('leagueId', '==', leagueId),
      orderBy('runAt', 'desc'),
      limit(1)
    );

    const snap = await getDocs(q1);
    if (snap.empty) return undefined;

    const d = snap.docs[0].data();

    const order = Array.isArray(d.order)
      ? d.order.slice(0, topN).map((t: Record<string, unknown>) => ({
          teamId: String(t.teamId ?? ''),
          teamName: String(t.teamName ?? 'Team'),
        }))
      : [];

    return {
      nextRunIso: toIso(d.nextRun ?? d.runAt),
      orderTop: order,
    };
  } catch (error) {
    // Don't throw for optional waiver data
    console.warn(`Failed to get waiver snapshot for league ${leagueId}:`, error);
    return undefined;
  }
}

export async function listRecentTrades(
  db: Firestore,
  leagueId: string,
  maxItems = 10
): Promise<TradeItem[]> {
  try {
    const tradesCol = collection(db, 'trades');
    const qTrades = query(
      tradesCol,
      where('leagueId', '==', leagueId),
      orderBy('createdAt', 'desc'),
      limit(maxItems)
    );

    const ts = await getDocs(qTrades);

    return ts.docs.map((d) => {
      const v = d.data();
      return {
        id: d.id,
        summary: String(v.summary ?? 'Trade'),
        status: (v.status ?? 'pending') as TradeItem['status'],
        createdAtIso: toIso(v.createdAt),
      };
    });
  } catch (error) {
    console.warn(`Failed to list trades for league ${leagueId}:`, error);
    return [];
  }
}

export async function getActivityFeed(
  db: Firestore,
  leagueId: string,
  maxItems = 10
): Promise<ActivityItem[]> {
  const out: ActivityItem[] = [];

  try {
    // Preferred: aggregated /activities
    const actCol = collection(db, 'activities');
    const qAct = query(
      actCol,
      where('leagueId', '==', leagueId),
      orderBy('createdAt', 'desc'),
      limit(maxItems)
    );

    const s = await getDocs(qAct);

    if (!s.empty) {
      s.docs.forEach((d) => {
        const v = d.data();
        out.push({
          id: d.id,
          kind: (v.kind ?? 'admin') as ActivityKind,
          iso: toIso(v.createdAt),
          text: String(v.text ?? 'Activity'),
        });
      });
      return out;
    }

    // Fallback: trades + waivers summaries
    const trades = await listRecentTrades(db, leagueId, maxItems);
    out.push(
      ...trades.map((t) => ({
        id: `trade_${t.id}`,
        kind: 'trade' as const,
        iso: t.createdAtIso,
        text: t.summary,
      }))
    );

    const waiversCol = collection(db, 'waivers');
    const qW = query(
      waiversCol,
      where('leagueId', '==', leagueId),
      orderBy('runAt', 'desc'),
      limit(3)
    );
    const ws = await getDocs(qW);

    ws.docs.forEach((d) => {
      const v = d.data();
      out.push({
        id: `waiver_${d.id}`,
        kind: 'waiver',
        iso: toIso(v.runAt),
        text: String(v.summary ?? 'Waiver run processed'),
      });
    });

    return out.sort((a, b) => (a.iso < b.iso ? 1 : -1)).slice(0, maxItems);
  } catch (error) {
    console.warn(`Failed to get activity feed for league ${leagueId}:`, error);
    return [];
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Draft
// ───────────────────────────────────────────────────────────────────────────────

export async function getDraftRoom(
  db: Firestore,
  leagueId: string
): Promise<DraftRoom | undefined> {
  try {
    const qRoom = query(collection(db, 'draftRooms'), where('leagueId', '==', leagueId), limit(1));

    const s = await getDocs(qRoom);
    if (s.empty) return undefined;

    const d = s.docs[0].data();

    return {
      draftId: s.docs[0].id,
      leagueId,
      type: (d.type ?? 'snake') as DraftRoom['type'],
      order: Array.isArray(d.order) ? d.order.map(String) : [],
      pickClockSeconds: d.pickClockSeconds != null ? Number(d.pickClockSeconds) : undefined,
      scheduledIso: d.scheduledAt ? toIso(d.scheduledAt) : undefined,
      started: Boolean(d.started),
    };
  } catch (error) {
    console.warn(`Failed to get draft room for league ${leagueId}:`, error);
    return undefined;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Players (Free Agents / Search)
// ───────────────────────────────────────────────────────────────────────────────

export interface PlayerSearchFilters {
  search?: string;
  team?: string;
  position?: string;
  onlyFreeAgents?: boolean; // if true, exclude owned players
}

export async function searchPlayers(
  db: Firestore,
  leagueId: string,
  filters: PlayerSearchFilters = {}
): Promise<PlayerLite[]> {
  try {
    // Minimal, index-friendly starter:
    // /players: { nameLC, team, position }
    // You can add Algolia/Meilisearch later for fuzzy search.
    let qRef = query(collection(db, 'players'), orderBy('nameLC'), limit(50));

    // NOTE: For true text search, use a dedicated search service.
    const snap = await getDocs(qRef);
    let rows = snap.docs.map((d) => {
      const v = d.data();
      return {
        id: d.id,
        name: String(v.name ?? ''),
        team: v.team ? String(v.team) : undefined,
        position: v.position ? String(v.position) : undefined,
        ownedByTeamId: v.ownedByTeamId ? String(v.ownedByTeamId) : undefined,
      } as PlayerLite;
    });

    // Client-side filtering (consider moving to server-side for better performance)
    const s = filters.search?.toLowerCase().trim();
    if (s) rows = rows.filter((r) => r.name.toLowerCase().includes(s));
    if (filters.team)
      rows = rows.filter((r) => (r.team ?? '').toLowerCase() === filters.team!.toLowerCase());
    if (filters.position)
      rows = rows.filter(
        (r) => (r.position ?? '').toLowerCase() === filters.position!.toLowerCase()
      );
    if (filters.onlyFreeAgents) rows = rows.filter((r) => !r.ownedByTeamId);

    return rows;
  } catch (error) {
    throw new LeagueApiError(
      `Failed to search players in league ${leagueId}`,
      'PLAYER_SEARCH_ERROR',
      error
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Rules & Settings (read-only)
// ───────────────────────────────────────────────────────────────────────────────

export async function getLeagueRules(
  db: Firestore,
  leagueId: string
): Promise<LeagueRules | undefined> {
  try {
    const ref = doc(db, 'leagues', leagueId);
    const s = await getDoc(ref);

    if (!s.exists()) return undefined;

    const d = s.data();

    return {
      scoringCategories: Array.isArray(d.categories) ? d.categories.map(String) : [],
      rosterSlots: Array.isArray(d.rosterSlots) ? d.rosterSlots.map(String) : [],
      trades: {
        limit: d.tradeSettings?.tradeLimit != null ? Number(d.tradeSettings.tradeLimit) : undefined,
        review: (d.tradeSettings?.tradeReview ?? 'none') as TradeReview,
        deadlineIso: d.tradeSettings?.deadline ? toIso(d.tradeSettings.deadline) : undefined,
      },
      waivers: {
        periodHours:
          d.waiverWire?.waiverPeriodHours != null
            ? Number(d.waiverWire.waiverPeriodHours)
            : undefined,
        resetPolicy: (d.waiverWire?.waiverResetPolicy as WaiverResetPolicy) ?? undefined,
      },
      draft: {
        type: (d.draft?.type ?? 'snake') as 'snake' | 'linear',
        pickClockSeconds:
          d.draft?.pickClockSeconds != null ? Number(d.draft.pickClockSeconds) : undefined,
        scheduledIso: d.draft?.scheduledAt ? toIso(d.draft.scheduledAt) : undefined,
      },
      lockout: (d.lockout ?? 'round') as LeagueRules['lockout'],
    };
  } catch (error) {
    console.warn(`Failed to get league rules for ${leagueId}:`, error);
    return undefined;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Utilities
// ───────────────────────────────────────────────────────────────────────────────

interface FirestoreTimestamp {
  toDate(): Date;
}

function toIso(maybeTs: unknown): string {
  try {
    // Handle Firestore timestamp objects
    if (maybeTs && typeof maybeTs === 'object' && 'toDate' in maybeTs) {
      return (maybeTs as FirestoreTimestamp).toDate().toISOString();
    }
    if (maybeTs instanceof Date) return maybeTs.toISOString();
    if (typeof maybeTs === 'number') return new Date(maybeTs).toISOString();
    if (typeof maybeTs === 'string') return new Date(maybeTs).toISOString();
  } catch {
    // ignore
  }
  return new Date().toISOString();
}
