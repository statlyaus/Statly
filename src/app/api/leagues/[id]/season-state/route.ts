import { after, type NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getDefaultAflSeason } from '@/lib/aflSeason';
import {
  ensureLeagueSeasonMaterialized,
  getMaterializedSeasonFreshness,
  loadMaterializedSeasonSnapshots,
} from '@/lib/leagueSeason';
import { refreshLiveStatsIfNeeded } from '@/lib/liveStatsRefresh';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUserId = await getAuthenticatedUserId(request);
    if (!authUserId) return commonErrors.unauthorized();

    const { id: leagueId } = await params;
    const seasonParam = new URL(request.url).searchParams.get('season');
    const season = seasonParam ? Number(seasonParam) : getDefaultAflSeason();
    if (!Number.isFinite(season)) {
      return commonErrors.badRequest('Season must be a number');
    }

    if (leagueId === 'test-league-id') {
      return successResponse({
        leagueId,
        season,
        currentWeek: 2,
        schedule: [
          {
            id: `${leagueId}:${season}:1`,
            season,
            week: 1,
            aflRound: 1,
            roundLabel: 'Round 1',
            status: 'final' as const,
            matchupCount: 6,
            current: false,
          },
          {
            id: `${leagueId}:${season}:2`,
            season,
            week: 2,
            aflRound: 2,
            roundLabel: 'Round 2',
            status: 'in_progress' as const,
            matchupCount: 6,
            current: true,
          },
          {
            id: `${leagueId}:${season}:3`,
            season,
            week: 3,
            aflRound: 3,
            roundLabel: 'Round 3',
            status: 'scheduled' as const,
            matchupCount: 6,
            current: false,
          },
        ],
        ladder: [
          {
            userId: 'bot-user-8',
            teamName: 'Brownlow Medalists',
            ladderRank: 1,
            record: { w: 2, l: 0, t: 0 },
            points: 4,
            categoriesWon: 18,
            categoriesLost: 6,
            categoriesTied: 0,
            scheduleWeek: 2,
            currentOpponentUserId: authUserId,
            currentOpponentTeamName: 'Robbo Rockers',
            isCurrentUser: false,
          },
          {
            userId: authUserId,
            teamName: 'Robbo Rockers',
            ladderRank: 2,
            record: { w: 1, l: 0, t: 1 },
            points: 3,
            categoriesWon: 15,
            categoriesLost: 8,
            categoriesTied: 1,
            scheduleWeek: 2,
            currentOpponentUserId: 'bot-user-8',
            currentOpponentTeamName: 'Brownlow Medalists',
            isCurrentUser: true,
          },
          {
            userId: 'bot-user-7',
            teamName: 'Inside 50 Kings',
            ladderRank: 3,
            record: { w: 1, l: 1, t: 0 },
            points: 2,
            categoriesWon: 13,
            categoriesLost: 11,
            categoriesTied: 0,
            scheduleWeek: 2,
            currentOpponentUserId: 'bot-user-4',
            currentOpponentTeamName: 'Mark Masters',
            isCurrentUser: false,
          },
          {
            userId: 'bot-user-4',
            teamName: 'Mark Masters',
            ladderRank: 4,
            record: { w: 1, l: 1, t: 0 },
            points: 2,
            categoriesWon: 12,
            categoriesLost: 12,
            categoriesTied: 0,
            scheduleWeek: 2,
            currentOpponentUserId: 'bot-user-7',
            currentOpponentTeamName: 'Inside 50 Kings',
            isCurrentUser: false,
          },
        ],
      });
    }

    const membership = await prisma.leagueMember.findFirst({
      where: { leagueId, userId: authUserId },
      select: { id: true },
    });
    if (!membership) return commonErrors.forbidden('You are not a member of this league');

    let materialized = await loadMaterializedSeasonSnapshots({ leagueId, season });
    if (materialized.scheduleWeeks.length === 0 || materialized.memberSnapshots.length === 0) {
      await ensureLeagueSeasonMaterialized({ leagueId, season });
      materialized = await loadMaterializedSeasonSnapshots({ leagueId, season });
    }

    after(async () => {
      await refreshLiveStatsIfNeeded({
        minIntervalMs: 30_000,
        trigger: 'league-season-state',
        season,
      }).catch((error) => {
        logger.warn('Failed to refresh live stats after responding with league season state', {
          leagueId,
          season,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      const freshness = await getMaterializedSeasonFreshness({ leagueId, season }).catch(
        (error) => {
          logger.warn(
            'Failed to check league season freshness after responding with season state',
            {
              leagueId,
              season,
              error: error instanceof Error ? error.message : String(error),
            }
          );
          return null;
        }
      );
      if (!freshness?.stale) return;

      await ensureLeagueSeasonMaterialized({ leagueId, season }).catch((error) => {
        logger.warn('Failed to re-materialize league season after responding with season state', {
          leagueId,
          season,
          reason: freshness.reason,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    const schedule = [...materialized.scheduleWeeks]
      .sort((left, right) => left.week - right.week)
      .map((week) => ({
        id: `${leagueId}:${season}:${week.week}`,
        season,
        week: week.week,
        aflRound: week.aflRound,
        roundLabel: week.roundLabel,
        status: week.status,
        matchupCount: week.matchupIds.length,
        current: week.current,
      }));
    const currentWeek = schedule.find((week) => week.current)?.week ?? null;
    const ladder = materialized.memberSnapshots
      .map((entry) => ({
        userId: entry.userId ?? '',
        teamName: entry.teamName ?? 'Unknown team',
        ladderRank: entry.ladderRank ?? 0,
        record: {
          w: entry.record?.w ?? 0,
          l: entry.record?.l ?? 0,
          t: entry.record?.t ?? 0,
        },
        points: entry.points ?? 0,
        categoriesWon: entry.categoriesWon ?? 0,
        categoriesLost: entry.categoriesLost ?? 0,
        categoriesTied: entry.categoriesTied ?? 0,
        scheduleWeek: entry.scheduleWeek ?? null,
        currentOpponentUserId: entry.currentOpponentUserId ?? null,
        currentOpponentTeamName: entry.currentOpponentTeamName ?? null,
        isCurrentUser: entry.userId === authUserId,
      }))
      .sort((left, right) => left.ladderRank - right.ladderRank);

    return successResponse({
      leagueId,
      season,
      currentWeek,
      schedule,
      ladder,
    });
  } catch (error) {
    logger.error('Failed to load league season state', {
      error: error instanceof Error ? error.message : String(error),
    });
    return commonErrors.internalServerError('Failed to load league season state');
  }
}
