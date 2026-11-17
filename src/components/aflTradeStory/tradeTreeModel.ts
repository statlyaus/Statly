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

type Hop = AflTradeStoryLineageAsset['hops'][number];

/** Onward trades sit just before the draft of their year, or before that year's season end. */
function onwardColumnOf(
  columns: readonly TreeColumn[],
  after: readonly Hop[],
  draft: AflTradeStoryAssetPoint | null
): number | null {
  if (after.length === 0) return null;
  const year = after[0]!.year;
  return columnAt(columns, {
    kind: draft && draft.checkpoint.season === year ? 'draft' : 'season_end',
    season: year,
  });
}

/** Who holds the lane from each column: this trade's club, then the last onward club. */
function spansOf(
  thisHop: Hop,
  after: readonly Hop[],
  onwardColumn: number | null,
  draftColumn: number | null,
  startsAsPick: boolean
): TreeSpan[] {
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
  return spans.sort((left, right) => left.from - right.from);
}

/** Where a lane stops early: its stint closed, or the pick was not used. */
function endOf(
  columns: readonly TreeColumn[],
  line: readonly AflTradeStoryAssetPoint[]
): Pick<TreeLane, 'endColumn' | 'endReason'> {
  const closed = line.find(({ state }) => state === 'closed');
  if (closed) return { endColumn: columnAt(columns, closed.checkpoint), endReason: 'closed' };
  const notUsed = line.find(({ state }) => state === 'not_used');
  if (notUsed) return { endColumn: columnAt(columns, notUsed.checkpoint), endReason: 'not_used' };
  return { endColumn: null, endReason: null };
}

function playerOf(asset: AflTradeStoryLineageAsset, receiverId: string): TreeLane['player'] {
  const outcome = asset.outcome;
  if (outcome.kind !== 'player' && outcome.kind !== 'bid_share') return null;
  return {
    name: outcome.playerName,
    clubName: outcome.clubName,
    away: outcome.clubId !== receiverId,
  };
}

function viaOf(before: readonly Hop[]): string | null {
  if (before.length === 0) return null;
  return before.length === 1 ? `via a ${before[0]!.year} trade` : `via ${before.length} trades`;
}

function lane(columns: readonly TreeColumn[], asset: AflTradeStoryLineageAsset): TreeLane {
  const thisHop = asset.hops.find(({ relation }) => relation === 'this')!;
  const before = asset.hops.filter(({ relation }) => relation === 'before');
  const after = asset.hops.filter(({ relation }) => relation === 'after');
  const startsAsPick = asset.line[0]?.state === 'pick';
  const draft = draftPoint(asset.line);
  const draftColumn = draft ? columnAt(columns, draft.checkpoint) : null;
  const onwardColumn = onwardColumnOf(columns, after, draft);
  const drafted =
    draft && draft.checkpoint.kind === 'draft' && draft.state !== 'not_used'
      ? { column: draftColumn!, selection: draft.selectionNumber }
      : null;
  return {
    asset,
    label: startsAsPick ? laneLabel(asset.label) : asset.label,
    via: viaOf(before),
    receiverId: thisHop.clubId,
    spans: spansOf(thisHop, after, onwardColumn, draftColumn, startsAsPick),
    onward:
      onwardColumn === null
        ? null
        : { beforeColumn: onwardColumn, clubNames: after.map(({ clubName }) => clubName) },
    drafted,
    ...endOf(columns, asset.line),
    player: playerOf(asset, thisHop.clubId),
    value: knownPav(asset.value),
    latest: asset.line.at(-1) ?? null,
  };
}

/** The tree: a group per club of the trade, its lanes biggest value first. */
export function tradeTree(story: AflTradeStory): TradeTree {
  const columns = columnsOf(story);
  const lanes = story.lineage.assets.map((asset) => lane(columns, asset));
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
