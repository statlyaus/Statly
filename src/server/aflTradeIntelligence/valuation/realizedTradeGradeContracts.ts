import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { hpnDpv3ValueForPick } from '../modeling/hpnPickValueBenchmark';
import { pickCustodyDateSchema } from '../source/pickCustodyDate';
import {
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
} from '@/types/aflTradeIntelligence/shared';

/**
 * The MVP realized trade grade (statlyaus/Statly#789; rules in docs/architecture/afl-trade-intelligence.md,
 * "Valuing a not-used pick", "Traded-on picks and bundled trades", "Pick projection" and "Realized trade
 * grade (MVP) contract"). Each transfer leg carries one realized value in whole-first-stint HPN PAV at its receiving
 * club: received for that club and given up by the sending club. A club's net is received minus given up.
 * The at-trade view is reported beside each leg and never enters a total. The unit is `career_pav`, which
 * the docs forbid composing with Statly model units, so this contract is separate from the draw-based
 * complete-exchange assessment, and it carries no letter grade.
 *
 * Pick outcomes come from Draftguru. Under rule v1 every valued or excluded pick leg carries
 * `single_source_pick_outcome`, so only a trade of players alone can be `complete`. Under rule v2
 * (owner decision 2026-10-12, issues 853 and 789) a pick leg whose outcome a Footyinfo draft board
 * corroborates says so (`corroboratedBy: 'footyinfo'`) and drops that reason; every other valued or
 * excluded pick leg keeps it. A v1 batch never names a corroborating provider.
 *
 * Under rules v1 and v2 a blocked leg nulls every club total in its trade. Under rule v3 (issue 789) a
 * club's `received` is null only when a leg it receives is blocked, and its `givenUp` only when a leg it
 * sends is blocked; `net` is null when either is. A traded-on pick then needs only its club's side of
 * the onward trade, which may be blocked elsewhere (`traded_on_return_partial`).
 *
 * HPN PAV is signed: a few player-seasons are slightly negative. Under rule v4 (issue 789) a first-stint
 * leg is worth its stint's PAV sum floored at 0, since a player cannot return less than nothing, and the
 * stint records that signed sum as `pavSum` for audit. Rules v1 to v3 record no `pavSum`.
 *
 * Under rule v5 (owner decision 2026-10-14, issue 789) a reviewed Footyinfo board may prove which
 * selections the 2025 national draft had, no official completed session being reviewed for it. A
 * not-used pick leg whose nominee count rests on that board says so (`draftProvenBy: 'footyinfo'`) and
 * stays single-source: the board proves the draft, not the pick's fate. Rules v1 to v4 never name it.
 *
 * Under rule v6 (owner direction 2026-10-14, issue 789) a pick whose draft is not yet in evidence
 * (`pending`) is valued provisionally from its slot in the live Official AFL indicative order: the HPN
 * DPVC v3 value of that slot (`pick_projected_from_order`). DPVC is whole-career expected PAV, not the
 * first-stint PAV every other leg realizes, so the leg is always provisional. A pick of a draft with no
 * order yet takes its original club's slot in the same round of the latest order, flagged as a proxy.
 * A traded-on pick whose club's onward side rests on such a projection says so
 * (`traded_on_return_projected`). Rules v1 to v5 never project a pick.
 *
 * Under rule v7 (issue 789) a special draft entitlement (a concession or other special pick) whose
 * reviewed canonical custody chain names a successor transfer, the ordinary pick it was traded on as,
 * is valued as a traded-on pick through that successor's trade. It names the entitlement and the
 * successor (`specialEntitlement`) and says so (`special_entitlement_custody_linked`). It stays
 * single-source: the chain is reviewed custody, not a corroborating draft board. A special entitlement
 * with no successor stays `special_entitlement_unsupported`. Rules v1 to v6 never follow the chain.
 *
 * Under rule v8 (owner direction 2026-10-16, issue 789) a future pick, whose slot no club knew at the
 * trade, reports at trade the HPN DPVC v3 value of the slot it eventually took
 * (`pick_projection_eventual_slot`): the selection it was used at, else its slot in its own draft's
 * order, else for a pending pick its rule v6 projected slot. That is hindsight, not what the clubs knew,
 * and like every at-trade view it never enters a total. Rules v1 to v7 never report it.
 *
 * Under rule v9 (issue 789) a pick hop Draftguru stated "not used", whose receiving club the
 * candidate shows giving the same pick away in a later trade (the outcome's `statedDisposition`), is
 * a traded-on pick valued by its onward return, never 0, and says so (`stated_not_used_traded_on`).
 * Draftguru reports a pick's final fate on every page it passed through; only the final holder's hop
 * stays not used. Rules v1 to v8 never state it.
 *
 * Under rule v10 (issue 789, 2026-10-16) a receiving club's selection that a reviewed Footyinfo board
 * records as that club's matched bid counts as a nominee even when Draftguru's year page marks it
 * open (2020 Reef McInnes, Collingwood matching GWS's academy bid). A not-used pick leg excluded on
 * such a count says so (`nomineeMatchedBidBy: 'footyinfo'`) and stays single-source: the board states
 * the nominee, not this pick's fate. Rules v1 to v9 never name it.
 *
 * Under rule v11 (issue 789, 2026-10-16) a traded-on pick that was the only asset its club gave in the
 * onward trade is worth all its club received there, even when the pick's own leg there is excluded
 * (the next holder spent it on a nominee): that later fate is not this club's. Only a bundle's excluded
 * pick, which has no realized weight to share the return by, stays unallocated. A traded-on pick whose
 * club received legs in the onward trade that are all excluded is unallocated, not worth a known 0.
 * Rules v1 to v10 never value a sole asset whose onward leg is excluded, and value an all-excluded
 * return at 0.
 *
 * Under rule v12 (issue 789, 2026-10-16, coordinator decision under the owner's full permission) a
 * traded-on pick's trail orders one season's undated pick-only trades by their Draftguru event id
 * suffix (inferred from 87 of 87 consecutive numbered pairs agreeing with the chain), and when more
 * than one trail survives keeps the one ending at the pick's latest usable Official AFL custody
 * holder (`source/pickOnwardTransfer.ts`). A pick that cycled within one trade period then follows
 * one trail instead of linking back into its first trade. The batch records no new field, so the
 * contract cannot tell the rules apart; the version and limitation name it.
 *
 * Under rule v13 (issue 789, 2026-10-16) a traded-on pick in a bundle (its club gave more than one
 * asset in the onward trade) whose club gave any excluded asset there is unallocated: the excluded
 * asset's realized weight is unknown, so no traded-on asset's share of the return is known. Through
 * rule v12 the excluded sibling dropped out of the weight total and its valued siblings absorbed its
 * share. A sole asset still takes the whole return (rule v11).
 *
 * Ids, reasons and seasons are ordered by JavaScript code-unit comparison (`<`), not `localeCompare`.
 */
export const AFL_TRADE_REALIZED_TRADE_GRADE_BATCH_SCHEMA_VERSION =
  'afl-trade-realized-trade-grade-batch/v1' as const;
