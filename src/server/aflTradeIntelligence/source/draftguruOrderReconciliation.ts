import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import type {
  AflTradeExternalEvidenceBatch,
  AflTradeExternalEvidenceContent,
} from './externalDraftTradeEvidenceContracts';

type Claim = AflTradeExternalEvidenceContent['claim'];
type OrderClaim = Extract<Claim, { kind: 'draft_order_pick' }>;
type RecordedEntity = OrderClaim['club'];
type Evidence = AflTradeExternalEvidenceBatch['content']['evidence'][number];
export type DraftguruOrderEvidence = Evidence & { content: { claim: OrderClaim } };

/**
 * Drafts whose Draftguru post-draft order settles the outcomes of the traded picks it ties (owner
 * approval 4 of the 2026 intake). Another draft needs a new owner decision, never just a new entry.
 */
export const ORDER_ORIGIN_DRAFTS: ReadonlySet<string> = new Set(['2026|national']);

/**
 * One row of a Draftguru post-draft order (`draft_order_pick`), clubs and player resolved: its
 * round, final number, holder and outcome, and the candidate transfer each of its trade hops ties
 * to (null where a hop ties to none, and for every hop outside `ORDER_ORIGIN_DRAFTS`). `playerId` is
 * the selected player, or the nominee a spent pick matched; null when unresolved or removed. Every
 * order row is one record, so the candidate conserves it whether or not anything reads it.
 */
export interface AflTradeCanonicalDraftOrderPick {
  orderPickId: string;
  draftYear: number;
  draftType: string;
  roundNumber: number;
  pickNumber: number | null;
  clubId: string | null;
  outcome: 'selected' | 'bid_spent' | 'removed';
  playerId: string | null;
  /** The number a spent pick was spent as, as the row states it. */
  asPick: number | null;
  hopTransferIds: (string | null)[];
  evidenceIds: string[];
}

/** A candidate pick transfer the order's hops may tie to. */
export interface DraftguruOrderTieTransfer {
  transferId: string;
  /** `nativeEventId|nativeTransferId`, as Draftguru's statements key a transfer. */
  key: string;
  nativeEventId: string;
  fromClubId: string | null;
  toClubId: string | null;
  draftYear: number;
  draftType: string;
  /** The round or number the trade page states for the pick, when it states one. */
  statedRound: number | null;
  statedNumber: number | null;
}

/** A transfer an order row ties: the row, the hop and whether it is the row's last hop. */
export interface DraftguruOrderTie {
  orderPickId: string;
  hop: number;
  final: boolean;
}

export interface DraftguruOrderReconciliation {
  records: AflTradeCanonicalDraftOrderPick[];
  rows: ReadonlyMap<string, DraftguruOrderEvidence>;
  /** By transfer id. */
  ties: ReadonlyMap<string, DraftguruOrderTie>;
  /** The resolved club chain of a row: its original club (null when it states none) and hop clubs. */
  routes: ReadonlyMap<string, readonly (string | null)[]>;
}

type Lookup = (entityKind: 'club' | 'player', sourceIdentity: RecordedEntity) => string | null;

interface HopSlot {
  orderPickId: string;
  ordinal: number;
  hop: number;
  final: boolean;
  round: number;
  pickNumber: number | null;
}

/** Whether a row's draft is one the order may settle. */
export function isDraftguruOrderOriginDraft(draftYear: number, draftType: string): boolean {
  return ORDER_ORIGIN_DRAFTS.has(`${draftYear}|${draftType}`);
}

/**
 * Pairs a slot's hops with its transfers, as many of each: one to one; else by the round each
 * transfer states when every transfer states a distinct round and the hops' rounds are the same
 * set; else by number, the lowest stated number with the earliest row (round, then final number),
 * when every transfer states a distinct number and no two hops share a round unless both rows were
 * selected. Otherwise nothing ties.
 */
function pairSlot(
  slots: readonly HopSlot[],
  transfers: readonly DraftguruOrderTieTransfer[]
): [HopSlot, DraftguruOrderTieTransfer][] {
  if (slots.length !== transfers.length || slots.length === 0) return [];
  if (slots.length === 1) return [[slots[0]!, transfers[0]!]];
  const distinct = (values: readonly (number | null)[]) =>
    values.every((value) => value !== null) && new Set(values).size === values.length;
  const rounds = transfers.map(({ statedRound }) => statedRound);
  if (
    distinct(rounds) &&
    distinct(slots.map(({ round }) => round)) &&
    slots.every(({ round }) => rounds.includes(round))
  ) {
    return slots.map((slot) => [
      slot,
      transfers.find(({ statedRound }) => statedRound === slot.round)!,
    ]);
  }
  const ordered = [...slots].sort(
    (left, right) =>
      left.round - right.round ||
      (left.pickNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.pickNumber ?? Number.MAX_SAFE_INTEGER) ||
      left.ordinal - right.ordinal
  );
  const sharedRound = ordered.some(
    (slot, index) =>
      index > 0 &&
      slot.round === ordered[index - 1]!.round &&
      (slot.pickNumber === null || ordered[index - 1]!.pickNumber === null)
  );
  if (!distinct(transfers.map(({ statedNumber }) => statedNumber)) || sharedRound) return [];
  const byNumber = [...transfers].sort((left, right) => left.statedNumber! - right.statedNumber!);
  return ordered.map((slot, index) => [slot, byNumber[index]!]);
}

