import 'server-only';

import type { LeagueBite, LeagueLineupSlot } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { loadDraftPlayerStatsLookup } from '@/server/draft/readModels/draftPlayerReadModel';

import { isActivePrismaMembership } from './activeMembership';
import { loadLeagueScores, pickAutoBitePair } from './bloodsuckerAutoBite';
import {
  assertMatchupFinal,
  assertNoRoundInProgress,
  assertOldestOpenBite,
  BiteError,
} from './bloodsuckerBites';
import { normalizeLeagueFormat, resolveBloodsuckerMemberId } from './leagueFormat';

// What the Bloodsucker screens read (Bloodsucker 9/9, #1286; BR-40, US-6, US-8, NFR-5). Every member
// sees who the Bloodsucker is, its record and every bite this season. Only the Bloodsucker reads its
// bite picker. Nothing here writes: the picker shows what the server would refuse and why, and the
// bite itself still goes through `executeBite`.

export type SlotGroup = 'DEF' | 'MID' | 'RUC' | 'FWD' | 'UTIL' | 'NON_SCORING';

export const SLOT_GROUP_ORDER: readonly SlotGroup[] = [
  'DEF',
  'MID',
  'RUC',
  'FWD',
  'UTIL',
  'NON_SCORING',
];

const SCORING_SLOTS = new Set<LeagueLineupSlot>(['DEF', 'MID', 'RUC', 'FWD', 'UTIL']);

const toGroup = (slot: LeagueLineupSlot): SlotGroup =>
  SCORING_SLOTS.has(slot) ? (slot as SlotGroup) : 'NON_SCORING';

/**
 * Where each player sat in a scored lineup, after autosubs: a replacement takes the slot of the
 * player he came on for, and that player drops to non-scoring. A player not in the lineup is
 * non-scoring too.
 */
export function slotGroupsAfterAutosubs(input: {
  players: ReadonlyArray<{ playerId: string; slot: LeagueLineupSlot }>;
  autosubs: ReadonlyArray<{
    outgoingPlayerId: string;
    replacementPlayerId: string;
    outgoingSlot: LeagueLineupSlot;
  }>;
}): Map<string, SlotGroup> {
  const groups = new Map(input.players.map((row) => [row.playerId, toGroup(row.slot)]));
  for (const autosub of input.autosubs) {
    groups.set(autosub.outgoingPlayerId, 'NON_SCORING');
    groups.set(autosub.replacementPlayerId, toGroup(autosub.outgoingSlot));
  }
  return groups;
}

export class BloodsuckerReadError extends Error {
  constructor(
    public readonly code: 'FORBIDDEN' | 'NOT_FOUND',
    message: string,
    public readonly status: 403 | 404
  ) {
    super(message);
    this.name = 'BloodsuckerReadError';
  }
}

export interface BloodsuckerBiteSummary {
  biteId: string;
  round: number;
  status: LeagueBite['status'];
  victim: { memberId: string; teamName: string };
  takenPlayer: { id: string; name: string } | null;
  returnedPlayer: { id: string; name: string } | null;
  deadlineAt: string;
  executedAt: string | null;
}

export interface BloodsuckerSummary {
  leagueFormat: string;
  bloodsucker: { memberId: string; teamName: string } | null;
  record: { wins: number; losses: number; draws: number };
  bites: BloodsuckerBiteSummary[];
  viewer: { memberId: string; isBloodsucker: boolean };
}

async function loadMembership(leagueId: string, userId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      activeSeasonId: true,
      settings: {
        select: { leagueFormat: true, bloodsuckerMemberId: true, competitionRulesVersion: true },
      },
      members: {
        select: { id: true, userId: true, teamName: true, isActive: true, status: true },
      },
    },
  });
  if (!league?.settings) throw new BloodsuckerReadError('NOT_FOUND', 'League not found.', 404);
  const active = league.members.filter(isActivePrismaMembership);
  const viewer = active.find((member) => member.userId === userId);
  if (!viewer) {
    throw new BloodsuckerReadError('FORBIDDEN', 'You are not a member of this league.', 403);
  }
  const bloodsuckerId = resolveBloodsuckerMemberId(
    league.settings,
    active.map((member) => member.id)
  );
  return { league, settings: league.settings, viewer, bloodsuckerId };
}

