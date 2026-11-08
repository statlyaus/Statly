import type { Prisma } from '@prisma/client';

import { IN_ACTIVE_SEASON } from '@/server/leagues/activeSeason';

import { nextWaiverRunAt, previousWaiverRunAt } from './nextWaiverRun';

export interface WaiverOnlyHold {
  leagueId: string;
  playerId: string;
  reason: 'PENDING_CLAIM' | 'RECENT_DROP';
  /** The waiver run that can award him: the first 6 am Melbourne run at or after the hold ends. */
  processingAt: Date;
}

/**
 * Players who can only be won at a waiver run, never by a free-agent add: anyone with a PENDING
 * waiver claim (until a run settles it), and anyone dropped since the last 6 am Melbourne run or
 * still inside a drop's waiver period.
 */
export async function loadWaiverOnlyHolds(
  db: Pick<Prisma.TransactionClient, 'teamAction'>,
  input: { leagueIds: readonly string[]; playerIds: readonly string[]; now?: Date }
): Promise<WaiverOnlyHold[]> {
  if (input.leagueIds.length === 0 || input.playerIds.length === 0) return [];
  const now = input.now ?? new Date();

  const actions = await db.teamAction.findMany({
    where: {
      leagueId: { in: [...input.leagueIds] },
      // Each league's own active season: an earlier season's claims and drops hold nobody.
      ...IN_ACTIVE_SEASON,
      status: 'PENDING',
      OR: [
        { actionType: 'WAIVER_CLAIM' },
        {
          actionType: 'DROP_PLAYER',
          OR: [{ processingAt: { gt: now } }, { createdAt: { gte: previousWaiverRunAt(now) } }],
        },
      ],
    },
    select: { leagueId: true, actionType: true, details: true, processingAt: true },
    orderBy: { processingAt: 'asc' },
  });

  const playerIds = new Set(input.playerIds);
  return actions.flatMap((action) => {
    const playerId = readPlayerId(action.details);
    if (!playerId || !playerIds.has(playerId)) return [];
    const dueAt = action.processingAt && action.processingAt > now ? action.processingAt : now;
    return [
      {
        leagueId: action.leagueId,
        playerId,
        reason: action.actionType === 'WAIVER_CLAIM' ? 'PENDING_CLAIM' : 'RECENT_DROP',
        processingAt: nextWaiverRunAt(dueAt),
      } satisfies WaiverOnlyHold,
    ];
  });
}

function readPlayerId(details: Prisma.JsonValue): string | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const playerId = (details as Record<string, unknown>).playerId;
  return typeof playerId === 'string' && playerId ? playerId : null;
}
