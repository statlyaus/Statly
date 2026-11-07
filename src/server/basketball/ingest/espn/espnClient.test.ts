// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { rosterResponse, scoreboardResponse, teamsResponse } from '../__fixtures__/espnFixtures';
import { NbaIngestRejected } from '../nbaStatsProvider';
import { createEspnNbaStatsProvider } from './espnClient';

function serving(body: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function rejectionOf(promise: Promise<unknown>): Promise<NbaIngestRejected> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught
  );
  if (!(error instanceof NbaIngestRejected)) throw new Error(`expected a rejection, got ${error}`);
  return error;
}

describe('createEspnNbaStatsProvider', () => {
  it('is the unlicensed espn provider', () => {
    const provider = createEspnNbaStatsProvider({ fetchImpl: serving({}).fetchImpl });
    expect(provider.id).toBe('espn');
    expect(provider.commercialUseLicensed).toBe(false);
  });

  it('asks for an Eastern date on the scoreboard with a browser User-Agent', async () => {
    const { fetchImpl, calls } = serving(scoreboardResponse([]));

    await createEspnNbaStatsProvider({ fetchImpl }).fetchScoreboard('2026-11-05');

    expect(calls[0].url).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261105'
    );
    expect(new Headers(calls[0].init?.headers).get('user-agent')).toMatch(
      /^Mozilla\/5\.0 .*Chrome/
    );
  });

  it('parses what it fetches', async () => {
    const { fetchImpl } = serving(teamsResponse());
    const teams = await createEspnNbaStatsProvider({ fetchImpl }).fetchTeams();
    expect(teams).toHaveLength(30);
  });

  it('rejects a non-2xx answer as fetch_failed with its status', async () => {
    const { fetchImpl } = serving('blocked', 403);

    const error = await rejectionOf(createEspnNbaStatsProvider({ fetchImpl }).fetchInjuries());

    expect(error.reason).toBe('fetch_failed');
    expect(error.httpStatus).toBe(403);
  });

  it('rejects a network error as fetch_failed', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    const error = await rejectionOf(createEspnNbaStatsProvider({ fetchImpl }).fetchTeams());

    expect(error.reason).toBe('fetch_failed');
  });

  it('rejects a body that is not JSON as parse_failed', async () => {
    const { fetchImpl } = serving('<html>challenge</html>');
    const error = await rejectionOf(createEspnNbaStatsProvider({ fetchImpl }).fetchTeams());
    expect(error.reason).toBe('parse_failed');
  });

  it('rejects a request that outlives the timeout as fetch_failed', async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;

    const error = await rejectionOf(
      createEspnNbaStatsProvider({ fetchImpl, timeoutMs: 5 }).fetchTeams()
    );

    expect(error.reason).toBe('fetch_failed');
  });

  it('never has more than four requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return new Response(JSON.stringify(rosterResponse('1', [])));
    }) as typeof fetch;
    const provider = createEspnNbaStatsProvider({ fetchImpl, maxConcurrency: 10 });

    await Promise.all(
      Array.from({ length: 12 }, (_, index) => provider.fetchTeamRoster(String(index)))
    );

    expect(peak).toBe(4);
  });

  it('spaces request starts by the minimum interval', async () => {
    let clock = 0;
    const starts: number[] = [];
    const fetchImpl = (async () => {
      starts.push(clock);
      return new Response(JSON.stringify(rosterResponse('1', [])));
    }) as typeof fetch;
    const provider = createEspnNbaStatsProvider({
      fetchImpl,
      minIntervalMs: 1000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    for (let index = 0; index < 3; index += 1) await provider.fetchTeamRoster(String(index));

    expect(starts).toEqual([0, 1000, 2000]);
  });
});
