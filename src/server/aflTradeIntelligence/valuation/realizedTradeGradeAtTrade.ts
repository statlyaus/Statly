import type { AflTradeExternalReconciliationCandidateRecord } from '../source/externalReconciliationCandidateContracts';
import { latestPickCustodyObservation } from '../source/pickCustodyDate';
import { isAflTradeUsableCustodyStatus } from '../source/pickLineageDeferral';
import {
  HPN_DPVC_V3_LAST_SUPPORTED_PICK,
  hpnDpv3ValueForPick,
} from '../modeling/hpnPickValueBenchmark';
import {
  AFL_TRADE_REALIZED_CLUBS_PER_ROUND,
  type AflTradeRealizedTradeGradeLeg,
} from './realizedTradeGradeContracts';

type CandidateContent = AflTradeExternalReconciliationCandidateRecord['content'];
type Transfer = CandidateContent['transfers'][number];
export type AflTradeGradeCustody = CandidateContent['pickCustody'][number];
export type AflTradeGradePickAsset = Extract<Transfer['asset'], { kind: 'pick_entitlement' }>;
type Custody = AflTradeGradeCustody;
type PickAsset = AflTradeGradePickAsset;
type AtTrade = AflTradeRealizedTradeGradeLeg['atTrade'];
type EventualSlotSource = Extract<AtTrade, { kind: 'pick_projection_eventual_slot' }>['slotSource'];

const LAST = HPN_DPVC_V3_LAST_SUPPORTED_PICK;
export const AFL_TRADE_FUTURE_PICK_SLOT_UNKNOWN: AtTrade = {
  kind: 'unavailable',
  reason: 'future_pick_slot_unknown',
};
export const AFL_TRADE_PICK_OUTSIDE_PROJECTION_DOMAIN: AtTrade = {
  kind: 'unavailable',
  reason: 'pick_outside_projection_domain',
};

const nationalRows = (custody: readonly Custody[], draftYear: number) =>
  custody.filter((row) => row.draftYear === draftYear && row.draftType === 'national');

/** Rows of one entitlement by draft round and original club; a pick with neither matches none. */
const sameEntitlement = (round: number | null, originalClubId: string | null) => (row: Custody) =>
  round !== null &&
  originalClubId !== null &&
  row.roundNumber === round &&
  row.originalClubId === originalClubId;

/** Every capture of a pick in one draft's rows: under its `pickId`, or re-keyed for its entitlement. */
const capturesOf = (rows: readonly Custody[], asset: PickAsset) =>
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

export interface AflTradeGradeOrderSlot {
  custody: Custody;
  selectionNumber: number;
  proxy: boolean;
}

/**
 * Rule v6 (owner direction 2026-10-14): the slot a pending national pick holds in the live Official
 * AFL indicative order. Its draft's custody rows with its `pickId` or with its draft, round and
 * original club, whatever their status, give the latest observation of the pick; that row must be
 * usable and name a slot from 1 to 90, so a newer disputed or unnumbered capture is never overridden
 * by an older usable one. When its draft has no order at all, the same round and original club in the
 * previous draft's order stand in as a proxy (a 2027 pick before the 2027 order exists). A pick with no
 * original club (a compensation or assistance pick) matches only by `pickId`, so it never proxies.
 */