/** BR-40: the Bloodsucker, its record and this season's bites, for every member. */
export async function loadBloodsuckerSummary(input: {
  leagueId: string;
  userId: string;
}): Promise<BloodsuckerSummary> {
  const { league, settings, viewer, bloodsuckerId } = await loadMembership(
    input.leagueId,
    input.userId
  );
  const base = {
    leagueFormat: normalizeLeagueFormat(settings.leagueFormat),
    viewer: { memberId: viewer.id, isBloodsucker: viewer.id === bloodsuckerId },
  };
  if (!bloodsuckerId) {
    return { ...base, bloodsucker: null, record: { wins: 0, losses: 0, draws: 0 }, bites: [] };
  }

  const [matchups, bites] = await Promise.all([
    prisma.leagueMatchup.findMany({
      where: {
        leagueId: input.leagueId,
        fixtureVersion: settings.competitionRulesVersion,
        status: 'FINAL',
        OR: [{ homeMemberId: bloodsuckerId }, { awayMemberId: bloodsuckerId }],
      },
      select: { winnerMemberId: true, homeMemberId: true, awayMemberId: true },
    }),
    league.activeSeasonId
      ? prisma.leagueBite.findMany({
          where: { leagueId: input.leagueId, seasonId: league.activeSeasonId },
          orderBy: [{ round: 'asc' }, { opensAt: 'asc' }, { id: 'asc' }],
        })
      : Promise.resolve([] as LeagueBite[]),
  ]);

  const record = { wins: 0, losses: 0, draws: 0 };
  for (const matchup of matchups) {
    if (!matchup.homeMemberId || !matchup.awayMemberId) continue;
    if (matchup.winnerMemberId === bloodsuckerId) record.wins += 1;
    else if (matchup.winnerMemberId) record.losses += 1;
    else record.draws += 1;
  }

  const playerIds = bites.flatMap((bite) =>
    [bite.takenPlayerId, bite.returnedPlayerId].flatMap((id) => id ?? [])
  );
  const players = playerIds.length
    ? await prisma.player.findMany({
        where: { id: { in: playerIds } },
        select: { id: true, name: true },
      })
    : [];
  const playerName = new Map(players.map((player) => [player.id, player.name]));
  const teamName = new Map(league.members.map((member) => [member.id, member.teamName]));
  const player = (id: string | null) =>
    id ? { id, name: playerName.get(id) ?? 'Unknown player' } : null;

  return {
    ...base,
    bloodsucker: {
      memberId: bloodsuckerId,
      teamName: teamName.get(bloodsuckerId) ?? 'Bloodsucker',
    },
    record,
    bites: bites.map((bite) => ({
      biteId: bite.id,
      round: bite.round,
      status: bite.status,
      victim: {
        memberId: bite.victimMemberId,
        teamName: teamName.get(bite.victimMemberId) ?? 'A former team',
      },
      takenPlayer: player(bite.takenPlayerId),
      returnedPlayer: player(bite.returnedPlayerId),
      deadlineAt: bite.deadlineAt.toISOString(),
      executedAt: bite.executedAt?.toISOString() ?? null,
    })),
  };
}

export interface BitePickerPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  group: SlotGroup;
  /** Statly Z under the league's categories; null with no stats. */
  z: number | null;
}

export interface BitePicker {
  biteId: string;
  round: number;
  status: LeagueBite['status'];
  version: number;
  deadlineAt: string;
  serverNow: string;
  victim: { memberId: string; teamName: string };
  score: string;
  victimPlayers: BitePickerPlayer[];
  returnPlayers: BitePickerPlayer[];
  /** What the deadline auto-bite would do now (BR-28). */
  autoBitePreview: { takenPlayerId: string; returnedPlayerId: string } | null;
  /** When the server would refuse a bite right now: every player is disabled with this reason. */
  blocked: { code: string; message: string } | null;
  takenPlayerId: string | null;
  returnedPlayerId: string | null;
}

async function groupsFor(bite: LeagueBite, memberId: string) {
  const lineup = await prisma.leagueLineup.findUnique({
    where: {
      leagueId_seasonId_memberId_round: {
        leagueId: bite.leagueId,
        seasonId: bite.seasonId,
        memberId,
        round: bite.round,
      },
    },
    select: {
      players: { select: { playerId: true, slot: true } },
      autosubs: {
        select: { outgoingPlayerId: true, replacementPlayerId: true, outgoingSlot: true },
      },
    },
  });
  return slotGroupsAfterAutosubs(lineup ?? { players: [], autosubs: [] });
}

