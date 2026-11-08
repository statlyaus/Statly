import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BasketballLeagueError } from '@/server/basketball/leagues/basketballLeagueErrors';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  canUseBasketball: vi.fn(),
  apiError: vi.fn(),
  listBasketballLeagues: vi.fn(),
  getBasketballLeagueDetail: vi.fn(),
  searchNbaPlayers: vi.fn(),
  matchPastedRoster: vi.fn(),
  createBasketballLeague: vi.fn(),
  updateBasketballLeague: vi.fn(),
  deleteBasketballLeague: vi.fn(),
  setBasketballLeagueTeams: vi.fn(),
  addBasketballRosterSpots: vi.fn(),
  updateBasketballRosterSpot: vi.fn(),
  removeBasketballRosterSpot: vi.fn(),
  setBasketballMatchup: vi.fn(),
  clearBasketballMatchup: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: mocks.getAuthenticatedUserId }));
vi.mock('@/server/basketball/basketballAccess', () => ({
  canUseBasketball: mocks.canUseBasketball,
}));
vi.mock('@/lib/logger', () => ({ logger: { apiError: mocks.apiError } }));
vi.mock('@/server/basketball/leagues/basketballLeagueQueries', () => ({
  listBasketballLeagues: mocks.listBasketballLeagues,
  getBasketballLeagueDetail: mocks.getBasketballLeagueDetail,
  searchNbaPlayers: mocks.searchNbaPlayers,
  matchPastedRoster: mocks.matchPastedRoster,
}));
vi.mock('@/server/basketball/leagues/basketballLeagueCommands', () => ({
  createBasketballLeague: mocks.createBasketballLeague,
  updateBasketballLeague: mocks.updateBasketballLeague,
  deleteBasketballLeague: mocks.deleteBasketballLeague,
  setBasketballLeagueTeams: mocks.setBasketballLeagueTeams,
  addBasketballRosterSpots: mocks.addBasketballRosterSpots,
  updateBasketballRosterSpot: mocks.updateBasketballRosterSpot,
  removeBasketballRosterSpot: mocks.removeBasketballRosterSpot,
  setBasketballMatchup: mocks.setBasketballMatchup,
  clearBasketballMatchup: mocks.clearBasketballMatchup,
}));

import * as leagueRoute from './leagues/[leagueId]/route';
import * as matchupRoute from './leagues/[leagueId]/matchups/[week]/route';
import * as rosterSpotRoute from './leagues/[leagueId]/roster/[playerId]/route';
import * as matchRoute from './leagues/[leagueId]/roster/match/route';
import * as rosterRoute from './leagues/[leagueId]/roster/route';
import * as teamsRoute from './leagues/[leagueId]/teams/route';
import * as leaguesRoute from './leagues/route';
import * as searchRoute from './players/search/route';

const USER = 'user-1';
const LEAGUE = 'league-1';
const PLAYER = 'player-1';
const BODY = { any: 'body' };

type Handler = (request: NextRequest, context: { params: Promise<never> }) => Promise<Response>;

interface RouteCase {
  name: string;
  handler: Handler;
  method: string;
  path: string;
  params?: Record<string, string>;
  body?: unknown;
  service: keyof typeof mocks;
  calledWith: unknown[];
  status: number;
}

