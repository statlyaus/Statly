import { prisma } from '@/lib/prisma';

import { parseLineupSlotsJson } from './lineupSettings';
import type { ActiveLineupSlot, LeagueLineupSlot, LineupSlotSettings } from './scoringTypes';

const LINEUP_SLOTS = new Set<LeagueLineupSlot>(['FWD', 'DEF', 'MID', 'RUC', 'UTIL', 'BENCH']);

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
  now?: Date;
}

export interface LineupValidationResult {
  ok: boolean;
  errors: string[];
}

export type SaveMemberLineupResult =
  | { ok: true; data: Awaited<ReturnType<typeof loadMemberLineup>> }
  | { ok: false; errors: string[] };

function normalizePosition(position: string | null | undefined): ActiveLineupSlot | undefined {
  const upper = position?.toUpperCase();
  if (upper === 'DEF' || upper === 'D') return 'DEF';
  if (upper === 'MID' || upper === 'M') return 'MID';
  if (upper === 'RUC' || upper === 'RUCK' || upper === 'R') return 'RUC';
  if (upper === 'FWD' || upper === 'F') return 'FWD';
  return undefined;
}

export function canAssignPlayerToSlot(
  playerPosition: string | null | undefined,
  slot: LeagueLineupSlot
): boolean {
  if (slot === 'BENCH' || slot === 'UTIL') return true;
  return normalizePosition(playerPosition) === slot;
}

export function isLineupPlayerLocked(
  gameStartsAt: Date | null | undefined,
  now = new Date()
): boolean {
  return Boolean(gameStartsAt && gameStartsAt.getTime() <= now.getTime());
}

export function validateLineupSubmission(
  input: ValidateLineupSubmissionInput
): LineupValidationResult {
  const errors: string[] = [];
  const now = input.now ?? new Date();
  const rosterByPlayerId = new Map(input.rosterPlayers.map((player) => [player.playerId, player]));
  const seenPlayerIds = new Set<string>();
  const occupiedSlots = new Set<string>();
  const activeSlotCounts = new Map<LeagueLineupSlot, number>();
  const lockedPlayerIds = new Set(input.existingLockedPlayers.map((player) => player.playerId));

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

    if (!canAssignPlayerToSlot(rosterPlayer.position, player.slot)) {
      errors.push(`Player ${player.playerId} is not eligible for ${player.slot}.`);
    }

    if (
      isLineupPlayerLocked(rosterPlayer.gameStartsAt, now) ||
      lockedPlayerIds.has(player.playerId)
    ) {
      errors.push(`Player ${player.playerId} is locked.`);
    }

    if (player.slot !== 'BENCH') {
      activeSlotCounts.set(player.slot, (activeSlotCounts.get(player.slot) ?? 0) + 1);
      if (player.slotIndex >= input.lineupSlots[player.slot]) {
        errors.push(`Slot ${player.slot}:${player.slotIndex} exceeds the configured lineup count.`);
      }
    }
  }

  for (const [slot, count] of activeSlotCounts) {
    if (slot !== 'BENCH' && count > input.lineupSlots[slot]) {
      errors.push(`${slot} has ${count} players but only ${input.lineupSlots[slot]} are allowed.`);
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

  const [league, rosterPlayers, existingLineup] = await Promise.all([
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
  ]);

  if (!league?.settings) {
    return { ok: false, errors: ['League not found.'] };
  }

  const result = validateLineupSubmission({
    lineupSlots: parseLineupSlotsJson(league.settings.lineupSlotsJson),
    rosterPlayers: rosterPlayers.map((row) => ({
      playerId: row.playerId,
      position: row.player.position,
    })),
    existingLockedPlayers:
      existingLineup?.players
        .filter((player) => player.lockedAt)
        .map((player) => ({
          playerId: player.playerId,
          slot: player.slot,
          slotIndex: player.slotIndex,
        })) ?? [],
    submittedPlayers,
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

    await tx.leagueLineupPlayer.deleteMany({
      where: {
        lineupId: upserted.id,
        lockedAt: null,
      },
    });

    if (submittedPlayers.length > 0) {
      await tx.leagueLineupPlayer.createMany({
        data: submittedPlayers.map((player) => ({
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
