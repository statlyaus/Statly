import { addDays, toEasternDate } from '@/lib/basketball/fantasyWeeks';

import {
  type NbaIngestJobOptions,
  type NbaIngestPrisma,
  type NbaIngestResult,
  recordNbaIngestRun,
} from './nbaIngestRun';
import {
  NbaIngestRejected,
  type NbaProviderBoxScore,
  type NbaProviderGame,
} from './nbaStatsProvider';
import { loadTeamIds, nbaGameData } from './syncNbaSchedule';

/**
 * BOX_SCORES job. Reads yesterday's and today's scoreboards (US Eastern) for game status, then
 * ingests at most `limits.games` box scores: FINAL games never ingested (oldest first), then FINAL
 * games ingested at least 12 hours ago and not yet finalised (the one re-ingest that picks up stat
 * corrections; a game first ingested more than 24 hours after tip-off is finalised at once). Every
 * fetch happens before the first write. Each game is written in its own transaction: the game row,
 * any player the provider has not seen before (created from the box score, identity = provider ID),
 * and the game's complete set of player lines.
 *
 * Rejected, writing nothing but the run row, when a scoreboard cannot be read, when every box score
 * fetch fails, or when the provider answers 401/403/429 (blocked or rate-limited). A single game
 * that cannot be fetched, parsed or fails its sanity check is skipped and listed in the summary.
 */

export const DEFAULT_BOX_SCORE_GAMES = 8;
export const RECHECK_AFTER_MS = 12 * 60 * 60 * 1000;
// A box score first ingested this long after tip-off already carries the provider's corrections,
// so it is finalised at once (the backfill and a catch-up never fetch a game twice).
export const ALREADY_FINAL_AFTER_MS = 24 * 60 * 60 * 1000;
export const MIN_LISTED_PLAYERS_PER_TEAM = 8;
export const MAX_LISTED_PLAYERS_PER_TEAM = 20;
const BLOCKED_STATUSES = new Set([401, 403, 429]);

export interface SyncNbaBoxScoresOptions extends NbaIngestJobOptions {
  /** Read the scoreboards for game status first. Default true; the backfill passes false. */
  refreshStatuses?: boolean;
  /** Games this run must not fetch (the backfill passes the ones it already skipped). */
  excludeExternalIds?: ReadonlySet<string>;
}

export interface NbaBoxScoresSummary {
  season: number;
  /** Regular-season games of this season on the two scoreboards. */
  scoreboardGames: number;
  statusesUpdated: number;
  ingested: number;
  finalised: number;
  playersCreated: number;
  /** Rows dropped because the provider gave no player identity and they record nothing. */
  unidentifiedEmptyRows: number;
  skipped: Array<{ gameExternalId: string; reason: string }>;
  /** FINAL games of this season still without a box score after this run. */
  pending: number;
}

/** Why a fetched box score must not be stored, or null when it passes. */
export function boxScoreProblem(
  box: NbaProviderBoxScore,
  expectedExternalId: string,
  season: number
): string | null {
  const { game, lines } = box;
  if (game.externalId !== expectedExternalId) return `summary is for game ${game.externalId}`;
  if (game.season !== season) return `game is in season ${game.season}`;
  if (game.status !== 'FINAL') return `game is ${game.status}, not FINAL`;
  const perTeam = new Map<string, number>();
  for (const { teamCode } of lines) perTeam.set(teamCode, (perTeam.get(teamCode) ?? 0) + 1);
  const teams = [game.homeTeamCode, game.awayTeamCode];
  if (perTeam.size !== 2 || !teams.every((code) => perTeam.has(code))) {
    return `box score teams ${[...perTeam.keys()].join(', ') || 'none'} are not ${teams.join(' and ')}`;
  }
  for (const [code, count] of perTeam) {
    if (count < MIN_LISTED_PLAYERS_PER_TEAM || count > MAX_LISTED_PLAYERS_PER_TEAM) {
      return `${code} lists ${count} players, outside ${MIN_LISTED_PLAYERS_PER_TEAM} to ${MAX_LISTED_PLAYERS_PER_TEAM}`;
    }
  }
  if (new Set(lines.map((entry) => entry.player.externalId)).size !== lines.length) {
    return 'a player is listed twice';
  }
  return null;
}

interface Candidate {
  externalId: string;
  startsAt: Date;
  recheck: boolean;
}

