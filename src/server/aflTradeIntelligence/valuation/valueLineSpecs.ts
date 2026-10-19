import type { AflTradeAssetLedgerReadModel } from './assetLedger';
import type { AflTradeAssetLedgerPick } from './assetLedgerContracts';
import type { AflTradeStoryIndex } from './realizedTradeStoryAssets';
import type { AflTradeStoryTrade } from './realizedTradeStoryContracts';
import {
  aflTradeValueLineCheckpointOrder as orderOf,
  aflTradeValueLinePending as pending,
  type AflTradeValueLineRawPoint,
  type AflTradeValueLineReader,
} from './valueLineAssets';
import type {
  AflTradeValueLineAsset,
  AflTradeValueLineBasis,
  AflTradeValueLineCheckpoint,
} from './valueLineContracts';
import {
  aflTradeValueLineAtTradeSlot,
  type AflTradeValueLineCandidate,
  type AflTradeValueLineSlot,
} from './valueLineSlots';

/** One asset's line: what it is, and its point at any checkpoint from its first trade. */
export interface AflTradeValueLineSpec {
  readonly assetKey: string;
  readonly kind: AflTradeValueLineAsset['kind'];
  readonly basis: AflTradeValueLineBasis;
  readonly pickId: string | null;
  readonly playerId: string | null;
  readonly clubId: string | null;
  readonly draftYear: number | null;
  /** Whether the pick's draft is held (in evidence), so the line has a draft checkpoint. */
  readonly draftHeld: boolean;
  readonly share: number | null;
  readonly firstTradeYear: number;
  readonly at: (checkpoint: AflTradeValueLineCheckpoint) => AflTradeValueLineRawPoint;
}

interface Hop {
  tradeYear: number;
  slot: AflTradeValueLineSlot | null;
}

type Sources = {
  trades: readonly AflTradeStoryTrade[];
  index: AflTradeStoryIndex;
  candidate: AflTradeValueLineCandidate;
  ledger: Pick<AflTradeAssetLedgerReadModel, 'ledger' | 'stintValue'>;
  reader: AflTradeValueLineReader;
};

const NOT_USED: AflTradeValueLineRawPoint = {
  state: 'not_used',
  value: 0,
  produced: 0,
  expectedRemaining: 0,
  slot: null,
  tenure: null,
  pending: null,
};

const scaled = (raw: AflTradeValueLineRawPoint, share: number): AflTradeValueLineRawPoint => {
  const by = (value: number | null) => (value === null ? null : value * share);
  return {
    ...raw,
    value: by(raw.value),
    produced: by(raw.produced),
    expectedRemaining: by(raw.expectedRemaining),
  };
};

const BASE = { pickId: null, playerId: null, clubId: null, draftYear: null, share: null };

/**
 * A pick's line: until its draft, the pick curve at the slot of its latest hop (its at-trade slot,
 * never its eventual selection); from the draft, what the ledger says it became.
 */
function pickSpec(
  sources: Sources,
  pickId: string,
  pick: AflTradeAssetLedgerPick | undefined,
  hops: readonly Hop[],
  firstTradeYear: number
): AflTradeValueLineSpec {
  const assetKey = `pick|${pickId}`;
  const base = { ...BASE, assetKey, kind: 'pick' as const, pickId, firstTradeYear };
  if (pick === undefined)
    return { ...base, basis: 'pick_pending', draftHeld: false, at: () => pending('unavailable') };
  const { reader } = sources;
  const { outcome, draftYear } = pick;
  const draft = orderOf({ kind: 'draft', season: draftYear });
  const preDraft = (checkpoint: AflTradeValueLineCheckpoint) => {
    // Hops are in trade order, so the last one at or before the checkpoint is the latest.
    const hop = hops
      .filter(
        ({ tradeYear }) => orderOf({ kind: 'trade', season: tradeYear }) <= orderOf(checkpoint)
      )
      .pop();
    if (hop === undefined) return pending('unavailable');
    return hop.slot === null
      ? pending('slot_unknown')
      : reader.pickPoint(hop.slot.selectionNumber, hop.slot.source);
  };
  const line = (
    basis: AflTradeValueLineBasis,
    fromDraft: (checkpoint: AflTradeValueLineCheckpoint) => AflTradeValueLineRawPoint,
    extra: Partial<Pick<AflTradeValueLineSpec, 'playerId' | 'clubId' | 'share'>> = {}
  ): AflTradeValueLineSpec => ({
    ...base,
    ...extra,
    basis,
    draftYear,
    draftHeld: outcome.kind !== 'future',
    at: (checkpoint) =>
      orderOf(checkpoint) < draft ? preDraft(checkpoint) : fromDraft(checkpoint),
  });
  switch (outcome.kind) {
    case 'selected': {
      const { selectionNumber, playerId, clubId, firstStint } = outcome;
      if (selectionNumber === null || playerId === null || firstStint === null)
        return line('pick_pending', () => pending('unavailable'));
      return line(
        'pick_selected',
        (checkpoint) =>
          reader.drafted(
            { selectionNumber, source: 'used_selection' },
            draftYear,
            playerId,
            firstStint,
            checkpoint
          ),
        { playerId, clubId }
      );
    }
    case 'not_used':
    case 'passed':
      return line('pick_not_used', () => NOT_USED);
    case 'future':
      return line('pick_future', () => pending('draft_not_in_evidence'));
    case 'unresolved':
      return line('pick_pending', () => pending('unavailable'));
    case 'matched_bid': {
      if (outcome.status === 'pending') return line('pick_pending', () => pending('matched_bid'));
      const match = sources.ledger.ledger.content.bidMatches.find(
        ({ bidMatchId }) => bidMatchId === outcome.bidMatchId
      );
      const nominee = match?.nominee;
      if (!match || !nominee?.firstStint || match.clubId === null || match.draftYear !== draftYear)
        return line('pick_pending', () => pending('matched_bid'));
      const stint = nominee.firstStint;
      return line(
        'pick_matched_bid_share',
        (checkpoint) =>
          scaled(
            reader.drafted(
              { selectionNumber: match.selectionNumber, source: 'bid_selection' },
              draftYear,
              nominee.playerId,
              stint,
              checkpoint
            ),
            outcome.share
          ),
        { playerId: nominee.playerId, clubId: match.clubId, share: outcome.share }
      );
    }
  }
}