async function rosterPlayers(
  bite: LeagueBite,
  memberId: string,
  scores: ReadonlyMap<string, number>
): Promise<BitePickerPlayer[]> {
  const [rows, groups] = await Promise.all([
    prisma.leagueRosterPlayer.findMany({
      where: { leagueId: bite.leagueId, memberId },
      select: { player: { select: { id: true, name: true, position: true, club: true } } },
    }),
    groupsFor(bite, memberId),
  ]);
  return rows
    .map(({ player }) => ({
      id: player.id,
      name: player.name,
      position: player.position ?? '',
      club: player.club ?? '',
      group: groups.get(player.id) ?? 'NON_SCORING',
      z: scores.get(player.id) ?? null,
    }))
    .sort(
      (left, right) =>
        SLOT_GROUP_ORDER.indexOf(left.group) - SLOT_GROUP_ORDER.indexOf(right.group) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id)
    );
}

/** The refusal `executeBite` would give right now, read without writing. */
async function currentRefusal(bite: LeagueBite, now: Date) {
  if (bite.status !== 'OPEN' && bite.status !== 'WAITING_LOCK') {
    return { code: 'BITE_NOT_OPEN', message: 'This bite is done.' };
  }
  try {
    await assertOldestOpenBite(prisma, bite);
    await assertMatchupFinal(prisma, bite);
    await assertNoRoundInProgress(prisma, bite.leagueId, now);
    return null;
  } catch (error) {
    if (error instanceof BiteError) return { code: error.code, message: error.message };
    throw error;
  }
}

/** `GET /api/leagues/[id]/bites/[biteId]`: the Bloodsucker's bite picker (US-6, BR-27, BR-28). */
export async function loadBitePicker(input: {
  leagueId: string;
  biteId: string;
  userId: string;
  now?: Date;
}): Promise<BitePicker> {
  const now = input.now ?? new Date();
  const { league, viewer } = await loadMembership(input.leagueId, input.userId);
  const bite = await prisma.leagueBite.findFirst({
    where: { id: input.biteId, leagueId: input.leagueId },
  });
  if (!bite) throw new BloodsuckerReadError('NOT_FOUND', 'Bite not found.', 404);
  if (viewer.id !== bite.bloodsuckerMemberId) {
    throw new BloodsuckerReadError('FORBIDDEN', 'Only the Bloodsucker can bite.', 403);
  }

  const { scoreByPlayerId } = await loadLeagueScores(
    input.leagueId,
    await loadDraftPlayerStatsLookup()
  );
  const [victimPlayers, returnPlayers, blocked, matchup] = await Promise.all([
    rosterPlayers(bite, bite.victimMemberId, scoreByPlayerId),
    rosterPlayers(bite, bite.bloodsuckerMemberId, scoreByPlayerId),
    currentRefusal(bite, now),
    prisma.leagueMatchup.findUnique({
      where: { id: bite.matchupId },
      select: { homeMemberId: true, homeCategoryWins: true, awayCategoryWins: true },
    }),
  ]);
  const auto = pickAutoBitePair({
    victimPlayerIds: victimPlayers.map((player) => player.id),
    bloodsuckerPlayerIds: returnPlayers.map((player) => player.id),
    scoreByPlayerId,
  });
  const home = matchup?.homeMemberId === bite.bloodsuckerMemberId;
  const victimTeam = league.members.find((member) => member.id === bite.victimMemberId);

  return {
    biteId: bite.id,
    round: bite.round,
    status: bite.status,
    version: bite.version,
    deadlineAt: bite.deadlineAt.toISOString(),
    serverNow: now.toISOString(),
    victim: { memberId: bite.victimMemberId, teamName: victimTeam?.teamName ?? 'A former team' },
    score: matchup
      ? home
        ? `${matchup.homeCategoryWins}-${matchup.awayCategoryWins}`
        : `${matchup.awayCategoryWins}-${matchup.homeCategoryWins}`
      : '',
    victimPlayers,
    returnPlayers,
    autoBitePreview: auto
      ? { takenPlayerId: auto.takenPlayerId, returnedPlayerId: auto.returnedPlayerId }
      : null,
    blocked,
    takenPlayerId: bite.takenPlayerId,
    returnedPlayerId: bite.returnedPlayerId,
  };
}
