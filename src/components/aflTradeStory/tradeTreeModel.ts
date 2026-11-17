import type {
  AflTradeStory,
  AflTradeStoryAssetPoint,
  AflTradeStoryLineageAsset,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { knownPav } from './tradePageModel';

/**
 * The trade tree (owner's design, 2026-11-17: "Where the trade went", hatched ink for other clubs):
 * the trade at the left, a branch per club, a lane per asset running through time to the player it
 * became, and that player's PAV. This module only arranges the story's own values; it adds none.
 */

/** A column of the time axis: a draft some asset was used in, or a season's end. */
export interface TreeColumn {
  readonly kind: 'draft' | 'season_end';
  readonly season: number;
}

/** Who holds a lane from a column on: the club it went to in this trade, or another club. */
export interface TreeSpan {
  /** Column index the span starts at; -1 is the trade itself. */
  readonly from: number;
  readonly clubId: string;
  readonly clubName: string;
  /** Still a pick, not yet a player. */
  readonly pick: boolean;
}

export interface TreeOnward {
  /** Column index of the draft (or season) the onward trades come just before. */
  readonly beforeColumn: number;
  readonly clubNames: readonly string[];
}

export interface TreeLane {
  readonly asset: AflTradeStoryLineageAsset;
  /** "Collingwood’s 2024 pick 11", or the player's name. */
  readonly label: string;
  /** "via a 2023 trade" when the pick came through earlier trades. */
  readonly via: string | null;
  readonly receiverId: string;
  readonly spans: readonly TreeSpan[];
  readonly onward: TreeOnward | null;
  /** The draft it was used in, with the selection, when it became a player in a draft. */
  readonly drafted: { readonly column: number; readonly selection: number | null } | null;
  /** The column the stint closed at, or the draft it was not used in. */
  readonly endColumn: number | null;
  readonly endReason: 'closed' | 'not_used' | null;
  /** The player it became and where he is, or null for an outcome that is not a player. */
  readonly player: {
    readonly name: string;
    readonly clubName: string;
    readonly away: boolean;
  } | null;
  /** Signed PAV at the story's checkpoint; null when pending. */
  readonly value: number | null;
  readonly latest: AflTradeStoryAssetPoint | null;
}

export interface TreeGroup {
  readonly clubId: string;
  readonly clubName: string;
  readonly lanes: readonly TreeLane[];
  /** PAV of the lanes whose player is still at, or ended his stint at, this club. */
  readonly kept: number;
  /** PAV that went to other clubs. */
  readonly elsewhere: number;
}

export interface TradeTree {
  readonly columns: readonly TreeColumn[];
  readonly groups: readonly TreeGroup[];
  readonly maxValue: number;
}

const ORDER = { season_end: 0, trade: 1, draft: 2 } as const;
const orderOf = ({ kind, season }: AflTradeStoryAssetPoint['checkpoint']) =>
  season * 3 + ORDER[kind];

/** "2024 pick 11 (Collingwood)" reads as "Collingwood’s 2024 pick 11". */
export function laneLabel(label: string): string {
  const match = /^(.*) \((.+)\)$/u.exec(label);
  return match ? `${match[2]}’s ${match[1]}` : label;
}

/** The draft point where a pick became a player: its first point after a `pick` point. */
function draftPoint(line: readonly AflTradeStoryAssetPoint[]) {
  for (let at = 1; at < line.length; at += 1)
    if (line[at - 1]!.state === 'pick' && line[at]!.state !== 'pick') return line[at]!;
  return null;
}

/** Every column the story's lanes need, oldest first. */
function columnsOf(story: AflTradeStory): TreeColumn[] {
  const keys = new Map<number, TreeColumn>();
  const tradeOrder = orderOf({ kind: 'trade', season: story.trade.year });
  for (const asset of story.lineage.assets) {
    for (const point of asset.line)
      if (point.checkpoint.kind === 'season_end' && orderOf(point.checkpoint) > tradeOrder)
        keys.set(orderOf(point.checkpoint), {
          kind: 'season_end',
          season: point.checkpoint.season,
        });
    const drafted = draftPoint(asset.line);
    if (drafted?.checkpoint.kind === 'draft')
      keys.set(orderOf(drafted.checkpoint), { kind: 'draft', season: drafted.checkpoint.season });
  }
  return [...keys.entries()].sort(([left], [right]) => left - right).map(([, column]) => column);
}

/** The column at or after a checkpoint. */
function columnAt(
  columns: readonly TreeColumn[],
  checkpoint: AflTradeStoryAssetPoint['checkpoint']
) {
  const order = orderOf(checkpoint);
  const at = columns.findIndex((column) => orderOf(column) >= order);
  return at === -1 ? columns.length - 1 : at;
}

function lane(
  story: AflTradeStory,
  columns: readonly TreeColumn[],
  asset: AflTradeStoryLineageAsset
): TreeLane {
  const hops = asset.hops;
  const thisHop = hops.find(({ relation }) => relation === 'this')!;
  const before = hops.filter(({ relation }) => relation === 'before');
  const after = hops.filter(({ relation }) => relation === 'after');
  const startsAsPick = asset.line[0]?.state === 'pick';
  const draft = draftPoint(asset.line);
  const draftColumn = draft ? columnAt(columns, draft.checkpoint) : null;
  // Onward trades sit just before the draft of their year, or before that year's season end.
  const onwardColumn =
    after.length === 0
      ? null
      : columnAt(columns, {
          kind: draft && draft.checkpoint.season === after[0]!.year ? 'draft' : 'season_end',
          season: after[0]!.year,
        });
  const spans: TreeSpan[] = [
    { from: -1, clubId: thisHop.clubId, clubName: thisHop.clubName, pick: startsAsPick },
  ];
  if (onwardColumn !== null) {
    const last = after.at(-1)!;
    spans.push({
      from: onwardColumn,
      clubId: last.clubId,
      clubName: last.clubName,
      pick: startsAsPick,
    });
  }
  if (draftColumn !== null && startsAsPick)
    spans.push({ ...spans.at(-1)!, from: draftColumn, pick: false });
  spans.sort((left, right) => left.from - right.from);

  const closed = asset.line.find(({ state }) => state === 'closed');
  const notUsed = asset.line.find(({ state }) => state === 'not_used');
  const outcome = asset.outcome;
  const player =
    outcome.kind === 'player' || outcome.kind === 'bid_share'
      ? {
          name: outcome.playerName,
          clubName: outcome.clubName,
          away: outcome.clubId !== thisHop.clubId,
        }
      : null;
  return {
    asset,
    label: startsAsPick ? laneLabel(asset.label) : asset.label,
    via:
      before.length === 0
        ? null
        : before.length === 1
          ? `via a ${before[0]!.year} trade`
          : `via ${before.length} trades`,
    receiverId: thisHop.clubId,
    spans,
    onward:
      onwardColumn === null
        ? null
        : { beforeColumn: onwardColumn, clubNames: after.map(({ clubName }) => clubName) },
    drafted:
      draft && draft.checkpoint.kind === 'draft' && draft.state !== 'not_used'
        ? { column: draftColumn!, selection: draft.selectionNumber }
        : null,
    endColumn: closed
      ? columnAt(columns, closed.checkpoint)
      : notUsed
        ? columnAt(columns, notUsed.checkpoint)
        : null,
    endReason: closed ? 'closed' : notUsed ? 'not_used' : null,
    player,
    value: knownPav(asset.value),
    latest: asset.line.at(-1) ?? null,
  };
}

/** The tree: a group per club of the trade, its lanes biggest value first. */
export function tradeTree(story: AflTradeStory): TradeTree {
  const columns = columnsOf(story);
  const lanes = story.lineage.assets.map((asset) => lane(story, columns, asset));
  const groups = story.trade.clubs.map((club) => {
    const own = lanes
      .filter(({ receiverId }) => receiverId === club.clubId)
      .sort((left, right) => (right.value ?? -Infinity) - (left.value ?? -Infinity));
    const sum = (rows: readonly TreeLane[]) =>
      rows.reduce((total, row) => total + (row.value ?? 0), 0);
    return {
      clubId: club.clubId,
      clubName: club.clubName,
      lanes: own,
      kept: sum(own.filter(({ player }) => !player?.away)),
      elsewhere: sum(own.filter(({ player }) => player?.away)),
    };
  });
  return {
    columns,
    groups: groups.filter(({ lanes: rows }) => rows.length > 0),
    maxValue: Math.max(1, ...lanes.map(({ value }) => value ?? 0)),
  };
}
