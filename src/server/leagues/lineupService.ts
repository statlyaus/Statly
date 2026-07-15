import { prisma } from '@/lib/prisma';
import { getLivePlayerStats } from '@/lib/etlIntegration';

import { parseCompetitionRulesJson, type CompetitionRules } from './competitionRules';
import { parseLineupSlotsJson } from './lineupSettings';
import { normalizeLiveStatRows, type RawLiveStatRow } from './liveStatsAdapter';
import type { ActiveLineupSlot, LeagueLineupSlot, LineupSlotSettings } from './scoringTypes';

const LINEUP_SLOTS = new Set<LeagueLineupSlot>([
  'FWD',
  'DEF',
  'MID',
  'RUC',
  'UTIL',
  'INTERCHANGE',
  'BENCH',
]);

export interface RosterLineupPlayer {
  playerId: string;
  position: string | null;
  gameStartsAt?: Date | null;
}

export interface SubmittedLineupPlayer {
  playerId: string;
  slot: LeagueLineupSlot;
  slotIndex: number;
}

export interface ValidateLineupSubmissionInput {
  lineupSlots: LineupSlotSettings;
  rosterPlayers: readonly RosterLineupPlayer[];
  existingLockedPlayers: readonly SubmittedLineupPlayer[];
  submittedPlayers: readonly SubmittedLineupPlayer[];
  interchangeSlots?: number;
  now?: Date;
}

export interface LineupValidationResult {
  ok: boolean;
  errors: string[];
}

export interface MemberLineupRoundContext {
  source: 'PUBLISHED' | 'SETUP_FALLBACK';
  round: number;
  aflRound: number | null;
  phase: 'REGULAR' | 'FINALS';
  roundStatus: 'SCHEDULED' | 'NO_MATCHUP' | 'PENDING' | 'LOCKED' | 'FINAL';
  startsAt: Date | null;
  fallbackLockAt: Date | null;
  lockAt: Date | null;
  lockState: 'OPEN' | 'LOCKED' | 'PUBLISHED_PENDING' | 'NO_MATCHUP';
  opponent: { id: string; teamName: string } | null;
}

export function resolveRequestedLineupRound({
  requestedRound,
  publishedCurrentRound,
}: {
  requestedRound: string;
  publishedCurrentRound: number | null;
}): number | null {
  if (requestedRound === 'current') return publishedCurrentRound ?? 1;

  const parsedRound = Number.parseInt(requestedRound, 10);
  return Number.isInteger(parsedRound) && parsedRound > 0 ? parsedRound : null;
}

export function createSetupLineupRoundContext(round: number): MemberLineupRoundContext {
  return {
    source: 'SETUP_FALLBACK',
    round,
    aflRound: null,
    phase: 'REGULAR',
    roundStatus: 'PENDING',
    startsAt: null,
    fallbackLockAt: null,
    lockAt: null,
    lockState: 'PUBLISHED_PENDING',
    opponent: null,
  };
}

export type SaveMemberLineupResult =
  | { ok: true; data: Awaited<ReturnType<typeof loadMemberLineup>> }
  | { ok: false; errors: string[] };

export function canAssignPlayerToSlot(
  _playerPosition: string | null | undefined,
  slot: LeagueLineupSlot
): boolean {
  return LINEUP_SLOTS.has(slot);
}

export function isLineupPlayerLocked(
  gameStartsAt: Date | null | undefined,
  now = new Date()
): boolean {
  return Boolean(gameStartsAt && gameStartsAt.getTime() <= now.getTime());
}

function resolveThursdayAestLock(startsAt: Date | null): Date | null {
  if (!startsAt) return null;

  const anchor = new Date(
    Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate())
  );
  const daysSinceThursday = (anchor.getUTCDay() + 3) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - daysSinceThursday);
  // Thursday 7 pm AEST is 09:00 UTC. This intentionally stays AEST year-round.
  return new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), 9, 0, 0)
  );
}

function resolveRoundLockAt(
  rules: CompetitionRules,
  competitionRound: { startsAt: Date | null; fallbackLockAt: Date | null }
) {
  if (competitionRound.fallbackLockAt) return competitionRound.fallbackLockAt;
  if (rules.lockPolicy === 'THURSDAY_7PM_AEST') {
    return resolveThursdayAestLock(competitionRound.startsAt);
  }
  return null;
}

