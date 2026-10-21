import type { AflTradeExternalReconciliationCandidateRecord } from '../source/externalReconciliationCandidateContracts';
import {
  aflTradeBoardPreDraftSlotOf,
  aflTradePickOrderSlotOf,
  type AflTradePickAsset,
} from './pickSlots';
import type { AflTradeValueLineSlotSource } from './valueLineContracts';

type CandidateContent = AflTradeExternalReconciliationCandidateRecord['content'];

/** The candidate fields the value lines read: transfers, and the orders and boards for slots. */
export type AflTradeValueLineCandidate = Pick<CandidateContent, 'transfers'> &
  Partial<Pick<CandidateContent, 'pickCustody' | 'draftBoardPicks' | 'draftSelections'>>;

export interface AflTradeValueLineSlot {
  readonly selectionNumber: number;
  readonly source: Extract<
    AflTradeValueLineSlotSource,
    'stated_at_trade' | 'order' | 'order_proxy' | 'board_pre_draft'
  >;
}

/**
 * A pick's slot at a trade of year `tradeYear` (value-line method, "Picks"), never the selection it
 * was eventually used at: the number the trade states, else rule v6's slot in the live Official AFL
 * order (the previous draft's order as a flagged proxy when its own draft has none), else the number
 * a reviewed Footyinfo board states it held before the draft (rule v19). Null for a pick of another
 * draft type, of an earlier draft, or one nothing places.
 */
export function aflTradeValueLineAtTradeSlot(
  candidate: AflTradeValueLineCandidate,
  asset: AflTradePickAsset,
  tradeYear: number
): AflTradeValueLineSlot | null {
  if (asset.draftType !== 'national' || asset.draftYear < tradeYear) return null;
  if (asset.nominalPick !== null)
    return { selectionNumber: asset.nominalPick, source: 'stated_at_trade' };
  const order = aflTradePickOrderSlotOf(candidate.pickCustody ?? [], asset);
  if (order)
    return {
      selectionNumber: order.selectionNumber,
      source: order.proxy ? 'order_proxy' : 'order',
    };
  const board = aflTradeBoardPreDraftSlotOf(candidate.draftBoardPicks ?? [], asset);
  return board ? { selectionNumber: board.selectionNumber, source: 'board_pre_draft' } : null;
}
