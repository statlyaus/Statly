// No 'server-only' here: the Socket.IO server imports this module outside Next.js.
import type { Prisma } from '@prisma/client';

/** `uniqueKey` of a season's league chat; a DM's is `dm:<memberId>:<memberId>`, a group has none. */
export const LEAGUE_CONVERSATION_KEY = 'league';

/**
 * League chat rows: messages and events in the league conversation, plus those written before
 * conversations existed (null). Never a DM's or a group's.
 */
export const LEAGUE_CHAT_MESSAGES: Prisma.SocialMessageWhereInput = {
  OR: [{ conversationId: null }, { conversation: { is: { kind: 'LEAGUE' } } }],
};
export const LEAGUE_CHAT_EVENTS: Prisma.SocialOutboxEventWhereInput = {
  OR: [{ conversationId: null }, { conversation: { is: { kind: 'LEAGUE' } } }],
};

/**
 * The season's league chat conversation, created on first use. Concurrent first messages insert
 * once: the losing insert does nothing and the read after it sees the winner's row.
 */
export async function ensureLeagueConversation(
  tx: Prisma.TransactionClient,
  scope: { leagueId: string; seasonId: string }
): Promise<string> {
  await tx.socialConversation.createMany({
    data: [
      {
        leagueId: scope.leagueId,
        seasonId: scope.seasonId,
        kind: 'LEAGUE',
        uniqueKey: LEAGUE_CONVERSATION_KEY,
      },
    ],
    skipDuplicates: true,
  });
  const conversation = await tx.socialConversation.findUniqueOrThrow({
    where: {
      seasonId_uniqueKey: { seasonId: scope.seasonId, uniqueKey: LEAGUE_CONVERSATION_KEY },
    },
    select: { id: true },
  });
  return conversation.id;
}

/**
 * Who may receive an event of this conversation: `null` for everyone in the league season (league
 * chat, or no conversation), otherwise the user ids of the DM's or group's current members.
 */
export async function privateConversationAudience(
  client: Pick<Prisma.TransactionClient, 'socialConversation'>,
  conversationId: string | null | undefined
): Promise<Set<string> | null> {
  if (!conversationId) return null;
  const conversation = await client.socialConversation.findUnique({
    where: { id: conversationId },
    select: {
      kind: true,
      members: { where: { leftAt: null }, select: { userId: true } },
    },
  });
  // A conversation that no longer exists has no audience: deliver to nobody, never the league.
  if (!conversation) return new Set();
  if (conversation.kind === 'LEAGUE') return null;
  return new Set(conversation.members.map((member) => member.userId));
}
