import type { AflTradeAssetLedgerReadModel } from './assetLedger';
import type { AflTradeAssetLedgerPick } from './assetLedgerContracts';
import { aflTradePickLatestOrderNumber, type AflTradePickCustody } from './pickSlots';
import type { AflTradeStructureLeg, AflTradeStructureTrade } from './tradeStructureContracts';
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
  trades: readonly AflTradeStructureTrade[];
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
      // Rule R2: a not-used pick that stood mid-draft is pending from the draft, never 0.
      if (outcome.fate === 'unknown')
        return line('pick_pending', () =>
          pending(
            outcome.evidence === 'board_not_spent'
              ? 'not_used_holder_matched_bid'
              : 'not_used_mid_draft'
          )
        );
      return line('pick_not_used', () => NOT_USED);
    case 'passed':
      return line('pick_not_used', () => NOT_USED);
    case 'relayed':
      // Rule R1: the structure links a relayed pick on, so its own line is never read.
      throw new Error(
        `The ledger relays pick ${pickId} to ${outcome.pickId}, but the trade structure does not link it on.`
      );
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

type Transfer = AflTradeValueLineCandidate['transfers'][number];

/**
 * Whether `next` continues `hop`'s asset: given on by the club that received it, as the same pick (a
 * pick trail), as another pick id of the same draft with the number both trades state (a relay, rule
 * R1), or as the next transfer of the same special entitlement's reviewed custody chain.
 */
function continues(
  transfers: ReadonlyMap<string, Transfer>,
  custody: readonly AflTradePickCustody[],
  hop: AflTradeStructureLeg,
  next: AflTradeStructureLeg
): boolean {
  const onward = hop.onward!;
  const from = transfers.get(hop.transferId)?.asset;
  const to = transfers.get(next.transferId)?.asset;
  if (next.sendingClubId !== hop.receivingClubId || !from || !to) return false;
  if (onward.kind === 'pick_trail')
    return (
      from.kind === 'pick_entitlement' &&
      to.kind === 'pick_entitlement' &&
      from.pickId === to.pickId
    );
  if (onward.kind === 'pick_relay_reviewed')
    return (
      from.kind === 'pick_entitlement' &&
      to.kind === 'pick_entitlement' &&
      from.pickId !== to.pickId &&
      from.draftYear === to.draftYear &&
      from.draftType === to.draftType
    );
  if (onward.kind === 'pick_relay')
    return (
      from.kind === 'pick_entitlement' &&
      to.kind === 'pick_entitlement' &&
      from.pickId !== to.pickId &&
      from.draftYear === to.draftYear &&
      from.draftType === to.draftType &&
      // R1 by order: a leg that states no number relays by its latest Official AFL order number.
      (from.nominalPick ?? aflTradePickLatestOrderNumber(custody, from)) ===
        onward.selectionNumber &&
      to.nominalPick === onward.selectionNumber
    );
  if (from.kind === 'player' || from.kind === 'pick_entitlement' || to.kind === 'player')
    return false;
  const own = (asset: typeof from | typeof to) =>
    asset.kind !== 'special_entitlement' || asset.entitlementId === onward.entitlementId;
  return own(from) && own(to);
}

/**
 * A leg's final hop: its onward links in the trade structure (a pick trail, or a special
 * entitlement's reviewed custody successor), followed to the leg that links nowhere. The structure
 * links whatever became of the onward trade and cuts every cycle; a cycle here is refused, and so is a
 * link that does not continue the asset (any caller can seal a structure).
 */
function finalHopOf(
  legs: ReadonlyMap<string, AflTradeStructureLeg>,
  transfers: ReadonlyMap<string, Transfer>,
  custody: readonly AflTradePickCustody[],
  leg: AflTradeStructureLeg
): AflTradeStructureLeg {
  let hop = leg;
  for (let steps = 0; hop.onward !== undefined; steps++) {
    if (steps > legs.size)
      throw new Error(`The trade structure links transfer ${leg.transferId} in a cycle.`);
    const next = legs.get(hop.onward.transferId);
    if (next === undefined)
      throw new Error(`The trade structure links transfer ${hop.transferId} outside itself.`);
    if (!continues(transfers, custody, hop, next))
      throw new Error(
        `The trade structure links transfer ${hop.transferId} to ${next.transferId}, which does not continue its asset.`
      );
    hop = next;
  }
  return hop;
}

/**
 * Every asset's line, and each leg's asset key and at-trade view. A pick leg follows the trade
 * structure's onward links to its final hop, so it carries what its pick finally became, in every
 * trade it passed through; a player leg is his own stint at the club that received him in that trade.
 */
export function aflTradeValueLineSpecs(sources: Sources) {
  const { trades, candidate, ledger, reader } = sources;
  const transfers = new Map(candidate.transfers.map((transfer) => [transfer.transferId, transfer]));
  const structureLegs = new Map(
    trades.flatMap(({ legs }) => legs.map((leg) => [leg.transferId, leg] as const))
  );
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
          `The structure names transfer ${leg.transferId}, which the candidate does not hold.`
        );
      if (transfer.fromClubId !== leg.sendingClubId || transfer.toClubId !== leg.receivingClubId)
        throw new Error(`Transfer ${leg.transferId}'s clubs are not the candidate transfer's.`);
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
      const final = transfers.get(
        finalHopOf(structureLegs, transfers, candidate.pickCustody ?? [], leg).transferId
      );
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