async function selectCandidates(
  prisma: NbaIngestPrisma,
  providerId: string,
  season: number,
  scoreboard: NbaProviderGame[],
  { limit, now, exclude }: { limit: number; now: Date; exclude: ReadonlySet<string> }
): Promise<Candidate[]> {
  const excluded = [...exclude];
  const finalOnBoard = scoreboard.filter(
    (game) => game.status === 'FINAL' && !exclude.has(game.externalId)
  );
  const alreadyIngested = new Set(
    finalOnBoard.length === 0
      ? []
      : (
          await prisma.nbaGame.findMany({
            where: {
              provider: providerId,
              externalId: { in: finalOnBoard.map((game) => game.externalId) },
              boxScoreIngestedAt: { not: null },
            },
            select: { externalId: true },
          })
        ).map((row) => row.externalId)
  );
  const pending = await prisma.nbaGame.findMany({
    where: {
      provider: providerId,
      season,
      status: 'FINAL',
      boxScoreIngestedAt: null,
      externalId: { notIn: excluded },
    },
    orderBy: { startsAt: 'asc' },
    take: limit,
    select: { externalId: true, startsAt: true },
  });

  const fresh = new Map<string, Candidate>();
  for (const row of pending) fresh.set(row.externalId, { ...row, recheck: false });
  for (const game of finalOnBoard) {
    if (!alreadyIngested.has(game.externalId)) {
      fresh.set(game.externalId, {
        externalId: game.externalId,
        startsAt: game.startsAt,
        recheck: false,
      });
    }
  }
  const firstIngests = [...fresh.values()]
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
    .slice(0, limit);
  if (firstIngests.length >= limit) return firstIngests;

  const rechecks = await prisma.nbaGame.findMany({
    where: {
      provider: providerId,
      season,
      status: 'FINAL',
      boxScoreFinalisedAt: null,
      boxScoreIngestedAt: { lte: new Date(now.getTime() - RECHECK_AFTER_MS) },
      externalId: { notIn: excluded },
    },
    orderBy: { startsAt: 'asc' },
    take: limit - firstIngests.length,
    select: { externalId: true, startsAt: true },
  });
  return [...firstIngests, ...rechecks.map((row) => ({ ...row, recheck: true }))];
}

async function updateStatuses(
  prisma: NbaIngestPrisma,
  providerId: string,
  scoreboard: NbaProviderGame[],
  teamIds: Map<string, string>
): Promise<number> {
  if (scoreboard.length === 0) return 0;
  const rows = await prisma.nbaGame.findMany({
    where: { provider: providerId, externalId: { in: scoreboard.map((game) => game.externalId) } },
    select: { externalId: true, status: true, homeScore: true, awayScore: true, startsAt: true },
  });
  const byExternalId = new Map(rows.map((row) => [row.externalId, row]));
  let updated = 0;
  for (const game of scoreboard) {
    const row = byExternalId.get(game.externalId);
    const unchanged =
      row &&
      row.status === game.status &&
      row.homeScore === game.homeScore &&
      row.awayScore === game.awayScore &&
      row.startsAt.getTime() === game.startsAt.getTime();
    if (unchanged) continue;
    const data = nbaGameData(game, teamIds);
    await prisma.nbaGame.upsert({
      where: { provider_externalId: { provider: providerId, externalId: game.externalId } },
      create: { provider: providerId, externalId: game.externalId, ...data },
      update: data,
    });
    updated += 1;
  }
  return updated;
}

/** One game in one transaction. Returns how many players it created. */
async function writeBoxScore(
  prisma: NbaIngestPrisma,
  providerId: string,
  box: NbaProviderBoxScore,
  teamIds: Map<string, string>,
  { recheck, now }: { recheck: boolean; now: Date }
): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      const data = nbaGameData(box.game, teamIds);
      const alreadyFinal = now.getTime() - box.game.startsAt.getTime() >= ALREADY_FINAL_AFTER_MS;
      const timestamps = recheck
        ? { boxScoreFinalisedAt: now }
        : { boxScoreIngestedAt: now, ...(alreadyFinal ? { boxScoreFinalisedAt: now } : {}) };
      const game = await tx.nbaGame.upsert({
        where: { provider_externalId: { provider: providerId, externalId: box.game.externalId } },
        create: {
          provider: providerId,
          externalId: box.game.externalId,
          ...data,
          ...timestamps,
        },
        update: { ...data, ...timestamps },
        select: { id: true },
      });

      const identities = await tx.nbaPlayerIdentity.findMany({
        where: {
          provider: providerId,
          externalId: { in: box.lines.map((entry) => entry.player.externalId) },
        },
        select: { externalId: true, playerId: true },
      });
      const playerIds = new Map(
        identities.map((identity) => [identity.externalId, identity.playerId])
      );
      let created = 0;
      for (const { player, teamCode } of box.lines) {
        if (playerIds.has(player.externalId)) continue;
        const row = await tx.nbaPlayer.create({
          data: {
            fullName: player.fullName,
            positions: player.positions,
            teamId: teamIds.get(teamCode),
            identities: { create: { provider: providerId, externalId: player.externalId } },
          },
          select: { id: true },
        });
        playerIds.set(player.externalId, row.id);
        created += 1;
      }

      // The box score is the whole truth for this game: replace its lines, which also drops a
      // player a stat correction removed.
      await tx.nbaPlayerGameStat.deleteMany({ where: { gameId: game.id } });
      await tx.nbaPlayerGameStat.createMany({
        data: box.lines.map(({ player, teamCode, ...stats }) => ({
          ...stats,
          gameId: game.id,
          playerId: playerIds.get(player.externalId) as string,
          teamId: teamIds.get(teamCode) as string,
        })),
      });
      return created;
    },
    { timeout: 30_000 }
  );
}

