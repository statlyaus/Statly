import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { hpnDpv3ValueForPick } from '../modeling/hpnPickValueBenchmark';
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
 * Pick outcomes come from one source (Draftguru), so every valued or excluded pick leg carries
 * `single_source_pick_outcome`: only a trade of players alone can be `complete`.
 *
 * Ids, reasons and seasons are ordered by JavaScript code-unit comparison (`<`), not `localeCompare`.
 */
export const AFL_TRADE_REALIZED_TRADE_GRADE_BATCH_SCHEMA_VERSION =
  'afl-trade-realized-trade-grade-batch/v1' as const;
export const AFL_TRADE_REALIZED_TRADE_GRADE_RULE_VERSION =
  'afl-trade-realized-grade-rule/v1' as const;

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
  'single_source_pick_outcome',
  'stint_open',
  'traded_on_return_provisional',
  'traded_on_return_unallocated',
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
      value: valueSchema,
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
    (leg, has) =>
      leg.assetKind === 'pick' && leg.state !== 'blocked' && !has('single_source_pick_outcome'),
    'A pick outcome is single-source, so a valued or excluded pick leg is provisional.',
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
    (leg, has) =>
      !('onward' in leg) && (has('equal_split_tiebreak') || has('traded_on_return_provisional')),
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
 * The club totals a trade's legs determine: each club's received and given-up sums over its valued legs,
 * reduced in leg order, and net = received − givenUp. A blocked trade reports nulls. Producers use this so
 * the same legs always produce byte-identical totals.
 */
export function expectedAflTradeRealizedTradeGradeClubs(
  legs: readonly AflTradeRealizedTradeGradeLeg[]
): AflTradeRealizedTradeGradeClub[] {
  const clubs = [
    ...new Set(legs.flatMap((leg) => [leg.sendingClubId, leg.receivingClubId])),
  ].sort();
  const blocked = legs.some((leg) => leg.state === 'blocked');
  return clubs.map((clubId) => {
    if (blocked) return { clubId, received: null, givenUp: null, net: null };
    let received = 0;
    let givenUp = 0;
    for (const leg of legs) {
      if (leg.state !== 'valued') continue;
      if (leg.receivingClubId === clubId) received += leg.realizedValue;
      if (leg.sendingClubId === clubId) givenUp += leg.realizedValue;
    }
    return { clubId, received, givenUp, net: received - givenUp };
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
    if (
      JSON.stringify(trade.clubs) !==
      JSON.stringify(expectedAflTradeRealizedTradeGradeClubs(trade.legs))
    )
      issue('clubs', 'Club totals must be exactly the legs’ received and given-up sums.');
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
    ruleVersion: z.literal(AFL_TRADE_REALIZED_TRADE_GRADE_RULE_VERSION),
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
    limitation: z.literal(
      'Private local non-production realized trade grade in career_pav; single-source pick outcomes; not public factual, publication, production or activation authority.'
    ),
  })
  .strict();

type BatchContent = z.infer<typeof batchContentFieldsSchema>;
type Issue = readonly [path: string, message: string];

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

/** A leg's PAV seasons must be the batch's pinned calculations, and its reasons must say so. */
function legSeasonIssues(
  leg: AflTradeRealizedTradeGradeLeg,
  official: ReadonlyMap<number, boolean>
): string[] {
  const has = (reason: AflTradeRealizedGradeReason) => leg.reasons.includes(reason);
  if (!('stint' in leg))
    return has('pav_season_not_official') || has('pav_seasons_missing')
      ? ['Only a leg with a stint carries PAV season reasons.']
      : [];
  const issues: string[] = [];
  if (leg.stint.seasonsValued.some((season) => !official.has(season)))
    issues.push('Every valued stint season must have a pinned PAV calculation.');
  if (leg.stint.seasonsMissingPav.some((season) => official.has(season)))
    issues.push('A season with a pinned PAV calculation is not missing.');
  const unofficial = leg.stint.seasonsValued.some((season) => official.get(season) === false);
  if (unofficial !== has('pav_season_not_official'))
    issues.push('A stint valued on an unofficial season, and only that, is stated as a reason.');
  return issues;
}

/** An unallocated traded-on pick must name an onward trade in which its club's leg is excluded. */
function unallocatedIssue(
  leg: Extract<AflTradeRealizedTradeGradeLeg, { basis: 'pick_traded_on_return_unallocated' }>,
  trade: AflTradeRealizedTradeGrade,
  trades: ReadonlyMap<string, AflTradeRealizedTradeGrade>
): string | null {
  const onwardTrade = trades.get(leg.onwardTransactionId);
  const excludedThere = onwardTrade?.legs.some(
    (onwardLeg) => onwardLeg.sendingClubId === leg.receivingClubId && onwardLeg.state === 'excluded'
  );
  return !onwardTrade || onwardTrade === trade || !excludedThere
    ? 'An unallocated traded-on pick names the onward trade where it is excluded.'
    : null;
}

/** A valued traded-on pick's return, asset count, weights and state must match its onward trade. */
function onwardIssue(
  leg: Extract<AflTradeRealizedTradeGradeLeg, { basis: 'pick_traded_on_return' }>,
  trade: AflTradeRealizedTradeGrade,
  trades: ReadonlyMap<string, AflTradeRealizedTradeGrade>
): string | null {
  const onwardTrade = trades.get(leg.onward.transactionId);
  if (!onwardTrade || onwardTrade.state === 'blocked' || onwardTrade === trade)
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
  return null;
}

function batchIssues(content: BatchContent): Issue[] {
  const issues = batchShapeIssues(content);
  const official = new Map(content.inputs.pavCalculations.map((row) => [row.season, row.official]));
  const trades = new Map(content.trades.map((trade) => [trade.transactionId, trade]));
  for (const trade of content.trades) {
    for (const leg of trade.legs) {
      if (
        leg.atTrade.kind === 'pick_projection' &&
        leg.atTrade.benchmarkId !== content.inputs.pickProjectionBenchmarkId
      )
        issues.push(['trades', 'Every pick projection must cite the batch’s pinned benchmark.']);
      for (const message of legSeasonIssues(leg, official)) issues.push(['trades', message]);
      const linkIssue =
        leg.basis === 'pick_traded_on_return_unallocated'
          ? unallocatedIssue(leg, trade, trades)
          : leg.basis === 'pick_traded_on_return'
            ? onwardIssue(leg, trade, trades)
            : null;
      if (linkIssue) issues.push(['trades', linkIssue]);
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
