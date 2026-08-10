import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from './contentAddress';

export const AFL_TRADE_PROMOTION_BACKED_CORPUS_SCHEMA_VERSION =
  'afl-trade-canonical-corpus/v3' as const;

const instantSchema = z.iso.datetime({ offset: true });
const environmentSchema = z.enum(['test_fixture', 'non_production', 'production']);
const recordKindSchema = z.enum([
  'transaction',
  'transfer',
  'draft_event',
  'draft_selection',
  'draft_player_asset',
  'pick_custody',
  'pick_realization',
]);
const promotionIdSchema = aflTradeContentAddressedIdSchema('external-canonical-promotion');
const boundedIdSchema = z.string().trim().min(1).max(1_000);

const promotionSchema = z
  .object({
    promotionId: promotionIdSchema,
    promotionSha256: aflTradeSha256Schema,
    anchorSeasonYear: z.number().int().min(1897).max(2200),
    finalizedAt: instantSchema,
    promotionRecordCount: z.number().int().positive().max(1_000_000),
  })
  .strict()
  .superRefine((promotion, context) => {
    if (promotion.promotionId !== `external-canonical-promotion:${promotion.promotionSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['promotionId'],
        message: 'Promotion ID must equal its exact content address.',
      });
    }
  });

const memberInputSchema = z
  .object({
    promotionId: promotionIdSchema,
    recordKind: recordKindSchema,
    sourceRecordId: boundedIdSchema,
    canonicalRecordId: boundedIdSchema,
    recordSha256: aflTradeSha256Schema,
  })
  .strict();

const memberSchema = memberInputSchema.extend({ ordinal: z.number().int().positive() }).strict();

type MemberInput = z.infer<typeof memberInputSchema>;
type Member = z.infer<typeof memberSchema>;
type RecordKind = z.infer<typeof recordKindSchema>;

const recordCountsSchema = z
  .object({
    transaction: z.number().int().nonnegative(),
    transfer: z.number().int().nonnegative(),
    draft_event: z.number().int().nonnegative(),
    draft_selection: z.number().int().nonnegative(),
    draft_player_asset: z.number().int().nonnegative(),
    pick_custody: z.number().int().nonnegative(),
    pick_realization: z.number().int().nonnegative(),
  })
  .strict();

function memberKey(member: MemberInput): string {
  return [
    member.promotionId,
    member.recordKind,
    member.sourceRecordId,
    member.canonicalRecordId,
  ].join('\0');
}

function membershipPayload(member: MemberInput) {
  return {
    promotionId: member.promotionId,
    recordKind: member.recordKind,
    sourceRecordId: member.sourceRecordId,
    canonicalRecordId: member.canonicalRecordId,
    recordSha256: member.recordSha256,
  };
}

function emptyCounts(): Record<RecordKind, number> {
  return {
    transaction: 0,
    transfer: 0,
    draft_event: 0,
    draft_selection: 0,
    draft_player_asset: 0,
    pick_custody: 0,
    pick_realization: 0,
  };
}

const corpusContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROMOTION_BACKED_CORPUS_SCHEMA_VERSION),
    environment: environmentSchema,
    competition: z.string().trim().min(1).max(40),
    anchorSeasonRange: z
      .object({
        from: z.number().int().min(1897).max(2200),
        through: z.number().int().min(1897).max(2200),
      })
      .strict(),
    createdAt: instantSchema,
    knowledgeCutoffAt: instantSchema,
    promotions: z.array(promotionSchema).min(1).max(100_000),
    promotionCount: z.number().int().positive(),
    members: z.array(memberSchema).min(1).max(1_000_000),
    memberCount: z.number().int().positive(),
    memberSetSha256: aflTradeSha256Schema,
    recordCounts: recordCountsSchema,
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((content, context) => {
    const promotionIds = content.promotions.map(({ promotionId }) => promotionId);
    if (
      new Set(promotionIds).size !== promotionIds.length ||
      promotionIds.some((value, index) => index > 0 && promotionIds[index - 1]! > value)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['promotions'],
        message: 'Corpus promotions must be unique and canonically ordered.',
      });
    }
    if (content.promotionCount !== content.promotions.length) {
      context.addIssue({
        code: 'custom',
        path: ['promotionCount'],
        message: 'Promotion count mismatch.',
      });
    }
    const years = content.promotions.map(({ anchorSeasonYear }) => anchorSeasonYear);
    if (
      content.anchorSeasonRange.from !== Math.min(...years) ||
      content.anchorSeasonRange.through !== Math.max(...years)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['anchorSeasonRange'],
        message: 'Corpus season range must equal its exact promotion bounds.',
      });
    }
    if (
      content.promotions.some(
        ({ finalizedAt }) => Date.parse(finalizedAt) > Date.parse(content.knowledgeCutoffAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['knowledgeCutoffAt'],
        message: 'Every promotion finalization must be known by the corpus cutoff.',
      });
    }
    if (Date.parse(content.knowledgeCutoffAt) > Date.parse(content.createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Corpus creation cannot predate its knowledge cutoff.',
      });
    }

    const knownPromotionIds = new Set(promotionIds);
    const keys = content.members.map(memberKey);
    content.members.forEach((member, index) => {
      if (member.ordinal !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['members', index, 'ordinal'],
          message: 'Member ordinal mismatch.',
        });
      }
      if (!knownPromotionIds.has(member.promotionId)) {
        context.addIssue({
          code: 'custom',
          path: ['members', index, 'promotionId'],
          message: 'Every corpus member must belong to a listed promotion.',
        });
      }
    });
    if (
      new Set(keys).size !== keys.length ||
      keys.some((value, index) => index > 0 && keys[index - 1]! > value)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['members'],
        message: 'Corpus members must be unique and canonically ordered.',
      });
    }
    if (content.memberCount !== content.members.length) {
      context.addIssue({
        code: 'custom',
        path: ['memberCount'],
        message: 'Member count mismatch.',
      });
    }
    if (
      content.memberSetSha256 !==
      sha256AflTradeCanonicalJson(content.members.map(membershipPayload))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['memberSetSha256'],
        message: 'Member-set digest must commit the exact canonical membership.',
      });
    }
    const actualCounts = emptyCounts();
    content.members.forEach(({ recordKind }) => actualCounts[recordKind]++);
    if (
      sha256AflTradeCanonicalJson(actualCounts) !==
      sha256AflTradeCanonicalJson(content.recordCounts)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recordCounts'],
        message: 'Record counts mismatch.',
      });
    }
    content.promotions.forEach((promotion, index) => {
      const actual = content.members.filter(
        ({ promotionId }) => promotionId === promotion.promotionId
      ).length;
      if (actual !== promotion.promotionRecordCount) {
        context.addIssue({
          code: 'custom',
          path: ['promotions', index, 'promotionRecordCount'],
          message: 'Promotion record count must equal its exact corpus membership.',
        });
      }
    });
  });

export const aflTradePromotionBackedCorpusSchema = z
  .object({
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    content: corpusContentSchema,
  })
  .strict()
  .superRefine((corpus, context) => {
    addAflTradeContentAddressIssue('corpus', corpus.corpusId, corpus.content, context, [
      'corpusId',
    ]);
  });

export type AflTradePromotionBackedCorpus = z.infer<typeof aflTradePromotionBackedCorpusSchema>;

export function createAflTradePromotionBackedCorpus(input: {
  environment: z.input<typeof environmentSchema>;
  competition: string;
  createdAt: string;
  knowledgeCutoffAt: string;
  promotions: readonly z.input<typeof promotionSchema>[];
  members: readonly z.input<typeof memberInputSchema>[];
}): AflTradePromotionBackedCorpus {
  const promotions = z
    .array(promotionSchema)
    .parse(input.promotions)
    .sort((left, right) => left.promotionId.localeCompare(right.promotionId));
  const memberInputs = z
    .array(memberInputSchema)
    .parse(input.members)
    .sort((left, right) => memberKey(left).localeCompare(memberKey(right)));
  const members: Member[] = memberInputs.map((member, index) => ({
    ordinal: index + 1,
    ...member,
  }));
  const recordCounts = emptyCounts();
  members.forEach(({ recordKind }) => recordCounts[recordKind]++);
  const years = promotions.map(({ anchorSeasonYear }) => anchorSeasonYear);
  const content = corpusContentSchema.parse({
    schemaVersion: AFL_TRADE_PROMOTION_BACKED_CORPUS_SCHEMA_VERSION,
    environment: input.environment,
    competition: input.competition,
    anchorSeasonRange: { from: Math.min(...years), through: Math.max(...years) },
    createdAt: input.createdAt,
    knowledgeCutoffAt: input.knowledgeCutoffAt,
    promotions,
    promotionCount: promotions.length,
    members,
    memberCount: members.length,
    memberSetSha256: sha256AflTradeCanonicalJson(memberInputs.map(membershipPayload)),
    recordCounts,
    publicationEligible: false,
  });
  return aflTradePromotionBackedCorpusSchema.parse({
    corpusId: createAflTradeContentAddress('corpus', content),
    content,
  });
}

export function parseAflTradePromotionBackedCorpus(input: unknown): AflTradePromotionBackedCorpus {
  return aflTradePromotionBackedCorpusSchema.parse(input);
}
