import type { AflTradeExternalReconciliationCandidateRecord } from '../source/externalReconciliationCandidateContracts';

type CandidateContent = AflTradeExternalReconciliationCandidateRecord['content'];

/**
 * One candidate's governed inputs, already loaded (`loadAflTradeGradingInputs`), that the trade
 * structure, the asset ledger, the value lines and the traded-player fit read (statlyaus/Statly#789).
 * Nothing here values a trade. The realized grade (rules v1 to v19) that first read these inputs was
 * retired by the value-line method's step 5.
 */
export interface AflTradeGradingInputs {
  candidateId: string;
  /**
   * The candidate's trades, transfers and provider-stated pick outcomes, with the draft selections,
   * reviewed Footyinfo board picks and matched bids, and the Official AFL pick custody (orders) that
   * place a pick's slot and its draftee.
   */
  candidate: Pick<CandidateContent, 'transactions' | 'transfers' | 'pickOutcomes'> &
    Partial<
      Pick<
        CandidateContent,
        'draftSelections' | 'draftBoardPicks' | 'draftBoardBidMatches' | 'pickCustody'
      >
    >;
  /** One pinned HPN PAV calculation per season, and whether that season is official. */
  pavCalculations: readonly { season: number; calculationId: string; official: boolean }[];
  /** HPN PAV per player per season at one club, from the pinned calculations. */
  pav: readonly { playerId: string; season: number; clubId: string; value: number }[];
  /** v3 season spells: each club a player appeared for in a season. */
  seasonSpells: readonly { playerId: string; season: number; clubId: string }[];
  /** The seasons the season spells cover. A departure can only be seen in these. */
  spellSeasons: readonly number[];
  /** Current reviewed (v4) arrivals: a player's first season at a club. */
  reviewedArrivals: readonly { playerId: string; clubId: string; season: number }[];
  /**
   * The approved canonical special entitlement custody chain. Each row is one transfer of a special
   * draft entitlement; its successor is the row naming it as `predecessorTransferId`.
   */
  specialEntitlementCustody?: readonly {
    transferId: string;
    entitlementId: string;
    predecessorTransferId: string | null;
  }[];
  pickProjectionBenchmarkId: string;
  spellCutoffAt: string;
  gradedAt: string;
}
