import type { BasketballLeague, Prisma } from '@prisma/client';

import { leagueNotFound } from './basketballLeagueErrors';

type LeagueReader = Pick<Prisma.TransactionClient, 'basketballLeague'>;

/**
 * The league when `userId` owns it; otherwise a NOT_FOUND error identical to the one for a league
 * that does not exist, so a non-owner learns nothing. Every basketball league read and write starts
 * here (or filters by `ownerId` itself) and then scopes each further query by this `leagueId`.
 */
export async function requireBasketballLeagueOwner(
  client: LeagueReader,
  leagueId: string,
  userId: string
): Promise<BasketballLeague> {
  const league = await client.basketballLeague.findFirst({
    where: { id: leagueId, ownerId: userId },
  });
  if (!league) throw leagueNotFound();
  return league;
}
