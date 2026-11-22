import type { AflTradeStorySampleSummary } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

/**
 * The public trade list's filters and its previewed trade
 * (/afl/trades?year=2024&club=geelong&sort=biggest&trade=<id>). They live in the address so a list
 * and the trade open beside it can be shared, bookmarked and read without scripts.
 */

type TradesListSort = 'newest' | 'biggest';

export interface TradesListQuery {
  /** One trade year, or null for every year. */
  readonly year: number | null;
  /** One club's slug, or null for every club. */
  readonly club: string | null;
  readonly sort: TradesListSort;
  /** The trade open in the preview, or null for the list's first row. */
  readonly trade: string | null;
}

/** A query without a preview: what filtering and every link from outside the list need. */
type TradesListFilter = Omit<TradesListQuery, 'trade'> & { readonly trade?: string | null };

interface TradesListClub {
  readonly clubId: string;
  readonly name: string;
  readonly slug: string;
}

type Param = string | string[] | undefined;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

/** A club's name as an address word: "Western Bulldogs" is `western-bulldogs`. */
export const clubSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');

/** Every club in the list, by name. */
export function tradesListClubs(stories: readonly AflTradeStorySampleSummary[]): TradesListClub[] {
  const clubs = new Map<string, TradesListClub>();
  for (const story of stories)
    story.clubIds.forEach((clubId, index) => {
      const name = story.clubNames[index]!;
      clubs.set(clubId, { clubId, name, slug: clubSlug(name) });
    });
  return [...clubs.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Every trade year in the list, newest first. */
export const tradesListYears = (stories: readonly AflTradeStorySampleSummary[]) =>
  [...new Set(stories.map(({ year }) => year))].sort((left, right) => right - left);

/**
 * Reads the address. With no year named the list shows the latest year, or every year once a club is
 * chosen (a club's trades are few enough to read together). An unknown year, club, sort or trade is
 * ignored.
 */
export function parseTradesListQuery(
  params: Readonly<Record<string, Param>>,
  stories: readonly AflTradeStorySampleSummary[]
): TradesListQuery {
  const years = tradesListYears(stories);
  const slug = first(params.club).toLowerCase();
  const club = tradesListClubs(stories).some((known) => known.slug === slug) ? slug : null;
  const named = first(params.year).toLowerCase();
  const year =
    named === 'all'
      ? null
      : years.includes(Number(named))
        ? Number(named)
        : club === null
          ? (years[0] ?? null)
          : null;
  const tradeId = first(params.trade);
  const trade = stories.some((story) => story.tradeId === tradeId) ? tradeId : null;
  return { year, club, sort: first(params.sort) === 'biggest' ? 'biggest' : 'newest', trade };
}

/** The address of the list under a query, always naming the year so a link means what it shows. */
export function tradesListHref(query: TradesListFilter): string {
  const params = new URLSearchParams({ year: query.year === null ? 'all' : String(query.year) });
  if (query.club !== null) params.set('club', query.club);
  if (query.sort === 'biggest') params.set('sort', 'biggest');
  if (query.trade) params.set('trade', query.trade);
  return `/afl/trades?${params.toString()}`;
}

/** The biggest swing in a trade: the largest net either way, or 0 when the trade has no results. */
const tradeSwing = (story: AflTradeStorySampleSummary) =>
  Math.max(0, ...(story.results ?? []).map(({ net }) => Math.abs(net)));

/** The trades a query shows, in its order. "Newest" keeps the list's own order within a year. */
export function filterTrades(
  stories: readonly AflTradeStorySampleSummary[],
  query: TradesListFilter
): AflTradeStorySampleSummary[] {
  const shown = stories.filter(
    (story) =>
      (query.year === null || story.year === query.year) &&
      (query.club === null || story.clubNames.some((name) => clubSlug(name) === query.club))
  );
  return query.sort === 'biggest'
    ? [...shown].sort((left, right) => tradeSwing(right) - tradeSwing(left))
    : [...shown].sort((left, right) => right.year - left.year);
}

interface TradeWin {
  readonly story: AflTradeStorySampleSummary;
  readonly clubName: string;
  readonly net: number;
  readonly received: readonly string[];
}

/**
 * A trade no season has been played since: its results are projections, listed and labelled but
 * never counted as a win or on the ladder.
 */
const projected = (story: AflTradeStorySampleSummary) =>
  (story.results ?? []).some((result) => result.projected);

/**
 * The largest settled-so-far wins: one per trade, its best club, provisional and projected results
 * left out.
 */
export function biggestWins(
  stories: readonly AflTradeStorySampleSummary[],
  count: number
): TradeWin[] {
  return stories
    .flatMap((story) => {
      const results = story.results ?? [];
      if (
        results.length === 0 ||
        projected(story) ||
        results.some(({ provisional }) => provisional)
      )
        return [];
      const best = results.reduce((top, result) => (result.net > top.net ? result : top));
      return [{ story, clubName: best.clubName, net: best.net, received: best.received }];
    })
    .sort((left, right) => right.net - left.net)
    .slice(0, count);
}

export interface TradeLadderRow extends TradesListClub {
  /** The club's combined result over every trade in the list. */
  readonly net: number;
  /** Trades the club is ahead on, and behind on, so far. */
  readonly ahead: number;
  readonly behind: number;
  /** A value in one of its trades is not in yet, so the total will move. */
  readonly provisional: boolean;
}

/**
 * The trade ladder: every club's combined result across the list's trades, best first. A club's
 * results add up because each trade values an asset once, at the club that received it. A projected
 * trade joins once a season has been played since it.
 */
export function tradeLadder(stories: readonly AflTradeStorySampleSummary[]): TradeLadderRow[] {
  const rows = new Map<string, TradeLadderRow>();
  for (const story of stories.filter((candidate) => !projected(candidate)))
    for (const result of story.results ?? []) {
      const row = rows.get(result.clubId) ?? {
        clubId: result.clubId,
        name: result.clubName,
        slug: clubSlug(result.clubName),
        net: 0,
        ahead: 0,
        behind: 0,
        provisional: false,
      };
      const settled = Number(Math.abs(result.net).toFixed(1)) === 0;
      rows.set(result.clubId, {
        ...row,
        net: row.net + result.net,
        ahead: row.ahead + (!settled && result.net > 0 ? 1 : 0),
        behind: row.behind + (!settled && result.net < 0 ? 1 : 0),
        provisional: row.provisional || result.provisional,
      });
    }
  return byResult([...rows.values()]);
}

const byResult = (rows: TradeLadderRow[]) =>
  rows.sort((left, right) => right.net - left.net || left.name.localeCompare(right.name));

/** The ladder of each trade year, oldest first, for picking years on the front page. */
export const tradeLadderByYear = (stories: readonly AflTradeStorySampleSummary[]) =>
  [...tradesListYears(stories)]
    .reverse()
    .map((year) => ({ year, rows: tradeLadder(stories.filter((story) => story.year === year)) }))
    .filter(({ rows }) => rows.length > 0);

/** Several years' ladders as one: each club's results add up, as they do across trades. */
export function combineLadders(ladders: readonly (readonly TradeLadderRow[])[]): TradeLadderRow[] {
  const rows = new Map<string, TradeLadderRow>();
  for (const row of ladders.flat()) {
    const sum = rows.get(row.clubId);
    rows.set(
      row.clubId,
      sum
        ? {
            ...sum,
            net: sum.net + row.net,
            ahead: sum.ahead + row.ahead,
            behind: sum.behind + row.behind,
            provisional: sum.provisional || row.provisional,
          }
        : row
    );
  }
  return byResult([...rows.values()]);
}

interface TradeYearSummary {
  readonly year: number;
  readonly trades: number;
  /** The year's biggest settled-so-far win, when it has one. */
  readonly biggest: TradeWin | null;
}

/** Each trade year, newest first: how many trades, and its biggest win. */
export const tradeYearSummaries = (
  stories: readonly AflTradeStorySampleSummary[]
): TradeYearSummary[] =>
  tradesListYears(stories).map((year) => {
    const inYear = stories.filter((story) => story.year === year);
    return { year, trades: inYear.length, biggest: biggestWins(inYear, 1)[0] ?? null };
  });
