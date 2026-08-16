import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const LOCAL_WORKBOOK_PLAYER_IDENTITY_REVIEW_SCHEMA_VERSION =
  'local-workbook-player-identity-review/v1' as const;

const boundedText = z.string().trim().min(1).max(2_000);
const publicId = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

const contentSchema = z
  .object({
    schemaVersion: z.literal(LOCAL_WORKBOOK_PLAYER_IDENTITY_REVIEW_SCHEMA_VERSION),
    workbookSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    tradeId: publicId,
    assetId: publicId,
    sourcePlayerName: boundedText,
    sourceAssetText: boundedText,
    receivingClubName: boundedText,
    canonicalPlayerId: publicId,
    recordedName: boundedText,
    evidenceBundleId: aflTradeContentAddressedIdSchema('private-reviewed-evidence-bundle'),
    reviewerId: publicId,
    rationale: boundedText,
    reviewedAt: z.iso.datetime({ offset: true }),
    authority: z.literal('private_local_workbook_player_identity_review'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
  })
  .strict();

const reviewSchema = z
  .object({
    decisionId: aflTradeContentAddressedIdSchema('local-workbook-player-identity'),
    content: contentSchema,
  })
  .strict()
  .superRefine((review, context) => {
    addAflTradeContentAddressIssue(
      'local-workbook-player-identity',
      review.decisionId,
      review.content,
      context,
      ['decisionId']
    );
  });

export type LocalWorkbookPlayerIdentityReview = z.infer<typeof reviewSchema>;

export function createLocalWorkbookPlayerIdentityReview(
  input: Omit<
    LocalWorkbookPlayerIdentityReview['content'],
    'schemaVersion' | 'authority' | 'publicationEligible' | 'publicationProhibited'
  >
): LocalWorkbookPlayerIdentityReview {
  const content = contentSchema.parse({
    schemaVersion: LOCAL_WORKBOOK_PLAYER_IDENTITY_REVIEW_SCHEMA_VERSION,
    ...input,
    authority: 'private_local_workbook_player_identity_review',
    publicationEligible: false,
    publicationProhibited: true,
  });
  return reviewSchema.parse({
    decisionId: createAflTradeContentAddress('local-workbook-player-identity', content),
    content,
  });
}

export function parseLocalWorkbookPlayerIdentityReview(
  input: unknown
): LocalWorkbookPlayerIdentityReview {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    throw new TypeError('Local workbook player identity review failed exact authentication.');
  }
  return parsed.data;
}
