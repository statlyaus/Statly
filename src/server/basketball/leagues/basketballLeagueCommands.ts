import 'server-only';

import type { BasketballLeague, Prisma } from '@prisma/client';
import { z } from 'zod';

import {
  dateOnlyToString,
  fantasyWeekOf,
  fantasyWeekRange,
  lastFantasyWeek,
  stringToDateOnly,
  toEasternDate,
  type EasternDate,
} from '@/lib/basketball/fantasyWeeks';
import { prisma } from '@/lib/prisma';
import { buildExternalUserEmail } from '@/lib/externalUserEmail';
import { BASKETBALL_CATEGORY_IDS, type BasketballCategoryId } from '@/types/basketball';

import { requireBasketballLeagueOwner } from './basketballLeagueAccess';
import type { BasketballLeagueDetail } from './basketballLeagueDto';
import {
  BasketballLeagueError,
  fieldError,
  leagueNotFound,
  type BasketballFieldErrors,
} from './basketballLeagueErrors';
import { getBasketballLeagueDetail } from './basketballLeagueQueries';
import {
  createLeagueSchema,
  leaguePatchSchema,
  leagueSettingsSchema,
  matchupSchema,
  parseInput,
  rosterEntriesSchema,
  rosterSpotPatchSchema,
  teamsSchema,
  weekSchema,
  type BasketballLeagueSettings,
} from './basketballLeagueValidation';

/** `now` decides the default `acquiredOn` (first day of the current fantasy week); tests pin it. */
export interface BasketballCommandOptions {
  now?: Date;
}

type Transaction = Prisma.TransactionClient;

function inCatalogOrder(ids: readonly BasketballCategoryId[]): BasketballCategoryId[] {
  return BASKETBALL_CATEGORY_IDS.filter((id) => ids.includes(id));
}

/**
 * The NBA season a profile plays in, named by the year it ends (2026-27 is 2027). Taken from week
 * one, which always falls inside the season, so a profile that stops early (ends 2026-12-31) is still
 * the 2027 season: a start from July on belongs to the season ending the next year.
 */
function seasonOf(weekOneStartsOn: EasternDate): number {
  const [year, month] = weekOneStartsOn.split('-').map(Number);
  return month >= 7 ? year + 1 : year;
}

function toLeagueData(settings: BasketballLeagueSettings) {
  return {
    name: settings.name,
    platform: settings.platform,
    format: settings.format,
    season: seasonOf(settings.weekOneStartsOn),
    categories: inCatalogOrder(settings.categories),
    puntCategories: inCatalogOrder(settings.puntCategories),
    teamCount: settings.teamCount,
    rosterSlotsJson: settings.rosterSlots,
    weekOneStartsOn: stringToDateOnly(settings.weekOneStartsOn),
    regularSeasonEndsOn: stringToDateOnly(settings.regularSeasonEndsOn),
    twoWeekMatchups: [...settings.twoWeekMatchups].sort((left, right) => left - right),
    auctionBudget: settings.auctionBudget,
  };
}

function toStoredSettings(league: BasketballLeague): Record<string, unknown> {
  return {
    name: league.name,
    platform: league.platform,
    format: league.format,
    categories: league.categories,
    puntCategories: league.puntCategories,
    teamCount: league.teamCount,
    rosterSlots: league.rosterSlotsJson,
    weekOneStartsOn: dateOnlyToString(league.weekOneStartsOn),
    regularSeasonEndsOn: dateOnlyToString(league.regularSeasonEndsOn),
    twoWeekMatchups: league.twoWeekMatchups,
    auctionBudget: league.auctionBudget,
  };
}

function lastWeekOf(league: BasketballLeague): number {
  return lastFantasyWeek(
    dateOnlyToString(league.weekOneStartsOn),
    dateOnlyToString(league.regularSeasonEndsOn),
    league.twoWeekMatchups
  );
}

/** First US Eastern date of the fantasy week containing `now`. */
function currentWeekStart(league: BasketballLeague, now: Date): EasternDate {
  const weekOne = dateOnlyToString(league.weekOneStartsOn);
  const week = fantasyWeekOf(toEasternDate(now), weekOne, league.twoWeekMatchups);
  return fantasyWeekRange(week, weekOne, league.twoWeekMatchups).start;
}

