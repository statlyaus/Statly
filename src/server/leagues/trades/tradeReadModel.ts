import 'server-only';

import { Prisma, type LeagueTradeThreadStatus, type TradeReviewMode } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import {
  TradeServiceError,
  type LeagueTradeCentreSnapshot,
  type LeagueTradeDigest,
  type LeagueTradeDto,
  type TradeOfferDto,
  type TradeReviewModeDto,
  type TradeTeamDto,
  type TradeThreadStatusDto,
  type TradeView,
} from './tradeContracts';
import { getAllowedTradeActions } from './tradePolicy';

const PAGE_SIZE = 20;
const terminalStatuses: LeagueTradeThreadStatus[] = [
  'COMPLETED',
  'DECLINED',
  'WITHDRAWN',
  'REJECTED',
  'VETOED',
  'EXPIRED',
  'INVALIDATED',
];

const offerInclude = {
  players: { include: { player: true }, orderBy: { createdAt: 'asc' } },
  vetoes: { select: { voterMemberId: true } },
} satisfies Prisma.LeagueTradeOfferInclude;

const threadInclude = {
  memberOne: { select: { id: true, teamName: true, teamLogoUrl: true } },
  memberTwo: { select: { id: true, teamName: true, teamLogoUrl: true } },
  currentOffer: { include: offerInclude },
  offers: { include: offerInclude, orderBy: { sequence: 'desc' } },
  events: { orderBy: { createdAt: 'desc' }, take: 30 },
} satisfies Prisma.LeagueTradeThreadInclude;

type TradeThreadRecord = Prisma.LeagueTradeThreadGetPayload<{ include: typeof threadInclude }>;

interface ReadAccess {
  leagueId: string;
  seasonId: string;
  memberId: string;
  isCommissioner: boolean;
  rules: LeagueTradeCentreSnapshot['rules'];
}

export async function loadAuthorizedLeagueTradeCentre({
  leagueId,
  userId,
  view = 'inbox',
  cursor,
  pageSize = PAGE_SIZE,
}: {
  leagueId: string;
  userId: string | null;
  view?: TradeView;
  cursor?: string | null;
  pageSize?: number;
}): Promise<LeagueTradeCentreSnapshot> {
  const access = await requireReadAccess(leagueId, userId);
  const where = buildViewFilter(access, view);
  const decodedCursor = decodeCursor(cursor);
  const take = Math.min(Math.max(pageSize, 1), 50);

  const [members, legacyRosters, records, counts] = await Promise.all([
    prisma.leagueMember.findMany({
      where: { leagueId, isActive: true, status: 'ACTIVE' },
      select: {
        id: true,
        userId: true,
        teamName: true,
        teamLogoUrl: true,
        rosterPlayers: {
          select: { player: { select: { id: true, name: true, club: true, position: true } } },
          orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
    }),
    prisma.leagueRoster.findMany({
      where: { leagueId },
      select: { memberId: true, playerIds: true },
    }),
    prisma.leagueTradeThread.findMany({
      where: decodedCursor
        ? {
            AND: [
              where,
              {
                OR: [
                  { updatedAt: { lt: decodedCursor.updatedAt } },
                  { updatedAt: decodedCursor.updatedAt, id: { lt: decodedCursor.id } },
                ],
              },
            ],
          }
        : where,
      include: threadInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    }),
    loadViewCounts(access),
  ]);

  const legacyPlayerIds = new Map(
    legacyRosters.map((roster) => [roster.memberId, parsePlayerIds(roster.playerIds)])
  );
  const missingPlayerIds = members.flatMap((member) =>
    member.rosterPlayers.length ? [] : (legacyPlayerIds.get(member.id) ?? [])
  );
  const legacyPlayers = missingPlayerIds.length
    ? await prisma.player.findMany({
        where: { id: { in: [...new Set(missingPlayerIds)] } },
        select: { id: true, name: true, club: true, position: true },
      })
    : [];
  const legacyPlayersById = new Map(legacyPlayers.map((player) => [player.id, player]));
  const teams: TradeTeamDto[] = members.map((member) => ({
    memberId: member.id,
    userId: member.userId,
    teamName: member.teamName,
    teamLogoUrl: member.teamLogoUrl,
    isViewer: member.id === access.memberId,
    players: member.rosterPlayers.length
      ? member.rosterPlayers.map(({ player }) => player)
      : (legacyPlayerIds.get(member.id) ?? []).flatMap((playerId) => {
          const player = legacyPlayersById.get(playerId);
          return player ? [player] : [];
        }),
  }));

  const hasNextPage = records.length > take;
  const page = hasNextPage ? records.slice(0, take) : records;
  const last = page.at(-1);

  return {
    leagueId,
    viewerMemberId: access.memberId,
    isCommissioner: access.isCommissioner,
    rules: access.rules,
    teams,
    trades: page.flatMap((record) => {
      const trade = toTradeDto(record, access);
      return trade ? [trade] : [];
    }),
    counts,
    activeView: view,
    nextCursor:
      hasNextPage && last
        ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id })
        : null,
  };
}

