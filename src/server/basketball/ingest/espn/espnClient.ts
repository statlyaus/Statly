import { NbaIngestRejected, type NbaStatsProvider } from '../nbaStatsProvider';
import {
  parseBoxScore,
  parseInjuries,
  parseRoster,
  parseSchedule,
  parseScoreboard,
  parseSeasonTotals,
  parseTeams,
} from './espnParsers';

/**
 * The ESPN adapter for the NBA stats provider port: ESPN's public, unofficial site API. ESPN's terms
 * (Disney) allow personal, non-commercial use only, so `commercialUseLicensed` is false and the
 * production guard in `nbaIngestRun.ts` refuses it unless explicitly allowed.
 *
 * At most four requests are in flight; the backfill also spaces request starts with `minIntervalMs`.
 */

export const ESPN_PROVIDER_ID = 'espn';

const SITE_API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const WEB_API = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_CONCURRENCY = 4;

export interface EspnProviderOptions {
  fetchImpl?: typeof fetch;
  /** Per request. Default 15 s. */
  timeoutMs?: number;
  /** Capped at 4. */
  maxConcurrency?: number;
  /** Minimum gap between request starts. Default 0; the backfill uses 1000. */
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createEspnNbaStatsProvider(options: EspnProviderOptions = {}): NbaStatsProvider {
  const {
    fetchImpl = fetch,
    timeoutMs = 15_000,
    minIntervalMs = 0,
    now = Date.now,
    sleep = defaultSleep,
  } = options;
  const maxConcurrency = Math.min(options.maxConcurrency ?? MAX_CONCURRENCY, MAX_CONCURRENCY);

  let active = 0;
  const waiting: Array<() => void> = [];
  let nextStartAt = 0;

  async function acquire(): Promise<void> {
    if (active < maxConcurrency) {
      active += 1;
    } else {
      // release() hands its slot straight to the next waiter.
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    const wait = nextStartAt - now();
    nextStartAt = Math.max(now(), nextStartAt) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  }

  function release(): void {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }

  async function getJson(url: string): Promise<unknown> {
    await acquire();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`timed out after ${timeoutMs} ms`)),
      timeoutMs
    );
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
          signal: controller.signal,
          cache: 'no-store',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new NbaIngestRejected('fetch_failed', `ESPN ${url} failed: ${message}`, {
          cause: error,
        });
      }
      if (!response.ok) {
        throw new NbaIngestRejected('fetch_failed', `ESPN ${url} answered ${response.status}`, {
          httpStatus: response.status,
        });
      }
      try {
        return await response.json();
      } catch (error) {
        throw new NbaIngestRejected('parse_failed', `ESPN ${url} did not return JSON`, {
          cause: error,
        });
      }
    } finally {
      clearTimeout(timer);
      release();
    }
  }

  return {
    id: ESPN_PROVIDER_ID,
    commercialUseLicensed: false,
    fetchTeams: async () => parseTeams(await getJson(`${SITE_API}/teams`)),
    fetchTeamRoster: async (teamId) =>
      parseRoster(await getJson(`${SITE_API}/teams/${teamId}/roster`)),
    fetchTeamSchedule: async (teamId, season) =>
      parseSchedule(await getJson(`${SITE_API}/teams/${teamId}/schedule?season=${season}`)),
    // `dates` is one US Eastern day; ESPN rejects ranges for the NBA.
    fetchScoreboard: async (easternDate) =>
      parseScoreboard(
        await getJson(`${SITE_API}/scoreboard?dates=${easternDate.replaceAll('-', '')}`)
      ),
    fetchBoxScore: async (gameId) =>
      parseBoxScore(await getJson(`${SITE_API}/summary?event=${gameId}`)),
    fetchInjuries: async () => parseInjuries(await getJson(`${SITE_API}/injuries`)),
    // The first page is the season's top 50 scorers, enough to verify a backfill.
    fetchSeasonTotals: async (season) =>
      parseSeasonTotals(
        await getJson(`${WEB_API}/statistics/byathlete?season=${season}&seasontype=2&limit=50`)
      ),
  };
}
