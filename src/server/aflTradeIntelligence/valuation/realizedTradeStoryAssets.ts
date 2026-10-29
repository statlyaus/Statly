import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import type {
  AflTradeStoryAsset,
  AflTradeStoryClub,
  AflTradeStoryLines,
  AflTradeStoryNames,
  AflTradeStoryOutcome,
  AflTradeStoryPendingAsset,
  AflTradeStoryValue,
} from './realizedTradeStoryContracts';
import {
  parseAflTradeStructure,
  type AflTradeStructureLeg,
  type AflTradeStructureTrade,
} from './tradeStructureContracts';
import { aflTradeValueLineCheckpointOrder as orderOf } from './valueLineAssets';
import {
  AFL_TRADE_VALUE_LINES_SCHEMA_VERSION,
  type AflTradeValueLineAsset,
  type AflTradeValueLineNetPoint,
  type AflTradeValueLinePoint,
  type AflTradeValueLineTrade,
  type AflTradeValueLineTradeLeg,
} from './valueLineContracts';

/** One hop of an asset: the trade, and its leg in that trade. */
export interface AflTradeStoryHopRef {
  readonly trade: AflTradeStructureTrade;
  readonly leg: AflTradeStructureLeg;
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`The trade story has no ${what}.`);
  return value;
}

const hopKey = (transactionId: string, transferId: string) => `${transactionId}|${transferId}`;

const valueOf = (point: AflTradeValueLinePoint): AflTradeStoryValue =>
  point.value === null
    ? { kind: 'pending', pending: point.pending ?? 'unavailable' }
    : { kind: 'known', pav: point.value };

/**
 * Refuses value lines that are not sealed over their content, not v3, or not computed on this
 * structure: the story never mixes a structure with another structure's values.
 */
function requireSealed({ structure, valueLines }: AflTradeStoryLines) {
  const parsed = parseAflTradeStructure(structure);
  if (valueLines.content.schemaVersion !== AFL_TRADE_VALUE_LINES_SCHEMA_VERSION)
    throw new Error(`The trade story reads ${AFL_TRADE_VALUE_LINES_SCHEMA_VERSION} only.`);
  if (createAflTradeContentAddress('value-lines', valueLines.content) !== valueLines.valueLinesId)
    throw new Error('The value lines do not match their content address.');
  if (valueLines.content.inputs.structureId !== parsed.structureId)
    throw new Error('The value lines were not computed on this trade structure.');
  return parsed;
}

/**
 * Follows assets through a trade structure and reads their values from the value lines computed on
 * it. A pick traded on is followed through each onward link to its final leg; its value line is the
 * same in every trade it passed through, though each trade reads it at its own checkpoint (a pick
 * before its draft at that trade's slot). No realized grade is read.
 */
export class AflTradeStoryIndex {
  private readonly trades: ReadonlyMap<string, AflTradeStructureTrade>;
  private readonly valueTrades: ReadonlyMap<string, AflTradeValueLineTrade>;
  private readonly valueLegs = new Map<string, AflTradeValueLineTradeLeg>();
  private readonly assets: ReadonlyMap<string, AflTradeValueLineAsset>;
  /** Each onward transfer, by trade and transfer, with the hop that links to it. */
  private readonly inbound = new Map<string, AflTradeStoryHopRef>();
  private readonly resolved = new Map<string, AflTradeStoryAsset>();
  private readonly tradeNets = new Map<string, ReturnType<AflTradeStoryIndex['readNets']>>();
  readonly structureId: string;
  readonly valueLinesId: string;

  constructor(
    lines: AflTradeStoryLines,
    private readonly names: AflTradeStoryNames
  ) {
    const structure = requireSealed(lines);
    this.structureId = structure.structureId;
    this.valueLinesId = lines.valueLines.valueLinesId;
    const { content } = lines.valueLines;
    this.trades = new Map(structure.content.trades.map((trade) => [trade.transactionId, trade]));
    this.valueTrades = new Map(content.trades.map((trade) => [trade.transactionId, trade]));
    this.assets = new Map(content.assets.map((asset) => [asset.assetKey, asset]));
    for (const trade of content.trades)
      for (const leg of trade.legs)
        this.valueLegs.set(hopKey(trade.transactionId, leg.transferId), leg);
    for (const trade of structure.content.trades)
      for (const leg of trade.legs)
        if (leg.onward)
          this.inbound.set(hopKey(leg.onward.transactionId, leg.onward.transferId), { trade, leg });
  }

  trade(tradeId: string): AflTradeStructureTrade {
    return required(this.trades.get(tradeId), `trade ${tradeId} in its structure`);
  }

