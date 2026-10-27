import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradePublicIdSchema } from '@/types/aflTradeIntelligence/shared';

/**
 * The trade structure (value-line method step 5, statlyaus/Statly#789; "Trade structure" in
 * docs/architecture/afl-trade-intelligence.md): the graded trades of one reconciliation candidate,
 * their legs and each leg's onward link, with no valuation. A leg's onward link is the transfer its
 * receiving club passed the asset on as: a pick's unique trail, a special entitlement's reviewed
 * custody successor, or (rule R1, statlyaus/Statly#1050) the new pick id a stated not-used pick's
 * holder traded the same number on as. It is emitted whatever became of the onward trade; only a link
 * whose onward trade leads back to its own trade (the leadsTo cycle guard) is dropped.
 */

export const AFL_TRADE_STRUCTURE_SCHEMA_VERSION = 'afl-trade-structure/v1' as const;
export const AFL_TRADE_STRUCTURE_ID_PREFIX = 'afl-trade-structure';
export const AFL_TRADE_STRUCTURE_LIMITATION =
  'Private local non-production trade structure: trades, legs and onward links only, with no value; not public factual, publication, production or activation authority.' as const;

const idSchema = aflTradePublicIdSchema;

const onwardSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('pick_trail'),
      transactionId: idSchema,
      transferId: idSchema,
      /** Exactly one Footyinfo board pick routes sender → receiver → onward receiver. */
      corroboratedBy: z.literal('footyinfo').optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('special_entitlement_successor'),
      transactionId: idSchema,
      transferId: idSchema,
      entitlementId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('pick_relay'),
      transactionId: idSchema,
      transferId: idSchema,
      /** The number this leg's trade and the onward trade both state for the pick. */
      selectionNumber: z.number().int().positive(),
    })
    .strict(),
  /** An owner-reviewed relay (`assetLedgerReviewedPickLinks.ts`): no number joins it, the review does. */
  z
    .object({
      kind: z.literal('pick_relay_reviewed'),
      transactionId: idSchema,
      transferId: idSchema,
    })
    .strict(),
]);

const legSchema = z
  .object({
    transferId: idSchema,
    assetKind: z.enum(['player', 'pick']),
    sendingClubId: idSchema,
    receivingClubId: idSchema,
    onward: onwardSchema.optional(),
  })
  .strict()
  .refine((leg) => leg.sendingClubId !== leg.receivingClubId, {
    message: 'A leg must move between distinct clubs.',
  });

const tradeSchema = z
  .object({
    transactionId: idSchema,
    tradeYear: z.number().int().min(1897).max(2200),
    clubs: z.array(z.object({ clubId: idSchema }).strict()).min(2),
    legs: z.array(legSchema).min(1),
  })
  .strict();

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_STRUCTURE_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    inputs: z
      .object({ candidateId: aflTradeContentAddressedIdSchema('external-reconciliation') })
      .strict(),
    trades: z.array(tradeSchema),
    ungraded: z.array(
      z
        .object({
          transactionId: idSchema,
          reason: z.enum(['club_unresolved', 'no_transfers']),
        })
        .strict()
    ),
    summary: z
      .object({
        trades: z.number().int().min(0),
        legs: z.number().int().min(0),
        onwardLinks: z.number().int().min(0),
        ungraded: z.number().int().min(0),
      })
      .strict(),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(AFL_TRADE_STRUCTURE_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    const legs = content.trades.flatMap((trade) => trade.legs);
    const expected = {
      trades: content.trades.length,
      legs: legs.length,
      onwardLinks: legs.filter((leg) => leg.onward).length,
      ungraded: content.ungraded.length,
    };
    if (JSON.stringify(expected) !== JSON.stringify(content.summary))
      context.addIssue({ code: 'custom', path: ['summary'], message: 'The summary must count.' });
    const ids = content.trades.map((trade) => trade.transactionId);
    if (ids.some((id, at) => at > 0 && ids[at - 1]! >= id))
      context.addIssue({ code: 'custom', path: ['trades'], message: 'Trades sort by id, once.' });
    const traded = new Map(content.trades.map((trade) => [trade.transactionId, trade]));
    for (const leg of legs) {
      const onward = leg.onward && traded.get(leg.onward.transactionId);
      if (
        leg.onward &&
        !onward?.legs.some(({ transferId }) => transferId === leg.onward!.transferId)
      )
        context.addIssue({
          code: 'custom',
          path: ['trades'],
          message: `Leg ${leg.transferId} links to a transfer outside the structure.`,
        });
    }
  });

export const aflTradeStructureSchema = z
  .object({
    structureId: aflTradeContentAddressedIdSchema(AFL_TRADE_STRUCTURE_ID_PREFIX),
    content: contentSchema,
  })
  .strict()
  .superRefine((structure, context) =>
    addAflTradeContentAddressIssue(
      AFL_TRADE_STRUCTURE_ID_PREFIX,
      structure.structureId,
      structure.content,
      context,
      ['structureId']
    )
  );

export type AflTradeStructure = z.infer<typeof aflTradeStructureSchema>;
export type AflTradeStructureContent = z.infer<typeof contentSchema>;
export type AflTradeStructureTrade = AflTradeStructureContent['trades'][number];
export type AflTradeStructureLeg = AflTradeStructureTrade['legs'][number];
export type AflTradeStructureOnwardLink = NonNullable<AflTradeStructureLeg['onward']>;

export function parseAflTradeStructure(value: unknown): AflTradeStructure {
  return aflTradeStructureSchema.parse(value);
}

/** Seals validated structure content under its content address. */
export function createAflTradeStructure(content: AflTradeStructureContent): AflTradeStructure {
  const parsed = contentSchema.parse(content);
  return aflTradeStructureSchema.parse({
    structureId: createAflTradeContentAddress(AFL_TRADE_STRUCTURE_ID_PREFIX, parsed),
    content: parsed,
  });
}