export async function loadMemberLineupRoundContext({
  leagueId,
  memberId,
  round,
  now = new Date(),
}: {
  leagueId: string;
  memberId: string;
  round: number;
  now?: Date;
}): Promise<MemberLineupRoundContext | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });
  if (!league?.settings || league.settings.competitionRulesVersion < 1) return null;

  const competitionRound = await prisma.leagueCompetitionRound.findUnique({
    where: {
      leagueId_fixtureVersion_round: {
        leagueId,
        fixtureVersion: league.settings.competitionRulesVersion,
        round,
      },
    },
  });
  if (!competitionRound) return null;

  const matchup = await prisma.leagueMatchup.findFirst({
    where: {
      leagueId,
      fixtureVersion: league.settings.competitionRulesVersion,
      round,
      OR: [{ homeMemberId: memberId }, { awayMemberId: memberId }],
    },
    include: {
      homeMember: { select: { id: true, teamName: true } },
      awayMember: { select: { id: true, teamName: true } },
    },
  });
  const opponent =
    matchup?.homeMemberId === memberId
      ? matchup.awayMember
      : matchup?.awayMemberId === memberId
        ? matchup.homeMember
        : null;
  const rules = parseCompetitionRulesJson(league.settings.competitionRulesJson, 'goals');
  const lockAt = resolveRoundLockAt(rules, competitionRound);
  const lockState =
    competitionRound.status === 'NO_MATCHUP'
      ? 'NO_MATCHUP'
      : lockAt && lockAt <= now
        ? 'LOCKED'
        : !competitionRound.startsAt && !competitionRound.fallbackLockAt
          ? 'PUBLISHED_PENDING'
          : 'OPEN';

  return {
    source: 'PUBLISHED',
    round: competitionRound.round,
    aflRound: competitionRound.aflRound,
    phase: competitionRound.phase,
    roundStatus: competitionRound.status,
    startsAt: competitionRound.startsAt,
    fallbackLockAt: competitionRound.fallbackLockAt,
    lockAt,
    lockState,
    opponent,
  };
}

export async function resolveCurrentCompetitionRoundNumber(
  leagueId: string,
  now = new Date()
): Promise<number | null> {
  const settings = await prisma.leagueSettings.findFirst({
    where: { league: { id: leagueId } },
    select: { competitionRulesVersion: true },
  });
  if (!settings || settings.competitionRulesVersion < 1) return null;

  const rounds = await prisma.leagueCompetitionRound.findMany({
    where: { leagueId, fixtureVersion: settings.competitionRulesVersion },
    orderBy: { round: 'asc' },
    select: { round: true, status: true, startsAt: true, endsAt: true },
  });
  const playableRounds = rounds.filter((competitionRound) => competitionRound.status !== 'NO_MATCHUP');
  const currentRound =
    playableRounds.find(
      (competitionRound) =>
        competitionRound.startsAt &&
        competitionRound.startsAt <= now &&
        (!competitionRound.endsAt || competitionRound.endsAt >= now)
    ) ??
    playableRounds.find(
      (competitionRound) => !competitionRound.startsAt || competitionRound.startsAt > now
    ) ??
    playableRounds.at(-1);

  return currentRound?.round ?? null;
}

export async function loadRoundPlayerGameStarts({
  aflRound,
  playerIds,
  season = new Date().getFullYear(),
}: {
  aflRound: number | null;
  playerIds: readonly string[];
  season?: number;
}) {
  if (!aflRound || playerIds.length === 0) return new Map<string, Date>();

  const trackedPlayerIds = new Set(playerIds);
  const rows = await getLivePlayerStats(season);
  const gameStartsByPlayerId = new Map<string, Date>();
  for (const row of normalizeLiveStatRows(rows as unknown as RawLiveStatRow[])) {
    if (
      row.round === aflRound &&
      trackedPlayerIds.has(row.playerId) &&
      row.gameStartsAt &&
      !gameStartsByPlayerId.has(row.playerId)
    ) {
      gameStartsByPlayerId.set(row.playerId, row.gameStartsAt);
    }
  }

  return gameStartsByPlayerId;
}

