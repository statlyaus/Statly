import type {
  AflTradeStory,
  AflTradeStoryEvent,
  AflTradeStoryLineageTrade,
  AflTradeStoryPlayer,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { formatPav, knownPav, tradeShortName } from './tradePageModel';

/**
 * The scarf timeline's content, from the story alone: the biggest values, each trade and
 * draft along the way, and any sourced events. Pure, so the page renders it on the server.
 */

export interface ScarfPlayer {
  readonly key: string;
  readonly name: string;
  readonly clubName: string;
  readonly value: number;
  readonly gotAway: boolean;
  readonly arrivalYear: number;
}

export type ScarfStepKind = 'trade' | 'this_trade' | 'draft' | 'major' | 'milestone';

export interface ScarfStep {
  readonly key: string;
  readonly kind: ScarfStepKind;
  readonly year: number;
  readonly label: string;
  readonly title: string;
  readonly text: string;
}

const ORDER: Record<ScarfStepKind, number> = {
  this_trade: 0,
  trade: 1,
  draft: 2,
  major: 3,
  milestone: 3,
};

const surname = (name: string) => name.split(' ').at(-1) ?? name;

/** The highest-value players along the chain, in the order they arrived. */
export function scarfPlayers(story: AflTradeStory, limit = 3): ScarfPlayer[] {
  const tradeYears = new Map(story.lineage.trades.map(({ tradeId, year }) => [tradeId, year]));
  const arrival = (player: AflTradeStoryPlayer) =>
    player.outcome.kind === 'player' && player.outcome.selection
      ? player.outcome.selection.draftYear
      : (tradeYears.get(player.acquired.tradeId) ?? story.trade.year);
  return story.players
    .flatMap((player) => {
      const value = knownPav(player.value);
      if (value === null || player.outcome.kind !== 'player') return [];
      return [
        {
          key: `${player.group}:${player.assetId}:${player.clubId}`,
          name: player.outcome.playerName,
          clubName: player.outcome.clubName,
          value,
          gotAway: player.group === 'got_away',
          arrivalYear: arrival(player),
        },
      ];
    })
    .sort((left, right) => right.value - left.value)
    .slice(0, limit)
    .sort((left, right) => left.arrivalYear - right.arrivalYear);
}

function listText(items: readonly string[], limit: number): string {
  const shown = items.slice(0, limit).join(', ');
  return items.length > limit ? `${shown} and ${items.length - limit} more` : shown;
}

const abbreviations = (trade: AflTradeStoryLineageTrade) => tradeShortName(trade.clubs);

/** A trade a club of the story is a party to: what each club got. */
function tradeStep(story: AflTradeStory, trade: AflTradeStoryLineageTrade): ScarfStep {
  const isThis = trade.tradeId === story.trade.id;
  const got = trade.clubs.map((club) => {
    const received = trade.assets
      .filter((asset) => asset.toClubId === club.clubId)
      .map((asset) => asset.label);
    return `${club.clubName} get ${listText(received, 1)}.`;
  });
  return {
    key: `trade:${trade.tradeId}`,
    kind: isThis ? 'this_trade' : 'trade',
    year: trade.year,
    label: String(trade.year),
    title: isThis ? 'This trade' : abbreviations(trade),
    text: got.join(' '),
  };
}

/** A year's trades between other clubs, one step: where the story's picks moved on. */
function laterDealsStep(year: number, trades: readonly AflTradeStoryLineageTrade[]): ScarfStep {
  return {
    key: `later:${year}`,
    kind: 'trade',
    year,
    label: String(year),
    title: trades.length === 1 ? abbreviations(trades[0]!) : 'Other deals',
    text: `Picks moved on${trades.length === 1 ? '' : `: ${trades.map(abbreviations).join(', ')}`}.`,
  };
}

function tradeSteps(story: AflTradeStory): ScarfStep[] {
  const parties = new Set(story.trade.clubs.map(({ clubId }) => clubId));
  const others = new Map<number, AflTradeStoryLineageTrade[]>();
  const steps: ScarfStep[] = [];
  for (const trade of story.lineage.trades) {
    if (trade.clubs.some(({ clubId }) => parties.has(clubId))) steps.push(tradeStep(story, trade));
    else others.set(trade.year, [...(others.get(trade.year) ?? []), trade]);
  }
  return [...steps, ...[...others].map(([year, trades]) => laterDealsStep(year, trades))];
}

/**
 * Each draft a pick in the chain was used in: who was taken, the trade's own picks first, then by
 * value.
 */
function draftSteps(story: AflTradeStory): ScarfStep[] {
  const byYear = new Map<
    number,
    Map<string, { name: string; selection: number; value: number; own: boolean }>
  >();
  const own = new Set(story.lineage.assets.map(({ assetId }) => assetId));
  for (const asset of story.lineage.trades.flatMap(({ assets }) => assets)) {
    const outcome = asset.outcome;
    if (outcome.kind !== 'player' || outcome.selection === null) continue;
    const year = byYear.get(outcome.selection.draftYear) ?? new Map();
    year.set(outcome.playerId, {
      name: surname(outcome.playerName),
      selection: outcome.selection.selectionNumber,
      value: knownPav(asset.value) ?? -1,
      own: own.has(asset.assetId) || (year.get(outcome.playerId)?.own ?? false),
    });
    byYear.set(outcome.selection.draftYear, year);
  }
  return [...byYear].map(([year, taken]) => ({
    key: `draft:${year}`,
    kind: 'draft' as const,
    year,
    label: String(year),
    title: 'Draft',
    text: `${listText(
      [...taken.values()]
        .sort(
          (left, right) =>
            Number(right.own) - Number(left.own) ||
            right.value - left.value ||
            left.selection - right.selection
        )
        .map(({ name, selection }) => `${name} (pick ${selection})`),
      3
    )}.`,
  }));
}

function eventStep(event: AflTradeStoryEvent): ScarfStep {
  return {
    key: `event:${event.sourceId}`,
    kind: event.kind,
    year: Number(event.date.slice(0, 4)),
    label: event.date,
    title: event.title,
    text: event.detail ?? '',
  };
}

/** Every step on the timeline, oldest first: a year's trades, then its draft, then its events. */
export function scarfSteps(story: AflTradeStory): ScarfStep[] {
  return [...tradeSteps(story), ...draftSteps(story), ...story.events.map(eventStep)]
    .map((step, index) => ({ step, index }))
    .sort(
      (left, right) =>
        left.step.year - right.step.year ||
        ORDER[left.step.kind] - ORDER[right.step.kind] ||
        left.index - right.index
    )
    .map(({ step }) => step);
}

/** Words to lines of at most `width` characters. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= width)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** At most `count` lines, the last ending in an ellipsis when text was cut. */
export function clampLines(lines: readonly string[], count: number): string[] {
  if (lines.length <= count) return [...lines];
  const kept = lines.slice(0, count);
  kept[count - 1] = `${kept[count - 1]!.replace(/[\s,.;:]+$/u, '')}\u2026`;
  return kept;
}

export const scarfPanelLabel = (player: ScarfPlayer) =>
  `${formatPav(player.value)} · ${player.clubName}`;

export const scarfPanelTitle = (player: ScarfPlayer) => surname(player.name).toUpperCase();