export async function syncNbaBoxScores(
  options: SyncNbaBoxScoresOptions
): Promise<NbaIngestResult<NbaBoxScoresSummary>> {
  const {
    prisma,
    provider,
    season,
    now = new Date(),
    refreshStatuses = true,
    excludeExternalIds = new Set<string>(),
  } = options;
  const limit = options.limits?.games ?? DEFAULT_BOX_SCORE_GAMES;

  return recordNbaIngestRun('BOX_SCORES', { prisma, provider, now }, async () => {
    const today = toEasternDate(now);
    const scoreboard = refreshStatuses
      ? (
          await Promise.all(
            [addDays(today, -1), today].map((date) => provider.fetchScoreboard(date))
          )
        )
          .flat()
          .filter((game) => game.season === season)
      : [];

    const candidates = await selectCandidates(prisma, provider.id, season, scoreboard, {
      limit,
      now,
      exclude: excludeExternalIds,
    });
    const results = await Promise.allSettled(
      candidates.map((candidate) => provider.fetchBoxScore(candidate.externalId))
    );

    const fetched: Array<{ candidate: Candidate; box: NbaProviderBoxScore }> = [];
    const skipped: NbaBoxScoresSummary['skipped'] = [];
    let fetchFailures = 0;
    for (const [index, result] of results.entries()) {
      const candidate = candidates[index];
      if (result.status === 'fulfilled') {
        const problem = boxScoreProblem(result.value, candidate.externalId, season);
        if (problem) skipped.push({ gameExternalId: candidate.externalId, reason: problem });
        else fetched.push({ candidate, box: result.value });
        continue;
      }
      const error: unknown = result.reason;
      if (!(error instanceof NbaIngestRejected)) throw error;
      if (error.httpStatus !== undefined && BLOCKED_STATUSES.has(error.httpStatus)) throw error;
      if (error.reason === 'fetch_failed') fetchFailures += 1;
      skipped.push({
        gameExternalId: candidate.externalId,
        reason: `${error.reason}: ${error.message}`,
      });
    }
    if (candidates.length > 0 && fetchFailures === candidates.length) {
      throw new NbaIngestRejected(
        'fetch_failed',
        `All ${candidates.length} box-score fetches failed; first: ${skipped[0]?.reason}`
      );
    }

    const teamIds = await loadTeamIds(
      prisma,
      [...scoreboard, ...fetched.map(({ box }) => box.game)].flatMap((game) => [
        game.homeTeamCode,
        game.awayTeamCode,
      ])
    );

    // Every fetch and check is done; writes start here.
    const statusesUpdated = await updateStatuses(prisma, provider.id, scoreboard, teamIds);
    let ingested = 0;
    let finalised = 0;
    let playersCreated = 0;
    for (const { candidate, box } of fetched) {
      playersCreated += await writeBoxScore(prisma, provider.id, box, teamIds, {
        recheck: candidate.recheck,
        now,
      });
      if (candidate.recheck) finalised += 1;
      else ingested += 1;
    }

    const pending = await prisma.nbaGame.count({
      where: { provider: provider.id, season, status: 'FINAL', boxScoreIngestedAt: null },
    });
    return {
      season,
      scoreboardGames: scoreboard.length,
      statusesUpdated,
      ingested,
      finalised,
      playersCreated,
      unidentifiedEmptyRows: fetched.reduce((sum, { box }) => sum + box.unidentifiedEmptyRows, 0),
      skipped,
      pending,
    };
  });
}
