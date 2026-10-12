import { prisma } from '@/lib/prisma';
import { publishLeagueSystemMessage } from '@/server/leagues/social/socialSystemEvents';

import type { WaiverClaim } from './WaiverProcessingService';

export type WaiverOutcomeType = 'waiver-successful' | 'waiver-failed';

/** Social message event types for processed waiver claims, in the league's Activity channel. */
export const WAIVER_OUTCOME_EVENT_TYPES: Record<WaiverOutcomeType, string> = {
  'waiver-successful': 'WAIVER_SUCCESSFUL',
  'waiver-failed': 'WAIVER_FAILED',
};

/**
 * Publishes a processed claim to the league's Activity channel. Only outcomes are published:
 * pending claims and their bids stay private until waivers run.
 */
export async function publishWaiverOutcome(input: {
  leagueId: string;
  claim: WaiverClaim;
  type: WaiverOutcomeType;
  reason?: string;
}): Promise<void> {
  const { leagueId, claim, type, reason } = input;
  const [member, player, dropped] = await Promise.all([
    prisma.leagueMember.findFirst({
      where: { id: claim.teamId, leagueId },
      select: { teamName: true },
    }),
    prisma.player.findUnique({ where: { id: claim.playerId }, select: { name: true } }),
    claim.dropPlayerId
      ? prisma.player.findUnique({ where: { id: claim.dropPlayerId }, select: { name: true } })
      : null,
  ]);
  const team = member?.teamName ?? 'A team';
  const playerName = player?.name ?? 'a player';
  const bid = typeof claim.bidAmount === 'number' ? ` for $${claim.bidAmount}` : '';
  const drop = dropped?.name ? `, dropping ${dropped.name}` : '';

  await publishLeagueSystemMessage({
    leagueId,
    eventType: WAIVER_OUTCOME_EVENT_TYPES[type],
    relatedEntityId: claim.id,
    content:
      type === 'waiver-successful'
        ? `${team} claimed ${playerName} off waivers${bid}${drop}.`
        : `Waiver claim by ${team} for ${playerName} failed${reason ? `: ${reason}` : ''}.`,
    context: {
      type,
      userId: claim.userId,
      teamId: claim.teamId,
      playerId: claim.playerId,
      claimId: claim.id,
      ...(claim.dropPlayerId ? { dropPlayerId: claim.dropPlayerId } : {}),
      ...(typeof claim.bidAmount === 'number' ? { bidAmount: claim.bidAmount } : {}),
      ...(reason ? { reason } : {}),
    },
  });
}

export interface WaiverActivityItem {
  id: string;
  leagueId: string;
  type: string;
  userId?: string;
  teamId?: string;
  playerId?: string;
  dropPlayerId?: string;
  bidAmount?: number;
  claimId?: string;
  reason?: string;
  timestamp: string;
}

/** The league's published waiver outcomes for its active season, newest first, before a cursor. */
export async function loadWaiverOutcomes(
  leagueId: string,
  options: { limit: number; before?: Date }
): Promise<WaiverActivityItem[]> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { activeSeasonId: true },
  });
  if (!league?.activeSeasonId) return [];

  const messages = await prisma.socialMessage.findMany({
    where: {
      leagueId,
      seasonId: league.activeSeasonId,
      type: 'SYSTEM',
      moderationStatus: 'ACTIVE',
      relatedEntityType: { in: Object.values(WAIVER_OUTCOME_EVENT_TYPES) },
      ...(options.before ? { createdAt: { lt: options.before } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit,
    select: { id: true, contextJson: true, createdAt: true },
  });

  return messages.map((message) => {
    const context = parseContext(message.contextJson);
    const text = (key: string) => (typeof context[key] === 'string' ? context[key] : undefined);
    return {
      id: message.id,
      leagueId,
      type: text('type') ?? '',
      ...(text('userId') ? { userId: text('userId') } : {}),
      ...(text('teamId') ? { teamId: text('teamId') } : {}),
      ...(text('playerId') ? { playerId: text('playerId') } : {}),
      ...(text('dropPlayerId') ? { dropPlayerId: text('dropPlayerId') } : {}),
      ...(typeof context.bidAmount === 'number' ? { bidAmount: context.bidAmount } : {}),
      ...(text('claimId') ? { claimId: text('claimId') } : {}),
      ...(text('reason') ? { reason: text('reason') } : {}),
      timestamp: message.createdAt.toISOString(),
    };
  });
}

function parseContext(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
