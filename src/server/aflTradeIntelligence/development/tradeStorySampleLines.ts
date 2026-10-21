import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import type { AflTradeStoryLines } from '../valuation/realizedTradeStoryContracts';
import {
  AFL_TRADE_STRUCTURE_LIMITATION,
  AFL_TRADE_STRUCTURE_SCHEMA_VERSION,
  createAflTradeStructure,
  type AflTradeStructureLeg,
} from '../valuation/tradeStructureContracts';
import { aflTradeValueLineCheckpointOrder as orderOf } from '../valuation/valueLineAssets';
import {
  AFL_TRADE_VALUE_LINE_RULES,
  AFL_TRADE_VALUE_LINES_LIMITATION,
  AFL_TRADE_VALUE_LINES_SCHEMA_VERSION,
  type AflTradeValueLineAsset,
  type AflTradeValueLineBasis,
  type AflTradeValueLineCheckpoint,
  type AflTradeValueLinePoint,
  type AflTradeValueLinesContent,
  type AflTradeValueLineTrade,
} from '../valuation/valueLineContracts';
import { aflTradeValueLineNetPoint } from '../valuation/valueLines';

/**
 * Seals hand-written sample value lines and their trade structure, for the private trade page's
 * sample source and the story's unit tests (statlyaus/Statly#789). The assets' points are given; each
 * trade leg's points are read from them, and the trades' per-club nets from those by the value lines'
 * own net rule, so each sample trade
 * is zero-sum like a computed one. Sample data only: the fit, ledger and games ids are placeholders,
 * never publication evidence.
 */

/** A structure leg with the value line it reads and its at-trade view. */
export interface AflTradeStorySampleLeg extends AflTradeStructureLeg {
  readonly assetKey: string;
  readonly atTrade: AflTradeValueLinePoint;
}

export interface AflTradeStorySampleTrade {
  readonly transactionId: string;
  readonly tradeYear: number;
  readonly legs: readonly AflTradeStorySampleLeg[];
}

const byCodeUnit = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const placeholder = (prefix: string) => createAflTradeContentAddress(prefix, { sample: prefix });

/**
 * The asset's point at one of its trade's checkpoints: its own, else its latest earlier one after the
 * trade, else the leg's at-trade view. A point from before the trade is never read, as the value lines
 * read a pick before its draft at the latest hop's slot, never an earlier hop's.
 */
function pointAt(
  asset: AflTradeValueLineAsset,
  checkpoint: AflTradeValueLineCheckpoint,
  atTrade: AflTradeValueLinePoint
): AflTradeValueLinePoint {
  const earlier = asset.points.filter(
    (point) =>
      orderOf(point.checkpoint) > orderOf(atTrade.checkpoint) &&
      orderOf(point.checkpoint) <= orderOf(checkpoint)
  );
  return { ...(earlier.at(-1) ?? atTrade), checkpoint };
}

function valueTrade(
  trade: AflTradeStorySampleTrade,
  assets: ReadonlyMap<string, AflTradeValueLineAsset>
): AflTradeValueLineTrade {
  const atTradeCheckpoint = { kind: 'trade' as const, season: trade.tradeYear };
  const legs = [...trade.legs]
    .sort((left, right) => byCodeUnit(left.transferId, right.transferId))
    .map((leg) => ({ leg, asset: assets.get(leg.assetKey)! }));
  const checkpoints = [
    ...new Map(
      legs
        .flatMap(({ asset }) => asset.points.map(({ checkpoint }) => checkpoint))
        .filter((checkpoint) => orderOf(checkpoint) > orderOf(atTradeCheckpoint))
        .map((checkpoint) => [orderOf(checkpoint), checkpoint] as const)
    ).values(),
  ].sort((left, right) => orderOf(left) - orderOf(right));
  const valueLegs = legs.map(({ leg, asset }) => {
    const atTrade = { ...leg.atTrade, checkpoint: atTradeCheckpoint };
    return {
      transferId: leg.transferId,
      assetKey: leg.assetKey,
      sendingClubId: leg.sendingClubId,
      receivingClubId: leg.receivingClubId,
      atTrade,
      points: checkpoints.map((checkpoint) => pointAt(asset, checkpoint, atTrade)),
    };
  });
  const clubIds = [...new Set(legs.flatMap(({ leg }) => [leg.sendingClubId, leg.receivingClubId]))];
  return {
    transactionId: trade.transactionId,
    tradeYear: trade.tradeYear,
    legs: valueLegs,
    clubs: clubIds.sort(byCodeUnit).map((clubId) => ({
      clubId,
      atTrade: aflTradeValueLineNetPoint(
        atTradeCheckpoint,
        clubId,
        valueLegs.map((leg) => ({ leg, point: leg.atTrade }))
      ),
      points: checkpoints.map((checkpoint, at) =>
        aflTradeValueLineNetPoint(
          checkpoint,
          clubId,
          valueLegs.map((leg) => ({ leg, point: leg.points[at]! }))
        )
      ),
    })),
  };
}

