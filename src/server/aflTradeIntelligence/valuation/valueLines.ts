import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import type { AflTradePlayerSeasonGames } from '../modeling/playerSeasonGames';
import type { AflTradeTradedPlayerValueEvaluator } from '../modeling/tradedPlayerValueLineContracts';
import {
  AFL_TRADE_VALUE_LINE_FIT_SCHEMA_VERSION,
  type AflTradeValueLineFit,
} from '../modeling/valueLineFit';
import type { AflTradeAssetLedgerReadModel } from './assetLedger';
import { AflTradeStoryIndex } from './realizedTradeStoryAssets';
import type { AflTradeStoryTrade, AflTradeStoryTransferAsset } from './realizedTradeStoryContracts';
import {
  AflTradeValueLineReader,
  aflTradeValueLineCheckpointOrder as orderOf,
  type AflTradeValueLineRawPoint,
} from './valueLineAssets';
import {
  AFL_TRADE_VALUE_LINE_RULES,
  AFL_TRADE_VALUE_LINES_LIMITATION,
  AFL_TRADE_VALUE_LINES_SCHEMA_VERSION,
  type AflTradeValueLineAsset,
  type AflTradeValueLineBasis,
  type AflTradeValueLineCheckpoint,
  type AflTradeValueLineNetPoint,
  type AflTradeValueLinePoint,
  type AflTradeValueLines,
  type AflTradeValueLinesContent,
  type AflTradeValueLineTrade,
  type AflTradeValueLineTradeLeg,
} from './valueLineContracts';
import { type AflTradeValueLineSpec, aflTradeValueLineSpecs } from './valueLineSpecs';
import type { AflTradeValueLineCandidate } from './valueLineSlots';

/**
 * The value-line calculator (value-line method, implementation order step 3; statlyaus/Statly#789).
 * Pure and deterministic: from the stored fit, the asset ledger, the player-season games read model,
 * the reconciliation candidate and a realized-trade-grade batch (read for its trades, legs and onward
 * links only, never its values), it gives every traded asset's value line at each checkpoint and each
 * trade's per-club nets on those lines, with each leg's at-trade view beside them.
 */
export interface AflTradeValueLineInputs {
  /** The sealed fit (`afl-trade-value-line-fit/v2`); its content address is checked. */
  readonly fit: Pick<AflTradeValueLineFit, 'fitId' | 'content'>;
  readonly ledger: Pick<AflTradeAssetLedgerReadModel, 'ledger' | 'stintValue'>;
  readonly games: AflTradePlayerSeasonGames;
  readonly candidateId: string;
  readonly candidate: AflTradeValueLineCandidate;
  readonly batch: {
    readonly batchId: string;
    readonly content: {
      readonly inputs: {
        readonly candidateId: string;
        readonly pavCalculations: readonly {
          readonly season: number;
          readonly calculationId: string;
        }[];
      };
      readonly trades: readonly AflTradeStoryTrade[];
    };
  };
  /** The stored traded-player fit; without it a traded player's open stint is pending. */
  readonly tradedPlayers?: AflTradeTradedPlayerValueEvaluator;
  /** The last season end valued. */
  readonly throughSeason: number;
}