const cases: RouteCase[] = [
  {
    name: 'GET /leagues',
    handler: leaguesRoute.GET as Handler,
    method: 'GET',
    path: '/api/basketball/leagues',
    service: 'listBasketballLeagues',
    calledWith: [USER],
    status: 200,
  },
  {
    name: 'POST /leagues',
    handler: leaguesRoute.POST as Handler,
    method: 'POST',
    path: '/api/basketball/leagues',
    body: BODY,
    service: 'createBasketballLeague',
    calledWith: [USER, BODY],
    status: 201,
  },
  {
    name: 'GET /leagues/[leagueId]',
    handler: leagueRoute.GET as Handler,
    method: 'GET',
    path: `/api/basketball/leagues/${LEAGUE}`,
    params: { leagueId: LEAGUE },
    service: 'getBasketballLeagueDetail',
    calledWith: [USER, LEAGUE],
    status: 200,
  },
  {
    name: 'PATCH /leagues/[leagueId]',
    handler: leagueRoute.PATCH as Handler,
    method: 'PATCH',
    path: `/api/basketball/leagues/${LEAGUE}`,
    params: { leagueId: LEAGUE },
    body: BODY,
    service: 'updateBasketballLeague',
    calledWith: [USER, LEAGUE, BODY],
    status: 200,
  },
  {
    name: 'DELETE /leagues/[leagueId]',
    handler: leagueRoute.DELETE as Handler,
    method: 'DELETE',
    path: `/api/basketball/leagues/${LEAGUE}`,
    params: { leagueId: LEAGUE },
    service: 'deleteBasketballLeague',
    calledWith: [USER, LEAGUE],
    status: 200,
  },
  {
    name: 'PUT /leagues/[leagueId]/teams',
    handler: teamsRoute.PUT as Handler,
    method: 'PUT',
    path: `/api/basketball/leagues/${LEAGUE}/teams`,
    params: { leagueId: LEAGUE },
    body: BODY,
    service: 'setBasketballLeagueTeams',
    calledWith: [USER, LEAGUE, BODY],
    status: 200,
  },
  {
    name: 'POST /leagues/[leagueId]/roster',
    handler: rosterRoute.POST as Handler,
    method: 'POST',
    path: `/api/basketball/leagues/${LEAGUE}/roster`,
    params: { leagueId: LEAGUE },
    body: BODY,
    service: 'addBasketballRosterSpots',
    calledWith: [USER, LEAGUE, BODY],
    status: 200,
  },
  {
    name: 'PATCH /leagues/[leagueId]/roster/[playerId]',
    handler: rosterSpotRoute.PATCH as Handler,
    method: 'PATCH',
    path: `/api/basketball/leagues/${LEAGUE}/roster/${PLAYER}`,
    params: { leagueId: LEAGUE, playerId: PLAYER },
    body: BODY,
    service: 'updateBasketballRosterSpot',
    calledWith: [USER, LEAGUE, PLAYER, BODY],
    status: 200,
  },
  {
    name: 'DELETE /leagues/[leagueId]/roster/[playerId]',
    handler: rosterSpotRoute.DELETE as Handler,
    method: 'DELETE',
    path: `/api/basketball/leagues/${LEAGUE}/roster/${PLAYER}`,
    params: { leagueId: LEAGUE, playerId: PLAYER },
    service: 'removeBasketballRosterSpot',
    calledWith: [USER, LEAGUE, PLAYER],
    status: 200,
  },
  {
    name: 'POST /leagues/[leagueId]/roster/match',
    handler: matchRoute.POST as Handler,
    method: 'POST',
    path: `/api/basketball/leagues/${LEAGUE}/roster/match`,
    params: { leagueId: LEAGUE },
    body: BODY,
    service: 'matchPastedRoster',
    calledWith: [USER, LEAGUE, BODY],
    status: 200,
  },
  {
    name: 'PUT /leagues/[leagueId]/matchups/[week]',
    handler: matchupRoute.PUT as Handler,
    method: 'PUT',
    path: `/api/basketball/leagues/${LEAGUE}/matchups/3`,
    params: { leagueId: LEAGUE, week: '3' },
    body: BODY,
    service: 'setBasketballMatchup',
    calledWith: [USER, LEAGUE, '3', BODY],
    status: 200,
  },
  {
    name: 'DELETE /leagues/[leagueId]/matchups/[week]',
    handler: matchupRoute.DELETE as Handler,
    method: 'DELETE',
    path: `/api/basketball/leagues/${LEAGUE}/matchups/3`,
    params: { leagueId: LEAGUE, week: '3' },
    service: 'clearBasketballMatchup',
    calledWith: [USER, LEAGUE, '3'],
    status: 200,
  },
  {
    name: 'GET /players/search',
    handler: searchRoute.GET as Handler,
    method: 'GET',
    path: '/api/basketball/players/search?q=jokic&limit=5',
    service: 'searchNbaPlayers',
    calledWith: ['jokic', { limit: '5' }],
    status: 200,
  },
];

