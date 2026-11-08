export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { buildCanonicalPlayerId } from '@/lib/playerIdentity';
import { formatLeagueTime } from '@/lib/leagueTime';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { loadWaiverOnlyHolds } from '@/server/waivers/waiverOnlyPlayers';

// Prisma owns membership, rosters, picks and waiver claims, so it alone decides availability. A failed
// read is a 500, never an empty result: an empty result would show every player as a free agent.

type AvailabilityStatus = 'owned' | 'your-roster' | 'waiver' | 'free-agent';
type AvailabilityActionType = 'trade' | 'waiver' | 'add' | 'roster';

interface UserLeagueContext {
  leagueId: string;
  leagueName: string;
  teamName: string;
  memberId: string;
  timeZone?: string;
}

interface AvailabilityOwner {
  memberId: string;
  userId: string;
  teamName: string;
  isCurrentUser: boolean;
}

interface AvailabilityWaiver {
  processingAt?: Date;
  pendingClaims: number;
}

interface PlayerLeagueAvailability {
  leagueId: string;
  leagueName: string;
  teamName: string;
  /** The league's IANA timezone; league times in this row are shown in it. */
  timeZone?: string;
  status: AvailabilityStatus;
  statusLabel: string;
  statusDetail: string;
  owner?: AvailabilityOwner;
  waiver?: {
    processingAt?: string;
    pendingClaims: number;
  };
  action: {
    type: AvailabilityActionType;
    label: string;
    href: string;
  };
}

function getActionHref(
  leagueId: string,
  playerId: string,
  type: AvailabilityActionType,
  ownerMemberId?: string
): string {
  const league = encodeURIComponent(leagueId);
  const player = encodeURIComponent(playerId);

  if (type === 'trade') {
    const owner = ownerMemberId ? `&ownerMemberId=${encodeURIComponent(ownerMemberId)}` : '';
    return `/leagues/${league}/trades?playerId=${player}${owner}`;
  }

  if (type === 'waiver') return `/leagues/${league}?tab=waivers&playerId=${player}&action=claim`;
  if (type === 'roster') return `/leagues/${league}?tab=roster&playerId=${player}`;
  return `/leagues/${league}?tab=roster&addPlayerId=${player}`;
}

async function loadUserLeagueContexts(userId: string): Promise<UserLeagueContext[]> {
  const memberships = await prisma.leagueMember.findMany({
    where: { userId, isActive: true },
    include: {
      league: {
        select: {
          id: true,
          name: true,
          settings: { select: { timeZone: true } },
        },
      },
    },
    orderBy: { joinedAt: 'desc' },
  });

  return memberships.map((membership) => ({
    leagueId: membership.leagueId,
    leagueName: membership.league.name,
    teamName: membership.teamName,
    memberId: membership.id,
    timeZone: membership.league.settings?.timeZone,
  }));
}

function serializeWaiver(waiver: AvailabilityWaiver): PlayerLeagueAvailability['waiver'] {
  return {
    ...(waiver.processingAt ? { processingAt: waiver.processingAt.toISOString() } : {}),
    pendingClaims: waiver.pendingClaims,
  };
}

function buildAvailabilityRow(input: {
  league: UserLeagueContext;
  playerId: string;
  owner?: AvailabilityOwner;
  waiver?: AvailabilityWaiver;
}): PlayerLeagueAvailability {
  const base = {
    leagueId: input.league.leagueId,
    leagueName: input.league.leagueName,
    teamName: input.league.teamName,
    timeZone: input.league.timeZone,
  };

  if (input.owner) {
    const actionType: AvailabilityActionType = input.owner.isCurrentUser ? 'roster' : 'trade';
    return {
      ...base,
      status: input.owner.isCurrentUser ? 'your-roster' : 'owned',
      statusLabel: input.owner.isCurrentUser ? 'On your roster' : 'Owned',
      statusDetail: input.owner.isCurrentUser
        ? `Rostered by ${input.league.teamName}`
        : `Owned by ${input.owner.teamName}`,
      owner: input.owner,
      action: {
        type: actionType,
        label: input.owner.isCurrentUser ? 'View roster' : 'Trade',
        href: getActionHref(
          input.league.leagueId,
          input.playerId,
          actionType,
          input.owner.memberId
        ),
      },
    };
  }

  if (input.waiver) {
    return {
      ...base,
      status: 'waiver',
      statusLabel: 'Waivers',
      statusDetail: input.waiver.processingAt
        ? `Claims process ${formatLeagueTime(input.waiver.processingAt, input.league.timeZone)}`
        : `${input.waiver.pendingClaims} pending claim${input.waiver.pendingClaims === 1 ? '' : 's'}`,
      waiver: serializeWaiver(input.waiver),
      action: {
        type: 'waiver',
        label: 'Waiver claim',
        href: getActionHref(input.league.leagueId, input.playerId, 'waiver'),
      },
    };
  }

  return {
    ...base,
    status: 'free-agent',
    statusLabel: 'Free agent',
    statusDetail: 'Not rostered in this league',
    action: {
      type: 'add',
      label: 'Add player',
      href: getActionHref(input.league.leagueId, input.playerId, 'add'),
    },
  };
}

