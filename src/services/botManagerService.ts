import { randomUUID } from 'node:crypto';

import { BotPersonality, LeagueRole, TradeStatus, type LeagueBotProfile } from '@prisma/client';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { prisma } from '@/lib/prisma';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';
import { tradeService } from '@/services/tradeService';

type BotProfileUpdate = {
  memberId: string;
  personality?: BotPersonality;
  enabled?: boolean;
  allowTradeInitiation?: boolean;
  allowTradeResponses?: boolean;
  allowWaiverClaims?: boolean;
  activityLevel?: number;
  tradeAggression?: number;
  tradeRiskTolerance?: number;
  waiverAggression?: number;
  preferredTradeCount?: number;
  minimumActionIntervalMins?: number;
};

type RunLeagueBotsInput = {
  leagueId: string;
  actorUserId: string;
  season?: number;
  maxActions?: number;
  random?: () => number;
};

type RunAction =
  | { type: 'trade_accept'; memberId: string; tradeId: string }
  | { type: 'trade_decline'; memberId: string; tradeId: string }
  | { type: 'trade_offer'; memberId: string; tradeId: string; targetUserId: string }
  | { type: 'waiver_claim'; memberId: string; claimId: string; playerId: string };

type ValueMap = Map<string, number>;

type ProfileRow = LeagueBotProfile & {
  member: {
    id: string;
    userId: string;
    teamName: string;
    draftSlot: number | null;
    rosterPlayers: Array<{ playerId: string; sortOrder: number }>;
  };
};

function clampPercent(value: number | undefined, fallback: number) {
  const source = Number.isFinite(value) ? Number(value) : fallback;
  return Math.max(0, Math.min(100, Math.round(source)));
}

function clampPositiveInt(value: number | undefined, fallback: number, min = 1, max = 1440) {
  const source = Number.isFinite(value) ? Number(value) : fallback;
  return Math.max(min, Math.min(max, Math.round(source)));
}

function chancePassed(probability: number, random: () => number) {
  return random() <= Math.max(0, Math.min(1, probability));
}

function personalityDefaults(personality: BotPersonality) {
  switch (personality) {
    case BotPersonality.AGGRESSIVE:
      return {
        activityLevel: 82,
        tradeAggression: 80,
        tradeRiskTolerance: 68,
        waiverAggression: 58,
      };
    case BotPersonality.OPPORTUNISTIC:
      return {
        activityLevel: 66,
        tradeAggression: 72,
        tradeRiskTolerance: 56,
        waiverAggression: 64,
      };
    case BotPersonality.CONSERVATIVE:
      return {
        activityLevel: 46,
        tradeAggression: 30,
        tradeRiskTolerance: 24,
        waiverAggression: 44,
      };
    case BotPersonality.WAIVER_HUNTER:
      return {
        activityLevel: 74,
        tradeAggression: 38,
        tradeRiskTolerance: 42,
        waiverAggression: 86,
      };
    case BotPersonality.BALANCED:
    default:
      return {
        activityLevel: 60,
        tradeAggression: 52,
        tradeRiskTolerance: 48,
        waiverAggression: 52,
      };
  }
}

function getTradeResponseMargin(profile: ProfileRow) {
  return (profile.tradeRiskTolerance - 50) * 1.2;
}

function getTradeOfferReach(profile: ProfileRow) {
  return 4 + profile.tradeAggression * 0.35 + profile.tradeRiskTolerance * 0.2;
}

function getWaiverUpgradeFloor(profile: ProfileRow) {
  return Math.max(1.5, 9 - profile.waiverAggression * 0.08);
}

function isActionDue(profile: ProfileRow, now: Date) {
  if (!profile.lastAutomatedAt) return true;
  return (
    now.getTime() - profile.lastAutomatedAt.getTime() >=
    profile.minimumActionIntervalMins * 60 * 1000
  );
}