export const AFL_TRADE_REALIZED_TRADE_GRADE_RULE_VERSION =
  'afl-trade-realized-grade-rule/v13' as const;
/** Every rule a stored batch may name, with the limitation it states; earlier batches stay valid. */
const RULE_LIMITATIONS = {
  'afl-trade-realized-grade-rule/v1':
    'Private local non-production realized trade grade in career_pav; single-source pick outcomes; not public factual, publication, production or activation authority.',
  'afl-trade-realized-grade-rule/v2':
    'Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; not public factual, publication, production or activation authority.',
  'afl-trade-realized-grade-rule/v3':
    'Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; not public factual, publication, production or activation authority.',
  'afl-trade-realized-grade-rule/v4':
    'Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; not public factual, publication, production or activation authority.',
  'afl-trade-realized-grade-rule/v5':
    'Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; not public factual, publication, production or activation authority.',
  'afl-trade-realized-grade-rule/v6':
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; not public factual, publication, production or activation authority.",
  'afl-trade-realized-grade-rule/v7':
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; not public factual, publication, production or activation authority.",
  'afl-trade-realized-grade-rule/v8':
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; not public factual, publication, production or activation authority.",
  'afl-trade-realized-grade-rule/v9':
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used; not public factual, publication, production or activation authority.",
  'afl-trade-realized-grade-rule/v10':
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used; a receiving club's selection a reviewed Footyinfo board records as that club's matched bid counts as a nominee even when Draftguru marks it open; not public factual, publication, production or activation authority.",
  'afl-trade-realized-grade-rule/v11':
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used; a receiving club's selection a reviewed Footyinfo board records as that club's matched bid counts as a nominee even when Draftguru marks it open; a sole asset traded on is valued at its club's whole return in the onward trade, whatever became of the pick there; a traded-on pick whose club's every return leg in the onward trade is excluded is unallocated, not worth 0; not public factual, publication, production or activation authority.",
  'afl-trade-realized-grade-rule/v12':
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used; a receiving club's selection a reviewed Footyinfo board records as that club's matched bid counts as a nominee even when Draftguru marks it open; a sole asset traded on is valued at its club's whole return in the onward trade, whatever became of the pick there; a traded-on pick whose club's every return leg in the onward trade is excluded is unallocated, not worth 0; undated pick trades of one season are ordered by the Draftguru pick-trade sequence, an ordering inferred from its agreement with every chain checked, not a stated date, and a pick with more than one possible trail follows the one ending at its latest Official AFL custody holder; not public factual, publication, production or activation authority.",
  'afl-trade-realized-grade-rule/v13':
    "Private local non-production realized trade grade in career_pav; pick outcomes are single-source unless a Footyinfo draft board corroborates them; a blocked leg leaves unknown only the club totals it enters; a first stint is worth its signed HPN PAV sum floored at 0; the membership of the 2025 national draft is proven by a reviewed Footyinfo board, no official session being reviewed; a pick whose draft is not yet in evidence is valued provisionally at the HPN DPVC v3 value (whole-career expected PAV, not first-stint) of its slot in the live Official AFL indicative order; a pick of a draft with no order yet uses its original club's slot in the latest order; a special draft entitlement is followed through its reviewed canonical custody chain to the ordinary pick it was traded on as, and valued as that pick's traded-on return; a future pick's at-trade view is valued at the slot it eventually took, known only after the trade (hindsight, not what the clubs knew), and enters no total; a pick stated not used that its club traded on in a later trade is valued by its traded-on return, and only the final holder's stays not used; a receiving club's selection a reviewed Footyinfo board records as that club's matched bid counts as a nominee even when Draftguru marks it open; a sole asset traded on is valued at its club's whole return in the onward trade, whatever became of the pick there; a traded-on pick whose club's every return leg in the onward trade is excluded is unallocated, not worth 0; undated pick trades of one season are ordered by the Draftguru pick-trade sequence, an ordering inferred from its agreement with every chain checked, not a stated date, and a pick with more than one possible trail follows the one ending at its latest Official AFL custody holder; a traded-on pick given in a bundle with an excluded asset is unallocated, the excluded asset's share of the return being unknown, and a sole asset still takes the whole return; not public factual, publication, production or activation authority.",
} as const;
export type AflTradeRealizedGradeRuleVersion = keyof typeof RULE_LIMITATIONS;
/** Rules under which a blocked leg nulls every club total in its trade; later rules scope it. */
const UNSCOPED_RULES = new Set<AflTradeRealizedGradeRuleVersion>([
  'afl-trade-realized-grade-rule/v1',
  'afl-trade-realized-grade-rule/v2',
]);
/** Rules whose stints record no signed PAV sum; later rules record it and floor the value at 0. */
const UNRECORDED_PAV_SUM_RULES = new Set<AflTradeRealizedGradeRuleVersion>([
  'afl-trade-realized-grade-rule/v1',
  'afl-trade-realized-grade-rule/v2',
  'afl-trade-realized-grade-rule/v3',
]);
/** Rules under which no leg names a board-proven draft; rule v5 may. */
const UNPROVEN_DRAFT_RULES = new Set<AflTradeRealizedGradeRuleVersion>([
  'afl-trade-realized-grade-rule/v1',
  'afl-trade-realized-grade-rule/v2',
  'afl-trade-realized-grade-rule/v3',
  'afl-trade-realized-grade-rule/v4',
]);
/** Rules under which no pick is projected from a draft order; rule v6 may. */
const UNPROJECTED_RULES = new Set<AflTradeRealizedGradeRuleVersion>([
  ...UNPROVEN_DRAFT_RULES,
  'afl-trade-realized-grade-rule/v5',
]);
/** Rules under which no special entitlement is followed through its custody chain; rule v7 may. */
const NO_SPECIAL_CUSTODY_RULES = new Set<AflTradeRealizedGradeRuleVersion>([
  ...UNPROJECTED_RULES,
  'afl-trade-realized-grade-rule/v6',
]);
/** Rules under which no at-trade view reports a future pick's eventual slot; rule v8 may. */
const NO_EVENTUAL_SLOT_RULES = new Set<AflTradeRealizedGradeRuleVersion>([
  ...NO_SPECIAL_CUSTODY_RULES,
  'afl-trade-realized-grade-rule/v7',
]);
/** Rules under which no stated not-used pick is valued as traded on; rule v9 may. */
const NO_STATED_NOT_USED_TRADED_ON_RULES = new Set<AflTradeRealizedGradeRuleVersion>([
  ...NO_EVENTUAL_SLOT_RULES,
  'afl-trade-realized-grade-rule/v8',
]);
/** Rules under which no nominee rests on a board-recorded matched bid alone; rule v10 may. */
const NO_BOARD_MATCHED_BID_NOMINEE_RULES = new Set<AflTradeRealizedGradeRuleVersion>([
  ...NO_STATED_NOT_USED_TRADED_ON_RULES,
  'afl-trade-realized-grade-rule/v9',
]);
/**
 * Rules under which an excluded onward pick leaves even a sole asset unallocated, and an all-excluded
 * return is worth 0; rule v11 values the sole asset at its return and leaves that return unallocated.
 */