export async function loadAuthorizedLeagueTradeDigest({
  leagueId,
  userId,
}: {
  leagueId: string;
  userId: string | null;
}): Promise<LeagueTradeDigest> {
  const access = await requireReadAccess(leagueId, userId);
  const [actionRequired, pending, recent] = await Promise.all([
    prisma.leagueTradeThread.count({ where: buildViewFilter(access, 'inbox') }),
    prisma.leagueTradeThread.count({
      where: {
        leagueId,
        seasonId: access.seasonId,
        status: { in: ['OPEN', 'PENDING_ADMIN_REVIEW', 'PENDING_VETO_REVIEW'] },
        OR: [{ memberOneId: access.memberId }, { memberTwoId: access.memberId }],
      },
    }),
    prisma.leagueTradeThread.findMany({
      where: {
        leagueId,
        seasonId: access.seasonId,
        OR: [{ memberOneId: access.memberId }, { memberTwoId: access.memberId }],
      },
      include: {
        memberOne: { select: { teamName: true } },
        memberTwo: { select: { teamName: true } },
        currentOffer: {
          select: {
            players: { select: { player: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 3,
    }),
  ]);

  return {
    actionRequired,
    pending,
    recent: recent.flatMap((thread) =>
      thread.currentOffer
        ? [
            {
              id: thread.id,
              status: toStatusDto(thread.status),
              teamNames: [thread.memberOne.teamName, thread.memberTwo.teamName] as [string, string],
              playerNames: thread.currentOffer.players.map(({ player }) => player.name),
              updatedAt: thread.updatedAt.toISOString(),
            },
          ]
        : []
    ),
  };
}

async function requireReadAccess(leagueId: string, userId: string | null): Promise<ReadAccess> {
  if (!userId) throw new TradeServiceError('UNAUTHORIZED', 'Sign in to view trades.', 401);
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      ownerId: true,
      activeSeasonId: true,
      settings: {
        select: {
          tradeLimit: true,
          tradeReviewMode: true,
          tradeDeadline: true,
          tradeOfferExpiryHours: true,
          tradeReviewHours: true,
          tradeVetoThreshold: true,
        },
      },
      members: {
        where: { userId, isActive: true, status: 'ACTIVE' },
        select: { id: true, isCoCommissioner: true },
        take: 1,
      },
    },
  });
  if (!league) throw new TradeServiceError('NOT_FOUND', 'League not found.', 404);
  const member = league.members[0];
  if (!member) throw new TradeServiceError('FORBIDDEN', 'League membership is required.', 403);
  if (!league.activeSeasonId) {
    throw new TradeServiceError('INVALID_STATE', 'The league does not have an active season.', 409);
  }
  return {
    leagueId,
    seasonId: league.activeSeasonId,
    memberId: member.id,
    isCommissioner: league.ownerId === userId || member.isCoCommissioner,
    rules: {
      limit: league.settings.tradeLimit,
      reviewMode: toReviewModeDto(league.settings.tradeReviewMode),
      deadline: league.settings.tradeDeadline?.toISOString() ?? null,
      offerExpiryHours: league.settings.tradeOfferExpiryHours,
      reviewHours: league.settings.tradeReviewHours,
      vetoThreshold: league.settings.tradeVetoThreshold,
    },
  };
}

function buildViewFilter(access: ReadAccess, view: TradeView): Prisma.LeagueTradeThreadWhereInput {
  const base = { leagueId: access.leagueId, seasonId: access.seasonId };
  if (view === 'inbox') {
    return { ...base, status: 'OPEN', currentOffer: { recipientMemberId: access.memberId } };
  }
  if (view === 'sent') {
    return { ...base, status: 'OPEN', currentOffer: { proposerMemberId: access.memberId } };
  }
  if (view === 'history') {
    return {
      ...base,
      status: { in: terminalStatuses },
      ...(access.isCommissioner
        ? {}
        : { OR: [{ memberOneId: access.memberId }, { memberTwoId: access.memberId }] }),
    };
  }
  return {
    ...base,
    OR: [
      access.isCommissioner
        ? { status: 'PENDING_ADMIN_REVIEW' as const }
        : {
            status: 'PENDING_ADMIN_REVIEW' as const,
            OR: [{ memberOneId: access.memberId }, { memberTwoId: access.memberId }],
          },
      { status: 'PENDING_VETO_REVIEW' },
    ],
  };
}

async function loadViewCounts(access: ReadAccess): Promise<LeagueTradeCentreSnapshot['counts']> {
  const [inbox, sent, history, review] = await Promise.all(
    (['inbox', 'sent', 'history', 'review'] as const).map((view) =>
      prisma.leagueTradeThread.count({ where: buildViewFilter(access, view) })
    )
  );
  return { inbox, sent, history, review };
}

function toTradeDto(record: TradeThreadRecord, access: ReadAccess): LeagueTradeDto | null {
  if (!record.currentOffer) return null;
  const participantIds = [record.memberOneId, record.memberTwoId];
  const actions = getAllowedTradeActions({
    status: record.status,
    proposerMemberId: record.currentOffer.proposerMemberId,
    recipientMemberId: record.currentOffer.recipientMemberId,
    participantMemberIds: participantIds,
    actorMemberId: access.memberId,
    isCommissioner: access.isCommissioner,
  }).filter(
    (action) =>
      action !== 'veto' ||
      !record.currentOffer?.vetoes.some((veto) => veto.voterMemberId === access.memberId)
  );

  return {
    id: record.id,
    status: toStatusDto(record.status),
    version: record.version,
    memberOne: {
      memberId: record.memberOne.id,
      teamName: record.memberOne.teamName,
      teamLogoUrl: record.memberOne.teamLogoUrl,
    },
    memberTwo: {
      memberId: record.memberTwo.id,
      teamName: record.memberTwo.teamName,
      teamLogoUrl: record.memberTwo.teamLogoUrl,
    },
    currentOffer: toOfferDto(record.currentOffer, record.reviewEndsAt),
    offerHistory: record.offers.map((offer) =>
      toOfferDto(offer, offer.id === record.currentOffer?.id ? record.reviewEndsAt : null)
    ),
    events: record.events.map((event) => ({
      id: event.id,
      type: event.eventType.toLowerCase(),
      actorMemberId: event.actorMemberId,
      previousStatus: event.previousStatus,
      nextStatus: event.nextStatus,
      reasonCode: event.reasonCode,
      reason: readPublicEventReason(event.eventType, event.payloadJson),
      createdAt: event.createdAt.toISOString(),
    })),
    completedAt: record.completedAt?.toISOString() ?? null,
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    allowedActions: actions,
  };
}

function toOfferDto(
  offer: TradeThreadRecord['offers'][number],
  reviewEndsAt: Date | null
): TradeOfferDto {
  return {
    id: offer.id,
    sequence: offer.sequence,
    proposerMemberId: offer.proposerMemberId,
    recipientMemberId: offer.recipientMemberId,
    status: offer.status.toLowerCase(),
    message: offer.message,
    expiresAt: offer.expiresAt.toISOString(),
    reviewMode: toReviewModeDto(offer.reviewMode),
    reviewEndsAt: reviewEndsAt?.toISOString() ?? null,
    vetoThreshold: offer.vetoThreshold,
    vetoCount: offer.vetoes.length,
    players: offer.players.map(({ player, fromMemberId, toMemberId }) => ({
      ...player,
      fromMemberId,
      toMemberId,
    })),
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
  };
}

function toReviewModeDto(mode: TradeReviewMode): TradeReviewModeDto {
  if (mode === 'ADMIN') return 'admin';
  if (mode === 'VETO') return 'veto';
  return 'none';
}

function toStatusDto(status: LeagueTradeThreadStatus): TradeThreadStatusDto {
  return status.toLowerCase() as TradeThreadStatusDto;
}

function parsePlayerIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((playerId): playerId is string => typeof playerId === 'string')
      : [];
  } catch {
    return [];
  }
}

function readPublicEventReason(eventType: string, payloadJson: string | null): string | null {
  if (eventType !== 'REJECTED' || !payloadJson) return null;

  try {
    const payload = JSON.parse(payloadJson) as unknown;
    if (!payload || typeof payload !== 'object' || !('reason' in payload)) return null;
    const reason = (payload as { reason?: unknown }).reason;
    if (typeof reason !== 'string') return null;

    const sanitized = reason.replace(/\s+/g, ' ').trim().slice(0, 500);
    return sanitized || null;
  } catch {
    return null;
  }
}

function encodeCursor(cursor: { updatedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | null | undefined): { updatedAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      updatedAt?: unknown;
      id?: unknown;
    };
    const updatedAt = typeof parsed.updatedAt === 'string' ? new Date(parsed.updatedAt) : null;
    return updatedAt && !Number.isNaN(updatedAt.getTime()) && typeof parsed.id === 'string'
      ? { updatedAt, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}