export function aflTradeGradeOrderSlotOf(
  custody: readonly Custody[],
  asset: PickAsset
): AflTradeGradeOrderSlot | undefined {
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
 * Rule v17: whether a pick held a slot in its own draft's final order. Its latest capture names a
 * number (usable or not, inside 1 to 90 or not), or its captures are too close in time to tell which
 * is latest. A pick never captured, or last captured with no number, held none.
 */
function heldOrderSlot(rows: readonly Custody[], asset: PickAsset): boolean {
  const captures = capturesOf(rows, asset);
  if (captures.length === 0) return false;
  const latest = latestPickCustodyObservation(captures);
  return !latest || latest.recordedPickNumber !== null;
}

/** Rule v17: each club's own first-round slot in one draft's final order, where it is usable. */
function firstRoundSlots(rows: readonly Custody[]): Map<string, Custody> {
  const clubs = new Set(
    rows.flatMap((row) => (row.roundNumber === 1 && row.originalClubId ? [row.originalClubId] : []))
  );
  const slots = new Map<string, Custody>();
  for (const clubId of clubs) {
    const found = latestPickCustodyObservation(rows.filter(sameEntitlement(1, clubId)));
    if (usableSlot(found) !== undefined) slots.set(clubId, found!);
  }
  return slots;
}

export interface AflTradeGradeRoundPositionProxy {
  roundNumber: number;
  clubPosition: number;
  selectionNumber: number;
  orderCustodyId: string;
}

/**
 * Rule v17 (issue 789, 2026-10-16): a round-position proxy for a pick that held no slot in its own
 * draft's final order (spent matching a bid, passed, or never used). Its original club's position is
 * its rank by its own first-round slot among the clubs whose first-round slot that order names (rule
 * v6's lookup by draft, round and original club); the proxy slot is that position plus 18 for each
 * later round, capped at 90. A pick with no round or original club, a club with no usable first-round
 * slot, or a pick that did hold a slot, gets none.
 */
export function aflTradeGradeRoundPositionProxyOf(
  custody: readonly Custody[],
  asset: PickAsset
): AflTradeGradeRoundPositionProxy | undefined {
  const round = asset.nominalRound;
  if (asset.draftType !== 'national' || round === null || asset.originalClubId === null)
    return undefined;
  const rows = nationalRows(custody, asset.draftYear);
  if (heldOrderSlot(rows, asset)) return undefined;
  const slots = firstRoundSlots(rows);
  const own = slots.get(asset.originalClubId);
  if (!own) return undefined;
  const clubPosition =
    1 +
    [...slots.values()].filter((row) => row.recordedPickNumber! < own.recordedPickNumber!).length;
  if (clubPosition > AFL_TRADE_REALIZED_CLUBS_PER_ROUND) return undefined;
  return {
    roundNumber: round,
    clubPosition,
    selectionNumber: Math.min(
      LAST,
      clubPosition + AFL_TRADE_REALIZED_CLUBS_PER_ROUND * (round - 1)
    ),
    orderCustodyId: own.custodyId,
  };
}

/** Rules v8 and v17: a future pick's at-trade view at the slot it eventually took. */
export function aflTradeEventualSlotView(
  benchmarkId: string,
  selectionNumber: number,
  slotSource: EventualSlotSource
): AtTrade {
  return {
    kind: 'pick_projection_eventual_slot',
    benchmarkId,
    selectionNumber,
    slotSource,
    value: hpnDpv3ValueForPick(selectionNumber),
  };
}

/** Rule v17: a future pick's at-trade view at its round-position proxy, an estimate. */
export function aflTradeRoundPositionProxyView(
  benchmarkId: string,
  proxy: AflTradeGradeRoundPositionProxy
): AtTrade {
  return {
    kind: 'pick_projection_round_position_proxy',
    benchmarkId,
    ...proxy,
    value: hpnDpv3ValueForPick(proxy.selectionNumber),
  };
}

/**
 * A current pick's at-trade view at its slot at the trade. HPN states DPVC v3 for 1 to 90 only; from
 * rule v17 a later slot is valued at DPVC(90), an upper bound since the curve falls with the slot.
 */
export function aflTradeNominalPickView(benchmarkId: string, nominalPick: number): AtTrade {
  if (nominalPick <= LAST)
    return {
      kind: 'pick_projection',
      benchmarkId,
      selectionNumber: nominalPick,
      value: hpnDpv3ValueForPick(nominalPick),
    };
  return {
    kind: 'pick_projection_domain_capped',
    benchmarkId,
    selectionNumber: nominalPick,
    cappedAt: LAST,
    value: hpnDpv3ValueForPick(LAST),
  };
}
