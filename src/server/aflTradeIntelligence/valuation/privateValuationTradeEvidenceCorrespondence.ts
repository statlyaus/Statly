import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_TRADE_PRIVATE_VALUATION_TRADE_EVIDENCE_CORRESPONDENCE_SCHEMA_VERSION =
  'afl-trade-private-valuation-trade-evidence-correspondence/v1' as const;
export const AFL_TRADE_PRIVATE_VALUATION_TRADE_EVIDENCE_CORRESPONDENCE_BOUNDARY =
  'private_non_production_exact_trade_and_asset_correspondence_no_score_grade_model_or_publication_authority' as const;

const publicIdSchema = z.string().trim().min(1).max(500);
const instantSchema = z.iso.datetime({ offset: true });

const evaluatedTradeSchema = z
  .object({
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    transactionEventVersionId: publicIdSchema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
    assetVersionIds: z.array(publicIdSchema).min(1).max(10_000),
  })
  .strict();

const evaluationEvidenceSchema = z
  .object({
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    corpusToCandidateLineageId: aflTradeContentAddressedIdSchema(
      'corpus-factual-lineage'
    ),
    transactionEventVersionId: publicIdSchema,
    memberSetSha256: aflTradeSha256Schema,
    assetVersionIds: z.array(publicIdSchema).min(1).max(10_000),
  })
  .strict();

const assetMappingSchema = z
  .object({
    assetId: publicIdSchema,
    evaluatedAssetVersionId: publicIdSchema,
    evaluationEvidenceAssetVersionId: publicIdSchema,
    correspondence: z.literal('exact_stable_domain_identity'),
  })
  .strict();

function isUniqueSorted(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every((value, index) => index === 0 || values[index - 1]! < value)
  );
}

const contentSchema = z
  .object({
    schemaVersion: z.literal(
      AFL_TRADE_PRIVATE_VALUATION_TRADE_EVIDENCE_CORRESPONDENCE_SCHEMA_VERSION
    ),
    authorityBoundary: z.literal(
      AFL_TRADE_PRIVATE_VALUATION_TRADE_EVIDENCE_CORRESPONDENCE_BOUNDARY
    ),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    valuationScopeKey: publicIdSchema,
    tradeId: publicIdSchema,
    createdAt: instantSchema,
    evaluatedTrade: evaluatedTradeSchema,
    evaluationEvidence: evaluationEvidenceSchema,
    assetMappings: z.array(assetMappingSchema).min(1).max(10_000),
    completeness: z.literal('every_trade_asset_mapped_exactly_once_in_both_roots'),
    limitation: z.literal(
      'This artifact proves factual trade and asset correspondence only. It contains no score, grade, model authority, publication authority, or fantasy ownership state.'
    ),
  })
  .strict()
  .superRefine((document, context) => {
    const evaluated = document.evaluatedTrade.assetVersionIds;
    const evidence = document.evaluationEvidence.assetVersionIds;
    const mappedEvaluated = document.assetMappings.map(
      ({ evaluatedAssetVersionId }) => evaluatedAssetVersionId
    );
    const mappedEvidence = document.assetMappings.map(
      ({ evaluationEvidenceAssetVersionId }) => evaluationEvidenceAssetVersionId
    );
    const mappedAssets = document.assetMappings.map(({ assetId }) => assetId);
    if (
      !isUniqueSorted(evaluated) ||
      !isUniqueSorted(evidence) ||
      !isUniqueSorted(mappedEvaluated) ||
      !isUniqueSorted(mappedEvidence) ||
      new Set(mappedAssets).size !== mappedAssets.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assetMappings'],
        message: 'Trade correspondence assets must be unique and canonically ordered.',
      });
    }
    if (
      evaluated.length !== mappedEvaluated.length ||
      evidence.length !== mappedEvidence.length ||
      evaluated.some((assetVersionId, index) => mappedEvaluated[index] !== assetVersionId) ||
      evidence.some((assetVersionId, index) => mappedEvidence[index] !== assetVersionId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assetMappings'],
        message: 'Trade correspondence must exactly cover every asset in both factual roots.',
      });
    }
    if (
      document.evaluatedTrade.transactionEventVersionId !==
      document.evaluationEvidence.transactionEventVersionId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evaluationEvidence', 'transactionEventVersionId'],
        message: 'Separated factual roots must resolve the same stable transaction version.',
      });
    }
  });

export const aflTradePrivateValuationTradeEvidenceCorrespondenceSchema = z
  .object({
    correspondenceId: aflTradeContentAddressedIdSchema(
      'valuation-trade-evidence-correspondence'
    ),
    content: contentSchema,
  })
  .strict()
  .superRefine((document, context) => {
    addAflTradeContentAddressIssue(
      'valuation-trade-evidence-correspondence',
      document.correspondenceId,
      document.content,
      context,
      ['correspondenceId']
    );
  });

export type AflTradePrivateValuationTradeEvidenceCorrespondence = z.infer<
  typeof aflTradePrivateValuationTradeEvidenceCorrespondenceSchema
>;

export function createAflTradePrivateValuationTradeEvidenceCorrespondence(input: {
  valuationScopeKey: string;
  tradeId: string;
  createdAt: string;
  evaluatedTrade: z.input<typeof evaluatedTradeSchema>;
  evaluationEvidence: z.input<typeof evaluationEvidenceSchema>;
  assetMappings: readonly Omit<z.input<typeof assetMappingSchema>, 'correspondence'>[];
}): AflTradePrivateValuationTradeEvidenceCorrespondence {
  const content = contentSchema.parse({
    schemaVersion:
      AFL_TRADE_PRIVATE_VALUATION_TRADE_EVIDENCE_CORRESPONDENCE_SCHEMA_VERSION,
    authorityBoundary:
      AFL_TRADE_PRIVATE_VALUATION_TRADE_EVIDENCE_CORRESPONDENCE_BOUNDARY,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    valuationScopeKey: input.valuationScopeKey,
    tradeId: input.tradeId,
    createdAt: input.createdAt,
    evaluatedTrade: input.evaluatedTrade,
    evaluationEvidence: input.evaluationEvidence,
    assetMappings: input.assetMappings.map((mapping) => ({
      ...mapping,
      correspondence: 'exact_stable_domain_identity' as const,
    })),
    completeness: 'every_trade_asset_mapped_exactly_once_in_both_roots',
    limitation:
      'This artifact proves factual trade and asset correspondence only. It contains no score, grade, model authority, publication authority, or fantasy ownership state.',
  });
  return aflTradePrivateValuationTradeEvidenceCorrespondenceSchema.parse({
    correspondenceId: createAflTradeContentAddress(
      'valuation-trade-evidence-correspondence',
      content
    ),
    content,
  });
}
