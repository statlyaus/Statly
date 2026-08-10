import { z } from 'zod';

import {
  createAflTradePromotionBackedCorpus,
  type AflTradePromotionBackedCorpus,
} from './promotionBackedCorpusContracts';

const instantSchema = z.iso.datetime({ offset: true });
const snapshotSchema = z
  .object({
    promotionId: z.string().regex(/^external-canonical-promotion:[a-f0-9]{64}$/),
    receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.string().trim().min(1).max(40),
    anchorSeasonYear: z.number().int().min(1897).max(2200),
    status: z.literal('finalized'),
    finalizedAt: instantSchema,
    promotionRecordCount: z.number().int().positive().max(1_000_000),
    records: z
      .array(
        z
          .object({
            recordKind: z.enum([
              'transaction',
              'transfer',
              'draft_event',
              'draft_selection',
              'draft_player_asset',
              'pick_custody',
              'pick_realization',
            ]),
            sourceRecordId: z.string().trim().min(1).max(1_000),
            canonicalRecordId: z.string().trim().min(1).max(1_000),
            recordSha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
      )
      .min(1)
      .max(1_000_000),
  })
  .strict()
  .superRefine((promotion, context) => {
    if (promotion.promotionId !== `external-canonical-promotion:${promotion.receiptSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['promotionId'],
        message: 'Promotion snapshot must preserve the exact receipt content address.',
      });
    }
    if (promotion.promotionRecordCount !== promotion.records.length) {
      context.addIssue({
        code: 'custom',
        path: ['promotionRecordCount'],
        message: 'Promotion record count must equal every loaded promotion record.',
      });
    }
  });

export type AflTradeCanonicalPromotionSnapshot = z.infer<typeof snapshotSchema>;

export function buildAflTradePromotionBackedCorpus(input: {
  environment: 'test_fixture' | 'non_production' | 'production';
  competition: string;
  createdAt: string;
  knowledgeCutoffAt: string;
  promotions: readonly unknown[];
}): AflTradePromotionBackedCorpus {
  const promotions = z.array(snapshotSchema).min(1).max(100_000).parse(input.promotions);
  promotions.forEach((promotion) => {
    if (
      promotion.environment !== input.environment ||
      promotion.competition !== input.competition
    ) {
      throw new TypeError('Every canonical promotion must match the requested corpus scope.');
    }
  });
  return createAflTradePromotionBackedCorpus({
    environment: input.environment,
    competition: input.competition,
    createdAt: input.createdAt,
    knowledgeCutoffAt: input.knowledgeCutoffAt,
    promotions: promotions.map((promotion) => ({
      promotionId: promotion.promotionId,
      promotionSha256: promotion.receiptSha256,
      anchorSeasonYear: promotion.anchorSeasonYear,
      finalizedAt: promotion.finalizedAt,
      promotionRecordCount: promotion.promotionRecordCount,
    })),
    members: promotions.flatMap((promotion) =>
      promotion.records.map((record) => ({ promotionId: promotion.promotionId, ...record }))
    ),
  });
}