export function validateLineupSubmission(
  input: ValidateLineupSubmissionInput
): LineupValidationResult {
  const errors: string[] = [];
  const now = input.now ?? new Date();
  const rosterByPlayerId = new Map(input.rosterPlayers.map((player) => [player.playerId, player]));
  const seenPlayerIds = new Set<string>();
  const occupiedSlots = new Set<string>();
  const activeSlotCounts = new Map<ActiveLineupSlot, number>();
  const lockedPlayersById = new Map(
    input.existingLockedPlayers.map((player) => [player.playerId, player])
  );

  for (const player of input.submittedPlayers) {
    if (seenPlayerIds.has(player.playerId)) {
      errors.push(`Player ${player.playerId} is a duplicate lineup selection.`);
    }
    seenPlayerIds.add(player.playerId);

    if (!LINEUP_SLOTS.has(player.slot)) {
      errors.push(`Slot ${player.slot} is not supported.`);
      continue;
    }

    const slotKey = `${player.slot}:${player.slotIndex}`;
    if (occupiedSlots.has(slotKey)) {
      errors.push(`Slot ${slotKey} has more than one player.`);
    }
    occupiedSlots.add(slotKey);

    if (!Number.isInteger(player.slotIndex) || player.slotIndex < 0) {
      errors.push(`Slot index for ${player.playerId} must be a non-negative integer.`);
    }

    const rosterPlayer = rosterByPlayerId.get(player.playerId);
    if (!rosterPlayer) {
      errors.push(`Player ${player.playerId} is not on this member roster.`);
      continue;
    }

    const lockedPlayer = lockedPlayersById.get(player.playerId);
    if (
      lockedPlayer &&
      (lockedPlayer.slot !== player.slot || lockedPlayer.slotIndex !== player.slotIndex)
    ) {
      errors.push(`Player ${player.playerId} is locked.`);
    }
    if (isLineupPlayerLocked(rosterPlayer.gameStartsAt, now) && !lockedPlayer) {
      errors.push(`Player ${player.playerId} is locked.`);
    }

    if (player.slot === 'INTERCHANGE') {
      if (player.slotIndex >= (input.interchangeSlots ?? 0)) {
        errors.push(`Interchange slot ${player.slotIndex + 1} exceeds the configured interchange count.`);
      }
    } else if (player.slot !== 'BENCH') {
      const activeSlot = player.slot;
      activeSlotCounts.set(activeSlot, (activeSlotCounts.get(activeSlot) ?? 0) + 1);
      if (player.slotIndex >= input.lineupSlots[activeSlot]) {
        errors.push(`Slot ${player.slot}:${player.slotIndex} exceeds the configured lineup count.`);
      }
    }
  }

  for (const [slot, count] of activeSlotCounts) {
    if (count > input.lineupSlots[slot]) {
      errors.push(`${slot} has ${count} players but only ${input.lineupSlots[slot]} are allowed.`);
    }
  }

  for (const lockedPlayer of input.existingLockedPlayers) {
    const submittedPlayer = input.submittedPlayers.find(
      (player) => player.playerId === lockedPlayer.playerId
    );
    if (
      !submittedPlayer ||
      submittedPlayer.slot !== lockedPlayer.slot ||
      submittedPlayer.slotIndex !== lockedPlayer.slotIndex
    ) {
      errors.push(`Player ${lockedPlayer.playerId} is locked and must remain in place.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function isLeagueLineupSlot(value: unknown): value is LeagueLineupSlot {
  return typeof value === 'string' && LINEUP_SLOTS.has(value as LeagueLineupSlot);
}

function normalizeSubmittedPlayers(players: readonly unknown[]): SubmittedLineupPlayer[] {
  return players.flatMap((player) => {
    if (!player || typeof player !== 'object') return [];
    const source = player as Record<string, unknown>;
    const slotIndex =
      typeof source.slotIndex === 'number'
        ? source.slotIndex
        : Number.parseInt(String(source.slotIndex ?? ''), 10);

    if (typeof source.playerId !== 'string' || !isLeagueLineupSlot(source.slot)) {
      return [];
    }

    return {
      playerId: source.playerId,
      slot: source.slot,
      slotIndex,
    };
  });
}

export async function loadMemberLineup({
  leagueId,
  memberId,
  round,
}: {
  leagueId: string;
  memberId: string;
  round: number;
}) {
  return prisma.leagueLineup.findUnique({
    where: { leagueId_memberId_round: { leagueId, memberId, round } },
    include: {
      players: {
        include: { player: true },
        orderBy: [{ slot: 'asc' }, { slotIndex: 'asc' }],
      },
    },
  });
}

export async function saveMemberLineup({
  leagueId,
  memberId,
  round,
  players,
}: {
  leagueId: string;
  memberId: string;
  round: number;
  players: readonly unknown[];
}): Promise<SaveMemberLineupResult> {
  const submittedPlayers = normalizeSubmittedPlayers(players);
  if (submittedPlayers.length !== players.length) {
    return { ok: false, errors: ['Lineup payload contains invalid player rows.'] };
  }

  const [league, rosterPlayers, existingLineup, roundContext] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      include: { settings: true },
    }),
    prisma.leagueRosterPlayer.findMany({
      where: { leagueId, memberId },
      include: { player: true },
    }),
    prisma.leagueLineup.findUnique({
      where: { leagueId_memberId_round: { leagueId, memberId, round } },
      include: { players: true },
    }),
    loadMemberLineupRoundContext({ leagueId, memberId, round }),
  ]);

  if (!league?.settings) {
    return { ok: false, errors: ['League not found.'] };
  }
  const isSetupFallback =
    league.settings.competitionStatus === 'SETUP' &&
    league.settings.competitionRulesVersion === 0;
  if (!roundContext && !isSetupFallback) {
    return { ok: false, errors: ['Publish the competition before saving lineups.'] };
  }
  if (roundContext?.lockState === 'LOCKED') {
    return { ok: false, errors: ['This round is locked.'] };
  }

  const rules = parseCompetitionRulesJson(league.settings.competitionRulesJson, 'goals');
  const gameStartsByPlayerId = await loadRoundPlayerGameStarts({
    aflRound: roundContext?.aflRound ?? null,
    playerIds: rosterPlayers.map((row) => row.playerId),
  });
  const existingLockedPlayers =
    existingLineup?.players
      .filter(
        (player) =>
          player.lockedAt ||
          isLineupPlayerLocked(gameStartsByPlayerId.get(player.playerId))
      )
      .map((player) => ({
        playerId: player.playerId,
        slot: player.slot,
        slotIndex: player.slotIndex,
      })) ?? [];

  const result = validateLineupSubmission({
    lineupSlots: parseLineupSlotsJson(league.settings.lineupSlotsJson),
    rosterPlayers: rosterPlayers.map((row) => ({
      playerId: row.playerId,
      position: row.player.position,
      gameStartsAt: gameStartsByPlayerId.get(row.playerId) ?? null,
    })),
    existingLockedPlayers,
    submittedPlayers,
    interchangeSlots: rules.interchangeSlots,
  });

  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  const lineup = await prisma.$transaction(async (tx) => {
    const upserted = await tx.leagueLineup.upsert({
      where: { leagueId_memberId_round: { leagueId, memberId, round } },
      create: { leagueId, memberId, round },
      update: {},
    });

    const lockedPlayerIds = new Set(existingLockedPlayers.map((player) => player.playerId));
    await tx.leagueLineupPlayer.deleteMany({
      where: {
        lineupId: upserted.id,
        playerId: { notIn: [...lockedPlayerIds] },
      },
    });
    const mutableSubmittedPlayers = submittedPlayers.filter(
      (player) => !lockedPlayerIds.has(player.playerId)
    );
    if (mutableSubmittedPlayers.length > 0) {
      await tx.leagueLineupPlayer.createMany({
        data: mutableSubmittedPlayers.map((player) => ({
          lineupId: upserted.id,
          playerId: player.playerId,
          slot: player.slot,
          slotIndex: player.slotIndex,
        })),
      });
    }

    return tx.leagueLineup.findUnique({
      where: { id: upserted.id },
      include: {
        players: {
          include: { player: true },
          orderBy: [{ slot: 'asc' }, { slotIndex: 'asc' }],
        },
      },
    });
  });

  return { ok: true, data: lineup };
}
