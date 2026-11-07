import { dateOnlyToString, stringToDateOnly, toEasternDate } from '@/lib/basketball/fantasyWeeks';

import {
  type NbaIngestJobOptions,
  type NbaIngestPrisma,
  type NbaIngestResult,
  recordNbaIngestRun,
} from './nbaIngestRun';
import { NbaIngestRejected } from './nbaStatsProvider';

/**
 * INJURIES job: the league-wide injury report, replacing NbaPlayerInjury as a whole list in one
 * transaction. Rows are linked by the provider's athlete ID only; an ID with no NbaPlayerIdentity is
 * skipped and counted, never matched by name. Rejected, keeping the previous list, when the feed
 * has more than 400 rows, or fewer than 20 while the season is on (between the first and last
 * stored game dates of `season`; about 90 rows is normal in November).
 */

export const MIN_IN_SEASON_INJURIES = 20;
export const MAX_INJURIES = 400;

export interface NbaInjuriesSummary {
  rows: number;
  stored: number;
  unknownPlayers: number;
  /** A player listed twice; the first entry wins. */
  duplicates: number;
  inSeason: boolean;
}

async function isInSeason(prisma: NbaIngestPrisma, season: number, now: Date): Promise<boolean> {
  const span = await prisma.nbaGame.aggregate({
    where: { season },
    _min: { gameDate: true },
    _max: { gameDate: true },
  });
  const first = span._min.gameDate;
  const last = span._max.gameDate;
  if (!first || !last) return false;
  const today = toEasternDate(now);
  return dateOnlyToString(first) <= today && today <= dateOnlyToString(last);
}

export async function syncNbaInjuries(
  options: NbaIngestJobOptions
): Promise<NbaIngestResult<NbaInjuriesSummary>> {
  const { prisma, provider, season, now = new Date() } = options;
  return recordNbaIngestRun('INJURIES', { prisma, provider, now }, async () => {
    const entries = await provider.fetchInjuries();
    if (entries.length > MAX_INJURIES) {
      throw new NbaIngestRejected(
        'out_of_bounds',
        `Injury report has ${entries.length} rows, more than ${MAX_INJURIES}`
      );
    }
    const inSeason = await isInSeason(prisma, season, now);
    if (inSeason && entries.length < MIN_IN_SEASON_INJURIES) {
      throw new NbaIngestRejected(
        'out_of_bounds',
        `Injury report has ${entries.length} rows in season, fewer than ${MIN_IN_SEASON_INJURIES}`
      );
    }

    const identities = await prisma.nbaPlayerIdentity.findMany({
      where: {
        provider: provider.id,
        externalId: { in: entries.map((entry) => entry.athleteExternalId) },
      },
      select: { externalId: true, playerId: true },
    });
    const playerIds = new Map(
      identities.map((identity) => [identity.externalId, identity.playerId])
    );

    const rows = new Map<string, (typeof entries)[number] & { playerId: string }>();
    let unknownPlayers = 0;
    let duplicates = 0;
    for (const entry of entries) {
      const playerId = playerIds.get(entry.athleteExternalId);
      if (!playerId) unknownPlayers += 1;
      else if (rows.has(playerId)) duplicates += 1;
      else rows.set(playerId, { ...entry, playerId });
    }

    await prisma.$transaction(async (tx) => {
      await tx.nbaPlayerInjury.deleteMany({});
      await tx.nbaPlayerInjury.createMany({
        data: [...rows.values()].map((row) => ({
          playerId: row.playerId,
          status: row.status,
          detail: row.detail,
          expectedReturnOn: row.expectedReturnOn ? stringToDateOnly(row.expectedReturnOn) : null,
          reportedAt: row.reportedAt,
          fetchedAt: now,
        })),
      });
    });

    return { rows: entries.length, stored: rows.size, unknownPlayers, duplicates, inSeason };
  });
}
