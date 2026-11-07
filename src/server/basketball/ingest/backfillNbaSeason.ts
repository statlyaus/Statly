import {
  type NbaIngestJobOptions,
  type NbaIngestPrisma,
  type NbaIngestResult,
  recordNbaIngestRun,
} from './nbaIngestRun';
import {
  NbaIngestRejected,
  type NbaProviderSeasonTotal,
  type NbaStatsProvider,
} from './nbaStatsProvider';
import { type NbaBoxScoresSummary, syncNbaBoxScores } from './syncNbaBoxScores';
import { type NbaPlayersSummary, syncNbaPlayers } from './syncNbaPlayers';
import { type NbaScheduleSummary, syncNbaSchedule } from './syncNbaSchedule';

/**
 * A whole season through the normal jobs, for `Scripts/basketball/backfill-nba-season.ts`: PLAYERS,
 * SCHEDULE for `season`, then BOX_SCORES in batches (no scoreboard) until every FINAL game has a box
 * score, PLAYERS again (so only rostered players stay active), then a check of the stored sums
 * against the provider's own season totals. Resumable: ingested games are never fetched again.
 * Recorded as one BACKFILL run around the jobs' own runs.
 *
 * A totals mismatch fails the run. It is also what would catch a game that must not be stored, such
 * as the NBA Cup final, whose stats are not part of season totals.
 */

const BATCH_SIZE = 20;
const STATS = ['points', 'rebounds', 'assists'] as const;
type VerifiedStat = (typeof STATS)[number];

export interface NbaTotalsMismatch {
  athleteExternalId: string;
  fullName: string;
  stat: VerifiedStat;
  provider: number;
  stored: number;
}

export interface NbaBackfillSummary {
  season: number;
  players: NbaPlayersSummary;
  schedule: NbaScheduleSummary;
  ingested: number;
  skipped: NbaBoxScoresSummary['skipped'];
  pending: number;
  /** Null when games are still pending (a `--limit` run): totals cannot match yet. */
  verification: { checked: number; mismatches: NbaTotalsMismatch[] } | null;
}

export interface BackfillNbaSeasonOptions extends NbaIngestJobOptions {
  /** Stop after this many box scores (for a trial run). */
  maxGames?: number;
  /** Largest per-stat difference from the provider's season totals still accepted. Default 0. */
  tolerance?: number;
  log?: (line: string) => void;
}

/**
 * Stats whose stored sum differs from the provider's total by more than `tolerance`. Keep it 0:
 * ESPN's season-totals feed can disagree with its own box scores (2026-27: one assist for two
 * players after game 401909846, whose box score and game logs match what is stored), and only then
 * should an operator rerun with `--tolerance 1` after checking the box scores.
 */
export function compareSeasonTotals(
  totals: NbaProviderSeasonTotal[],
  stored: Map<string, Record<VerifiedStat, number>>,
  tolerance = 0
): NbaTotalsMismatch[] {
  return totals.flatMap((total) =>
    STATS.flatMap((stat) => {
      const sum = stored.get(total.athleteExternalId)?.[stat] ?? 0;
      return Math.abs(sum - total[stat]) <= tolerance
        ? []
        : [
            {
              athleteExternalId: total.athleteExternalId,
              fullName: total.fullName,
              stat,
              provider: total[stat],
              stored: sum,
            },
          ];
    })
  );
}

/** Sums the stored lines of every player in the provider's sample and compares them. */
export async function verifyNbaSeasonTotals({
  prisma,
  provider,
  season,
  tolerance = 0,
}: {
  prisma: NbaIngestPrisma;
  provider: NbaStatsProvider;
  season: number;
  tolerance?: number;
}): Promise<{ checked: number; mismatches: NbaTotalsMismatch[] }> {
  const totals = await provider.fetchSeasonTotals(season);
  if (totals.length === 0) {
    throw new NbaIngestRejected(
      'out_of_bounds',
      `No season totals for ${season} to verify against`
    );
  }
  const identities = await prisma.nbaPlayerIdentity.findMany({
    where: {
      provider: provider.id,
      externalId: { in: totals.map((total) => total.athleteExternalId) },
    },
    select: { externalId: true, playerId: true },
  });
  const sums = await prisma.nbaPlayerGameStat.groupBy({
    by: ['playerId'],
    where: {
      playerId: { in: identities.map((identity) => identity.playerId) },
      game: { provider: provider.id, season },
    },
    _sum: { points: true, rebounds: true, assists: true },
  });
  const sumByPlayerId = new Map(sums.map((row) => [row.playerId, row._sum]));
  const stored = new Map(
    identities.map((identity) => {
      const sum = sumByPlayerId.get(identity.playerId);
      return [
        identity.externalId,
        {
          points: sum?.points ?? 0,
          rebounds: sum?.rebounds ?? 0,
          assists: sum?.assists ?? 0,
        },
      ];
    })
  );
  return { checked: totals.length, mismatches: compareSeasonTotals(totals, stored, tolerance) };
}

export async function backfillNbaSeason(
  options: BackfillNbaSeasonOptions
): Promise<NbaIngestResult<NbaBackfillSummary>> {
  const {
    prisma,
    provider,
    season,
    maxGames = Number.POSITIVE_INFINITY,
    tolerance = 0,
    log = () => {},
  } = options;
  const jobOptions = { prisma, provider, season, now: options.now };

  return recordNbaIngestRun('BACKFILL', options, async () => {
    const players = (await syncNbaPlayers(jobOptions)).summary;
    log(`Players: ${JSON.stringify(players)}`);
    const schedule = (await syncNbaSchedule(jobOptions)).summary;
    log(`Schedule: ${JSON.stringify(schedule)}`);

    const skipped: NbaBoxScoresSummary['skipped'] = [];
    const exclude = new Set<string>();
    let ingested = 0;
    let pending = schedule.final;
    while (ingested < maxGames) {
      const { summary } = await syncNbaBoxScores({
        ...jobOptions,
        now: new Date(),
        refreshStatuses: false,
        excludeExternalIds: exclude,
        // An operator rerunning a backfill after a fix wants every skipped game retried now.
        deferFailingGames: false,
        limits: { games: Math.min(BATCH_SIZE, maxGames - ingested) },
      });
      ingested += summary.ingested;
      pending = summary.pending;
      for (const skip of summary.skipped) {
        skipped.push(skip);
        exclude.add(skip.gameExternalId);
      }
      log(`Box scores: ${ingested} ingested, ${skipped.length} skipped, ${pending} pending`);
      if (summary.ingested === 0 && summary.skipped.length === 0) break;
    }
    // Box scores create every player they list as active on that game's team. Rosters again leave
    // only currently rostered players active, which matters after a past season.
    const rosters = (await syncNbaPlayers(jobOptions)).summary;
    log(`Players after box scores: ${JSON.stringify(rosters)}`);

    let verification: NbaBackfillSummary['verification'] = null;
    if (pending === 0) {
      verification = await verifyNbaSeasonTotals({ prisma, provider, season, tolerance });
      log(`Verified ${verification.checked} players: ${verification.mismatches.length} mismatches`);
    }
    const summary = { season, players, schedule, ingested, skipped, pending, verification };
    if (verification && verification.mismatches.length > 0) {
      throw new Error(
        `Season totals mismatch for ${verification.mismatches.length} stat(s): ${JSON.stringify(verification.mismatches)}`
      );
    }
    return summary;
  });
}