const PICK_EXCLUSION_ALLOCATION_RULES = new Set<AflTradeRealizedGradeRuleVersion>([
  ...NO_BOARD_MATCHED_BID_NOMINEE_RULES,
  'afl-trade-realized-grade-rule/v10',
]);
/**
 * Rules under which a bundle's valued traded-on pick may share its club's onward return with an
 * excluded sibling, which drops out of the weight total; rule v13 leaves that return unallocated.
 */
const EXCLUDED_SIBLING_SHARING_RULES = new Set<AflTradeRealizedGradeRuleVersion>([
  ...PICK_EXCLUSION_ALLOCATION_RULES,
  'afl-trade-realized-grade-rule/v11',
  'afl-trade-realized-grade-rule/v12',
]);
export const AFL_TRADE_REALIZED_TRADE_GRADE_LIMITATION =
  RULE_LIMITATIONS[AFL_TRADE_REALIZED_TRADE_GRADE_RULE_VERSION];

/** Reasons that make a leg, and so its trade, ungradable. */
export const AFL_TRADE_REALIZED_GRADE_BLOCKING_REASONS = [
  'hpn_pav_head_missing',
  'not_used_no_access_evidence',
  'pick_outcome_pending',
  'pick_outcome_unresolved',
  'player_identity_unresolved',
  'special_entitlement_unsupported',
  'traded_on_return_blocked',
  'traded_on_return_unlinked',
] as const;

/** Reasons a valued or excluded leg is not final. */
export const AFL_TRADE_REALIZED_GRADE_PROVISIONAL_REASONS = [
  'arrival_unreviewed',
  'equal_split_tiebreak',
  'no_appearances_after_trade',
  'not_used_nominee_excluded',
  'pav_season_not_official',
  'pav_seasons_missing',
  'pick_projected_from_live_order',
  'pick_projected_from_prior_order_proxy',
  'single_source_pick_outcome',
  'special_entitlement_custody_linked',
  'stated_not_used_traded_on',
  'stint_open',
  'traded_on_return_partial',
  'traded_on_return_projected',
  'traded_on_return_provisional',
  'traded_on_return_unallocated',
] as const;
/** Rule v6: reasons only a pick projected from a draft order, or a return resting on one, carries. */
const PROJECTION_REASONS = [
  'pick_projected_from_live_order',
  'pick_projected_from_prior_order_proxy',
  'traded_on_return_projected',
] as const;

const blockingReasons = new Set<string>(AFL_TRADE_REALIZED_GRADE_BLOCKING_REASONS);
export const aflTradeRealizedGradeReasonSchema = z.enum([
  ...AFL_TRADE_REALIZED_GRADE_BLOCKING_REASONS,
  ...AFL_TRADE_REALIZED_GRADE_PROVISIONAL_REASONS,
]);
export type AflTradeRealizedGradeReason = z.infer<typeof aflTradeRealizedGradeReasonSchema>;

const valueSchema = z.number().finite().min(0);
const seasonSchema = z.number().int().min(1897).max(2200);
const isCanonical = (values: readonly (string | number)[]) =>
  values.every((value, index) => index === 0 || values[index - 1]! < value);

const reasonsSchema = z
  .array(aflTradeRealizedGradeReasonSchema)
  .max(30)
  .refine(isCanonical, 'Reasons must be unique and sorted.');
// Bounded by the season range itself, so no stint the candidate allows can exceed it.
const seasonsSchema = z.array(seasonSchema).max(304).refine(isCanonical, 'Seasons must be sorted.');

const atTradeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('player_trade_season_pav'),
      season: seasonSchema,
      // HPN PAV is signed, and this view is reported as it is: it never enters a total.
      value: z.number().finite(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('pick_projection'),
      benchmarkId: aflTradeContentAddressedIdSchema('hpn-pick-benchmark'),
      selectionNumber: z.number().int().min(1).max(90),
      value: z.number().finite(),
    })
    .strict(),
  // Rule v8: a future pick at the slot it eventually took, which is hindsight, never a total.
  z
    .object({
      kind: z.literal('pick_projection_eventual_slot'),
      benchmarkId: aflTradeContentAddressedIdSchema('hpn-pick-benchmark'),
      selectionNumber: z.number().int().min(1).max(90),
      slotSource: z.enum(['selection', 'order', 'projected_order']),
      value: z.number().finite(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unavailable'),
      reason: z.enum([
        'future_pick_slot_unknown',
        'pick_outside_projection_domain',
        'trade_season_pav_missing',
      ]),
    })
    .strict(),
]);

const stintSchema = z
  .object({
    status: z.enum(['closed', 'open']),
    seasonsValued: seasonsSchema,
    seasonsMissingPav: seasonsSchema,
    /** Rule v4: the signed HPN PAV sum of the valued seasons; the leg is worth it floored at 0. */
    pavSum: z.number().finite().optional(),
  })
  .strict();

/**
 * Rule v6: the slot a pending pick takes in the live Official AFL indicative order, from one usable
 * custody row. `orderDraftYear` is the pick's own draft, or the year before it for a proxy.
 */
const projectionSchema = z
  .object({
    benchmarkId: aflTradeContentAddressedIdSchema('hpn-pick-benchmark'),
    selectionNumber: z.number().int().min(1).max(90),
    orderDraftYear: seasonSchema,
    pickDraftYear: seasonSchema,
    custodyId: aflTradeContentAddressedIdSchema('external-pick-custody'),
    observedAt: pickCustodyDateSchema,
    proxy: z.boolean(),
  })
  .strict();

/** How a traded-on pick's value was taken from the trade it moved into. */
const onwardSchema = z
  .object({
    transactionId: aflTradePublicIdSchema,
    allocation: z.enum(['sole_asset', 'relative_value', 'equal_split']),
    returnValue: valueSchema,
    givenAssetCount: z.number().int().min(1).max(200),
    weight: valueSchema.nullable(),
    weightTotal: valueSchema.nullable(),
    // 0 when the pick became nothing at the onward club (for example a nominee pick there).
    share: z.number().finite().min(0).max(1),
  })
  .strict()
  .superRefine((onward, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    const weighted = onward.weight !== null && onward.weightTotal !== null;
    if (
      onward.allocation === 'sole_asset' &&
      (onward.givenAssetCount !== 1 || onward.share !== 1 || weighted)
    )
      issue('A sole asset takes the whole return, unweighted.');
    if (
      onward.allocation === 'relative_value' &&
      (onward.givenAssetCount < 2 ||
        !weighted ||
        onward.weightTotal! <= 0 ||
        onward.share !== onward.weight! / onward.weightTotal!)
    )
      issue('A relative-value share is its realized weight over the bundle’s total weight.');
    if (
      onward.allocation === 'equal_split' &&
      (onward.givenAssetCount < 2 || weighted || onward.share !== 1 / onward.givenAssetCount)
    )
      issue('An equal split shares the return evenly across the assets given.');
  });

