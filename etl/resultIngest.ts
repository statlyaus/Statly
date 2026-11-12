/**
 * AFL match result ingest: turns the rows `fetch_fw_results.R` reads from Footywire through fitzRoy
 * into `AflMatchResult` rows (fantasy PostgreSQL, see prisma/schema.prisma). Pure apart from the
 * injected store, so the rules are tested without a database.
 *
 * Every rule fails closed: an unknown club or round, an unreadable score or a duplicate match
 * rejects the whole batch before anything is written. A result whose content changed is never
 * updated in place: the stored row is superseded by a new one with the reason. Re-ingesting
 * unchanged results writes nothing.
 */
import { createHash, randomUUID } from 'crypto';

import { FINALS_WEEK, footywireClub } from './fixtureIngest';

export type ResultSourceRow = {
  season: number;
  /** Footywire match id, from its ft_match_statistics?mid= link. */
  match_id: string;
  round_label: string;
  home_team: string;
  away_team: string;
  home_points: number | null;
  away_points: number | null;
  date: string;
  /** The season's last numbered round in the Footywire fixture; finals are numbered on from it. */
  last_home_and_away_round: number;
};

/** The line `fetch_fw_results.R` prints after its last result row. */
export type ResultEndRow = { end_of_results: number };

/**
 * Splits the R script's parsed NDJSON lines into result rows, refusing output that does not end
 * with the end-of-results line or whose count disagrees: an R failure part-way leaves no such line.
 */
export function completeResultRows(lines: readonly unknown[]): ResultSourceRow[] {
  const last = lines[lines.length - 1] as Partial<ResultEndRow> | undefined;
  if (!last || typeof last.end_of_results !== 'number') {
    throw new Error('Footywire results output ended without its end-of-results line');
  }
  const rows = lines.slice(0, -1) as ResultSourceRow[];
  if (rows.length !== last.end_of_results) {
    throw new Error(
      `Footywire results output has ${rows.length} rows, expected ${last.end_of_results}`
    );
  }
  return rows;
}

export type MatchResultStatus = 'FINAL' | 'ABANDONED';

export type MatchResult = {
  season: number;
  round: number;
  matchId: string;
  matchUid: string;
  homeClub: string;
  awayClub: string;
  homePoints: number | null;
  awayPoints: number | null;
  margin: number | null;
  status: MatchResultStatus;
  contentHash: string;
};

/** A stored `AflMatchResult` row, current or superseded. */
export type StoredMatchResult = Pick<
  MatchResult,
  'matchId' | 'contentHash' | 'homePoints' | 'awayPoints' | 'status' | 'homeClub' | 'awayClub'
> & { id: string; supersededById: string | null };

export type ResultSupersede = { previous: StoredMatchResult; next: MatchResult; reason: string };

export type ResultWritePlan = {
  inserts: MatchResult[];
  supersedes: ResultSupersede[];
  unchanged: number;
};

export type ResultStoreTransaction = {
  /** The current (not superseded) stored rows of these matches. */
  read(season: number, matchIds: readonly string[]): Promise<StoredMatchResult[]>;
  insert(id: string, result: MatchResult, fetchedAt: Date): Promise<void>;
  markSuperseded(previousId: string, nextId: string, reason: string): Promise<void>;
};

export type ResultStore = {
  /** Runs `work` in one transaction that holds the season's result lock; any throw rolls it back. */
  transaction<T>(season: number, work: (tx: ResultStoreTransaction) => Promise<T>): Promise<T>;
};

// Footywire's match pages name some clubs differently from its fixture.
const MATCH_PAGE_CLUB_NAMES: Record<string, string> = {
  Brisbane: 'Brisbane Lions',
  'Greater Western Sydney': 'GWS',
  'GWS Giants': 'GWS',
};

function resultClub(name: string) {
  const trimmed = String(name ?? '').trim();
  return footywireClub(MATCH_PAGE_CLUB_NAMES[trimmed] ?? trimmed);
}

function roundNumber(label: string, lastHomeAndAwayRound: number): number {
  const trimmed = String(label ?? '').trim();
  const numbered = /^Round (\d+)$/.exec(trimmed);
  if (numbered) return Number(numbered[1]);
  const week = FINALS_WEEK[trimmed];
  if (week === undefined) throw new Error(`Unknown Footywire round "${label}"`);
  return lastHomeAndAwayRound + week;
}

