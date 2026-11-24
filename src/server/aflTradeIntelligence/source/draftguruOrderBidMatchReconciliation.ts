import { z } from 'zod';

import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  isDraftguruOrderOriginDraft,
  type DraftguruOrderEvidence,
  type DraftguruOrderReconciliation,
} from './draftguruOrderReconciliation';

type OrderClaim = DraftguruOrderEvidence['content']['claim'];
type RecordedEntity = OrderClaim['club'];
type Lookup = (entityKind: 'club' | 'player', sourceIdentity: RecordedEntity) => string | null;

export const AFL_TRADE_BID_LADDER_SCHEMA_VERSION = 'afl-trade-bid-ladder/v1' as const;

/**
 * The owner's ladder for pricing a season's matched bids (owner, 2026-11-24): each club's final
 * ranking that season, finals included, keyed by the Draftguru club id the order rows name
 * (`port-adelaide`). Supplied at preparation (`--bid-ladder`) and recorded on each bid it prices; a
 * club it leaves out has no position, so its bid is refused (`ladder_position_missing`).
 */
export const aflTradeBidLadderSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_BID_LADDER_SCHEMA_VERSION),
    season: z.number().int().min(2026).max(2200),
    basis: z.literal('final_ranking_including_finals'),
    /** Where the owner read the ladder, for the record. */
    source: z.string().trim().min(1).max(1_000),
    positions: z.record(z.string().regex(/^[a-z]+(?:-[a-z]+)*$/), z.number().int().min(1).max(19)),
  })
  .strict()
  .refine(({ positions }) => {
    const values = Object.values(positions);
    return values.length > 0 && new Set(values).size === values.length;
  }, 'A ladder names at least one club, and no two clubs share a position.');

export type AflTradeBidLadder = z.infer<typeof aflTradeBidLadderSchema>;

/**
 * One matched bid a Draftguru post-draft order states (owner, 2026-11-24): its nominee row ("Port bid
 * for X matched (Academy) using picks 6, 22"), clubs and nominee resolved. Each pick the row says the
 * club used is tied to the one order row spent on the same nominee by the same club as that number;
 * when the club's spent rows are not exactly those numbers, none is tied. Points are never stored:
 * valuation reads them from the year's DVI at each slot. Every bid row is one record.
 */
export interface AflTradeCanonicalDraftOrderBidMatch {
  bidMatchId: string;
  draftYear: number;
  draftType: string;
  roundNumber: number;
  /** The bid's slot: the nominee row's number. */
  selectionNumber: number;
  /** The matching club, which holds the nominee row. */
  clubId: string | null;
  /** The nominee. */
  playerId: string | null;
  bidClubId: string | null;
  basis: 'father_son' | 'academy' | 'next_generation_academy';
  /** The picks spent, in the order the nominee row lists them ("using picks 6, 22"). */
  spentPicks: {
    /** The live slot it was spent as. */
    asPick: number;
    /** The spent order row; null when the club's spent rows are not exactly the listed numbers. */
    orderPickId: string | null;
    /** The row's origin: its stated original club first (null when none), then each hop's club. */
    routeClubIds: (string | null)[];
    originKind: 'entitlement' | 'compensation' | 'leftover_points' | null;
  }[];
  /** The leftover-points rows the match created: their number and player, as the order states. */
  leftoverPicks: { orderPickId: string; pickNumber: number | null; playerId: string | null }[];
  /** The matching club's position on the owner's ladder of the draft's season; null when not given. */
  ladderPosition: number | null;
  evidenceIds: string[];
}

const sameEntity = (left: RecordedEntity, right: RecordedEntity) =>
  left.nativeId !== null && right.nativeId !== null
    ? left.nativeId === right.nativeId
    : left.recordedName === right.recordedName;

type BidRow = DraftguruOrderEvidence & {
  content: { claim: { origin: Extract<OrderClaim['origin'], { kind: 'bid_matched' }> } };
};

const isBidRow = (row: DraftguruOrderEvidence): row is BidRow =>
  row.content.claim.origin?.kind === 'bid_matched' &&
  row.content.claim.pickNumber !== null &&
  isDraftguruOrderOriginDraft(row.content.claim.draftYear, row.content.claim.draftType);