async function requireMyTeam(tx: Transaction, leagueId: string): Promise<{ id: string }> {
  const mine = await tx.basketballLeagueTeam.findFirst({
    where: { leagueId, isMine: true },
    select: { id: true },
  });
  if (!mine) throw new Error(`Basketball league ${leagueId} has no team marked as the user's own`);
  return mine;
}

function throwFieldErrors(fieldErrors: BasketballFieldErrors['fieldErrors']): void {
  if (Object.keys(fieldErrors).length > 0) {
    throw new BasketballLeagueError('VALIDATION', 'Check the highlighted fields', {
      formErrors: [],
      fieldErrors,
    });
  }
}

export async function createBasketballLeague(
  userId: string,
  input: unknown
): Promise<BasketballLeagueDetail> {
  const data = parseInput(createLeagueSchema, input);
  const leagueId = await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: buildExternalUserEmail(userId),
        passwordHash: 'firebase-auth',
        displayName: data.myTeamName,
      },
    });
    const league = await tx.basketballLeague.create({
      data: {
        ...toLeagueData(data),
        ownerId: userId,
        teams: {
          create: [
            { name: data.myTeamName, isMine: true, sortOrder: 0 },
            ...data.otherTeamNames.map((name, index) => ({ name, sortOrder: index + 1 })),
          ],
        },
      },
      select: { id: true },
    });
    return league.id;
  });
  return getBasketballLeagueDetail(userId, leagueId);
}

/** Applies a partial settings change, validating the merged settings with the full rule set. */
export async function updateBasketballLeague(
  userId: string,
  leagueId: string,
  input: unknown
): Promise<BasketballLeagueDetail> {
  const patch = parseInput(leaguePatchSchema, input);
  await prisma.$transaction(async (tx) => {
    const league = await requireBasketballLeagueOwner(tx, leagueId, userId);
    const merged = parseInput(leagueSettingsSchema, { ...toStoredSettings(league), ...patch });

    const teamTotal = await tx.basketballLeagueTeam.count({ where: { leagueId } });
    if (merged.teamCount < teamTotal) {
      throw fieldError('teamCount', `You have entered ${teamTotal} teams. Remove some first.`);
    }
    const lastWeek = lastFantasyWeek(
      merged.weekOneStartsOn,
      merged.regularSeasonEndsOn,
      merged.twoWeekMatchups
    );
    const lateMatchup = await tx.basketballMatchup.findFirst({
      where: { leagueId, week: { gt: lastWeek } },
      orderBy: { week: 'desc' },
      select: { week: true },
    });
    if (lateMatchup) {
      throw fieldError(
        'regularSeasonEndsOn',
        `These dates end the season in week ${lastWeek}, but week ${lateMatchup.week} has a matchup. Clear it first.`
      );
    }

    await tx.basketballLeague.updateMany({
      where: { id: leagueId, ownerId: userId },
      data: toLeagueData(merged),
    });
  });
  return getBasketballLeagueDetail(userId, leagueId);
}

/** Deletes the profile; its teams, roster spots and matchups go with it (database cascade). */
export async function deleteBasketballLeague(
  userId: string,
  leagueId: string
): Promise<{ id: string }> {
  const { count } = await prisma.basketballLeague.deleteMany({
    where: { id: leagueId, ownerId: userId },
  });
  if (count === 0) throw leagueNotFound();
  return { id: leagueId };
}

/**
 * Replaces the league's team list: entries with an `id` keep (and may rename) that team, entries
 * without one are added, and teams left out are removed with their roster spots and matchups. The
 * user's own team must stay; array order becomes the display order.
 */
