import { z } from 'zod';

import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  parseAflTradePromotionBackedFactualCandidate,
  type AflTradePromotionBackedFactualCandidate,
} from './promotionBackedFactualReleaseContracts';
import {
  parseAflTradePromotionBackedPublicArchive,
  type AflTradePromotionBackedPublicArchive,
} from './promotionBackedPublicArchiveContracts';

export const AFL_TRADE_PROMOTION_BACKED_FACTUAL_PROJECTION_SCHEMA_VERSION =
  'afl-draft-trade-factual-projection/v3' as const;
export const AFL_TRADE_PROMOTION_BACKED_FACTUAL_PROJECTION_AUTHORITY_BOUNDARY =
  'public_transaction_draft_pick_facts_no_valuation_grade_or_fantasy_ownership' as const;

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));
const publicRecordCountsSchema = z
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

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROMOTION_BACKED_FACTUAL_PROJECTION_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    authorityBoundary: z.literal(AFL_TRADE_PROMOTION_BACKED_FACTUAL_PROJECTION_AUTHORITY_BOUNDARY),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    scopeKey: z.string().trim().min(1).max(1_000),
    competition: z.string().trim().min(1).max(40),
    validFromSeason: z.number().int().min(1897).max(2200),
    validThroughSeason: z.number().int().min(1897).max(2200),
    createdAt: instantSchema,
    effectiveThrough: instantSchema,
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    publicArchiveId: aflTradeContentAddressedIdSchema('public-factual-archive'),
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    sourceMemberSetSha256: aflTradeSha256Schema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
    publicRecordCount: z.number().int().positive().max(1_000_000),
    publicRecordCounts: publicRecordCountsSchema,
    publicRecordSetSha256: aflTradeSha256Schema,
    derivationSha256: aflTradeSha256Schema,
    parityReport: z
      .object({
        artifact: aflTradeArtifactRefSchema,
        status: z.literal('passed'),
        checkCount: z.number().int().positive(),
        failureCount: z.literal(0),
        checkedCanonicalRecordCount: z.number().int().positive(),
        checkedPublicRecordCount: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine((projection, context) => {
    const count = Object.values(projection.publicRecordCounts).reduce(
      (total, value) => total + value,
      0
    );
    if (
      projection.validThroughSeason < projection.validFromSeason ||
      Date.parse(projection.effectiveThrough) > Date.parse(projection.createdAt) ||
      Date.parse(projection.parityReport.artifact.createdAt) > Date.parse(projection.createdAt)
    ) {
      context.addIssue({ code: 'custom', message: 'Public projection chronology is invalid.' });
    }
    if (
      count !== projection.publicRecordCount ||
      projection.parityReport.checkedCanonicalRecordCount !== projection.publicRecordCount ||
      projection.parityReport.checkedPublicRecordCount !== projection.publicRecordCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['publicRecordCounts'],
        message: 'Public record counts must equal the exact sealed projection membership.',
      });
    }
    const expectedDerivation = sha256AflTradeCanonicalJson({
      canonicalMemberSetSha256: projection.canonicalMemberSetSha256,
      corpusId: projection.corpusId,
      factualCandidateId: projection.factualCandidateId,
      publicArchiveId: projection.publicArchiveId,
      publicRecordCount: projection.publicRecordCount,
      publicRecordSetSha256: projection.publicRecordSetSha256,
      releaseId: projection.releaseId,
      sourceMemberSetSha256: projection.sourceMemberSetSha256,
    });
    if (projection.derivationSha256 !== expectedDerivation) {
      context.addIssue({
        code: 'custom',
        path: ['derivationSha256'],
        message: 'Public projection derivation does not bind its exact private and public roots.',
      });
    }
  });

export const aflTradePromotionBackedFactualProjectionSchema = z
  .object({
    projectionId: aflTradeContentAddressedIdSchema('outcome-projection'),
    content: contentSchema,
  })
  .strict()
  .superRefine((projection, context) => {
    addAflTradeContentAddressIssue(
      'outcome-projection',
      projection.projectionId,
      projection.content,
      context,
      ['projectionId']
    );
  });