const legBase = {
  transferId: aflTradePublicIdSchema,
  assetKind: z.enum(['player', 'pick']),
  sendingClubId: aflTradePublicIdSchema,
  receivingClubId: aflTradePublicIdSchema,
  reasons: reasonsSchema,
  atTrade: atTradeSchema,
  /** Rule v2: the second provider whose evidence agrees with the pick outcome this leg rests on. */
  corroboratedBy: z.literal('footyinfo').optional(),
  /** Rule v5: the not-used pick's nominee count rests on a draft membership a Footyinfo board proved. */
  draftProvenBy: z.literal('footyinfo').optional(),
  /**
   * Rule v10: the not-used pick's nominee count includes a selection only a Footyinfo board's matched
   * bid records as a nominee.
   */
  nomineeMatchedBidBy: z.literal('footyinfo').optional(),
  /**
   * Rule v7: a special draft entitlement followed through its reviewed canonical custody chain to the
   * successor transfer, the ordinary pick it was traded on as in its onward trade.
   */
  specialEntitlement: z
    .object({
      entitlementId: aflTradeContentAddressedIdSchema('special-draft-entitlement'),
      successorTransferId: aflTradePublicIdSchema,
    })
    .strict()
    .optional(),
};

const legUnionSchema = z.union([
  z
    .object({
      ...legBase,
      state: z.literal('valued'),
      basis: z.enum(['pick_selected_first_stint', 'player_first_stint']),
      realizedValue: valueSchema,
      stint: stintSchema,
    })
    .strict(),
  z
    .object({
      ...legBase,
      state: z.literal('valued'),
      basis: z.literal('pick_traded_on_return'),
      realizedValue: valueSchema,
      onward: onwardSchema,
    })
    .strict(),
  z
    .object({
      ...legBase,
      state: z.literal('valued'),
      basis: z.literal('pick_not_used_no_nominee'),
      realizedValue: z.literal(0),
    })
    .strict(),
  // Rule v6: a pending pick valued provisionally at the HPN DPVC v3 value of its order slot.
  z
    .object({
      ...legBase,
      state: z.literal('valued'),
      basis: z.literal('pick_projected_from_order'),
      realizedValue: valueSchema,
      projection: projectionSchema,
    })
    .strict(),
  z
    .object({
      ...legBase,
      state: z.literal('excluded'),
      basis: z.literal('pick_not_used_nominee_excluded'),
    })
    .strict(),
  // Traded on in a bundle where it is excluded (spent on a nominee, or unallocated further down the
  // chain): it has no realized weight to share the bundle's return by, so it is excluded too.
  z
    .object({
      ...legBase,
      state: z.literal('excluded'),
      basis: z.literal('pick_traded_on_return_unallocated'),
      onwardTransactionId: aflTradePublicIdSchema,
    })
    .strict(),
  z.object({ ...legBase, state: z.literal('blocked'), basis: z.literal('unavailable') }).strict(),
]);

type ParsedLeg = z.infer<typeof legUnionSchema>;
const projectableSlot = (selectionNumber: number) =>
  Number.isInteger(selectionNumber) && selectionNumber >= 1 && selectionNumber <= 90;
type LegRule = (leg: ParsedLeg, has: (reason: AflTradeRealizedGradeReason) => boolean) => boolean;

