import 'server-only';

import {
  Prisma,
  type LeagueTradeOfferStatus,
  type LeagueTradeThreadStatus,
  type TradeReviewMode,
} from '@prisma/client';

import { getPlayers } from '@/lib/data';
import { prisma } from '@/lib/prisma';
import { parseCategoryDirectionsJson } from '@/server/leagues/categoryDirections';
import { buildLeaguePlayerStatDatasetForTargets } from '@/server/players/readModels/leaguePlayerStatReadModel';
import {
  normalizeFantasyCategoryKeys,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';
import type { CategoryDirection } from '@/types/leagues';

import {
  TradeServiceError,
  type LeagueTradeCentreSnapshot,
  type LeagueTradeDigest,
  type LeagueTradeDto,
  type TradeOfferStatusDto,
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
  players: {
    select: {
      playerId: true,
      playerNameSnapshot: true,
      playerClubSnapshot: true,
      playerPositionSnapshot: true,
      fromMemberId: true,
      toMemberId: true,
    },
    orderBy: { createdAt: 'asc' },
  },
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
  categories: FantasyCategoryKey[];
  categoryDirections: Partial<Record<FantasyCategoryKey, CategoryDirection>>;
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

  const [members, records, counts, sourcePlayers] = await Promise.all([
    prisma.leagueMember.findMany({
      where: { leagueId, isActive: true, status: 'ACTIVE' },
      select: {
        id: true,
        teamName: true,
        teamLogoUrl: true,
        rosterPlayers: {
          select: { player: { select: { id: true, name: true, club: true, position: true } } },
          orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
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
    getPlayers(),
  ]);

  const teams: TradeTeamDto[] = members.map((member) => ({
    memberId: member.id,
    teamName: member.teamName,
    teamLogoUrl: member.teamLogoUrl,
    isViewer: member.id === access.memberId,
    players: member.rosterPlayers.map(({ player }) => player),
  }));
  const historicalOfferPlayers = records.flatMap((record) =>
    record.offers.flatMap((offer) =>
      offer.players.map((player) => ({
        id: player.playerId,
        name: player.playerNameSnapshot,
        club: player.playerClubSnapshot,
      }))
    )
  );
  const playerStats = buildLeaguePlayerStatDatasetForTargets(
    sourcePlayers,
    [...teams.flatMap((team) => team.players), ...historicalOfferPlayers],
    {
      categories: access.categories,
      categoryDirections: access.categoryDirections,
    }
  );

  const hasNextPage = records.length > take;
  const page = hasNextPage ? records.slice(0, take) : records;
  const last = page.at(-1);

  return {
    leagueId,
    viewerMemberId: access.memberId,
    isCommissioner: access.isCommissioner,
    rules: access.rules,
    playerStats,
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
            players: { select: { playerNameSnapshot: true } },
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
              playerNames: thread.currentOffer.players.map(
                ({ playerNameSnapshot }) => playerNameSnapshot
              ),
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
      categoriesJson: true,
      settings: {
        select: {
          categoryDirectionsJson: true,
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
  const categories = normalizeStoredCategories(league.categoriesJson);
  return {
    leagueId,
    seasonId: league.activeSeasonId,
    memberId: member.id,
    isCommissioner: league.ownerId === userId || member.isCoCommissioner,
    categories,
    categoryDirections: parseCategoryDirectionsJson(
      categories,
      league.settings.categoryDirectionsJson
    ),
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
      OR: [{ memberOneId: access.memberId }, { memberTwoId: access.memberId }],
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
      type: event.eventType,
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
    status: toOfferStatusDto(offer.status),
    message: offer.message,
    expiresAt: offer.expiresAt.toISOString(),
    reviewMode: toReviewModeDto(offer.reviewMode),
    reviewEndsAt: reviewEndsAt?.toISOString() ?? null,
    vetoThreshold: offer.vetoThreshold,
    vetoCount: offer.vetoes.length,
    players: offer.players.map((player) => ({
      id: player.playerId,
      name: player.playerNameSnapshot,
      club: player.playerClubSnapshot,
      position: player.playerPositionSnapshot,
      fromMemberId: player.fromMemberId,
      toMemberId: player.toMemberId,
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
  if (status === 'OPEN') return 'PENDING';
  if (status === 'PENDING_ADMIN_REVIEW' || status === 'PENDING_VETO_REVIEW') {
    return 'ACCEPTED_PENDING_REVIEW';
  }
  if (status === 'REJECTED') return 'COMMISSIONER_REJECTED';
  if (status === 'INVALIDATED') return 'FAILED';
  return status;
}

function toOfferStatusDto(status: LeagueTradeOfferStatus): TradeOfferStatusDto {
  if (status === 'PROPOSED') return 'PENDING';
  if (status === 'ACCEPTED') return 'ACCEPTED_PENDING_REVIEW';
  if (status === 'SUPERSEDED') return 'COUNTERED';
  if (status === 'REJECTED') return 'COMMISSIONER_REJECTED';
  if (status === 'INVALIDATED') return 'FAILED';
  return status;
}

function normalizeStoredCategories(value: string | null): FantasyCategoryKey[] {
  if (!value) return [...REAL_DATA_NINE_CATEGORY_PRESET];
  try {
    return normalizeFantasyCategoryKeys(JSON.parse(value), REAL_DATA_NINE_CATEGORY_PRESET);
  } catch {
    return normalizeFantasyCategoryKeys(
      value.split(',').map((category) => category.trim()),
      REAL_DATA_NINE_CATEGORY_PRESET
    );
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
    if (
      !updatedAt ||
      Number.isNaN(updatedAt.getTime()) ||
      typeof parsed.id !== 'string' ||
      !parsed.id
    ) {
      throw new TradeServiceError('INVALID_INPUT', 'Trade cursor is invalid.');
    }
    return { updatedAt, id: parsed.id };
  } catch {
    throw new TradeServiceError('INVALID_INPUT', 'Trade cursor is invalid.');
  }
}