const byCodeUnit = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const round = (value: number) => {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Refuses inputs that do not describe the same seasons, method and candidate. */
function requireConsistent(inputs: AflTradeValueLineInputs): Map<number, string> {
  const { fit, ledger, games, batch, candidateId, throughSeason } = inputs;
  if (fit.content.schemaVersion !== AFL_TRADE_VALUE_LINE_FIT_SCHEMA_VERSION)
    throw new Error(`The fit is not ${AFL_TRADE_VALUE_LINE_FIT_SCHEMA_VERSION}.`);
  if (createAflTradeContentAddress('value-line-fit', fit.content) !== fit.fitId)
    throw new Error('The fit does not match its content address.');
  if (games.methodId !== fit.content.methodId)
    throw new Error('The games read model is not of the fit’s HPN PAV method.');
  if (games.discrepancies.length > 0)
    throw new Error('The games read model has discrepancies; the value lines refuse it.');
  const read = games.seasons.map(({ season }) => season).sort((left, right) => left - right);
  if (
    games.seasons.some(({ availability }) => availability !== 'available') ||
    read.some((season, index) => index > 0 && season !== read[index - 1]! + 1)
  )
    throw new Error('Every season of the games read model must be available, without a gap.');
  if (
    ledger.ledger.content.inputs.candidateId !== candidateId ||
    batch.content.inputs.candidateId !== candidateId
  )
    throw new Error('The ledger, the batch and the candidate are not of the same candidate.');
  const pinned = new Map<number, { calculationId: string; from: string }>();
  const pin = (from: string, rows: readonly { season: number; calculationId: string | null }[]) => {
    for (const { season, calculationId } of rows) {
      const earlier = pinned.get(season);
      if (earlier && earlier.calculationId !== calculationId)
        throw new Error(
          `Season ${season}: the ${earlier.from} and the ${from} pin different HPN PAV calculations.`
        );
      if (calculationId !== null) pinned.set(season, { calculationId, from });
    }
  };
  pin('games read model', games.seasons);
  pin('fit', fit.content.fitWindow.seasons);
  pin('ledger', ledger.ledger.content.inputs.pavCalculations);
  pin('batch', batch.content.inputs.pavCalculations);
  if (throughSeason > fit.content.fitWindow.lastSeason)
    throw new Error(`Checkpoint ${throughSeason} is after the fit's last season.`);
  if (throughSeason > read[read.length - 1]!)
    throw new Error(`Checkpoint ${throughSeason} is after the games read model's last season.`);
  return new Map([...pinned].map(([season, { calculationId }]) => [season, calculationId]));
}

/** A raw point at its checkpoint, rounded to a millionth of a PAV (a share is already applied). */
function finish(
  checkpoint: AflTradeValueLineCheckpoint,
  raw: AflTradeValueLineRawPoint
): AflTradeValueLinePoint {
  const scale = (value: number | null) => (value === null ? null : round(value));
  return {
    checkpoint,
    ...raw,
    value: scale(raw.value),
    produced: scale(raw.produced),
    expectedRemaining: scale(raw.expectedRemaining),
  };
}

function netPoint(
  checkpoint: AflTradeValueLineCheckpoint,
  clubId: string,
  legs: readonly { leg: AflTradeValueLineTradeLeg; point: AflTradeValueLinePoint }[]
): AflTradeValueLineNetPoint {
  let net = 0;
  const pendingLegs: AflTradeValueLineNetPoint['pending'][number][] = [];
  for (const { leg, point } of legs) {
    const sign = (leg.receivingClubId === clubId ? 1 : 0) - (leg.sendingClubId === clubId ? 1 : 0);
    if (sign === 0) continue;
    if (point.value === null)
      pendingLegs.push({
        assetKey: leg.assetKey,
        direction: sign > 0 ? 'received' : 'given',
        reason: point.pending ?? 'unavailable',
      });
    else net += sign * point.value;
  }
  return { checkpoint, net: round(net), provisional: pendingLegs.length > 0, pending: pendingLegs };
}

/** Computes and seals every traded asset's value line and each trade's per-club nets. */
export function computeAflTradeValueLines(inputs: AflTradeValueLineInputs): AflTradeValueLines {
  const seasons = requireConsistent(inputs);
  const { batch, candidate, throughSeason, ledger } = inputs;
  const trades = [...batch.content.trades].sort(
    (left, right) =>
      left.tradeYear - right.tradeYear || byCodeUnit(left.transactionId, right.transactionId)
  );
  if (trades.length === 0) throw new Error('The batch has no trades.');
  if (trades.some(({ tradeYear }) => tradeYear > throughSeason))
    throw new Error(`A trade is after checkpoint ${throughSeason}.`);
  const official = new Map(
    ledger.ledger.content.inputs.pavCalculations.map((row) => [row.season, row.official])
  );
  const seasonEnds = Array.from(
    { length: throughSeason - trades[0]!.tradeYear },
    (_, index) => trades[0]!.tradeYear + 1 + index
  );
  const unofficial = seasonEnds.filter((season) => official.get(season) !== true);
  if (unofficial.length > 0)
    throw new Error(`Season ends ${unofficial.join(', ')} have no official HPN PAV.`);

  const transfers = new Map<string, AflTradeStoryTransferAsset>(
    candidate.transfers.map(({ transferId, asset }) => [
      transferId,
      asset.kind === 'pick_entitlement'
        ? { kind: 'pick', pickId: asset.pickId, label: '' }
        : asset.kind === 'player' && asset.playerId !== null
          ? { kind: 'player', playerId: asset.playerId }
          : // Never the same asset as another transfer, so never followed on.
            { kind: 'pick', pickId: `unresolved|${transferId}`, label: '' },
    ])
  );
  const index = new AflTradeStoryIndex(batch, {
    clubs: new Map(),
    players: new Map(),
    picks: new Map(),
    transfers,
  });
  const reader = new AflTradeValueLineReader(
    inputs.fit.content.parameters,
    inputs.games,
    candidate,
    inputs.tradedPlayers
  );
  const { specs, legKeys } = aflTradeValueLineSpecs({ trades, index, candidate, ledger, reader });

  const cache = new Map<string, AflTradeValueLinePoint>();
  const pointAt = (spec: AflTradeValueLineSpec, checkpoint: AflTradeValueLineCheckpoint) => {
    const key = `${spec.assetKey}@${orderOf(checkpoint)}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const point = finish(checkpoint, spec.at(checkpoint));
    cache.set(key, point);
    return point;
  };
  const seasonEnd = (season: number): AflTradeValueLineCheckpoint => ({
    kind: 'season_end',
    season,
  });
  const lineCheckpoints = (spec: AflTradeValueLineSpec, from: number) =>
    [
      ...(spec.draftYear !== null &&
      spec.draftHeld &&
      spec.draftYear >= from &&
      spec.draftYear <= throughSeason
        ? [{ kind: 'draft' as const, season: spec.draftYear }]
        : []),
      ...Array.from({ length: Math.max(0, throughSeason - from) }, (_, i) =>
        seasonEnd(from + 1 + i)
      ),
    ].sort((left, right) => orderOf(left) - orderOf(right));

  const assets: AflTradeValueLineAsset[] = [...specs.values()]
    .sort((left, right) => byCodeUnit(left.assetKey, right.assetKey))
    .map((spec) => ({
      assetKey: spec.assetKey,
      kind: spec.kind,
      basis: spec.basis,
      pickId: spec.pickId,
      playerId: spec.playerId,
      clubId: spec.clubId,
      draftYear: spec.draftYear,
      share: spec.share,
      points: lineCheckpoints(spec, spec.firstTradeYear).map((checkpoint) =>
        pointAt(spec, checkpoint)
      ),
    }));

  const valueTrades: AflTradeValueLineTrade[] = trades.map((trade) => {
    const atTradeCheckpoint: AflTradeValueLineCheckpoint = {
      kind: 'trade',
      season: trade.tradeYear,
    };
    const legs = trade.legs
      .map((leg) => {
        const { assetKey, atTrade } = legKeys.get(`${trade.transactionId}|${leg.transferId}`)!;
        const spec = specs.get(assetKey)!;
        return {
          spec,
          leg: {
            transferId: leg.transferId,
            assetKey,
            sendingClubId: leg.sendingClubId,
            receivingClubId: leg.receivingClubId,
            atTrade: finish(atTradeCheckpoint, atTrade),
          },
        };
      })
      .sort((left, right) => byCodeUnit(left.leg.transferId, right.leg.transferId));
    const checkpoints = [
      ...new Map(
        legs
          .flatMap(({ spec }) => lineCheckpoints(spec, trade.tradeYear))
          .map((checkpoint) => [orderOf(checkpoint), checkpoint] as const)
      ).values(),
    ].sort((left, right) => orderOf(left) - orderOf(right));
    const clubIds = [...new Set(trade.clubs.map(({ clubId }) => clubId))].sort(byCodeUnit);
    return {
      transactionId: trade.transactionId,
      tradeYear: trade.tradeYear,
      legs: legs.map(({ leg }) => leg),
      clubs: clubIds.map((clubId) => ({
        clubId,
        atTrade: netPoint(
          atTradeCheckpoint,
          clubId,
          legs.map(({ leg }) => ({ leg, point: leg.atTrade }))
        ),
        points: checkpoints.map((checkpoint) =>
          netPoint(
            checkpoint,
            clubId,
            legs.map(({ spec, leg }) => ({ leg, point: pointAt(spec, checkpoint) }))
          )
        ),
      })),
    };
  });

  const byBasis: Record<AflTradeValueLineBasis, number> = {
    pick_selected: 0,
    pick_matched_bid_share: 0,
    pick_future: 0,
    pick_not_used: 0,
    pick_pending: 0,
    traded_player: 0,
    pending: 0,
  };
  for (const { basis } of assets) byBasis[basis]++;
  const lastOf = <T extends { checkpoint: AflTradeValueLineCheckpoint }>(points: readonly T[]) =>
    points.find(
      ({ checkpoint }) => checkpoint.kind === 'season_end' && checkpoint.season === throughSeason
    );
  const content: AflTradeValueLinesContent = {
    schemaVersion: AFL_TRADE_VALUE_LINES_SCHEMA_VERSION,
    environment: 'non_production',
    valueUnit: 'hpn_pav',
    rules: AFL_TRADE_VALUE_LINE_RULES,
    inputs: {
      fitId: inputs.fit.fitId,
      tradedPlayerFitId: inputs.tradedPlayers?.parameters.fitId ?? null,
      ledgerId: ledger.ledger.ledgerId,
      candidateId: inputs.candidateId,
      batchId: batch.batchId,
      gamesMethodId: inputs.games.methodId,
      seasons: [...seasons]
        .sort(([left], [right]) => left - right)
        .map(([season, calculationId]) => ({ season, calculationId })),
      throughSeason,
    },
    assets,
    trades: valueTrades,
    summary: {
      assets: assets.length,
      trades: valueTrades.length,
      byBasis,
      pendingAtLastCheckpoint: assets.filter(({ points }) => lastOf(points)?.value === null).length,
      provisionalTrades: valueTrades.filter(({ clubs }) =>
        clubs.some((club) => (lastOf(club.points) ?? club.atTrade).provisional)
      ).length,
    },
    publicationEligible: false,
    publicationProhibited: true,
    limitation: AFL_TRADE_VALUE_LINES_LIMITATION,
  };
  return { valueLinesId: createAflTradeContentAddress('value-lines', content), content };
}
