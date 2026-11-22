import type { AflTradeStorySampleSummary } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

import { clubSlug, tradeLadder } from './tradesListQuery';

/**
 * The trade list's rail counts, its rows and the preview's "Where next" links, all from the list's
 * own summaries: the page needs no read beyond the list and the one previewed story.
 */

type Summary = AflTradeStorySampleSummary;
type Result = NonNullable<Summary['results']>[number];

const involves = (story: Summary, slug: string) =>
  story.clubNames.some((name) => clubSlug(name) === slug);

/** The trade the preview shows: the one the address names when the list shows it, else the first. */
export const selectedTrade = (shown: readonly Summary[], tradeId: string | null): Summary | null =>
  shown.find((story) => story.tradeId === tradeId) ?? shown[0] ?? null;

/**
 * A received asset that is a player: picks are named "2023 pick 46" or "2024 round 2 (Sydney)". The
 * one other label in the bundle, "Special draft entitlement", appears once, so it never matches.
 */
const isPlayer = (label: string) => !/^\d{4} /u.test(label);

/** Other trades a player in this one was also part of, oldest first. */
export function samePlayerTrades(
  stories: readonly Summary[],
  story: Summary
): { player: string; story: Summary }[] {
  const players = new Set(
    (story.results ?? []).flatMap(({ received }) => received.filter(isPlayer))
  );
  return stories
    .filter((other) => other.tradeId !== story.tradeId)
    .flatMap((other) => {
      const player = (other.results ?? [])
        .flatMap(({ received }) => received)
        .find((label) => players.has(label));
      return player ? [{ player, story: other }] : [];
    })
    .sort((left, right) => left.story.year - right.story.year);
}

/** Trades per year for the chosen club (or every club), and over every year. */
export function yearCounts(stories: readonly Summary[], club: string | null) {
  const mine = club === null ? stories : stories.filter((story) => involves(story, club));
  const byYear = new Map<number, number>();
  for (const { year } of mine) byYear.set(year, (byYear.get(year) ?? 0) + 1);
  return { all: mine.length, byYear };
}

/** Trades per club for the chosen year (or every year), and in all. */
export function clubCounts(stories: readonly Summary[], year: number | null) {
  const inYear = year === null ? stories : stories.filter((story) => story.year === year);
  const bySlug = new Map<string, number>();
  for (const story of inYear)
    for (const name of story.clubNames)
      bySlug.set(clubSlug(name), (bySlug.get(clubSlug(name)) ?? 0) + 1);
  return { all: inYear.length, bySlug };
}

/**
 * A club's trades over every year and its combined result, both as the trade ladder counts them:
 * a projected trade joins once a season has been played since it.
 */
export function clubTotals(stories: readonly Summary[], slug: string) {
  const trades = stories.filter(
    (story) => involves(story, slug) && !(story.results ?? []).some(({ projected }) => projected)
  ).length;
  const net = tradeLadder(stories).find((row) => row.slug === slug)?.net ?? 0;
  return { trades, net };
}

/**
 * A row's lead side: the chosen club when it is in the trade, else the club ahead. Null when the trade
 * has no results yet.
 */
export function rowSides(
  story: Summary,
  club: string | null
): { lead: Result; others: Result[] } | null {
  const results = story.results ?? [];
  if (results.length === 0) return null;
  const lead =
    results.find((result) => club !== null && clubSlug(result.clubName) === club) ??
    results.reduce((top, result) => (result.net > top.net ? result : top));
  return { lead, others: results.filter((result) => result !== lead) };
}