/** Each rule returns true when the leg breaks it. */
const legRules: ReadonlyArray<readonly [LegRule, string]> = [
  [(leg) => leg.sendingClubId === leg.receivingClubId, 'A leg must move between distinct clubs.'],
  [
    (leg) =>
      (leg.state === 'blocked') !== leg.reasons.some((reason) => blockingReasons.has(reason)),
    'A leg is blocked exactly when it carries a blocking reason.',
  ],
  [
    (leg) =>
      leg.assetKind === 'player' &&
      leg.basis !== 'player_first_stint' &&
      leg.basis !== 'unavailable',
    'A player leg is valued on the player first-stint basis or blocked.',
  ],
  [
    (leg) => leg.assetKind === 'pick' && leg.basis === 'player_first_stint',
    'A pick leg is never valued on the player basis.',
  ],
  [
    (leg) =>
      leg.corroboratedBy !== undefined && (leg.assetKind !== 'pick' || leg.state === 'blocked'),
    'Only a valued or excluded pick leg rests on a corroborated pick outcome.',
  ],
  [
    (leg, has) =>
      leg.assetKind === 'pick' &&
      leg.state !== 'blocked' &&
      leg.basis !== 'pick_projected_from_order' &&
      has('single_source_pick_outcome') === (leg.corroboratedBy !== undefined),
    'A valued or excluded pick leg is single-source exactly when no second provider corroborates it.',
  ],
  [
    (leg, has) =>
      leg.basis === 'pick_projected_from_order' &&
      (has('single_source_pick_outcome') || leg.corroboratedBy !== undefined),
    'A projected pick rests on a draft order, not on a pick outcome.',
  ],
  [
    (leg, has) =>
      (leg.basis === 'pick_projected_from_order') !==
        (has('pick_projected_from_live_order') !== has('pick_projected_from_prior_order_proxy')) ||
      (has('pick_projected_from_live_order') && has('pick_projected_from_prior_order_proxy')),
    'A pick projected from a draft order, and only that, states exactly one projection reason.',
  ],
  [
    (leg, has) =>
      'projection' in leg &&
      (leg.projection.proxy !== has('pick_projected_from_prior_order_proxy') ||
        leg.projection.orderDraftYear !==
          leg.projection.pickDraftYear - (leg.projection.proxy ? 1 : 0)),
    'A projection reads its own draft’s order, or as a proxy the order of the draft before it.',
  ],
  [
    // A slot outside 1 to 90 is already a schema issue; it must not throw here.
    (leg) =>
      'projection' in leg &&
      (leg.assetKind !== 'pick' ||
        !projectableSlot(leg.projection.selectionNumber) ||
        leg.realizedValue !== hpnDpv3ValueForPick(leg.projection.selectionNumber)),
    'A projected pick is worth the HPN DPVC v3 value of its order slot.',
  ],
  [
    (leg) =>
      leg.draftProvenBy !== undefined &&
      (leg.assetKind !== 'pick' ||
        leg.corroboratedBy !== undefined ||
        (leg.basis !== 'pick_not_used_no_nominee' &&
          leg.basis !== 'pick_not_used_nominee_excluded')),
    'Only a not-used pick leg valued on its nominee count rests on a board-proven draft.',
  ],
  [
    (leg) =>
      leg.nomineeMatchedBidBy !== undefined &&
      (leg.assetKind !== 'pick' ||
        leg.corroboratedBy !== undefined ||
        leg.basis !== 'pick_not_used_nominee_excluded'),
    'Only a not-used pick leg excluded for a nominee rests on a board-recorded matched bid.',
  ],
  [
    (leg, has) =>
      (leg.specialEntitlement !== undefined) !== has('special_entitlement_custody_linked'),
    'A special entitlement followed through its custody chain, and only that, is stated as a reason.',
  ],
  [
    (leg) =>
      leg.specialEntitlement !== undefined &&
      (leg.assetKind !== 'pick' ||
        leg.corroboratedBy !== undefined ||
        (leg.basis !== 'pick_traded_on_return' &&
          leg.basis !== 'pick_traded_on_return_unallocated')),
    'Only a single-source traded-on pick leg follows a special entitlement’s custody chain.',
  ],
  [
    (leg, has) =>
      has('stated_not_used_traded_on') &&
      (leg.assetKind !== 'pick' ||
        (leg.basis !== 'pick_traded_on_return' &&
          leg.basis !== 'pick_traded_on_return_unallocated' &&
          leg.basis !== 'unavailable')),
    'Only a traded-on pick leg, or a blocked one, overrides a stated not-used pick.',
  ],
  [
    (leg, has) => leg.assetKind === 'player' && has('single_source_pick_outcome'),
    'Only a pick leg rests on a pick outcome.',
  ],
  [
    (leg, has) =>
      (leg.basis === 'pick_not_used_nominee_excluded') !== has('not_used_nominee_excluded'),
    'A not-used pick is excluded exactly when its club took a nominee with it.',
  ],
  [
    (leg, has) =>
      (leg.basis === 'pick_traded_on_return_unallocated') !== has('traded_on_return_unallocated'),
    'An unallocated traded-on pick, and only that, is stated as a reason.',
  ],
  [
    (leg, has) => ('stint' in leg && leg.stint.status === 'open') !== has('stint_open'),
    'An open stint, and only an open stint, is stated as a reason.',
  ],
  [
    (leg, has) =>
      'stint' in leg && leg.stint.seasonsMissingPav.length > 0 !== has('pav_seasons_missing'),
    'Missing PAV seasons, and only missing PAV seasons, are stated as a reason.',
  ],
  [
    (leg) =>
      'stint' in leg &&
      leg.stint.seasonsValued.some((season) => leg.stint.seasonsMissingPav.includes(season)),
    'A stint season is either valued or missing, not both.',
  ],
  [
    (leg) =>
      'stint' in leg &&
      leg.stint.pavSum !== undefined &&
      leg.realizedValue !== Math.max(0, leg.stint.pavSum),
    'A first stint is worth its signed PAV sum floored at 0.',
  ],
  [
    (leg, has) =>
      !('onward' in leg) &&
      (has('equal_split_tiebreak') ||
        has('traded_on_return_partial') ||
        has('traded_on_return_projected') ||
        has('traded_on_return_provisional')),
    'Only a traded-on pick carries onward-trade reasons.',
  ],
  [
    (leg, has) =>
      'onward' in leg && (leg.onward.allocation === 'equal_split') !== has('equal_split_tiebreak'),
    'An equal split, and only an equal split, is stated as a reason.',
  ],
  [
    (leg) =>
      'onward' in leg &&
      leg.state === 'valued' &&
      leg.realizedValue !== leg.onward.share * leg.onward.returnValue,
    'A traded-on pick is worth its share of the onward return.',
  ],
  [
    (leg) =>
      leg.atTrade.kind === 'pick_projection' &&
      (leg.assetKind !== 'pick' ||
        leg.atTrade.value !== hpnDpv3ValueForPick(leg.atTrade.selectionNumber)),
    'A pick projection must be the HPN DPVC v3 value of its selection, on a pick leg.',
  ],
  [
    // A slot outside 1 to 90 is already a schema issue; it must not throw here.
    (leg) =>
      leg.atTrade.kind === 'pick_projection_eventual_slot' &&
      (leg.assetKind !== 'pick' ||
        !projectableSlot(leg.atTrade.selectionNumber) ||
        leg.atTrade.value !== hpnDpv3ValueForPick(leg.atTrade.selectionNumber)),
    'A future pick’s eventual slot must be valued at the HPN DPVC v3 value of that slot, on a pick leg.',
  ],
  [
    (leg) =>
      leg.atTrade.kind === 'pick_projection_eventual_slot' &&
      (leg.atTrade.slotSource === 'projected_order') !==
        (leg.basis === 'pick_projected_from_order'),
    'A future pick’s eventual slot is its projected order slot exactly when its leg is projected.',
  ],
  [
    (leg) =>
      leg.atTrade.kind === 'pick_projection_eventual_slot' &&
      'projection' in leg &&
      leg.projection.selectionNumber !== leg.atTrade.selectionNumber,
    'A projected future pick’s eventual slot is the slot it is projected from.',
  ],
  [
    (leg) =>
      leg.atTrade.kind === 'pick_projection_eventual_slot' &&
      leg.atTrade.slotSource === 'selection' &&
      leg.basis !== 'pick_selected_first_stint' &&
      leg.basis !== 'unavailable',
    'Only a selected pick takes its eventual slot from its selection.',
  ],
  [
    (leg) => leg.atTrade.kind === 'player_trade_season_pav' && leg.assetKind !== 'player',
    'A trade-season PAV view belongs to a player leg.',
  ],
  [
    (leg) =>
      leg.atTrade.kind === 'unavailable' &&
      (leg.atTrade.reason === 'trade_season_pav_missing') !== (leg.assetKind === 'player'),
    'A missing trade-season PAV is a player view; the other unavailable views are picks.',
  ],
];

export const aflTradeRealizedTradeGradeLegSchema = legUnionSchema.superRefine((leg, context) => {
  const has = (reason: AflTradeRealizedGradeReason) => leg.reasons.includes(reason);
  for (const [broken, message] of legRules)
    if (broken(leg, has)) context.addIssue({ code: 'custom', message });
});

export type AflTradeRealizedTradeGradeLeg = z.infer<typeof aflTradeRealizedTradeGradeLegSchema>;

const clubGradeSchema = z
  .object({
    clubId: aflTradePublicIdSchema,
    received: valueSchema.nullable(),
    givenUp: valueSchema.nullable(),
    net: z.number().finite().nullable(),
  })
  .strict();
export type AflTradeRealizedTradeGradeClub = z.infer<typeof clubGradeSchema>;

/**
 * The club totals a trade's legs determine under a rule: each club's received and given-up sums over its
 * valued legs, reduced in leg order, and net = received − givenUp. Under rules v1 and v2 a blocked trade
 * reports nulls; under v3 a side is null only when one of its own legs is blocked. Producers use this so
 * the same legs always produce byte-identical totals.
 */
export function expectedAflTradeRealizedTradeGradeClubs(
  legs: readonly AflTradeRealizedTradeGradeLeg[],
  ruleVersion: AflTradeRealizedGradeRuleVersion
): AflTradeRealizedTradeGradeClub[] {
  const clubs = [
    ...new Set(legs.flatMap((leg) => [leg.sendingClubId, leg.receivingClubId])),
  ].sort();
  const tradeBlocked = legs.some((leg) => leg.state === 'blocked');
  const side = (onSide: (leg: AflTradeRealizedTradeGradeLeg) => boolean) => {
    if (
      UNSCOPED_RULES.has(ruleVersion)
        ? tradeBlocked
        : legs.some((leg) => onSide(leg) && leg.state === 'blocked')
    )
      return null;
    let total = 0;
    for (const leg of legs) if (leg.state === 'valued' && onSide(leg)) total += leg.realizedValue;
    return total;
  };
  return clubs.map((clubId) => {
    const received = side((leg) => leg.receivingClubId === clubId);
    const givenUp = side((leg) => leg.sendingClubId === clubId);
    return {
      clubId,
      received,
      givenUp,
      net: received === null || givenUp === null ? null : received - givenUp,
    };
  });
}