export async function setBasketballLeagueTeams(
  userId: string,
  leagueId: string,
  input: unknown
): Promise<BasketballLeagueDetail> {
  const { teams } = parseInput(teamsSchema, input);
  await prisma.$transaction(async (tx) => {
    const league = await requireBasketballLeagueOwner(tx, leagueId, userId);
    const existing = await tx.basketballLeagueTeam.findMany({
      where: { leagueId },
      select: { id: true, name: true, isMine: true },
    });
    const existingById = new Map(existing.map((team) => [team.id, team]));

    const errors: BasketballFieldErrors['fieldErrors'] = {};
    teams.forEach((team, index) => {
      if (team.id && !existingById.has(team.id)) {
        errors[`teams.${index}.id`] = ['Team not found in this league'];
      }
    });
    throwFieldErrors(errors);
    const mine = existing.find((team) => team.isMine);
    if (!mine || !teams.some((team) => team.id === mine.id)) {
      throw fieldError('teams', 'Your own team cannot be removed');
    }
    if (teams.length > league.teamCount) {
      throw fieldError('teams', `This league has ${league.teamCount} teams`);
    }

    const keptIds = teams.flatMap((team) => (team.id ? [team.id] : []));
    await tx.basketballLeagueTeam.deleteMany({ where: { leagueId, id: { notIn: keptIds } } });
    // Park renamed teams on unique placeholder names first, so swapping two names cannot trip the
    // (leagueId, name) unique constraint halfway through.
    const renamed = teams.filter(
      (team) => team.id && existingById.get(team.id)?.name !== team.name
    );
    for (const team of renamed) {
      await tx.basketballLeagueTeam.updateMany({
        where: { id: team.id, leagueId },
        data: { name: `renaming ${team.id}` },
      });
    }
    for (const [sortOrder, team] of teams.entries()) {
      if (team.id) {
        await tx.basketballLeagueTeam.updateMany({
          where: { id: team.id, leagueId },
          data: { name: team.name, sortOrder },
        });
      } else {
        await tx.basketballLeagueTeam.create({ data: { leagueId, name: team.name, sortOrder } });
      }
    }
  });
  return getBasketballLeagueDetail(userId, leagueId);
}

/**
 * Adds players to teams in the league (`teamId` null: rostered by a team not entered). A player
 * already in the league is moved, not duplicated. A new or moved player's `acquiredOn` defaults to
 * the first day of the current fantasy week, and a moved player comes off the injured list unless
 * the entry says otherwise. Only ever called with player ids the user confirmed.
 */
export async function addBasketballRosterSpots(
  userId: string,
  leagueId: string,
  input: unknown,
  options: BasketballCommandOptions = {}
): Promise<BasketballLeagueDetail> {
  const { entries } = parseInput(rosterEntriesSchema, input);
  await prisma.$transaction(async (tx) => {
    const league = await requireBasketballLeagueOwner(tx, leagueId, userId);
    const teamIds = [...new Set(entries.flatMap((entry) => (entry.teamId ? [entry.teamId] : [])))];
    const playerIds = entries.map((entry) => entry.playerId);
    const [teams, players, spots] = await Promise.all([
      tx.basketballLeagueTeam.findMany({
        where: { leagueId, id: { in: teamIds } },
        select: { id: true },
      }),
      tx.nbaPlayer.findMany({ where: { id: { in: playerIds } }, select: { id: true } }),
      tx.basketballRosterSpot.findMany({
        where: { leagueId, playerId: { in: playerIds } },
        select: { id: true, playerId: true, teamId: true },
      }),
    ]);
    const knownTeams = new Set(teams.map((team) => team.id));
    const knownPlayers = new Set(players.map((player) => player.id));

    const errors: BasketballFieldErrors['fieldErrors'] = {};
    entries.forEach((entry, index) => {
      if (!knownPlayers.has(entry.playerId)) {
        errors[`entries.${index}.playerId`] = ['Player not found'];
      }
      if (entry.teamId && !knownTeams.has(entry.teamId)) {
        errors[`entries.${index}.teamId`] = ['Team not found in this league'];
      }
    });
    throwFieldErrors(errors);

    const weekStart = currentWeekStart(league, options.now ?? new Date());
    const spotByPlayer = new Map(spots.map((spot) => [spot.playerId, spot]));
    for (const entry of entries) {
      const spot = spotByPlayer.get(entry.playerId);
      if (!spot) {
        await tx.basketballRosterSpot.create({
          data: {
            leagueId,
            playerId: entry.playerId,
            teamId: entry.teamId,
            onInjuredList: entry.onInjuredList ?? false,
            acquiredOn: stringToDateOnly(entry.acquiredOn ?? weekStart),
          },
        });
        continue;
      }
      const moved = spot.teamId !== entry.teamId;
      await tx.basketballRosterSpot.updateMany({
        where: { id: spot.id, leagueId },
        data: {
          teamId: entry.teamId,
          onInjuredList: entry.onInjuredList ?? (moved ? false : undefined),
          acquiredOn: entry.acquiredOn
            ? stringToDateOnly(entry.acquiredOn)
            : moved
              ? stringToDateOnly(weekStart)
              : undefined,
        },
      });
    }
  });
  return getBasketballLeagueDetail(userId, leagueId);
}

