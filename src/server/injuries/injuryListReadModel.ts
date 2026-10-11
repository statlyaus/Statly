import type { PrismaClient } from '@prisma/client';

import type { InjuryReturnStatus } from './footywireInjuryList';
import { FOOTYWIRE_INJURY_SOURCE } from './injuryListConstants';

/**
 * The current injury list, read from the latest Footywire snapshot.
 *
 * Injuries are facts about AFL players, not about any league or season, so this read carries no
 * league or season scope and has no scope key: every league sees the same list. Only MATCHED
 * entries are returned; an unmatched or ambiguous row names no Statly player, and guessing one would
 * bench the wrong player.
 */

export const DEFAULT_INJURY_LIST_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export interface CurrentInjury {
  status: InjuryReturnStatus;
  injuryRaw: string;
  returnRaw: string;
}

export type CurrentInjuries =
  | {
      ok: true;
      snapshot: { id: string; confirmedAt: Date; fetchedAt: Date };
      byPlayerId: Map<string, CurrentInjury>;
    }
  // `error` is never returned here; a caller that catches a failed read reports it this way so the
  // lineup still renders with every player available.
  | { ok: false; reason: 'none' | 'stale' | 'error' };

export interface LoadCurrentInjuriesOptions {
  prisma: Pick<PrismaClient, 'injuryListSnapshot'>;
  now?: Date;
  maxAgeMs?: number;
}

/** Owner decision 2026-10-11: a player listed as `TEST` may still be picked; every other status blocks. */
export function injuryBlocksSelection(status: string): boolean {
  return status !== 'TEST';
}

export async function loadCurrentInjuries({
  prisma,
  now = new Date(),
  maxAgeMs = DEFAULT_INJURY_LIST_MAX_AGE_MS,
}: LoadCurrentInjuriesOptions): Promise<CurrentInjuries> {
  const snapshot = await prisma.injuryListSnapshot.findFirst({
    where: { source: FOOTYWIRE_INJURY_SOURCE },
    orderBy: { confirmedAt: 'desc' },
    select: {
      id: true,
      confirmedAt: true,
      fetchedAt: true,
      entries: {
        where: { matchStatus: 'MATCHED', playerId: { not: null } },
        select: { playerId: true, status: true, injuryRaw: true, returnRaw: true },
      },
    },
  });
  if (!snapshot) return { ok: false, reason: 'none' };
  // A list nobody has confirmed recently cannot say who is fit now, so callers treat it as absent.
  if (now.getTime() - snapshot.confirmedAt.getTime() > maxAgeMs) {
    return { ok: false, reason: 'stale' };
  }

  const byPlayerId = new Map<string, CurrentInjury>();
  for (const entry of snapshot.entries) {
    if (!entry.playerId) continue;
    const current: CurrentInjury = {
      status: entry.status as InjuryReturnStatus,
      injuryRaw: entry.injuryRaw,
      returnRaw: entry.returnRaw,
    };
    // Two rows can only land on one player through distinct Footywire slugs; keep the one that
    // blocks selection so a listing is never hidden by a TEST row.
    const previous = byPlayerId.get(entry.playerId);
    if (previous && injuryBlocksSelection(previous.status)) continue;
    byPlayerId.set(entry.playerId, current);
  }

  return {
    ok: true,
    snapshot: { id: snapshot.id, confirmedAt: snapshot.confirmedAt, fetchedAt: snapshot.fetchedAt },
    byPlayerId,
  };
}