export const aflTradeRealizedTradeGradeSchema = z
  .object({
    transactionId: aflTradePublicIdSchema,
    tradeYear: seasonSchema,
    state: z.enum(['blocked', 'complete', 'provisional']),
    reasons: reasonsSchema,
    clubs: z.array(clubGradeSchema).min(2).max(10),
    legs: z.array(aflTradeRealizedTradeGradeLegSchema).min(1).max(200),
  })
  .strict()
  .superRefine((trade, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });
    if (!isCanonical(trade.legs.map(({ transferId }) => transferId)))
      issue('legs', 'Legs must be unique and ordered by transfer.');
    const reasons = [...new Set(trade.legs.flatMap((leg) => leg.reasons))].sort();
    if (reasons.join('|') !== trade.reasons.join('|'))
      issue('reasons', 'Trade reasons must be the ordered union of its legs’ reasons.');
    const state = trade.legs.some((leg) => leg.state === 'blocked')
      ? 'blocked'
      : reasons.length > 0
        ? 'provisional'
        : 'complete';
    if (trade.state !== state) issue('state', `The trade state must be ${state}.`);
    // Club totals depend on the rule, so the batch checks them (batchIssues).
    for (const leg of trade.legs) {
      if (leg.atTrade.kind === 'player_trade_season_pav' && leg.atTrade.season !== trade.tradeYear)
        issue('legs', 'A player’s at-trade view is his PAV in the trade season.');
      if (
        'stint' in leg &&
        [...leg.stint.seasonsValued, ...leg.stint.seasonsMissingPav].some(
          (season) => season <= trade.tradeYear
        )
      )
        issue('legs', 'A first stint starts after the trade season.');
    }
  });

export type AflTradeRealizedTradeGrade = z.infer<typeof aflTradeRealizedTradeGradeSchema>;

const batchContentFieldsSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_REALIZED_TRADE_GRADE_BATCH_SCHEMA_VERSION),
    ruleVersion: z.enum(
      Object.keys(RULE_LIMITATIONS) as [
        keyof typeof RULE_LIMITATIONS,
        ...(keyof typeof RULE_LIMITATIONS)[],
      ]
    ),
    environment: z.literal('non_production'),
    valueUnit: z.literal('career_pav'),
    inputs: z
      .object({
        candidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
        pavCalculations: z
          .array(
            z
              .object({
                season: seasonSchema,
                calculationId: aflTradePublicIdSchema,
                official: z.boolean(),
              })
              .strict()
          )
          .min(1)
          .max(60)
          .refine(
            (rows) => isCanonical(rows.map(({ season }) => season)),
            'Seasons must be unique and sorted.'
          ),
        pickProjectionBenchmarkId: aflTradeContentAddressedIdSchema('hpn-pick-benchmark'),
        spellCutoffAt: aflTradeIsoDateTimeSchema,
      })
      .strict(),
    gradedAt: aflTradeIsoDateTimeSchema,
    trades: z.array(aflTradeRealizedTradeGradeSchema).max(5_000),
    /** Trades the candidate holds that cannot be represented as legs: named, never dropped. */
    ungraded: z
      .array(
        z
          .object({
            transactionId: aflTradePublicIdSchema,
            reason: z.enum(['club_unresolved', 'no_transfers']),
          })
          .strict()
      )
      .max(5_000),
    summary: z
      .object({
        complete: z.number().int().min(0),
        provisional: z.number().int().min(0),
        blocked: z.number().int().min(0),
        ungraded: z.number().int().min(0),
      })
      .strict(),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.enum(
      Object.values(RULE_LIMITATIONS) as [
        (typeof RULE_LIMITATIONS)[keyof typeof RULE_LIMITATIONS],
        ...(typeof RULE_LIMITATIONS)[keyof typeof RULE_LIMITATIONS][],
      ]
    ),
  })
  .strict();

type BatchContent = z.infer<typeof batchContentFieldsSchema>;
type Issue = readonly [path: string, message: string];

/** Leg features each rule introduced: the rules that predate one refuse any leg that uses it. */
const RULE_GATED_LEG_FEATURES: ReadonlyArray<
  readonly [
    rules: ReadonlySet<AflTradeRealizedGradeRuleVersion>,
    used: (leg: AflTradeRealizedTradeGradeLeg) => boolean,
    message: string,
  ]
> = [
  [
    new Set<AflTradeRealizedGradeRuleVersion>(['afl-trade-realized-grade-rule/v1']),
    (leg) => leg.corroboratedBy !== undefined,
    'Rule v1 treats every pick outcome as single-source.',
  ],
  [
    UNPROVEN_DRAFT_RULES,
    (leg) => leg.draftProvenBy !== undefined,
    'Only rule v5 and later name a board-proven draft.',
  ],
  [
    UNPROJECTED_RULES,
    (leg) =>
      leg.basis === 'pick_projected_from_order' ||
      PROJECTION_REASONS.some((reason) => leg.reasons.includes(reason)),
    'Only rule v6 and later project a pick from a draft order.',
  ],
  [
    NO_SPECIAL_CUSTODY_RULES,
    (leg) =>
      leg.specialEntitlement !== undefined ||
      leg.reasons.includes('special_entitlement_custody_linked'),
    'Only rule v7 and later follow a special entitlement’s custody chain.',
  ],
  [
    NO_EVENTUAL_SLOT_RULES,
    (leg) => leg.atTrade.kind === 'pick_projection_eventual_slot',
    'Only rule v8 and later value a future pick at its eventual slot.',
  ],
  [
    NO_STATED_NOT_USED_TRADED_ON_RULES,
    (leg) => leg.reasons.includes('stated_not_used_traded_on'),
    'Only rule v9 and later value a stated not-used pick its club traded on.',
  ],
  [
    NO_BOARD_MATCHED_BID_NOMINEE_RULES,
    (leg) => leg.nomineeMatchedBidBy !== undefined,
    'Only rule v10 and later count a board-recorded matched bid as a nominee.',
  ],
];

function batchShapeIssues(content: BatchContent): Issue[] {
  const issues: Issue[] = [];
  const ungradedIds = content.ungraded.map(({ transactionId }) => transactionId);
  const count = (state: AflTradeRealizedTradeGrade['state']) =>
    content.trades.filter((trade) => trade.state === state).length;
  if (!isCanonical(content.trades.map(({ transactionId }) => transactionId)))
    issues.push(['trades', 'Trades must be unique and ordered by transaction.']);
  if (!isCanonical(ungradedIds))
    issues.push(['ungraded', 'Ungraded trades must be unique and ordered.']);
  if (content.trades.some(({ transactionId }) => ungradedIds.includes(transactionId)))
    issues.push(['ungraded', 'A trade is either graded or ungraded.']);
  if (content.trades.length + content.ungraded.length === 0)
    issues.push(['trades', 'A batch grades or names at least one trade.']);
  if (content.limitation !== RULE_LIMITATIONS[content.ruleVersion])
    issues.push(['limitation', 'The limitation must be the one its rule version states.']);
  for (const [rules, used, message] of RULE_GATED_LEG_FEATURES)
    if (
      rules.has(content.ruleVersion) &&
      content.trades.some(({ legs }) => legs.some((leg) => used(leg)))
    )
      issues.push(['trades', message]);
  const summary = content.summary;
  if (
    summary.complete !== count('complete') ||
    summary.provisional !== count('provisional') ||
    summary.blocked !== count('blocked') ||
    summary.ungraded !== content.ungraded.length
  )
    issues.push(['summary', 'The summary must count the trades by state.']);
  return issues;
}

