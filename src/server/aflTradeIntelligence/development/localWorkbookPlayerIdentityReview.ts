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

export interface LocalWorkbookPlayerIdentityReviewPreparation {
  readonly workbookSha256: string;
  readonly valuationScopeKey: string;
  readonly tradeId: string;
  readonly tradeYear: number;
  readonly tradeTitle: string;
  readonly workbookPlayerAssets: readonly Readonly<{
    assetId: string;
    sourcePlayerName: string;
    sourceAssetText: string;
    receivingClubName: string;
  }>[];
  readonly promotedPlayerAssets: readonly Readonly<{
    assetId: string;
    sourceAssetText: string;
    canonicalPlayerId: string | null;
  }>[];
  readonly reviewedProviderIdentities: readonly Readonly<{
    canonicalPlayerId: string;
    recordedName: string;
  }>[];
  readonly evidenceBundleId: string;
  readonly reviewerId: string;
  readonly reviewedAt: string;
}

function normalizedIdentityText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-AU');
}

function recordedNameMatchesWorkbookEvidence(input: {
  recordedName: string;
  workbookName: string;
  tradeTitle: string;
}): boolean {
  const recorded = normalizedIdentityText(input.recordedName);
  const workbook = normalizedIdentityText(input.workbookName);
  if (recorded === workbook) return true;
  if (workbook.includes(' ')) return false;
  return (
    recorded.split(' ').at(-1) === workbook &&
    normalizedIdentityText(input.tradeTitle).includes(recorded)
  );
}

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

export function prepareLocalWorkbookPlayerIdentityReviews(
  input: LocalWorkbookPlayerIdentityReviewPreparation
): readonly LocalWorkbookPlayerIdentityReview[] {
  if (input.valuationScopeKey !== `afl-men:${input.tradeYear}-trades`) {
    throw new TypeError('The requested valuation scope does not match the workbook trade year.');
  }
  const workbookAssets = new Map(
    input.workbookPlayerAssets.map((asset) => [asset.assetId, asset] as const)
  );
  const promotedAssetIds = new Set(input.promotedPlayerAssets.map(({ assetId }) => assetId));
  if (
    workbookAssets.size !== input.workbookPlayerAssets.length ||
    promotedAssetIds.size !== input.promotedPlayerAssets.length ||
    input.workbookPlayerAssets.length !== input.promotedPlayerAssets.length ||
    input.promotedPlayerAssets.some(
      ({ assetId, canonicalPlayerId }) => canonicalPlayerId === null || !workbookAssets.has(assetId)
    ) ||
    input.workbookPlayerAssets.some(({ assetId }) => !promotedAssetIds.has(assetId))
  ) {
    throw new TypeError('Promoted player identity membership is incomplete or ambiguous.');
  }
  return input.promotedPlayerAssets.map((promotedAsset) => {
    const workbookAsset = workbookAssets.get(promotedAsset.assetId)!;
    if (
      normalizedIdentityText(workbookAsset.sourceAssetText) !==
      normalizedIdentityText(promotedAsset.sourceAssetText)
    ) {
      throw new TypeError('Promoted player membership does not match the pinned workbook.');
    }
    const recordedNames = [
      ...new Set(
        input.reviewedProviderIdentities
          .filter(
            ({ canonicalPlayerId, recordedName }) =>
              canonicalPlayerId === promotedAsset.canonicalPlayerId &&
              recordedNameMatchesWorkbookEvidence({
                recordedName,
                workbookName: workbookAsset.sourcePlayerName,
                tradeTitle: input.tradeTitle,
              })
          )
          .map(({ recordedName }) => recordedName)
      ),
    ];
    if (recordedNames.length !== 1) {
      throw new TypeError(
        `Player asset ${promotedAsset.assetId} requires one exact reviewed provider identity.`
      );
    }
    return createLocalWorkbookPlayerIdentityReview({
      workbookSha256: input.workbookSha256,
      tradeId: input.tradeId,
      assetId: promotedAsset.assetId,
      sourcePlayerName: workbookAsset.sourcePlayerName,
      sourceAssetText: workbookAsset.sourceAssetText,
      receivingClubName: workbookAsset.receivingClubName,
      canonicalPlayerId: promotedAsset.canonicalPlayerId!,
      recordedName: recordedNames[0]!,
      evidenceBundleId: input.evidenceBundleId,
      reviewerId: input.reviewerId,
      rationale: `Approved the exact ${recordedNames[0]} identity for this pinned private workbook asset after local identity, match, and factual review.`,
      reviewedAt: input.reviewedAt,
    });
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

export function assertExactLocalWorkbookPlayerIdentityReview(
  retained: unknown,
  expected: LocalWorkbookPlayerIdentityReview
): LocalWorkbookPlayerIdentityReview {
  const parsed = parseLocalWorkbookPlayerIdentityReview(retained);
  if (parsed.decisionId !== expected.decisionId) {
    throw new TypeError('The retained local workbook player identity review conflicts.');
  }
  return parsed;
}
