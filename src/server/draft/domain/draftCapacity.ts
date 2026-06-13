import type { Prisma, PrismaClient } from '@prisma/client';

import {
  type DraftPositionLimits,
  getBenchSizeFromPositionLimits,
  getRosterSizeFromPositionLimits,
  POSITION_LIMIT_KEYS,
} from '@/lib/draftSettings';

type PlayerCountClient = Pick<PrismaClient, 'player'> | Prisma.TransactionClient;

export type DraftPositionKey = Exclude<keyof DraftPositionLimits, 'BENCH'>;

export interface DraftCapacityInput {
  teamCount: number;
  positionLimits: DraftPositionLimits;
  activePlayerCount: number;
  activePlayersByPosition?: Partial<Record<DraftPositionKey, number>>;
  existingPickCount?: number;
  currentPick?: number;
}

export interface DraftPositionShortage {
  position: DraftPositionKey;
  required: number;
  available: number;
  shortage: number;
}

export interface DraftCapacity {
  teamCount: number;
  rosterSpotsPerTeam: number;
  requestedTotalPicks: number;
  totalPicks: number;
  activePlayerCount: number;
  hardMinimumPicks: number;
  cappedByPlayerPool: boolean;
  positionShortages: DraftPositionShortage[];
}

const POSITION_KEYS = POSITION_LIMIT_KEYS.filter((key): key is DraftPositionKey => key !== 'BENCH');

function normalizePosition(value: string | null | undefined): DraftPositionKey | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return POSITION_KEYS.includes(normalized as DraftPositionKey) ? (normalized as DraftPositionKey) : null;
}

export function calculateDraftCapacity(input: DraftCapacityInput): DraftCapacity {
  const teamCount = Math.max(0, Math.floor(input.teamCount));
  const activePlayerCount = Math.max(0, Math.floor(input.activePlayerCount));
  const rosterSpotsPerTeam =
    getRosterSizeFromPositionLimits(input.positionLimits) +
    getBenchSizeFromPositionLimits(input.positionLimits);
  const requestedTotalPicks = teamCount * rosterSpotsPerTeam;
  const existingPickCount = Math.max(0, Math.floor(input.existingPickCount ?? 0));
  const currentPickFloor = Math.max(0, Math.floor((input.currentPick ?? 1) - 1));
  const hardMinimumPicks = Math.max(existingPickCount, currentPickFloor);
  const playerPoolCap = activePlayerCount > 0 ? activePlayerCount : 0;
  const cappedTotalPicks = Math.min(requestedTotalPicks, playerPoolCap);
  const totalPicks = Math.max(hardMinimumPicks, cappedTotalPicks);

  const positionShortages = POSITION_KEYS.flatMap((position) => {
    const required = teamCount * input.positionLimits[position];
    const available = Math.max(0, Math.floor(input.activePlayersByPosition?.[position] ?? 0));
    const shortage = Math.max(0, required - available);
    return shortage > 0 ? [{ position, required, available, shortage }] : [];
  });

  return {
    teamCount,
    rosterSpotsPerTeam,
    requestedTotalPicks,
    totalPicks,
    activePlayerCount,
    hardMinimumPicks,
    cappedByPlayerPool: totalPicks < requestedTotalPicks,
    positionShortages,
  };
}

export async function countActiveDraftPlayersByPosition(
  client: PlayerCountClient
): Promise<Record<DraftPositionKey, number>> {
  const grouped = await client.player.groupBy({
    by: ['position'],
    where: { active: true },
    _count: { _all: true },
  });

  return grouped.reduce<Record<DraftPositionKey, number>>(
    (counts, group) => {
      const position = normalizePosition(group.position);
      if (position) {
        counts[position] += group._count._all;
      }
      return counts;
    },
    { DEF: 0, MID: 0, RUC: 0, FWD: 0 }
  );
}
