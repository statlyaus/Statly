import { createHash } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import type { SocialMessage } from '@/types/social';

import { ensureActiveLeagueSeason } from './socialAccess';
import { socialMessageInclude, toSocialMessage } from './socialDto';
import { SocialError } from './socialErrors';
import { SOCIAL_MESSAGE_MAX_LENGTH } from './socialValidation';

export async function publishLeagueSystemMessage({
  leagueId,
  eventType,
  relatedEntityId,
  content,
}: {
  leagueId: string;
  eventType: string;
  relatedEntityId: string;
  content: string;
}): Promise<SocialMessage> {
  const normalizedContent = content.trim();
  if (!normalizedContent || normalizedContent.length > SOCIAL_MESSAGE_MAX_LENGTH) {
    throw new SocialError('VALIDATION', 'System message content is invalid');
  }
  const seasonId = await ensureActiveLeagueSeason(leagueId);
  const commandKey = `system:${eventType}:${relatedEntityId}`.slice(0, 128);

  return prisma.$transaction(async (tx) => {
    const existingCommand = await tx.socialCommand.findUnique({
      where: {
        leagueId_actorUserId_idempotencyKey: {
          leagueId,
          actorUserId: '__system__',
          idempotencyKey: commandKey,
        },
      },
      select: { resultId: true },
    });
    if (existingCommand?.resultId) {
      const existingMessage = await tx.socialMessage.findFirst({
        where: { id: existingCommand.resultId, leagueId, seasonId },
        include: socialMessageInclude,
      });
      if (existingMessage) return toSocialMessage(existingMessage, '');
    }

    const command = await tx.socialCommand.create({
      data: {
        leagueId,
        seasonId,
        actorUserId: '__system__',
        idempotencyKey: commandKey,
        commandType: 'PUBLISH_SYSTEM_MESSAGE',
        requestHash: createHash('sha256')
          .update(`${eventType}:${relatedEntityId}:${normalizedContent}`)
          .digest('hex'),
      },
    });
    const record = await tx.socialMessage.create({
      data: {
        leagueId,
        seasonId,
        type: 'SYSTEM',
        content: normalizedContent,
        relatedEntityType: eventType,
        relatedEntityId,
      },
      include: socialMessageInclude,
    });
    const message = toSocialMessage(record, '');
    await tx.socialOutboxEvent.create({
      data: {
        leagueId,
        seasonId,
        channel: 'ACTIVITY',
        actorUserId: null,
        eventType: 'social:activity',
        aggregateType: 'activity',
        aggregateId: record.id,
        payloadJson: JSON.stringify(message),
      },
    });
    await tx.socialCommand.update({
      where: { id: command.id },
      data: {
        resultType: 'message',
        resultId: record.id,
        responseJson: JSON.stringify(message),
      },
    });
    return message;
  });
}
