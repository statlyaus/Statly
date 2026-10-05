import { z } from 'zod';

import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_TRADE_PRIVATE_VALUATION_EVIDENCE_BUNDLE_SCHEMA_VERSION =
  'afl-trade-private-valuation-evidence-bundle/v1' as const;
export const AFL_TRADE_PRIVATE_VALUATION_EVIDENCE_BUNDLE_BOUNDARY =
  'private_non_production_complete_factual_asset_evidence_no_score_grade_model_authority_or_publication' as const;

const publicIdSchema = z.string().trim().min(1).max(500);
const instantSchema = z.iso.datetime({ offset: true });

const factualRootSchema = z
  .object({
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    candidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    corpusToCandidateLineageId: aflTradeContentAddressedIdSchema(
      'corpus-factual-lineage'
    ),
    sourceQualificationReportId: aflTradeContentAddressedIdSchema(
      'valuation-source-qualification'
    ),
    privateEvaluationDecisionId: aflTradeContentAddressedIdSchema(
      'private-valuation-evaluation-decision'
    ),
    memberSetSha256: aflTradeSha256Schema,
  })
  .strict();

const assetBase = {
  assetId: publicIdSchema,
  assetVersionId: publicIdSchema,
  receivingClubId: publicIdSchema,
  evidenceArtifact: aflTradeArtifactRefSchema,
  dependencyArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(100_000),
};

const assetEvidenceSchema = z
  .discriminatedUnion('evidenceKind', [
    z
      .object({
        ...assetBase,
        assetKind: z.literal('player'),
        evidenceKind: z.literal('exhaustive_acquisition_spell_horizons'),
      })
      .strict(),
    z
      .object({
        ...assetBase,
        assetKind: z.enum(['pick', 'future_pick']),
        evidenceKind: z.literal('custody_aware_conserved_frontier'),
      })
      .strict(),
  ])
  .superRefine((asset, context) => {
    const ids = asset.dependencyArtifacts.map(({ artifactId }) => artifactId);
    if (
      new Set(ids).size !== ids.length ||
      ids.some((artifactId, index) => index > 0 && ids[index - 1]! > artifactId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dependencyArtifacts'],
        message: 'Evidence dependencies must be unique and canonically ordered.',
      });
    }
  });

const contentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_VALUATION_EVIDENCE_BUNDLE_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PRIVATE_VALUATION_EVIDENCE_BUNDLE_BOUNDARY),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    valuationScopeKey: publicIdSchema,
    tradeId: publicIdSchema,
    createdAt: instantSchema,
    knowledgeCutoffAt: instantSchema,
    factualRoot: factualRootSchema,
    evaluatedTradeCorrespondenceArtifact: aflTradeArtifactRefSchema,
    expectedAssetVersionIds: z.array(publicIdSchema).min(1).max(10_000),
    assets: z.array(assetEvidenceSchema).min(1).max(10_000),
    completeness: z.literal('every_expected_asset_has_exact_factual_evidence'),
    missingValuePolicy: z.literal('unavailable_never_zero_and_no_incomplete_bundle'),
    limitation: z.literal(
      'This bundle retains complete factual evidence for private local evaluation only. It contains no score, grade, model authority, publication authority, or fantasy ownership state.'
    ),
  })
  .strict()
  .superRefine((bundle, context) => {
    if (Date.parse(bundle.knowledgeCutoffAt) > Date.parse(bundle.createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['knowledgeCutoffAt'],
        message: 'The factual knowledge cutoff cannot follow bundle creation.',
      });
    }
    const expected = bundle.expectedAssetVersionIds;
    const actual = bundle.assets.map(({ assetVersionId }) => assetVersionId);
    const assetIds = bundle.assets.map(({ assetId }) => assetId);
    if (
      new Set(expected).size !== expected.length ||
      expected.some((assetVersionId, index) => index > 0 && expected[index - 1]! > assetVersionId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expectedAssetVersionIds'],
        message: 'Expected asset versions must be unique and canonically ordered.',
      });
    }
    if (
      new Set(actual).size !== actual.length ||
      new Set(assetIds).size !== assetIds.length ||
      actual.some((assetVersionId, index) => index > 0 && actual[index - 1]! > assetVersionId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Factual asset evidence must be unique and canonically ordered.',
      });
    }
    if (
      expected.length !== actual.length ||
      expected.some((assetVersionId, index) => actual[index] !== assetVersionId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'The factual asset universe must exactly cover every expected trade asset.',
      });
    }
    const artifacts = [
      bundle.evaluatedTradeCorrespondenceArtifact,
      ...bundle.assets.flatMap((asset) => [
        asset.evidenceArtifact,
        ...asset.dependencyArtifacts,
      ]),
    ];
    if (artifacts.some(({ createdAt }) => Date.parse(createdAt) > Date.parse(bundle.createdAt))) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Every retained factual artifact must predate bundle creation.',
      });
    }
  });

export const aflTradePrivateValuationEvidenceBundleSchema = z
  .object({
    evidenceBundleId: aflTradeContentAddressedIdSchema('valuation-evidence-bundle'),
    content: contentSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    addAflTradeContentAddressIssue(
      'valuation-evidence-bundle',
      bundle.evidenceBundleId,
      bundle.content,
      context,
      ['evidenceBundleId']
    );
  });

export type AflTradePrivateValuationEvidenceBundle = z.infer<
  typeof aflTradePrivateValuationEvidenceBundleSchema
>;

export function createAflTradePrivateValuationEvidenceBundle(input: {
  valuationScopeKey: string;
  tradeId: string;
  createdAt: string;
  knowledgeCutoffAt: string;
  factualRoot: z.input<typeof factualRootSchema>;
  evaluatedTradeCorrespondenceArtifact: z.input<typeof aflTradeArtifactRefSchema>;
  expectedAssetVersionIds: readonly string[];
  assets: readonly z.input<typeof assetEvidenceSchema>[];
}): AflTradePrivateValuationEvidenceBundle {
  const content = contentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_VALUATION_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PRIVATE_VALUATION_EVIDENCE_BUNDLE_BOUNDARY,
    environment: 'non_production',
    publicationEligible: false,
    publicationProhibited: true,
    valuationScopeKey: input.valuationScopeKey,
    tradeId: input.tradeId,
    createdAt: input.createdAt,
    knowledgeCutoffAt: input.knowledgeCutoffAt,
    factualRoot: input.factualRoot,
    evaluatedTradeCorrespondenceArtifact: input.evaluatedTradeCorrespondenceArtifact,
    expectedAssetVersionIds: input.expectedAssetVersionIds,
    assets: input.assets,
    completeness: 'every_expected_asset_has_exact_factual_evidence',
    missingValuePolicy: 'unavailable_never_zero_and_no_incomplete_bundle',
    limitation:
      'This bundle retains complete factual evidence for private local evaluation only. It contains no score, grade, model authority, publication authority, or fantasy ownership state.',
  });
  return aflTradePrivateValuationEvidenceBundleSchema.parse({
    evidenceBundleId: createAflTradeContentAddress('valuation-evidence-bundle', content),
    content,
  });
}
