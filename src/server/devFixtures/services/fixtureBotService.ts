import { BotPersonality } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { botManagerService } from '@/services/botManagerService';

import type { DevFixtureStepResult } from '../core/types';

const PERSONALITIES = [
  BotPersonality.BALANCED,
  BotPersonality.AGGRESSIVE,
  BotPersonality.OPPORTUNISTIC,
  BotPersonality.CONSERVATIVE,
  BotPersonality.WAIVER_HUNTER,
];

export async function ensureFixtureBotProfiles(input: {
  leagueIds: string[];
  ownerUserId: string;
}): Promise<DevFixtureStepResult[]> {
  const steps: DevFixtureStepResult[] = [];

  for (const leagueId of input.leagueIds) {
    const members = await prisma.leagueMember.findMany({
      where: {
        leagueId,
        userId: { not: input.ownerUserId },
      },
      orderBy: [{ draftSlot: 'asc' }, { joinedAt: 'asc' }],
      select: {
        id: true,
        draftSlot: true,
      },
    });

    await botManagerService.upsertProfiles({
      leagueId,
      actorUserId: input.ownerUserId,
      profiles: members.map((member, index) => ({
        memberId: member.id,
        personality: PERSONALITIES[index % PERSONALITIES.length],
        enabled: true,
        allowTradeInitiation: true,
        allowTradeResponses: true,
        allowWaiverClaims: true,
        activityLevel: 55 + (index % 5) * 8,
        tradeAggression: 45 + (index % 6) * 6,
        tradeRiskTolerance: 40 + (index % 5) * 7,
        waiverAggression: 50 + (index % 4) * 9,
        preferredTradeCount: 1,
        minimumActionIntervalMins: 180,
      })),
    });

    steps.push({
      name: `bot profiles ${leagueId}`,
      status: 'updated',
      detail: `Ensured ${members.length} enabled bot profiles.`,
    });
  }

  return steps;
}