function call(routeCase: RouteCase, body: string | undefined = undefined): Promise<Response> {
  const payload =
    body ?? (routeCase.body === undefined ? undefined : JSON.stringify(routeCase.body));
  const request = new NextRequest(`http://localhost${routeCase.path}`, {
    method: routeCase.method,
    ...(payload === undefined
      ? {}
      : { body: payload, headers: { 'content-type': 'application/json' } }),
  });
  return routeCase.handler(request, {
    params: Promise.resolve(routeCase.params ?? {}) as Promise<never>,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUserId.mockResolvedValue(USER);
  mocks.canUseBasketball.mockReturnValue(true);
});

describe.each(cases)('$name', (routeCase) => {
  it('answers 401 without touching the service when nobody is signed in', async () => {
    mocks.getAuthenticatedUserId.mockResolvedValue(null);

    const response = await call(routeCase);

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks[routeCase.service]).not.toHaveBeenCalled();
  });

  it('answers 404 without touching the service when the caller is not allowed into basketball', async () => {
    mocks.canUseBasketball.mockReturnValue(false);

    const response = await call(routeCase);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Not found' },
    });
    expect(mocks.canUseBasketball).toHaveBeenCalledWith(USER);
    expect(mocks[routeCase.service]).not.toHaveBeenCalled();
  });

  it('passes the caller, the URL parameters and the raw body to the service', async () => {
    mocks[routeCase.service].mockResolvedValue({ ok: true });

    const response = await call(routeCase);

    expect(response.status).toBe(routeCase.status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ success: true, data: { ok: true } });
    expect(mocks[routeCase.service]).toHaveBeenCalledWith(...routeCase.calledWith);
  });

  it('answers 404 for a league that is missing or not the caller’s', async () => {
    mocks[routeCase.service].mockRejectedValue(
      new BasketballLeagueError('NOT_FOUND', 'League not found')
    );

    const response = await call(routeCase);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'League not found' },
    });
  });
});

describe('basketball route errors', () => {
  const create = cases[1];

  it('answers 400 with field errors from the service', async () => {
    const details = { formErrors: [], fieldErrors: { name: ['Enter a name'] } };
    mocks.createBasketballLeague.mockRejectedValue(
      new BasketballLeagueError('VALIDATION', 'Check the highlighted fields', details)
    );

    const response = await call(create);

    expect(response.status).toBe(400);
    expect((await response.json()).error.details).toEqual(details);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await call(create, '{not json');

    expect(response.status).toBe(400);
    expect(mocks.createBasketballLeague).not.toHaveBeenCalled();
  });

  it('answers 409 for a conflict', async () => {
    mocks.createBasketballLeague.mockRejectedValue(new BasketballLeagueError('CONFLICT', 'Busy'));

    expect((await call(create)).status).toBe(409);
  });

  it('logs an unexpected failure and answers a generic 500', async () => {
    mocks.createBasketballLeague.mockRejectedValue(new Error('database password in message'));

    const response = await call(create);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('password');
    expect(mocks.apiError).toHaveBeenCalledWith(
      'POST',
      '/api/basketball/leagues',
      expect.any(Error)
    );
  });

  it('treats a failing identity check as a 500, not a crash', async () => {
    mocks.getAuthenticatedUserId.mockRejectedValue(new Error('auth backend down'));

    expect((await call(create)).status).toBe(500);
  });
});