  club(clubId: string): AflTradeStoryClub {
    return { clubId, clubName: required(this.names.clubs.get(clubId), `name for club ${clubId}`) };
  }

  /** The player or pick id a leg moves, the same in every trade the asset passes through. */
  assetId(ref: AflTradeStoryHopRef): string {
    const asset = this.lineOf(ref);
    return asset.pickId ?? asset.playerId ?? asset.assetKey;
  }

  /** The value line a leg reads: what the asset finally became, the same for every hop. */
  assetKey(ref: AflTradeStoryHopRef): string {
    return this.valueLeg(ref).assetKey;
  }

  /** The asset's next hop: the onward transfer its receiving club passed it on as, if any. */
  nextHop(ref: AflTradeStoryHopRef): AflTradeStoryHopRef | undefined {
    const { onward } = ref.leg;
    if (onward === undefined) return undefined;
    const trade = this.trade(onward.transactionId);
    const leg = required(
      trade.legs.find(({ transferId }) => transferId === onward.transferId),
      `onward leg for transfer ${ref.leg.transferId}`
    );
    if (leg.sendingClubId !== ref.leg.receivingClubId)
      throw new Error(
        `The trade story's transfer ${leg.transferId} is not given on by the club that received ${ref.leg.transferId}.`
      );
    return { trade, leg };
  }

  /** The hop that brought the asset into this trade's sending club, if the structure holds one. */
  priorHop(ref: AflTradeStoryHopRef): AflTradeStoryHopRef | undefined {
    return this.inbound.get(hopKey(ref.trade.transactionId, ref.leg.transferId));
  }

  /** This hop and every later one, to the asset's final leg. */
  forward(ref: AflTradeStoryHopRef): AflTradeStoryHopRef[] {
    return this.walk(ref, (hop) => this.nextHop(hop));
  }

  /** The asset's final leg: where it ended up. */
  finalHop(ref: AflTradeStoryHopRef): AflTradeStoryHopRef {
    return this.forward(ref).reduce((_, hop) => hop);
  }

  /** Every earlier hop the structure holds, oldest first, without this one. */
  backward(ref: AflTradeStoryHopRef): AflTradeStoryHopRef[] {
    return this.walk(ref, (hop) => this.priorHop(hop))
      .slice(1)
      .reverse();
  }

  /**
   * The trade's latest checkpoint (its last net point, normally the last season end) and each club's
   * net there and at the trade, and its line (the at-trade view, then every point), from the value
   * lines: zero-sum by construction.
   */
  nets(tradeId: string) {
    const cached = this.tradeNets.get(tradeId) ?? this.readNets(tradeId);
    this.tradeNets.set(tradeId, cached);
    return cached;
  }

  private readNets(tradeId: string) {
    const trade = required(this.valueTrades.get(tradeId), `value lines for trade ${tradeId}`);
    const latest = (club: AflTradeValueLineTrade['clubs'][number]) =>
      club.points.at(-1) ?? club.atTrade;
    const checkpoint = latest(trade.clubs[0]!).checkpoint;
    const clubs = new Map(
      trade.clubs.map((club) => [
        club.clubId,
        {
          now: this.net(tradeId, latest(club)),
          atTrade: this.net(tradeId, club.atTrade),
          line: [club.atTrade, ...club.points].map((point) => {
            const { net, pendingCount } = this.net(tradeId, point);
            return { checkpoint: point.checkpoint, net, pendingCount };
          }),
        },
      ])
    );
    return { checkpoint, clubs };
  }

  /** The asset a leg moves, with what it became, its value at the trade's checkpoint and at trade. */
  resolve(ref: AflTradeStoryHopRef): AflTradeStoryAsset {
    const key = hopKey(ref.trade.transactionId, ref.leg.transferId);
    const cached = this.resolved.get(key);
    if (cached) return cached;
    const valueLeg = this.valueLeg(ref);
    const line = this.lineOf(ref);
    const point = this.pointAt(ref.trade.transactionId, valueLeg);
    const value = valueOf(point);
    const asset: AflTradeStoryAsset = {
      transferId: ref.leg.transferId,
      assetKind: ref.leg.assetKind,
      assetId: this.assetId(ref),
      assetKey: line.assetKey,
      label: this.label(ref, line),
      fromClubId: ref.leg.sendingClubId,
      toClubId: ref.leg.receivingClubId,
      outcome: value.kind === 'pending' ? value : this.outcome(line, point),
      value,
      atTrade: valueOf(valueLeg.atTrade),
    };
    this.resolved.set(key, asset);
    return asset;
  }