/**
 * Reads the Draftguru post-draft order rows and ties each hop to the candidate transfer it is: the
 * transfer in the hop's trade (`nativeEventId`) of a pick in the row's draft, to the hop's club,
 * from the previous hop's club (the row's original club for the first hop, or any club when the
 * row states none, as a compensation pick does). A transfer two slots could take, or a slot whose
 * hops and transfers `pairSlot` cannot pair, ties nothing, and nothing changes for it.
 */
export function reconcileDraftguruOrderPicks(input: {
  evidence: readonly Evidence[];
  transfers: readonly DraftguruOrderTieTransfer[];
  lookup: Lookup;
}): DraftguruOrderReconciliation {
  const orderRows = input.evidence.filter(
    (row): row is DraftguruOrderEvidence =>
      row.content.provider === 'draftguru' && row.content.claim.kind === 'draft_order_pick'
  );
  const rows = new Map<string, DraftguruOrderEvidence>();
  const routes = new Map<string, (string | null)[]>();
  const slots = new Map<string, HopSlot[]>();
  const records = orderRows.map((row) => {
    const claim = row.content.claim;
    const orderPickId = createAflTradeContentAddress('external-draft-order-pick', {
      evidenceId: row.evidenceId,
    });
    rows.set(orderPickId, row);
    const origin =
      claim.origin?.kind === 'entitlement' || claim.origin?.kind === 'leftover_points'
        ? input.lookup('club', claim.origin.club)
        : null;
    const hopClubs = claim.hops.map(({ toClub }) => input.lookup('club', toClub));
    routes.set(orderPickId, [origin, ...hopClubs]);
    if (isDraftguruOrderOriginDraft(claim.draftYear, claim.draftType)) {
      const statesOrigin =
        claim.origin?.kind === 'entitlement' || claim.origin?.kind === 'leftover_points';
      claim.hops.forEach((hop, index) => {
        const to = hopClubs[index];
        const from = index === 0 ? origin : hopClubs[index - 1];
        // A club the row names that does not resolve leaves the hop untied.
        if (to === null || (from === null && (index > 0 || statesOrigin))) return;
        const key = `${hop.nativeEventId}|${from ?? '*'}|${to}`;
        (slots.get(key) ?? slots.set(key, []).get(key)!).push({
          orderPickId,
          ordinal: row.content.sourceRow.ordinal,
          hop: index,
          final: index === claim.hops.length - 1,
          round:
            claim.origin?.kind === 'entitlement' ? claim.origin.roundNumber : claim.roundNumber,
          pickNumber: claim.pickNumber,
        });
      });
    }
    const player =
      claim.outcome.kind === 'selected'
        ? claim.outcome.player
        : claim.outcome.kind === 'bid_spent'
          ? claim.outcome.nominee
          : null;
    return {
      orderPickId,
      draftYear: claim.draftYear,
      draftType: claim.draftType,
      roundNumber: claim.roundNumber,
      pickNumber: claim.pickNumber,
      clubId: input.lookup('club', claim.club),
      outcome: claim.outcome.kind,
      playerId: player === null ? null : input.lookup('player', player),
      asPick: claim.outcome.kind === 'bid_spent' ? claim.outcome.asPick : null,
      hopTransferIds: claim.hops.map((): string | null => null),
      evidenceIds: [row.evidenceId],
    } satisfies AflTradeCanonicalDraftOrderPick;
  });

  // Each slot's candidate transfers; a transfer two slots could take ties to neither.
  const candidates = new Map<string, DraftguruOrderTieTransfer[]>();
  const claimedBy = new Map<string, number>();
  for (const key of slots.keys()) {
    const [event, from, to] = key.split('|');
    const found = input.transfers.filter(
      (transfer) =>
        transfer.nativeEventId === event &&
        transfer.toClubId === to &&
        (from === '*' || transfer.fromClubId === from) &&
        slots.get(key)!.some(({ orderPickId }) => {
          const { draftYear, draftType } = rows.get(orderPickId)!.content.claim;
          return transfer.draftYear === draftYear && transfer.draftType === draftType;
        })
    );
    candidates.set(key, found);
    for (const { transferId } of found)
      claimedBy.set(transferId, (claimedBy.get(transferId) ?? 0) + 1);
  }
  const ties = new Map<string, DraftguruOrderTie>();
  const recordsById = new Map(records.map((record) => [record.orderPickId, record]));
  for (const [key, hops] of slots) {
    const found = candidates.get(key)!;
    if (found.some(({ transferId }) => claimedBy.get(transferId)! > 1)) continue;
    for (const [slot, transfer] of pairSlot(hops, found)) {
      ties.set(transfer.transferId, {
        orderPickId: slot.orderPickId,
        hop: slot.hop,
        final: slot.final,
      });
      recordsById.get(slot.orderPickId)!.hopTransferIds[slot.hop] = transfer.transferId;
    }
  }
  return {
    records: records.sort((left, right) => left.orderPickId.localeCompare(right.orderPickId)),
    rows,
    ties,
    routes,
  };
}
