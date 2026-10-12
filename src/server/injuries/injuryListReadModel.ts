import type { InjuryReturnStatus, PrismaClient } from '@prisma/client';

import { logger } from '@/lib/logger';

import { FOOTYWIRE_INJURY_SOURCE } from './injuryListConstants';

/**
 * The current injury list, read from the latest Footywire snapshot.
 *
 * Injuries are facts about AFL players, not about any league or season, so this read carries no
 * league or season scope and has no scope key: every league sees the same list. Only MATCHED
 * entries are returned; an unmatched or ambiguous row names no Statly player, and guessing one would
 * bench the wrong player.
 */

// A list nobody has confirmed recently cannot say who is fit now, so it counts as absent.
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

export interface CurrentInjury {
  status: InjuryReturnStatus;
  injuryRaw: string;
  returnRaw: string;
}

export type CurrentInjuries =
  { ok: true; byPlayerId: Map<string, CurrentInjury> } | { ok: false; reason: 'none' | 'stale' };

type InjuryListReadClient = Pick<PrismaClient, 'injuryListSnapshot' | 'injuryListEntry'>;

export interface LoadCurrentInjuriesOptions {
  prisma: InjuryListReadClient;
  now?: Date;
}

/** Owner decision 2026-10-11: a player listed as `TEST` may still be picked; every other status blocks. */
export function injuryBlocksSelection(status: InjuryReturnStatus): boolean {
  return status !== 'TEST';
}

export async function loadCurrentInjuries({
  prisma,
  now = new Date(),
}: LoadCurrentInjuriesOptions): Promise<CurrentInjuries> {
  const snapshot = await prisma.injuryListSnapshot.findFirst({
    where: { source: FOOTYWIRE_INJURY_SOURCE },
    orderBy: { confirmedAt: 'desc' },
    select: { id: true, confirmedAt: true },
  });
  if (!snapshot) return { ok: false, reason: 'none' };
  if (now.getTime() - snapshot.confirmedAt.getTime() > MAX_AGE_MS) {
    return { ok: false, reason: 'stale' };
  }

  const entries = await prisma.injuryListEntry.findMany({
    where: { snapshotId: snapshot.id, matchStatus: 'MATCHED', playerId: { not: null } },
    select: { playerId: true, status: true, injuryRaw: true, returnRaw: true },
  });
  const byPlayerId = new Map<string, CurrentInjury>();
  for (const { playerId, ...injury } of entries) {
    if (!playerId) continue;
    // Two rows can only land on one player through distinct Footywire slugs; keep the one that
    // blocks selection so a listing is never hidden by a TEST row.
    const previous = byPlayerId.get(playerId);
    if (previous && injuryBlocksSelection(previous.status)) continue;
    byPlayerId.set(playerId, injury);
  }
  return { ok: true, byPlayerId };
}

export interface InjuryListing {
  /** What the list says, e.g. "Knee (Test)", shown even when the player can still be picked. */
  label: string;
  blocksSelection: boolean;
}

export type InjuryLookup = (player: { playerId: string }) => InjuryListing | null;

/**
 * Looks up a listed injury by player id only. A name match could bench a namesake, so a player the
 * list does not name by id counts as fit. Without a current list, or when the read fails, everyone
 * counts as fit: the list only ever narrows a lineup, so its absence must not fail the caller.
 */
export async function loadInjuryLookup({
  prisma,
  now,
  logContext,
}: {
  prisma: InjuryListReadClient;
  now: Date;
  logContext: Record<string, unknown>;
}): Promise<InjuryLookup> {
  let injuries: CurrentInjuries;
  try {
    injuries = await loadCurrentInjuries({ prisma, now });
  } catch (error) {
    logger.warn('Injury list unavailable', {
      ...logContext,
      reason: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    return () => null;
  }
  if (!injuries.ok) {
    logger.warn('Injury list unavailable', { ...logContext, reason: injuries.reason });
    return () => null;
  }

  const byPlayerId = new Map<string, InjuryListing>();
  for (const [playerId, injury] of injuries.byPlayerId) {
    byPlayerId.set(playerId, {
      label: `${injury.injuryRaw} (${injury.returnRaw})`,
      blocksSelection: injuryBlocksSelection(injury.status),
    });
  }
  return (player) => byPlayerId.get(player.playerId) ?? null;
}