function points(value: unknown, side: string, matchId: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 400) {
    throw new Error(`Unreadable ${side} score "${value}" for Footywire match ${matchId}`);
  }
  return value;
}

/** sha256 over the stored result fields, in a fixed order. fetchedAt is not part of it. */
export function resultContentHash(
  result: Omit<MatchResult, 'contentHash' | 'margin'> & { margin: number | null }
): string {
  const canonical = JSON.stringify([
    result.season,
    result.round,
    result.matchId,
    result.matchUid,
    result.homeClub,
    result.awayClub,
    result.homePoints,
    result.awayPoints,
    result.margin,
    result.status,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export function buildMatchResults(rows: readonly ResultSourceRow[]): MatchResult[] {
  if (rows.length === 0) throw new Error('Footywire returned no match results');

  const season = Number(rows[0].season);
  if (!Number.isInteger(season)) throw new Error(`Unreadable results season "${rows[0].season}"`);

  const seenIds = new Set<string>();
  const seenUids = new Set<string>();
  return rows.map((row) => {
    if (Number(row.season) !== season) throw new Error('Result rows span more than one season');
    const matchId = String(row.match_id ?? '').trim();
    if (!/^\d+$/.test(matchId)) throw new Error(`Unreadable Footywire match id "${row.match_id}"`);
    if (seenIds.has(matchId)) throw new Error(`Duplicate Footywire match ${matchId}`);
    seenIds.add(matchId);

    const lastRound = Number(row.last_home_and_away_round);
    if (!Number.isInteger(lastRound) || lastRound < 1) {
      throw new Error(`Unreadable last home-and-away round "${row.last_home_and_away_round}"`);
    }
    const round = roundNumber(row.round_label, lastRound);
    const home = resultClub(row.home_team);
    const away = resultClub(row.away_team);
    if (home.abbr === away.abbr) throw new Error(`Footywire match ${matchId} has one club twice`);

    const matchUid = `${season}-R${round}-${home.abbr}-${away.abbr}`;
    if (seenUids.has(matchUid)) throw new Error(`Duplicate result for ${matchUid}`);
    seenUids.add(matchUid);

    // Footywire posts a match page only for a played match, so every row is FINAL. ABANDONED is
    // recorded by an operator (docs/runbooks/monitoring-and-alerts.md), never inferred from a gap.
    const homePoints = points(row.home_points, 'home', matchId);
    const awayPoints = points(row.away_points, 'away', matchId);
    const fields = {
      season,
      round,
      matchId,
      matchUid,
      homeClub: home.name,
      awayClub: away.name,
      homePoints,
      awayPoints,
      margin: homePoints - awayPoints,
      status: 'FINAL' as const,
    };
    return { ...fields, contentHash: resultContentHash(fields) };
  });
}

function describe(
  result: Pick<MatchResult, 'homeClub' | 'awayClub' | 'homePoints' | 'awayPoints' | 'status'>
) {
  return result.status === 'ABANDONED'
    ? `${result.homeClub} v ${result.awayClub} abandoned`
    : `${result.homeClub} ${result.homePoints} v ${result.awayClub} ${result.awayPoints}`;
}

export function supersedeReason(
  previous: StoredMatchResult,
  next: MatchResult,
  source = 'Footywire result changed'
): string {
  return `${source}: ${describe(previous)} is now ${describe(next)}`;
}

/**
 * An operator-recorded ABANDONED result (#1315): a game abandoned without a result has no Footywire
 * match page, so the ingest never sees it (BR-15 counts it in full). Clubs are read like Footywire's
 * own labels and the match id is `abandoned-{matchUid}` unless Footywire has one. Run through
 * `npm run record-abandoned` (etl/recordAbandonedResult.ts), never hand SQL.
 */
export function buildAbandonedResult(input: {
  season: number;
  round: number;
  homeTeam: string;
  awayTeam: string;
  matchId?: string;
}): MatchResult {
  const { season, round } = input;
  if (!Number.isInteger(season) || season < 1897) throw new Error(`Unreadable season "${season}"`);
  if (!Number.isInteger(round) || round < 1) throw new Error(`Unreadable round "${round}"`);
  const home = resultClub(input.homeTeam);
  const away = resultClub(input.awayTeam);
  if (home.abbr === away.abbr) throw new Error('An abandoned game needs two different clubs');
  const matchUid = `${season}-R${round}-${home.abbr}-${away.abbr}`;
  const matchId = input.matchId?.trim() || `abandoned-${matchUid}`;
  const fields = {
    season,
    round,
    matchId,
    matchUid,
    homeClub: home.name,
    awayClub: away.name,
    homePoints: null,
    awayPoints: null,
    margin: null,
    status: 'ABANDONED' as const,
  };
  return { ...fields, contentHash: resultContentHash(fields) };
}

/**
 * What to write for these results given the stored rows of the same matches. A match with no
 * current row is inserted; one whose current row has the same content hash is unchanged; one whose
 * content changed supersedes its current row. Only the current row counts: a change back to an
 * earlier version (A, then B, then A) supersedes B with a new row, never revives the old one, so
 * history keeps all three (BR-24, #1295).
 */
export function planResultWrites(
  results: readonly MatchResult[],
  stored: readonly StoredMatchResult[]
): ResultWritePlan {
  const current = new Map<string, StoredMatchResult>();
  for (const row of stored) {
    if (row.supersededById !== null) continue;
    if (current.has(row.matchId)) {
      throw new Error(`Footywire match ${row.matchId} has more than one current result`);
    }
    current.set(row.matchId, row);
  }

  const plan: ResultWritePlan = { inserts: [], supersedes: [], unchanged: 0 };
  for (const result of results) {
    const previous = current.get(result.matchId);
    if (previous?.contentHash === result.contentHash) {
      plan.unchanged += 1;
      continue;
    }
    if (previous) {
      plan.supersedes.push({ previous, next: result, reason: supersedeReason(previous, result) });
    } else {
      plan.inserts.push(result);
    }
  }
  return plan;
}

export type ResultWriteSummary = {
  results: number;
  inserted: number;
  superseded: number;
  unchanged: number;
};

export async function ingestResultRows(
  rows: readonly ResultSourceRow[],
  deps: { store: ResultStore; fetchedAt: Date; newId?: () => string }
): Promise<ResultWriteSummary> {
  return storeMatchResults(buildMatchResults(rows), deps);
}

/** Records an abandoned game (see `buildAbandonedResult`); a stored result of it is superseded. */
export async function recordAbandonedResult(
  input: Parameters<typeof buildAbandonedResult>[0],
  deps: { store: ResultStore; fetchedAt: Date; newId?: () => string }
): Promise<ResultWriteSummary> {
  return storeMatchResults([buildAbandonedResult(input)], {
    ...deps,
    supersedeSource: 'Operator recorded the game as abandoned',
  });
}

/** One season's results, written in one locked transaction (inserts, supersedes, or nothing). */
async function storeMatchResults(
  results: readonly MatchResult[],
  deps: {
    store: ResultStore;
    fetchedAt: Date;
    newId?: () => string;
    supersedeSource?: string;
  }
): Promise<ResultWriteSummary> {
  const season = results[0].season;
  const newId = deps.newId ?? randomUUID;

  const plan = await deps.store.transaction(season, async (tx) => {
    const stored = await tx.read(
      season,
      results.map((result) => result.matchId)
    );
    const planned = planResultWrites(results, stored);
    if (deps.supersedeSource) {
      for (const supersede of planned.supersedes) {
        supersede.reason = supersedeReason(
          supersede.previous,
          supersede.next,
          deps.supersedeSource
        );
      }
    }
    for (const result of planned.inserts) await tx.insert(newId(), result, deps.fetchedAt);
    for (const { previous, next, reason } of planned.supersedes) {
      // The old row stops being current first: one current row per match is a unique index.
      const id = newId();
      await tx.markSuperseded(previous.id, id, reason);
      await tx.insert(id, next, deps.fetchedAt);
    }
    return planned;
  });

  return {
    results: results.length,
    inserted: plan.inserts.length,
    superseded: plan.supersedes.length,
    unchanged: plan.unchanged,
  };
}