async function assertLeagueAutomationAccess(leagueId: string, actorUserId: string) {
  const membership = await prisma.leagueMember.findFirst({
    where: { leagueId, userId: actorUserId },
    select: {
      role: true,
      league: {
        select: {
          ownerId: true,
        },
      },
    },
  });

  if (!membership) {
    throw new Error('forbidden:Not a league member');
  }

  if (membership.league.ownerId !== actorUserId && membership.role !== LeagueRole.COMMISSIONER) {
    throw new Error('forbidden:Only the owner or a commissioner can manage bots');
  }
}

async function loadProfiles(leagueId: string) {
  return prisma.leagueBotProfile.findMany({
    where: { leagueId, enabled: true },
    include: {
      member: {
        select: {
          id: true,
          userId: true,
          teamName: true,
          draftSlot: true,
          rosterPlayers: {
            select: {
              playerId: true,
              sortOrder: true,
            },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
    orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
  });
}

async function loadPlayerValues(season: number, playerIds: string[]) {
  const uniqueIds = Array.from(new Set(playerIds));
  const summaries = uniqueIds.length
    ? await prisma.playerSeasonSummary.findMany({
        where: {
          season,
          playerId: { in: uniqueIds },
        },
        select: {
          playerId: true,
          averageScore: true,
          totalValue: true,
        },
      })
    : [];

  const valueMap: ValueMap = new Map();
  for (const summary of summaries) {
    const score = summary.totalValue > 0 ? summary.totalValue : summary.averageScore;
    valueMap.set(summary.playerId, Math.round(score * 10) / 10);
  }

  for (const playerId of uniqueIds) {
    if (!valueMap.has(playerId)) valueMap.set(playerId, 0);
  }

  return valueMap;
}

async function markProfilesTouched(memberIds: string[], touchedAt: Date) {
  if (memberIds.length === 0) return;
  await prisma.leagueBotProfile.updateMany({
    where: {
      memberId: { in: memberIds },
    },
    data: {
      lastAutomatedAt: touchedAt,
    },
  });
}

export const botManagerService = {
  async listProfiles(input: { leagueId: string; actorUserId: string }) {
    await assertLeagueAutomationAccess(input.leagueId, input.actorUserId);

    const [members, profiles] = await Promise.all([
      prisma.leagueMember.findMany({
        where: { leagueId: input.leagueId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          },
        },
        orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
      }),
      prisma.leagueBotProfile.findMany({
        where: { leagueId: input.leagueId },
      }),
    ]);

    const profileByMemberId = new Map(profiles.map((profile) => [profile.memberId, profile]));

    return members.map((member) => ({
      memberId: member.id,
      userId: member.userId,
      teamName: member.teamName,
      draftSlot: member.draftSlot,
      role: member.role,
      displayName: member.user.displayName,
      email: member.user.email,
      isBotCandidate: member.userId.startsWith('bot-user-'),
      profile: profileByMemberId.get(member.id) ?? null,
    }));
  },

  async upsertProfiles(input: {
    leagueId: string;
    actorUserId: string;
    profiles: BotProfileUpdate[];
  }) {
    await assertLeagueAutomationAccess(input.leagueId, input.actorUserId);

    const memberIds = Array.from(new Set(input.profiles.map((profile) => profile.memberId)));
    const members = await prisma.leagueMember.findMany({
      where: {
        leagueId: input.leagueId,
        id: { in: memberIds },
      },
      select: {
        id: true,
      },
    });

    const validMemberIds = new Set(members.map((member) => member.id));
    for (const profile of input.profiles) {
      if (!validMemberIds.has(profile.memberId)) {
        throw new Error(`bad_request:Unknown league member ${profile.memberId}`);
      }
    }

    const results = [];
    for (const profile of input.profiles) {
      const defaults = personalityDefaults(profile.personality ?? BotPersonality.BALANCED);
      const record = await prisma.leagueBotProfile.upsert({
        where: { memberId: profile.memberId },
        create: {
          leagueId: input.leagueId,
          memberId: profile.memberId,
          personality: profile.personality ?? BotPersonality.BALANCED,
          enabled: profile.enabled ?? true,
          allowTradeInitiation: profile.allowTradeInitiation ?? true,
          allowTradeResponses: profile.allowTradeResponses ?? true,
          allowWaiverClaims: profile.allowWaiverClaims ?? true,
          activityLevel: clampPercent(profile.activityLevel, defaults.activityLevel),
          tradeAggression: clampPercent(profile.tradeAggression, defaults.tradeAggression),
          tradeRiskTolerance: clampPercent(profile.tradeRiskTolerance, defaults.tradeRiskTolerance),
          waiverAggression: clampPercent(profile.waiverAggression, defaults.waiverAggression),
          preferredTradeCount: clampPositiveInt(profile.preferredTradeCount, 1, 1, 3),
          minimumActionIntervalMins: clampPositiveInt(
            profile.minimumActionIntervalMins,
            180,
            5,
            10080
          ),
        },
        update: {
          ...(profile.personality !== undefined ? { personality: profile.personality } : {}),
          ...(profile.enabled !== undefined ? { enabled: profile.enabled } : {}),
          ...(profile.allowTradeInitiation !== undefined
            ? { allowTradeInitiation: profile.allowTradeInitiation }
            : {}),
          ...(profile.allowTradeResponses !== undefined
            ? { allowTradeResponses: profile.allowTradeResponses }
            : {}),
          ...(profile.allowWaiverClaims !== undefined
            ? { allowWaiverClaims: profile.allowWaiverClaims }
            : {}),
          ...(profile.activityLevel !== undefined
            ? { activityLevel: clampPercent(profile.activityLevel, defaults.activityLevel) }
            : {}),
          ...(profile.tradeAggression !== undefined
            ? { tradeAggression: clampPercent(profile.tradeAggression, defaults.tradeAggression) }
            : {}),
          ...(profile.tradeRiskTolerance !== undefined
            ? {
                tradeRiskTolerance: clampPercent(
                  profile.tradeRiskTolerance,
                  defaults.tradeRiskTolerance
                ),
              }
            : {}),
          ...(profile.waiverAggression !== undefined
            ? {
                waiverAggression: clampPercent(profile.waiverAggression, defaults.waiverAggression),
              }
            : {}),
          ...(profile.preferredTradeCount !== undefined
            ? { preferredTradeCount: clampPositiveInt(profile.preferredTradeCount, 1, 1, 3) }
            : {}),
          ...(profile.minimumActionIntervalMins !== undefined
            ? {
                minimumActionIntervalMins: clampPositiveInt(
                  profile.minimumActionIntervalMins,
                  180,
                  5,
                  10080
                ),
              }
            : {}),
        },
      });
      results.push(record);
    }

    return results;
  },

  async runLeagueBots(input: RunLeagueBotsInput) {
    const random = input.random ?? Math.random;
    const season = input.season ?? getDefaultAflSeason();
    const maxActions = Math.max(1, Math.min(50, input.maxActions ?? 12));
    const now = new Date();

    await assertLeagueAutomationAccess(input.leagueId, input.actorUserId);

    const [profiles, allMembers] = await Promise.all([
      loadProfiles(input.leagueId),
      prisma.leagueMember.findMany({
        where: { leagueId: input.leagueId },
        include: {
          rosterPlayers: {
            select: {
              playerId: true,
              sortOrder: true,
            },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
        orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
      }),
    ]);
    const dueProfiles = profiles.filter((profile) => isActionDue(profile, now));
    if (dueProfiles.length === 0) {
      return {
        leagueId: input.leagueId,
        season,
        actions: [] as RunAction[],
        skipped: 'No bots due',
      };
    }

    const pendingTrades = await prisma.trade.findMany({
      where: {
        leagueId: input.leagueId,
        status: TradeStatus.PROPOSED,
        OR: [
          { recipientUserId: { in: dueProfiles.map((profile) => profile.member.userId) } },
          { proposerUserId: { in: dueProfiles.map((profile) => profile.member.userId) } },
        ],
      },
      include: {
        items: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const allPlayerIds = [
      ...allMembers.flatMap((member) => member.rosterPlayers.map((row) => row.playerId)),
      ...pendingTrades.flatMap((trade) => trade.items.map((item) => item.playerId)),
    ];
    const playerValues = await loadPlayerValues(season, allPlayerIds);
    const actions: RunAction[] = [];
    const touchedMembers = new Set<string>();

    for (const trade of pendingTrades) {
      if (actions.length >= maxActions) break;
      const profile = dueProfiles.find(
        (candidate) =>
          candidate.allowTradeResponses &&
          candidate.member.userId === trade.recipientUserId &&
          !touchedMembers.has(candidate.member.id)
      );
      if (!profile) continue;

      const incomingValue = trade.items
        .filter((item) => item.toUserId === profile.member.userId)
        .reduce((sum, item) => sum + (playerValues.get(item.playerId) ?? 0), 0);
      const outgoingValue = trade.items
        .filter((item) => item.fromUserId === profile.member.userId)
        .reduce((sum, item) => sum + (playerValues.get(item.playerId) ?? 0), 0);
      const netValue = incomingValue - outgoingValue;
      const accept =
        netValue >= getTradeResponseMargin(profile) &&
        chancePassed(0.45 + profile.activityLevel / 200, random);

      const result = accept
        ? await tradeService.acceptTrade({
            requestId: randomUUID(),
            tradeId: trade.id,
            actorUserId: profile.member.userId,
          })
        : await tradeService.declineTrade({
            requestId: randomUUID(),
            tradeId: trade.id,
            actorUserId: profile.member.userId,
          });

      actions.push({
        type: accept ? 'trade_accept' : 'trade_decline',
        memberId: profile.member.id,
        tradeId: result.tradeId,
      });
      touchedMembers.add(profile.member.id);
    }

    const profilesByMemberId = new Map(dueProfiles.map((profile) => [profile.member.id, profile]));
    const ownedPlayerIds = new Set(
      await prisma.leagueRosterPlayer
        .findMany({
          where: { leagueId: input.leagueId },
          select: { playerId: true },
        })
        .then((rows) => rows.map((row) => row.playerId))
    );

    const pendingClaimPlayerIds = new Set(
      await prisma.waiverClaim
        .findMany({
          where: {
            leagueId: input.leagueId,
            status: 'PENDING',
          },
          select: { playerId: true },
        })
        .then((rows) => rows.map((row) => row.playerId))
    );

    const freeAgentCandidates = await prisma.playerSeasonSummary.findMany({
      where: {
        season,
        playerId: {
          notIn: Array.from(new Set([...ownedPlayerIds, ...pendingClaimPlayerIds])),
        },
      },
      include: {
        player: {
          select: {
            id: true,
            active: true,
          },
        },
      },
      orderBy: [{ averageScore: 'desc' }, { totalValue: 'desc' }],
      take: 80,
    });

    const rosterLimit = await prisma.league.findUnique({
      where: { id: input.leagueId },
      select: {
        settings: {
          select: {
            rosterSize: true,
            benchSize: true,
          },
        },
      },
    });
    const maxRosterSize =
      (rosterLimit?.settings?.rosterSize ?? 0) + (rosterLimit?.settings?.benchSize ?? 0);

    for (const profile of dueProfiles) {
      if (actions.length >= maxActions) break;
      if (!profile.allowWaiverClaims || touchedMembers.has(profile.member.id)) continue;
      if (!chancePassed(profile.activityLevel / 100, random)) continue;

      const currentRoster = profile.member.rosterPlayers.map((row) => row.playerId);
      const worstOwned = currentRoster
        .map((playerId) => ({ playerId, value: playerValues.get(playerId) ?? 0 }))
        .sort((left, right) => left.value - right.value)[0];
      const target = freeAgentCandidates.find((candidate) => candidate.player.active);
      if (!target) continue;

      const targetValue = target.totalValue > 0 ? target.totalValue : target.averageScore;
      const worstValue = worstOwned?.value ?? 0;
      const needsDrop = maxRosterSize > 0 && currentRoster.length >= maxRosterSize;
      const upgradeFloor = getWaiverUpgradeFloor(profile);
      if (needsDrop && targetValue - worstValue < upgradeFloor) {
        continue;
      }

      const claim = await leagueApplicationService.submitWaiverClaim({
        leagueId: input.leagueId,
        userId: profile.member.userId,
        teamId: profile.member.id,
        playerId: target.playerId,
        dropPlayerId: needsDrop ? worstOwned?.playerId : undefined,
        priority: 1,
        bidAmount: undefined,
      });

      actions.push({
        type: 'waiver_claim',
        memberId: profile.member.id,
        claimId: claim.id,
        playerId: target.playerId,
      });
      touchedMembers.add(profile.member.id);
      freeAgentCandidates.splice(freeAgentCandidates.indexOf(target), 1);
    }

    const memberValueMaps = new Map(
      allMembers.map((member) => [
        member.id,
        member.rosterPlayers
          .map((row) => ({ playerId: row.playerId, value: playerValues.get(row.playerId) ?? 0 }))
          .sort((left, right) => left.value - right.value),
      ])
    );
    const openTradeUsers = new Set(
      pendingTrades.flatMap((trade) => [trade.proposerUserId, trade.recipientUserId])
    );

    for (const profile of dueProfiles) {
      if (actions.length >= maxActions) break;
      if (!profile.allowTradeInitiation || touchedMembers.has(profile.member.id)) continue;
      if (openTradeUsers.has(profile.member.userId)) continue;
      if (!chancePassed(profile.activityLevel / 120, random)) continue;

      const ownPlayers = memberValueMaps.get(profile.member.id) ?? [];
      if (ownPlayers.length === 0) continue;
      const offerPlayer =
        ownPlayers[Math.min(ownPlayers.length - 1, profile.preferredTradeCount - 1)];

      const tradeTargets = allMembers
        .filter(
          (member) => member.userId !== profile.member.userId && !openTradeUsers.has(member.userId)
        )
        .map((member) => {
          const targetPlayers = (memberValueMaps.get(member.id) ?? []).filter(
            (player) =>
              player.value > offerPlayer.value &&
              player.value - offerPlayer.value <= getTradeOfferReach(profile)
          );
          const desired = targetPlayers[targetPlayers.length - 1];
          if (!desired) return null;
          return { member, desired };
        })
        .filter(
          (
            entry
          ): entry is {
            member: (typeof allMembers)[number];
            desired: { playerId: string; value: number };
          } => Boolean(entry)
        )
        .sort((left, right) => left.desired.value - right.desired.value);

      const target = tradeTargets[0];
      if (!target) continue;

      const result = await tradeService.proposeTrade({
        requestId: randomUUID(),
        leagueId: input.leagueId,
        proposerUserId: profile.member.userId,
        recipientUserId: target.member.userId,
        note: `${profile.personality.toLowerCase()} bot offer`,
        items: [
          {
            fromUserId: profile.member.userId,
            toUserId: target.member.userId,
            playerId: offerPlayer.playerId,
          },
          {
            fromUserId: target.member.userId,
            toUserId: profile.member.userId,
            playerId: target.desired.playerId,
          },
        ],
      });

      actions.push({
        type: 'trade_offer',
        memberId: profile.member.id,
        tradeId: result.tradeId,
        targetUserId: target.member.userId,
      });
      touchedMembers.add(profile.member.id);
      openTradeUsers.add(profile.member.userId);
      openTradeUsers.add(target.member.userId);
    }

    await markProfilesTouched(Array.from(touchedMembers), now);

    return {
      leagueId: input.leagueId,
      season,
      actions,
      skipped: actions.length === 0 ? 'No eligible bot actions' : null,
    };
  },
};