/** Changes one spot's injured-list flag, acquired date or team; a team change is a move, as above. */
export async function updateBasketballRosterSpot(
  userId: string,
  leagueId: string,
  playerId: string,
  input: unknown,
  options: BasketballCommandOptions = {}
): Promise<BasketballLeagueDetail> {
  const patch = parseInput(rosterSpotPatchSchema, input);
  await prisma.$transaction(async (tx) => {
    const league = await requireBasketballLeagueOwner(tx, leagueId, userId);
    const spot = await tx.basketballRosterSpot.findFirst({
      where: { leagueId, playerId },
      select: { id: true, teamId: true },
    });
    if (!spot) throw new BasketballLeagueError('NOT_FOUND', 'Player is not in this league');
    if (patch.teamId) {
      const team = await tx.basketballLeagueTeam.findFirst({
        where: { id: patch.teamId, leagueId },
        select: { id: true },
      });
      if (!team) throw fieldError('teamId', 'Team not found in this league');
    }

    const moved = patch.teamId !== undefined && patch.teamId !== spot.teamId;
    await tx.basketballRosterSpot.updateMany({
      where: { id: spot.id, leagueId },
      data: {
        teamId: patch.teamId,
        onInjuredList: patch.onInjuredList ?? (moved ? false : undefined),
        acquiredOn: patch.acquiredOn
          ? stringToDateOnly(patch.acquiredOn)
          : moved
            ? stringToDateOnly(currentWeekStart(league, options.now ?? new Date()))
            : undefined,
      },
    });
  });
  return getBasketballLeagueDetail(userId, leagueId);
}

export async function removeBasketballRosterSpot(
  userId: string,
  leagueId: string,
  playerId: string
): Promise<BasketballLeagueDetail> {
  await requireBasketballLeagueOwner(prisma, leagueId, userId);
  const { count } = await prisma.basketballRosterSpot.deleteMany({ where: { leagueId, playerId } });
  if (count === 0) throw new BasketballLeagueError('NOT_FOUND', 'Player is not in this league');
  return getBasketballLeagueDetail(userId, leagueId);
}

const weekInputSchema = z.object({ week: weekSchema });

/** Sets (or replaces) the opponent of the user's own team in one fantasy week. */
export async function setBasketballMatchup(
  userId: string,
  leagueId: string,
  weekInput: unknown,
  input: unknown
): Promise<BasketballLeagueDetail> {
  const { week } = parseInput(weekInputSchema, { week: weekInput });
  const { opponentTeamId } = parseInput(matchupSchema, input);
  await prisma.$transaction(async (tx) => {
    const league = await requireBasketballLeagueOwner(tx, leagueId, userId);
    const lastWeek = lastWeekOf(league);
    if (week > lastWeek) throw fieldError('week', `The season has ${lastWeek} weeks`);
    const mine = await requireMyTeam(tx, leagueId);
    if (opponentTeamId === mine.id) {
      throw fieldError('opponentTeamId', 'Pick a team other than your own');
    }
    const opponent = await tx.basketballLeagueTeam.findFirst({
      where: { id: opponentTeamId, leagueId },
      select: { id: true },
    });
    if (!opponent) throw fieldError('opponentTeamId', 'Team not found in this league');

    await tx.basketballMatchup.upsert({
      where: { leagueId_week_teamId: { leagueId, week, teamId: mine.id } },
      create: { leagueId, week, teamId: mine.id, opponentTeamId },
      update: { opponentTeamId },
    });
  });
  return getBasketballLeagueDetail(userId, leagueId);
}

export async function clearBasketballMatchup(
  userId: string,
  leagueId: string,
  weekInput: unknown
): Promise<BasketballLeagueDetail> {
  const { week } = parseInput(weekInputSchema, { week: weekInput });
  await prisma.$transaction(async (tx) => {
    await requireBasketballLeagueOwner(tx, leagueId, userId);
    const mine = await requireMyTeam(tx, leagueId);
    const { count } = await tx.basketballMatchup.deleteMany({
      where: { leagueId, week, teamId: mine.id },
    });
    if (count === 0)
      throw new BasketballLeagueError('NOT_FOUND', `No matchup set for week ${week}`);
  });
  return getBasketballLeagueDetail(userId, leagueId);
}