/** Seals the sample's trade structure and value lines, the structure first so the lines can name it. */
export function sealAflTradeStorySample(sample: {
  readonly trades: readonly AflTradeStorySampleTrade[];
  readonly assets: readonly AflTradeValueLineAsset[];
  readonly throughSeason: number;
}): AflTradeStoryLines {
  const candidateId = placeholder('external-reconciliation');
  const trades = [...sample.trades].sort((left, right) =>
    byCodeUnit(left.transactionId, right.transactionId)
  );
  const structureTrades = trades.map((trade) => ({
    transactionId: trade.transactionId,
    tradeYear: trade.tradeYear,
    clubs: [...new Set(trade.legs.flatMap((leg) => [leg.sendingClubId, leg.receivingClubId]))]
      .sort(byCodeUnit)
      .map((clubId) => ({ clubId })),
    legs: [...trade.legs]
      .sort((left, right) => byCodeUnit(left.transferId, right.transferId))
      .map(({ assetKey: _key, atTrade: _view, ...leg }) => leg),
  }));
  const legs = structureTrades.flatMap((trade) => trade.legs);
  const structure = createAflTradeStructure({
    schemaVersion: AFL_TRADE_STRUCTURE_SCHEMA_VERSION,
    environment: 'non_production',
    inputs: { candidateId },
    trades: structureTrades,
    ungraded: [],
    summary: {
      trades: structureTrades.length,
      legs: legs.length,
      onwardLinks: legs.filter((leg) => leg.onward).length,
      ungraded: 0,
    },
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_STRUCTURE_LIMITATION,
  });

  const assets = [...sample.assets].sort((left, right) =>
    byCodeUnit(left.assetKey, right.assetKey)
  );
  const byKey = new Map(assets.map((asset) => [asset.assetKey, asset]));
  const valueTrades = [...trades]
    .sort(
      (left, right) =>
        left.tradeYear - right.tradeYear || byCodeUnit(left.transactionId, right.transactionId)
    )
    .map((trade) => valueTrade(trade, byKey));
  const isLast = ({ checkpoint }: { checkpoint: AflTradeValueLineCheckpoint }) =>
    checkpoint.kind === 'season_end' && checkpoint.season === sample.throughSeason;
  const byBasis = Object.fromEntries(
    (
      [
        'pick_selected',
        'pick_matched_bid_share',
        'pick_future',
        'pick_not_used',
        'pick_pending',
        'traded_player',
        'pending',
      ] satisfies AflTradeValueLineBasis[]
    ).map((basis) => [basis, assets.filter((asset) => asset.basis === basis).length])
  ) as Record<AflTradeValueLineBasis, number>;
  const content: AflTradeValueLinesContent = {
    schemaVersion: AFL_TRADE_VALUE_LINES_SCHEMA_VERSION,
    environment: 'non_production',
    valueUnit: 'hpn_pav',
    rules: AFL_TRADE_VALUE_LINE_RULES,
    inputs: {
      fitId: placeholder('value-line-fit'),
      tradedPlayerFitId: placeholder('traded-player-value-line-fit'),
      ledgerId: placeholder('asset-ledger'),
      candidateId,
      structureId: structure.structureId,
      gamesMethodId: 'sample',
      seasons: [],
      throughSeason: sample.throughSeason,
    },
    assets,
    trades: valueTrades,
    summary: {
      assets: assets.length,
      trades: valueTrades.length,
      byBasis,
      pendingAtLastCheckpoint: assets.filter(({ points }) => points.find(isLast)?.value === null)
        .length,
      provisionalTrades: valueTrades.filter(({ clubs }) =>
        clubs.some((club) => (club.points.find(isLast) ?? club.atTrade).provisional)
      ).length,
    },
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_VALUE_LINES_LIMITATION,
  };
  return {
    structure,
    valueLines: { valueLinesId: createAflTradeContentAddress('value-lines', content), content },
  };
}

/** Sample points. `produced` is the value and nothing is expected: the samples hold produced PAV. */
export const samplePoints = {
  seasonEnd: (season: number): AflTradeValueLineCheckpoint => ({ kind: 'season_end', season }),
  draft: (season: number): AflTradeValueLineCheckpoint => ({ kind: 'draft', season }),
  trade: (season: number): AflTradeValueLineCheckpoint => ({ kind: 'trade', season }),
  /** A stint's value: a drafted player (with his slot), a traded player or a matched-bid share. */
  stint: (
    checkpoint: AflTradeValueLineCheckpoint,
    value: number,
    state: 'open' | 'closed' = 'open',
    slot: AflTradeValueLinePoint['slot'] = null
  ): AflTradeValueLinePoint => ({
    checkpoint,
    state,
    value,
    produced: value,
    expectedRemaining: 0,
    slot,
    tenure: checkpoint.kind === 'draft' ? 0 : null,
    pending: null,
  }),
  /** A pick before its draft, valued at its slot. */
  pick: (
    checkpoint: AflTradeValueLineCheckpoint,
    slot: NonNullable<AflTradeValueLinePoint['slot']>,
    value: number
  ): AflTradeValueLinePoint => ({
    checkpoint,
    state: 'pick',
    value,
    produced: 0,
    expectedRemaining: value,
    slot,
    tenure: null,
    pending: null,
  }),
  notUsed: (checkpoint: AflTradeValueLineCheckpoint): AflTradeValueLinePoint => ({
    checkpoint,
    state: 'not_used',
    value: 0,
    produced: 0,
    expectedRemaining: 0,
    slot: null,
    tenure: null,
    pending: null,
  }),
  pending: (
    checkpoint: AflTradeValueLineCheckpoint,
    pending: NonNullable<AflTradeValueLinePoint['pending']>
  ): AflTradeValueLinePoint => ({
    checkpoint,
    state: 'pending',
    value: null,
    produced: null,
    expectedRemaining: null,
    slot: null,
    tenure: null,
    pending,
  }),
};