/**
 * A leg's PAV seasons must be the batch's pinned calculations, and its reasons must say so. Its stint
 * records the signed PAV sum exactly when its rule does.
 */
function legSeasonIssues(
  leg: AflTradeRealizedTradeGradeLeg,
  official: ReadonlyMap<number, boolean>,
  ruleVersion: AflTradeRealizedGradeRuleVersion
): string[] {
  const has = (reason: AflTradeRealizedGradeReason) => leg.reasons.includes(reason);
  if (!('stint' in leg))
    return has('pav_season_not_official') || has('pav_seasons_missing')
      ? ['Only a leg with a stint carries PAV season reasons.']
      : [];
  const issues: string[] = [];
  if ((leg.stint.pavSum === undefined) !== UNRECORDED_PAV_SUM_RULES.has(ruleVersion))
    issues.push('A stint records its signed PAV sum exactly under rule v4 and later.');
  if (leg.stint.seasonsValued.some((season) => !official.has(season)))
    issues.push('Every valued stint season must have a pinned PAV calculation.');
  if (leg.stint.seasonsMissingPav.some((season) => official.has(season)))
    issues.push('A season with a pinned PAV calculation is not missing.');
  const unofficial = leg.stint.seasonsValued.some((season) => official.get(season) === false);
  if (unofficial !== has('pav_season_not_official'))
    issues.push('A stint valued on an unofficial season, and only that, is stated as a reason.');
  return issues;
}

/**
 * The club's side of the onward trade a traded-on pick needs under rule v3: what it received, and what
 * it gave up when it gave more than the pick.
 */
function onwardSideKnown(onwardTrade: AflTradeRealizedTradeGrade, clubId: string) {
  const club = onwardTrade.clubs.find((row) => row.clubId === clubId);
  const given = onwardTrade.legs.filter((onwardLeg) => onwardLeg.sendingClubId === clubId).length;
  return !!club && club.received !== null && (given === 1 || club.givenUp !== null);
}

/** Rule v11: the club received legs in the onward trade, and every one of them is excluded. */
export function aflTradeRealizedOnwardReturnExcluded(
  onwardLegs: readonly AflTradeRealizedTradeGradeLeg[],
  clubId: string
): boolean {
  const received = onwardLegs.filter((onwardLeg) => onwardLeg.receivingClubId === clubId);
  return received.length > 0 && received.every((onwardLeg) => onwardLeg.state === 'excluded');
}

/**
 * The club gave more than one asset in the onward trade and at least one is excluded: rule v11's
 * grounds for an unallocated pick, and from rule v13 the reason no traded-on share there is known.
 */
export function aflTradeRealizedOnwardBundleExcluded(
  onwardLegs: readonly AflTradeRealizedTradeGradeLeg[],
  clubId: string
): boolean {
  const given = onwardLegs.filter((onwardLeg) => onwardLeg.sendingClubId === clubId);
  return given.length > 1 && given.some((onwardLeg) => onwardLeg.state === 'excluded');
}

/**
 * Whether the onward trade excludes what an unallocated traded-on pick rests on: through rule v10 any
 * leg its club gave there; under v11 a leg of a bundle it gave, or everything it received there.
 */
function unallocatedGrounds(
  onwardTrade: AflTradeRealizedTradeGrade,
  clubId: string,
  ruleVersion: AflTradeRealizedGradeRuleVersion
): boolean {
  if (PICK_EXCLUSION_ALLOCATION_RULES.has(ruleVersion))
    return onwardTrade.legs.some(
      (onwardLeg) => onwardLeg.sendingClubId === clubId && onwardLeg.state === 'excluded'
    );
  return (
    aflTradeRealizedOnwardBundleExcluded(onwardTrade.legs, clubId) ||
    aflTradeRealizedOnwardReturnExcluded(onwardTrade.legs, clubId)
  );
}

/**
 * Whether a valued traded-on pick reads an onward trade its rule would not value it on: through rule
 * v10 a sole asset whose onward leg is excluded; under v11 a return whose every leg is excluded; under
 * v13 also a bundle with an excluded asset.
 */
function valuedPastExclusionIssue(
  onwardTrade: AflTradeRealizedTradeGrade,
  clubId: string,
  ruleVersion: AflTradeRealizedGradeRuleVersion
): string | null {
  if (PICK_EXCLUSION_ALLOCATION_RULES.has(ruleVersion)) {
    const given = onwardTrade.legs.filter((onwardLeg) => onwardLeg.sendingClubId === clubId);
    return given.length === 1 && given[0]!.state === 'excluded'
      ? 'Only rule v11 and later value a sole asset whose onward leg is excluded.'
      : null;
  }
  if (aflTradeRealizedOnwardReturnExcluded(onwardTrade.legs, clubId))
    return 'A traded-on pick whose club’s every onward return leg is excluded is unallocated.';
  return !EXCLUDED_SIBLING_SHARING_RULES.has(ruleVersion) &&
    aflTradeRealizedOnwardBundleExcluded(onwardTrade.legs, clubId)
    ? 'From rule v13 a bundle with an excluded asset leaves its traded-on shares unallocated.'
    : null;
}

/** An unallocated traded-on pick must name an onward trade that excludes what it rests on. */
function unallocatedIssue(
  leg: Extract<AflTradeRealizedTradeGradeLeg, { basis: 'pick_traded_on_return_unallocated' }>,
  trade: AflTradeRealizedTradeGrade,
  trades: ReadonlyMap<string, AflTradeRealizedTradeGrade>,
  ruleVersion: AflTradeRealizedGradeRuleVersion
): string | null {
  const onwardTrade = trades.get(leg.onwardTransactionId);
  if (
    !onwardTrade ||
    onwardTrade === trade ||
    !unallocatedGrounds(onwardTrade, leg.receivingClubId, ruleVersion)
  )
    return 'An unallocated traded-on pick names the onward trade where it is excluded.';
  if (!UNSCOPED_RULES.has(ruleVersion) && !onwardSideKnown(onwardTrade, leg.receivingClubId))
    return 'An unallocated traded-on pick needs its club’s side of the onward trade.';
  return null;
}

/**
 * Rule v6: whether a traded-on pick's value rests on a projected pick on its club's side of the onward
 * trade: a valued leg the club received, or, for a bundle, a valued leg it gave, that is projected or
 * is itself a return resting on a projection.
 */