/**
 * Every asset's line, and each leg's asset key and at-trade view. A pick leg is followed through
 * each onward trade to its final hop, so it carries what its pick finally became; a player leg is
 * his own stint at the club that received him in that trade.
 */
export function aflTradeValueLineSpecs(sources: Sources) {
  const { trades, index, candidate, ledger, reader } = sources;
  const transfers = new Map(candidate.transfers.map((transfer) => [transfer.transferId, transfer]));
  const picks = new Map(ledger.ledger.content.picks.map((pick) => [pick.pickId, pick]));
  const specs = new Map<string, AflTradeValueLineSpec>();
  const hops = new Map<string, { list: Hop[]; firstTradeYear: number; pickId: string }>();
  const legs: {
    key: string;
    assetKey: string;
    tradeYear: number;
    slot: AflTradeValueLineSlot | null;
    pick: boolean;
  }[] = [];
  for (const trade of trades)
    for (const leg of trade.legs) {
      const transfer = transfers.get(leg.transferId);
      if (transfer === undefined)
        throw new Error(
          `The batch names transfer ${leg.transferId}, which the candidate does not hold.`
        );
      const key = `${trade.transactionId}|${leg.transferId}`;
      const unresolved = (assetKey: string) => {
        if (!specs.has(assetKey))
          specs.set(assetKey, {
            ...BASE,
            assetKey,
            kind: 'unresolved',
            basis: 'pending',
            draftHeld: false,
            firstTradeYear: trade.tradeYear,
            at: () => pending('unavailable'),
          });
        legs.push({ key, assetKey, tradeYear: trade.tradeYear, slot: null, pick: false });
      };
      if (leg.assetKind === 'player') {
        if (transfer.asset.kind !== 'player')
          throw new Error(`Transfer ${leg.transferId} is a player leg but not a player transfer.`);
        const playerId = transfer.asset.playerId;
        if (playerId === null) {
          unresolved(`unresolved|${leg.transferId}`);
          continue;
        }
        const fromSeason = trade.tradeYear + 1;
        const assetKey = `player|${playerId}|${leg.receivingClubId}|${fromSeason}`;
        if (!specs.has(assetKey)) {
          const stint = ledger.stintValue(playerId, leg.receivingClubId, fromSeason);
          const tradeYear = trade.tradeYear;
          specs.set(assetKey, {
            ...BASE,
            assetKey,
            kind: 'player',
            basis: 'traded_player',
            playerId,
            clubId: leg.receivingClubId,
            draftHeld: false,
            firstTradeYear: tradeYear,
            at: (checkpoint) => reader.traded(playerId, tradeYear, stint, checkpoint),
          });
        }
        legs.push({ key, assetKey, tradeYear: trade.tradeYear, slot: null, pick: false });
        continue;
      }
      const final = transfers.get(index.finalHop({ trade, leg }).leg.transferId);
      if (final === undefined)
        throw new Error(`The final hop of transfer ${leg.transferId} is not in the candidate.`);
      if (final.asset.kind !== 'pick_entitlement') {
        unresolved(`unresolved|${leg.transferId}`);
        continue;
      }
      const assetKey = `pick|${final.asset.pickId}`;
      const slot =
        transfer.asset.kind === 'pick_entitlement'
          ? aflTradeValueLineAtTradeSlot(candidate, transfer.asset, trade.tradeYear)
          : null;
      const entry = hops.get(assetKey) ?? {
        list: [],
        firstTradeYear: trade.tradeYear,
        pickId: final.asset.pickId,
      };
      entry.list.push({ tradeYear: trade.tradeYear, slot });
      hops.set(assetKey, entry);
      legs.push({ key, assetKey, tradeYear: trade.tradeYear, slot, pick: true });
    }
  for (const [assetKey, { list, firstTradeYear, pickId }] of hops)
    specs.set(assetKey, pickSpec(sources, pickId, picks.get(pickId), list, firstTradeYear));

  const legKeys = new Map<string, { assetKey: string; atTrade: AflTradeValueLineRawPoint }>();
  for (const { key, assetKey, tradeYear, slot, pick } of legs) {
    const spec = specs.get(assetKey)!;
    const checkpoint: AflTradeValueLineCheckpoint = { kind: 'trade', season: tradeYear };
    const beforeDraft =
      spec.draftYear === null ||
      orderOf(checkpoint) < orderOf({ kind: 'draft', season: spec.draftYear });
    // A pick's at-trade view is its own leg's slot, which other hops of the pick never change.
    const atTrade =
      pick && beforeDraft
        ? slot === null
          ? pending('slot_unknown')
          : reader.pickPoint(slot.selectionNumber, slot.source)
        : spec.at(checkpoint);
    legKeys.set(key, { assetKey, atTrade });
  }
  return { specs, legKeys };
}
