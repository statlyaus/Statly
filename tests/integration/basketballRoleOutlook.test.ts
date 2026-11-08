/**
 * The role outlook's reads against PostgreSQL: the season's box scores, schedule and injury report
 * and the history aggregates (season totals, back-to-back games and played tuples) must give the
 * engine exactly what the synthetic generator gives it in memory. Made-up teams (codes ZR*) and a
 * far-future season; every row this file writes is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => Promise<unknown>) => async () =>
    JSON.parse(JSON.stringify(await fn())),
}));

import {
  syntheticRoleHistory,
  syntheticRoleLeague,
} from '@/lib/basketball/__fixtures__/roleModelLeague';
import { daysBetween } from '@/lib/basketball/fantasyWeeks';
import type { InjuryOutlook } from '@/lib/basketball/injuryOutlook';
import {
  backToBackHistory,
  careerPriors,
  lastSeasonLines,
  type PlayerHistory,
} from '@/lib/basketball/playerHistory';
import { projectRestOfSeason } from '@/lib/basketball/restOfSeason';
import { toRoleGameRows } from '@/lib/basketball/roleGameRows';
import { runRoleModel } from '@/lib/basketball/roleModel';
import { buildScheduleContext } from '@/lib/basketball/roleSchedule';
import { projectNextFive } from '@/lib/basketball/roleStatProjection';
import { prisma } from '@/lib/prisma';
import { loadSeasonOutlook } from '@/server/basketball/readModels/roleOutlook';

const PROVIDER = 'int-role-outlook';
const SEASON = 2091;
const TEAMS = ['ZRA', 'ZRB', 'ZRC', 'ZRD', 'ZRE', 'ZRF'];
const SIDELINED = 'ZRC-02';

const current = syntheticRoleLeague({ teams: TEAMS, start: `${SEASON - 1}-10-21`, futureDays: 21 });
// The generator's 3 earlier seasons, rebuilt as box scores (syntheticRoleHistory's own seeds).
const earlier = [1, 2, 3].map((ago) => ({
  season: SEASON - ago,
  start: `${SEASON - ago - 1}-10-21`,
  league: syntheticRoleLeague({
    seed: 7 + ago,
    teams: TEAMS.slice(1),
    start: `${SEASON - ago - 1}-10-21`,
  }),
}));
const seasons = [{ season: SEASON, start: `${SEASON - 1}-10-21`, league: current }, ...earlier];
const teamId = (code: string) => `${PROVIDER}-${code}`;
const gameId = (season: number, id: string) => `${PROVIDER}-${season}-${id}`;

async function cleanUp() {
  const teams = { in: TEAMS.map(teamId) };
  await prisma.nbaPlayerGameStat.deleteMany({ where: { teamId: teams } });
  await prisma.nbaPlayerInjury.deleteMany({ where: { playerId: { startsWith: 'ZR' } } });
  await prisma.nbaGame.deleteMany({ where: { provider: PROVIDER } });
  await prisma.nbaPlayer.deleteMany({ where: { teamId: teams } });
  await prisma.nbaTeam.deleteMany({ where: { id: teams } });
}

beforeAll(async () => {
  await cleanUp();
  await prisma.nbaTeam.createMany({
    data: TEAMS.map((code) => ({ id: teamId(code), code, name: `Team ${code}` })),
  });
  const players = new Set(seasons.flatMap(({ league }) => league.rows.map((row) => row.playerId)));
  await prisma.nbaPlayer.createMany({
    data: [...players].map((id) => ({
      id,
      fullName: `Player ${id}`,
      positions: ['G'],
      teamId: teamId(id.slice(0, 3)),
    })),
  });
  for (const { season, start, league } of seasons) {
    const homeScore = new Map(
      league.rows.map((row) => [`${row.gameId}|${row.teamCode}`, row.teamScore])
    );
    await prisma.nbaGame.createMany({
      data: league.games.map((game) => {
        const id = `${game.home}-${game.away}-${daysBetween(start, game.date)}`;
        return {
          id: gameId(season, id),
          provider: PROVIDER,
          externalId: gameId(season, id),
          season,
          startsAt: new Date(`${game.date}T23:00:00Z`),
          gameDate: new Date(`${game.date}T00:00:00Z`),
          homeTeamId: teamId(game.home),
          awayTeamId: teamId(game.away),
          status: game.final ? 'FINAL' : 'SCHEDULED',
          homeScore: game.final ? homeScore.get(`${id}|${game.home}`)! : null,
          awayScore: game.final ? homeScore.get(`${id}|${game.away}`)! : null,
        };
      }),
    });
    await prisma.nbaPlayerGameStat.createMany({
      data: league.rows.map(
        ({ gameDate: _date, teamCode, teamScore: _t, opponentScore: _o, ...row }) => ({
          ...row,
          gameId: gameId(season, row.gameId),
          teamId: teamId(teamCode),
          starter: false,
          dnpReason: row.played ? null : 'COACH_DECISION',
          offensiveRebounds: 0,
          defensiveRebounds: row.rebounds,
          threePointersAttempted: row.threePointersMade,
          personalFouls: 0,
        })
      ),
    });
  }
  // A placeholder return date the season-ending flag must override.
  await prisma.nbaPlayerInjury.create({
    data: {
      playerId: SIDELINED,
      status: 'OUT',
      expectedReturnOn: new Date(`${current.today}T00:00:00Z`),
      seasonEnding: true,
      fetchedAt: new Date(`${current.today}T12:00:00Z`),
    },
  });
});

afterAll(cleanUp);

describe('loadSeasonOutlook on PostgreSQL', () => {
  it('feeds the engine the same rows, schedule, injuries and history as the generator', async () => {
    const past = syntheticRoleHistory({ teams: TEAMS, season: SEASON });
    const history: PlayerHistory = {
      priors: careerPriors(past.totals, SEASON),
      lastSeason: lastSeasonLines(past.totals, SEASON),
      backToBack: backToBackHistory(past.games, past.presence, SEASON),
    };
    const injuries = new Map<string, InjuryOutlook>([[SIDELINED, { fracNext5: 1, gamesOut: 999 }]]);
    const rows = toRoleGameRows(current.rows);
    const context = buildScheduleContext(rows, current.games, current.today);
    // The traded player is shown for his latest team only.
    const roles = runRoleModel(rows, injuries).filter(
      (role) => !(role.playerId === 'ZRB-06' && role.teamCode === 'ZRB')
    );
    const next5 = projectNextFive(rows, roles, context, history, injuries);
    const ros = projectRestOfSeason(rows, roles, context, history, injuries);

    const outlook = await loadSeasonOutlook(prisma, SEASON, current.today);

    expect(outlook.players.map((p) => [p.playerId, p.teamCode])).toEqual(
      roles.map((role) => [role.playerId, role.teamCode])
    );
    outlook.players.forEach((player, i) => {
      const { playerId: _p, teamCode: _t, raw: _r, drivers, ...role } = roles[i];
      const { playerId: _np, teamCode: _nt, raw: _nr, upcoming: _u, ...nextFive } = next5[i];
      const { playerId: _rp, teamCode: _rt, raw: _rr, ...rest } = ros[i];
      expect(player.fullName).toBe(`Player ${player.playerId}`);
      expect(player.role).toEqual({
        ...role,
        drivers: drivers.map((d) => ({ ...d, name: `Player ${d.playerId}` })),
      });
      expect(player.next5).toMatchObject(nextFive);
      expect(player.restOfSeason).toEqual(rest);
    });
    expect(outlook.players.find((p) => p.playerId === SIDELINED)?.injury).toEqual({
      status: 'OUT',
      detail: null,
      expectedReturnOn: current.today,
      seasonEnding: true,
    });
  });
});