/** The club's spent rows for this nominee, each tied to a listed number only when they all agree. */
function spentRowsOf(
  bid: BidRow,
  rows: readonly [string, DraftguruOrderEvidence][]
): (readonly [string, DraftguruOrderEvidence] | null)[] {
  const { claim } = bid.content;
  const spent = rows.filter(([, row]) => {
    const other = row.content.claim;
    return (
      other.outcome.kind === 'bid_spent' &&
      other.draftYear === claim.draftYear &&
      other.draftType === claim.draftType &&
      sameEntity(other.club, claim.club) &&
      sameEntity(other.outcome.nominee, claim.origin.nominee)
    );
  });
  const listed = claim.origin.usingPicks;
  const asPick = ([, row]: (typeof spent)[number]) =>
    row.content.claim.outcome.kind === 'bid_spent' ? row.content.claim.outcome.asPick : null;
  const agrees =
    spent.length === listed.length &&
    new Set(listed).size === listed.length &&
    listed.every((number) => spent.filter((row) => asPick(row) === number).length === 1);
  return listed.map((number) => (agrees ? spent.find((row) => asPick(row) === number)! : null));
}

/**
 * One record per Draftguru order bid row of a draft the order settles (`ORDER_ORIGIN_DRAFTS`): the
 * matching and bidding clubs and the nominee through their reviewed resolutions, the spent and
 * leftover rows of the same nominee and club, and the matching club's position on the owner's ladder
 * when one is given for the draft's season. The rows are the ones post-draft order reconciliation
 * already read (`reconcileDraftguruOrderPicks`), so a spent pick is identified by its order row.
 */
export function reconcileDraftguruOrderBidMatches(input: {
  order: Pick<DraftguruOrderReconciliation, 'rows' | 'routes'>;
  lookup: Lookup;
  ladder?: AflTradeBidLadder;
}): AflTradeCanonicalDraftOrderBidMatch[] {
  const rows = [...input.order.rows];
  return rows
    .flatMap(([, row]) => (isBidRow(row) ? [row] : []))
    .map((bid) => {
      const { claim } = bid.content;
      const spent = spentRowsOf(bid, rows);
      const leftover = rows.filter(([, row]) => {
        const origin = row.content.claim.origin;
        return (
          origin?.kind === 'leftover_points' &&
          row.content.claim.draftYear === claim.draftYear &&
          row.content.claim.draftType === claim.draftType &&
          sameEntity(origin.club, claim.club) &&
          sameEntity(origin.nominee, claim.origin.nominee)
        );
      });
      const ladderPosition =
        input.ladder?.season === claim.draftYear && claim.club.nativeId !== null
          ? (input.ladder.positions[claim.club.nativeId] ?? null)
          : null;
      return {
        bidMatchId: createAflTradeContentAddress('external-draft-order-bid-match', {
          evidenceId: bid.evidenceId,
        }),
        draftYear: claim.draftYear,
        draftType: claim.draftType,
        roundNumber: claim.roundNumber,
        selectionNumber: claim.pickNumber!,
        clubId: input.lookup('club', claim.club),
        playerId: input.lookup('player', claim.origin.nominee),
        bidClubId: input.lookup('club', claim.origin.bidClub),
        basis: claim.origin.basis,
        spentPicks: claim.origin.usingPicks.map((asPick, index) => {
          const tied = spent[index];
          const origin = tied?.[1].content.claim.origin ?? null;
          return {
            asPick,
            orderPickId: tied?.[0] ?? null,
            routeClubIds: tied ? [...input.order.routes.get(tied[0])!] : [],
            originKind: origin === null || origin.kind === 'bid_matched' ? null : origin.kind,
          };
        }),
        leftoverPicks: leftover.map(([orderPickId, row]) => {
          const outcome = row.content.claim.outcome;
          return {
            orderPickId,
            pickNumber: row.content.claim.pickNumber,
            playerId: outcome.kind === 'selected' ? input.lookup('player', outcome.player) : null,
          };
        }),
        ladderPosition,
        evidenceIds: [
          ...new Set([
            bid.evidenceId,
            ...spent.flatMap((row) => (row ? [row[1].evidenceId] : [])),
            ...leftover.map(([, row]) => row.evidenceId),
          ]),
        ].sort((left, right) => left.localeCompare(right)),
      };
    })
    .sort((left, right) => left.bidMatchId.localeCompare(right.bidMatchId));
}
