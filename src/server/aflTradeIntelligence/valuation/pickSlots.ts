import type { AflTradeExternalReconciliationCandidateRecord } from '../source/externalReconciliationCandidateContracts';
import { latestPickCustodyObservation } from '../source/pickCustodyDate';
import { isAflTradeUsableCustodyStatus } from '../source/pickLineageDeferral';
import { HPN_DPVC_V3_LAST_SUPPORTED_PICK } from '../modeling/hpnPickValueBenchmark';

type CandidateContent = AflTradeExternalReconciliationCandidateRecord['content'];
type Transfer = CandidateContent['transfers'][number];
type BoardPick = NonNullable<CandidateContent['draftBoardPicks']>[number];
export type AflTradePickCustody = CandidateContent['pickCustody'][number];
export type AflTradePickAsset = Extract<Transfer['asset'], { kind: 'pick_entitlement' }>;
type Custody = AflTradePickCustody;

const LAST = HPN_DPVC_V3_LAST_SUPPORTED_PICK;

const nationalRows = (custody: readonly Custody[], draftYear: number) =>
  custody.filter((row) => row.draftYear === draftYear && row.draftType === 'national');

/** Rows of one entitlement by draft round and original club; a pick with neither matches none. */
const sameEntitlement = (round: number | null, originalClubId: string | null) => (row: Custody) =>
  round !== null &&
  originalClubId !== null &&
  row.roundNumber === round &&
  row.originalClubId === originalClubId;

/** Every capture of a pick in one draft's rows: under its `pickId`, or re-keyed for its entitlement. */
const capturesOf = (rows: readonly Custody[], asset: AflTradePickAsset) =>
  rows.filter(
    (row) =>
      row.pickId === asset.pickId || sameEntitlement(asset.nominalRound, asset.originalClubId)(row)
  );

/** The slot a latest observation names, when it is usable and inside HPN's 1 to 90. */
function usableSlot(found: Custody | undefined): number | undefined {
  const selectionNumber = found?.recordedPickNumber;
  if (!found || !isAflTradeUsableCustodyStatus(found.status) || selectionNumber == null)
    return undefined;
  return selectionNumber <= LAST ? selectionNumber : undefined;
}

export interface AflTradePickOrderSlot {
  custody: Custody;
  selectionNumber: number;
  proxy: boolean;
}

/**
 * Rule v6 (owner direction 2026-10-14): the slot a national pick holds in the live Official AFL
 * indicative order. Its draft's custody rows with its `pickId` or with its draft, round and original
 * club, whatever their status, give the latest observation of the pick; that row must be usable and
 * name a slot from 1 to 90, so a newer disputed or unnumbered capture is never overridden by an older
 * usable one. When its draft has no order at all, the same round and original club in the previous
 * draft's order stand in as a proxy (a 2027 pick before the 2027 order exists). A pick with no
 * original club (a compensation or assistance pick) matches only by `pickId`, so it never proxies.
 */
export function aflTradePickOrderSlotOf(
  custody: readonly Custody[],
  asset: AflTradePickAsset
): AflTradePickOrderSlot | undefined {
  if (asset.draftType !== 'national') return undefined;
  const own = nationalRows(custody, asset.draftYear);
  const proxy = own.length === 0;
  const found = proxy
    ? latestPickCustodyObservation(
        nationalRows(custody, asset.draftYear - 1).filter(
          sameEntitlement(asset.nominalRound, asset.originalClubId)
        )
      )
    : latestPickCustodyObservation(capturesOf(own, asset));
  const selectionNumber = usableSlot(found);
  return selectionNumber === undefined ? undefined : { custody: found!, selectionNumber, proxy };
}

/**
 * Rule v19 (issue 789, owner decision 2026-10-18): the number a reviewed Footyinfo board states an
 * unused pick held before the draft. The board pick is the one passed or removed pick of the pick's
 * entitlement (national draft, round and original club, as the board states them from parser v3);
 * none, several, or a slot beyond HPN's 1 to 90 gives none. Nothing is matched by holder: the board
 * may record a later holder than a pick's trail reaches.
 */
export function aflTradeBoardPreDraftSlotOf(
  boardPicks: readonly BoardPick[],
  asset: AflTradePickAsset
): { boardPickId: string; selectionNumber: number } | undefined {
  if (asset.draftType !== 'national' || asset.nominalRound === null || !asset.originalClubId)
    return undefined;
  const matches = boardPicks.filter(
    (board) =>
      board.draftYear === asset.draftYear &&
      board.draftType === 'national' &&
      board.roundNumber === asset.nominalRound &&
      board.originalClubId === asset.originalClubId
  );
  const board = matches.length === 1 ? matches[0]! : undefined;
  const selectionNumber = board?.originalNumber;
  if (board?.status === 'selected' || selectionNumber == null || selectionNumber > LAST)
    return undefined;
  return { boardPickId: board!.boardPickId, selectionNumber };
}