  private net(tradeId: string, point: AflTradeValueLineNetPoint) {
    const pending: AflTradeStoryPendingAsset[] = point.pending.map(
      ({ assetKey, direction, reason }) => {
        const asset = required(this.assets.get(assetKey), `value line ${assetKey}`);
        return { assetId: asset.pickId ?? asset.playerId ?? assetKey, assetKey, direction, reason };
      }
    );
    if (point.provisional !== pending.length > 0)
      throw new Error(`The value lines' net for trade ${tradeId} miscounts its pending legs.`);
    return { net: point.net, pendingCount: pending.length, pending };
  }

  private valueLeg(ref: AflTradeStoryHopRef): AflTradeValueLineTradeLeg {
    const leg = required(
      this.valueLegs.get(hopKey(ref.trade.transactionId, ref.leg.transferId)),
      `value line for transfer ${ref.leg.transferId} in trade ${ref.trade.transactionId}`
    );
    if (
      leg.sendingClubId !== ref.leg.sendingClubId ||
      leg.receivingClubId !== ref.leg.receivingClubId
    )
      throw new Error(`The value lines move transfer ${ref.leg.transferId} between other clubs.`);
    return leg;
  }

  private lineOf(ref: AflTradeStoryHopRef): AflTradeValueLineAsset {
    const assetKey = this.valueLeg(ref).assetKey;
    return required(this.assets.get(assetKey), `value line ${assetKey}`);
  }

  /**
   * The leg's own point at the trade's latest checkpoint, else its at-trade view: exactly the point
   * the trade's nets count, never one derived from the line's points.
   */
  private pointAt(tradeId: string, leg: AflTradeValueLineTradeLeg): AflTradeValueLinePoint {
    const point = leg.points.at(-1) ?? leg.atTrade;
    const { checkpoint } = this.nets(tradeId);
    if (orderOf(point.checkpoint) !== orderOf(checkpoint))
      throw new Error(`The value lines' leg ${leg.transferId} is not read where its nets are.`);
    return point;
  }

  private walk(
    ref: AflTradeStoryHopRef,
    step: (hop: AflTradeStoryHopRef) => AflTradeStoryHopRef | undefined
  ): AflTradeStoryHopRef[] {
    const hops = [ref];
    for (let hop = step(ref); hop; hop = step(hop)) {
      if (hops.length > this.trades.size)
        throw new Error(`The trade story found a cycle at transfer ${ref.leg.transferId}.`);
      hops.push(hop);
    }
    return hops;
  }

  private label(ref: AflTradeStoryHopRef, line: AflTradeValueLineAsset): string {
    const label = this.names.labels.get(ref.leg.transferId);
    if (label !== undefined) return label;
    if (ref.leg.assetKind === 'player' && line.kind === 'player' && line.playerId !== null)
      return this.playerName(line.playerId);
    throw new Error(`The trade story has no label for transfer ${ref.leg.transferId}.`);
  }

  private playerName(playerId: string): string {
    return required(this.names.players.get(playerId), `name for player ${playerId}`);
  }

  /** What a valued line became at its point. */
  private outcome(
    line: AflTradeValueLineAsset,
    point: AflTradeValueLinePoint
  ): AflTradeStoryOutcome {
    const stint = point.state === 'closed' ? ('closed' as const) : ('open' as const);
    const holder = () => {
      const playerId = required(line.playerId, `player for value line ${line.assetKey}`);
      return {
        ...this.club(required(line.clubId, `club for value line ${line.assetKey}`)),
        playerId,
        playerName: this.playerName(playerId),
      };
    };
    if (point.state === 'not_used') return { kind: 'not_used' };
    if (point.state === 'pick') {
      const slot = required(point.slot, `slot for value line ${line.assetKey}`);
      const draftYear = required(line.draftYear, `draft for value line ${line.assetKey}`);
      return {
        kind: 'pick',
        draftYear,
        selectionNumber: slot.selectionNumber,
        source: slot.source,
      };
    }
    switch (line.basis) {
      case 'traded_player':
        return { kind: 'player', ...holder(), selection: null, stint };
      case 'pick_selected': {
        const slot = required(point.slot, `slot for value line ${line.assetKey}`);
        const draftYear = required(line.draftYear, `draft for value line ${line.assetKey}`);
        return {
          kind: 'player',
          ...holder(),
          selection: { selectionNumber: slot.selectionNumber, draftYear },
          stint,
        };
      }
      case 'pick_matched_bid_share':
        return {
          kind: 'bid_share',
          ...holder(),
          share: required(line.share, `share for value line ${line.assetKey}`),
          stint,
        };
      default:
        throw new Error(`The trade story cannot read value line ${line.assetKey} (${line.basis}).`);
    }
  }
}