export type AflTradePromotionBackedFactualProjection = z.infer<
  typeof aflTradePromotionBackedFactualProjectionSchema
>;

export function createAflTradePromotionBackedFactualProjection(input: {
  candidate: AflTradePromotionBackedFactualCandidate;
  archive: AflTradePromotionBackedPublicArchive;
  createdAt: string;
  parityReport: z.input<typeof contentSchema>['parityReport'];
}): AflTradePromotionBackedFactualProjection {
  const candidate = parseAflTradePromotionBackedFactualCandidate(input.candidate);
  const archive = parseAflTradePromotionBackedPublicArchive(input.archive);
  const release = candidate.content.targetReleaseManifest;
  if (
    archive.content.releaseId !== release.releaseId ||
    archive.content.factualCandidateId !== candidate.candidateId ||
    archive.content.corpusId !== candidate.content.corpusId ||
    archive.content.sourceMemberSetSha256 !== candidate.content.sourceMemberSetSha256 ||
    archive.content.canonicalMemberSetSha256 !== candidate.content.canonicalMemberSetSha256 ||
    archive.content.environment !== release.content.environment ||
    archive.content.scopeKey !== release.content.scopeKey ||
    archive.content.competition !== release.content.competition ||
    archive.content.validFromSeason !== release.content.validFromSeason ||
    archive.content.validThroughSeason !== release.content.validThroughSeason ||
    archive.content.effectiveThrough !== release.content.effectiveThrough
  ) {
    throw new TypeError('Public projection archive does not match its exact factual candidate.');
  }
  if (
    Date.parse(archive.content.createdAt) < Date.parse(candidate.content.createdAt) ||
    Date.parse(input.createdAt) < Date.parse(archive.content.createdAt)
  ) {
    throw new TypeError('Public projection cannot predate its finalized factual candidate.');
  }
  const derivationInput = {
    canonicalMemberSetSha256: candidate.content.canonicalMemberSetSha256,
    corpusId: candidate.content.corpusId,
    factualCandidateId: candidate.candidateId,
    publicArchiveId: archive.archiveId,
    publicRecordCount: archive.content.recordCount,
    publicRecordSetSha256: archive.content.recordSetSha256,
    releaseId: release.releaseId,
    sourceMemberSetSha256: candidate.content.sourceMemberSetSha256,
  };
  const content = contentSchema.parse({
    schemaVersion: AFL_TRADE_PROMOTION_BACKED_FACTUAL_PROJECTION_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_PROMOTION_BACKED_FACTUAL_PROJECTION_AUTHORITY_BOUNDARY,
    environment: release.content.environment,
    scopeKey: release.content.scopeKey,
    competition: release.content.competition,
    validFromSeason: release.content.validFromSeason,
    validThroughSeason: release.content.validThroughSeason,
    createdAt: input.createdAt,
    effectiveThrough: release.content.effectiveThrough,
    releaseId: release.releaseId,
    factualCandidateId: candidate.candidateId,
    publicArchiveId: archive.archiveId,
    corpusId: candidate.content.corpusId,
    sourceMemberSetSha256: candidate.content.sourceMemberSetSha256,
    canonicalMemberSetSha256: candidate.content.canonicalMemberSetSha256,
    publicRecordCount: archive.content.recordCount,
    publicRecordCounts: archive.content.recordCounts,
    publicRecordSetSha256: archive.content.recordSetSha256,
    derivationSha256: sha256AflTradeCanonicalJson(derivationInput),
    parityReport: input.parityReport,
  });
  return aflTradePromotionBackedFactualProjectionSchema.parse({
    projectionId: createAflTradeContentAddress('outcome-projection', content),
    content,
  });
}

export function parseAflTradePromotionBackedFactualProjection(
  input: unknown
): AflTradePromotionBackedFactualProjection {
  return aflTradePromotionBackedFactualProjectionSchema.parse(input);
}
