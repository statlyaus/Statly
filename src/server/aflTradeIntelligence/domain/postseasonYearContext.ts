import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

const publicId = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const instant = z.iso.datetime({ offset: true });

/** Structural evidence binding only. Current promotion/review authority must be resolved at admission. */
export const aflTradePostseasonYearContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-postseason-year-context/v1'),
    environment: z.enum(['test_fixture', 'non_production']),
    competition: z.literal('AFLM'),
    tradeId: publicId,
    promotionId: aflTradeContentAddressedIdSchema('external-canonical-promotion'),
    eventVersionId: publicId,
    tradeYear: z.number().int().min(1988).max(2197),
    tradeDate: z.iso.date().nullable(),
    period: z.literal('established_postseason'),
    reviewDecisionId: publicId,
    reviewEvidence: aflTradeArtifactRefSchema,
    recordedAt: instant,
    knowledgeCutoffAt: instant,
    knowledgePolicy: z.literal('retrospective_as_recorded_by_dataset_creation'),
  })
  .strict()
  .superRefine((content, ctx) => {
    if (content.tradeDate !== null && Number(content.tradeDate.slice(0, 4)) !== content.tradeYear) {
      ctx.addIssue({
        code: 'custom',
        path: ['tradeDate'],
        message: 'Known trade date must agree with the reviewed trade year.',
      });
    }
    if (Date.parse(content.reviewEvidence.createdAt) > Date.parse(content.recordedAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['recordedAt'],
        message: 'Recording cannot predate its review evidence.',
      });
    }
    if (Date.parse(content.recordedAt) > Date.parse(content.knowledgeCutoffAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['knowledgeCutoffAt'],
        message: 'Review must be recorded by the reconstruction knowledge cutoff.',
      });
    }
    if (new Date(content.recordedAt).getUTCFullYear() < content.tradeYear) {
      ctx.addIssue({
        code: 'custom',
        path: ['recordedAt'],
        message: 'Retrospective context cannot predate the trade year.',
      });
    }
    if (
      content.tradeDate !== null &&
      Date.parse(content.recordedAt) < Date.parse(content.tradeDate + 'T00:00:00.000Z')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['recordedAt'],
        message: 'Retrospective recording cannot precede a known trade date.',
      });
    }
  });

export const aflTradePostseasonYearContextSchema = z
  .object({
    contextId: aflTradeContentAddressedIdSchema('postseason-year-context'),
    content: aflTradePostseasonYearContentSchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    addAflTradeContentAddressIssue(
      'postseason-year-context',
      record.contextId,
      record.content,
      ctx,
      ['contextId']
    );
  });

export type AflTradePostseasonYearContext = z.infer<typeof aflTradePostseasonYearContextSchema>;

export function createAflTradePostseasonYearContext(
  input: z.input<typeof aflTradePostseasonYearContentSchema>
): AflTradePostseasonYearContext {
  const content = aflTradePostseasonYearContentSchema.parse(input);
  return aflTradePostseasonYearContextSchema.parse({
    contextId: createAflTradeContentAddress('postseason-year-context', content),
    content,
  });
}

/** Season eligibility is independent of when historical source evidence was collected. */
export function aflTradePostseasonSeasonWindow(
  input: AflTradePostseasonYearContext,
  historySeasons: 1 | 2 | 3
) {
  const context = aflTradePostseasonYearContextSchema.parse(input);
  z.union([z.literal(1), z.literal(2), z.literal(3)]).parse(historySeasons);
  const year = context.content.tradeYear;
  return {
    contextId: context.contextId,
    featureSeasons: Array.from(
      { length: historySeasons },
      (_, index) => year - historySeasons + index + 1
    ),
    outcomeSeasons: [year + 1, year + 2, year + 3],
  };
}