function titleCaseName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`)
    .join(' ');
}

async function resolvePlayerIdentityCandidates(requestedPlayerId: string): Promise<string[]> {
  const normalized = requestedPlayerId.trim();
  const slugAsWords = normalized.replace(/[_-]+/g, ' ').trim();
  const tokens = slugAsWords.split(/\s+/).filter(Boolean);
  const possibleNames = new Set<string>();

  if (slugAsWords) possibleNames.add(titleCaseName(slugAsWords));
  for (let length = tokens.length - 1; length >= 2; length -= 1) {
    possibleNames.add(titleCaseName(tokens.slice(0, length).join(' ')));
  }

  const seedIds = new Set(
    [
      normalized,
      normalized.replace(/-/g, '_'),
      buildCanonicalPlayerId(slugAsWords),
      ...Array.from(possibleNames).map(buildCanonicalPlayerId),
    ].filter(Boolean)
  );

  const players = await prisma.player.findMany({
    where: {
      OR: [
        { id: { in: Array.from(seedIds) } },
        ...Array.from(possibleNames).map((name) => ({ name })),
      ],
    },
    select: { id: true },
    take: 20,
  });

  for (const player of players) seedIds.add(player.id);
  return Array.from(seedIds);
}

async function loadPrismaOwnerships(input: {
  leagueIds: string[];
  playerIds: string[];
  userId: string;
}): Promise<Map<string, AvailabilityOwner>> {
  const ownerByLeagueId = new Map<string, AvailabilityOwner>();
  if (input.leagueIds.length === 0 || input.playerIds.length === 0) return ownerByLeagueId;

  const ownerships = await prisma.leagueRosterPlayer.findMany({
    where: {
      leagueId: { in: input.leagueIds },
      playerId: { in: input.playerIds },
    },
    select: {
      leagueId: true,
      memberId: true,
      member: { select: { userId: true, teamName: true } },
    },
  });

  for (const ownership of ownerships) {
    ownerByLeagueId.set(ownership.leagueId, {
      memberId: ownership.memberId,
      userId: ownership.member.userId,
      teamName: ownership.member.teamName,
      isCurrentUser: ownership.member.userId === input.userId,
    });
  }

  const missingLeagueIds = input.leagueIds.filter((leagueId) => !ownerByLeagueId.has(leagueId));
  if (missingLeagueIds.length === 0) return ownerByLeagueId;

  // Picks reach the roster table only when the draft completes (RosterProjectionService), so a pick
  // decides ownership only while its draft is still running. After that the roster table is the
  // truth, and a drafted player who was later dropped is not owned.
  const draftPicks = await prisma.pick.findMany({
    where: {
      playerId: { in: input.playerIds },
      draft: { leagueId: { in: missingLeagueIds }, status: { not: 'COMPLETED' } },
    },
    select: {
      memberId: true,
      draft: { select: { leagueId: true } },
      member: { select: { userId: true, teamName: true } },
    },
  });

  for (const pick of draftPicks) {
    const leagueId = pick.draft.leagueId;
    if (ownerByLeagueId.has(leagueId)) continue;
    ownerByLeagueId.set(leagueId, {
      memberId: pick.memberId,
      userId: pick.member.userId,
      teamName: pick.member.teamName,
      isCurrentUser: pick.member.userId === input.userId,
    });
  }

  return ownerByLeagueId;
}

async function loadPrismaWaivers(input: {
  leagueIds: string[];
  playerIds: string[];
}): Promise<Map<string, AvailabilityWaiver>> {
  const waiversByLeagueId = new Map<string, AvailabilityWaiver>();
  if (input.leagueIds.length === 0 || input.playerIds.length === 0) return waiversByLeagueId;

  // The same waiver-only rule the free-agent add enforces, so the panel offers Claim, never Add.
  const holds = await loadWaiverOnlyHolds(prisma, input);
  for (const hold of holds) {
    const current = waiversByLeagueId.get(hold.leagueId);
    waiversByLeagueId.set(hold.leagueId, {
      processingAt:
        current?.processingAt && current.processingAt < hold.processingAt
          ? current.processingAt
          : hold.processingAt,
      pendingClaims: (current?.pendingClaims ?? 0) + (hold.reason === 'PENDING_CLAIM' ? 1 : 0),
    });
  }

  return waiversByLeagueId;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const requestedPlayerId = decodeURIComponent(id);

  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return commonErrors.unauthorized();

    const [leagueContexts, playerIds] = await Promise.all([
      loadUserLeagueContexts(userId),
      resolvePlayerIdentityCandidates(requestedPlayerId),
    ]);
    const leagueIds = leagueContexts.map((league) => league.leagueId);

    const [ownershipByLeagueId, waiversByLeagueId] = await Promise.all([
      loadPrismaOwnerships({ leagueIds, playerIds, userId }),
      loadPrismaWaivers({ leagueIds, playerIds }),
    ]);

    const leagues = leagueContexts.map((league) =>
      buildAvailabilityRow({
        league,
        playerId: requestedPlayerId,
        owner: ownershipByLeagueId.get(league.leagueId),
        waiver: waiversByLeagueId.get(league.leagueId),
      })
    );

    return successResponse({
      playerId: requestedPlayerId,
      playerIds,
      leagues,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to fetch player availability', error, { playerId: requestedPlayerId });
    return commonErrors.internalServerError('Failed to fetch player availability');
  }
}