export function aflTradeRealizedOnwardSideProjected(
  onwardLegs: readonly AflTradeRealizedTradeGradeLeg[],
  clubId: string
): boolean {
  const bundle = onwardLegs.filter((onwardLeg) => onwardLeg.sendingClubId === clubId).length > 1;
  return onwardLegs.some(
    (onwardLeg) =>
      onwardLeg.state === 'valued' &&
      (onwardLeg.receivingClubId === clubId || (bundle && onwardLeg.sendingClubId === clubId)) &&
      (onwardLeg.basis === 'pick_projected_from_order' ||
        onwardLeg.reasons.includes('traded_on_return_projected'))
  );
}

/**
 * A valued traded-on pick's return, asset count, weights and state must match its onward trade. Under
 * rules v1 and v2 that trade is never blocked; under v3 it may be, if the club's own side is known.
 */
function onwardIssue(
  leg: Extract<AflTradeRealizedTradeGradeLeg, { basis: 'pick_traded_on_return' }>,
  trade: AflTradeRealizedTradeGrade,
  trades: ReadonlyMap<string, AflTradeRealizedTradeGrade>,
  ruleVersion: AflTradeRealizedGradeRuleVersion
): string | null {
  const onwardTrade = trades.get(leg.onward.transactionId);
  if (
    !onwardTrade ||
    (onwardTrade.state === 'blocked' && UNSCOPED_RULES.has(ruleVersion)) ||
    onwardTrade === trade
  )
    return 'A valued traded-on pick names another graded trade in the batch.';
  const onwardClub = onwardTrade.clubs.find((club) => club.clubId === leg.receivingClubId);
  const given = onwardTrade.legs.filter(
    (onwardLeg) => onwardLeg.sendingClubId === leg.receivingClubId
  );
  if (onwardClub?.received !== leg.onward.returnValue)
    return 'A traded-on pick’s return is what its club received in the onward trade.';
  if (leg.onward.givenAssetCount !== given.length)
    return 'The onward asset count is every asset its club gave in that trade.';
  if (leg.onward.allocation === 'relative_value' && leg.onward.weightTotal !== onwardClub.givenUp)
    return 'Relative-value weights total what its club gave up in the onward trade.';
  if (leg.onward.allocation === 'equal_split' && onwardClub.givenUp !== 0)
    return 'An equal split applies only when everything its club gave was worth 0.';
  if (
    (onwardTrade.state === 'provisional') !==
    leg.reasons.includes('traded_on_return_provisional')
  )
    return 'A traded-on pick is provisional exactly when its onward trade is.';
  if ((onwardTrade.state === 'blocked') !== leg.reasons.includes('traded_on_return_partial'))
    return 'A traded-on pick is partial exactly when its onward trade is blocked.';
  if (
    aflTradeRealizedOnwardSideProjected(onwardTrade.legs, leg.receivingClubId) !==
    leg.reasons.includes('traded_on_return_projected')
  )
    return 'A traded-on pick rests on a projection exactly when its club’s onward side does.';
  return valuedPastExclusionIssue(onwardTrade, leg.receivingClubId, ruleVersion);
}

/**
 * Rule v7: a special entitlement leg's successor transfer is the leg its club gave in the onward trade
 * the leg reads.
 */
function specialSuccessorIssue(
  leg: AflTradeRealizedTradeGradeLeg,
  trades: ReadonlyMap<string, AflTradeRealizedTradeGrade>
): string | null {
  if (leg.specialEntitlement === undefined) return null;
  const onwardTransactionId =
    leg.basis === 'pick_traded_on_return'
      ? leg.onward.transactionId
      : leg.basis === 'pick_traded_on_return_unallocated'
        ? leg.onwardTransactionId
        : undefined;
  const successor = onwardTransactionId
    ? trades
        .get(onwardTransactionId)
        ?.legs.find(
          (onwardLeg) => onwardLeg.transferId === leg.specialEntitlement!.successorTransferId
        )
    : undefined;
  if (!successor || successor.sendingClubId !== leg.receivingClubId)
    return 'A special entitlement’s successor is the leg its club gave in the onward trade.';
  return null;
}

function batchIssues(content: BatchContent): Issue[] {
  const issues = batchShapeIssues(content);
  const official = new Map(content.inputs.pavCalculations.map((row) => [row.season, row.official]));
  const trades = new Map(content.trades.map((trade) => [trade.transactionId, trade]));
  for (const trade of content.trades) {
    if (
      JSON.stringify(trade.clubs) !==
      JSON.stringify(expectedAflTradeRealizedTradeGradeClubs(trade.legs, content.ruleVersion))
    )
      issues.push(['trades', 'Club totals must be exactly the legs’ received and given-up sums.']);
    for (const leg of trade.legs) {
      if (
        (leg.atTrade.kind === 'pick_projection' ||
          leg.atTrade.kind === 'pick_projection_eventual_slot') &&
        leg.atTrade.benchmarkId !== content.inputs.pickProjectionBenchmarkId
      )
        issues.push(['trades', 'Every pick projection must cite the batch’s pinned benchmark.']);
      if (
        'projection' in leg &&
        leg.projection.benchmarkId !== content.inputs.pickProjectionBenchmarkId
      )
        issues.push(['trades', 'A projected pick must cite the batch’s pinned benchmark.']);
      for (const message of legSeasonIssues(leg, official, content.ruleVersion))
        issues.push(['trades', message]);
      const linkIssue =
        leg.basis === 'pick_traded_on_return_unallocated'
          ? unallocatedIssue(leg, trade, trades, content.ruleVersion)
          : leg.basis === 'pick_traded_on_return'
            ? onwardIssue(leg, trade, trades, content.ruleVersion)
            : null;
      if (linkIssue) issues.push(['trades', linkIssue]);
      const successorIssue = specialSuccessorIssue(leg, trades);
      if (successorIssue) issues.push(['trades', successorIssue]);
    }
  }
  return issues;
}

const batchContentSchema = batchContentFieldsSchema.superRefine((content, context) => {
  for (const [path, message] of batchIssues(content))
    context.addIssue({ code: 'custom', path: [path], message });
});

export const aflTradeRealizedTradeGradeBatchSchema = z
  .object({
    batchId: aflTradeContentAddressedIdSchema('realized-trade-grade-batch'),
    content: batchContentSchema,
  })
  .strict()
  .superRefine((batch, context) =>
    addAflTradeContentAddressIssue(
      'realized-trade-grade-batch',
      batch.batchId,
      batch.content,
      context,
      ['batchId']
    )
  );

export type AflTradeRealizedTradeGradeBatch = z.infer<typeof aflTradeRealizedTradeGradeBatchSchema>;
export type AflTradeRealizedTradeGradeBatchContent = z.infer<typeof batchContentSchema>;

export function parseAflTradeRealizedTradeGradeBatch(
  value: unknown
): AflTradeRealizedTradeGradeBatch {
  return aflTradeRealizedTradeGradeBatchSchema.parse(value);
}

/** Seals validated batch content under its content address. */
export function createAflTradeRealizedTradeGradeBatch(
  content: AflTradeRealizedTradeGradeBatchContent
): AflTradeRealizedTradeGradeBatch {
  const parsed = batchContentSchema.parse(content);
  return aflTradeRealizedTradeGradeBatchSchema.parse({
    batchId: createAflTradeContentAddress('realized-trade-grade-batch', parsed),
    content: parsed,
  });
}
