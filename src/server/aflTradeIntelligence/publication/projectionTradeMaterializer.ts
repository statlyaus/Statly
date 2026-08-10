import { z } from 'zod';

import {
  AFL_TRADE_VALUATION_VIEWS,
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
  aflTradeValueSummarySchema,
  type AflTradeAssetBreakdown,
  type AflTradeLineageSummary,
  type AflTradeValueResult,
  type AflTradeValueSummary,
} from '@/types/aflTradeIntelligence';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  aflTradePublicationManifestV3Schema,
  aflTradePublicationManifestV4Schema,
  type AflTradePublicationManifestV3,
  type AflTradePublicationManifestV4,
} from '../artifacts/publicationProjectionManifests';
import { aflTradeValuationOutputInventoryIndexResultSchema } from '../artifacts/valuationOutputInventoryIndex';
import {
  aflTradeCompleteAssessmentV2Schema,
  verifyAflTradeCompleteAssessmentV2,
  type AflTradeCompleteAssessmentV2,
  type AflTradeCompleteAssessmentV2VerificationInput,
} from '../valuation/completeTradeAssessment';
import type { AflTradeValuationComparison } from '../valuation/jointOutcomeComparisonArtifact';
import { compareAflTradeCodeUnits } from '../valuation/deterministicProbabilityMeasure';
import {
  aflTradeValuationCaseSchema,
  type AflTradeValuationCase,
} from '../valuation/valuationCaseContracts';
import {
  type AflTradeValuationDistribution,
  type AflTradeValuationDistributionSubject,
} from '../valuation/valuationDistributionArtifact';
import {
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SUBJECTS_PER_SHARD,
  aflTradeValuationOutputInventoryComparisonInputSchema,
  aflTradeValuationOutputInventoryDistributionInputSchema,
  aflTradeValuationOutputInventoryResultSchema,
} from '../valuation/valuationOutputInventory';
import {
  aflTradeValuationOutputCustodyIndexVerificationSchema,
  verifyAflTradeValuationOutputCustodyIndex,
} from '../valuation/valuationOutputCustodyIndex';
import {
  AFL_TRADE_PROJECTION_DOCUMENT_MAX_BYTES,
  AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
  aflTradeProjectionDocumentSchema,
  createAflTradeProjectionDocumentArtifact,
  verifyAflTradeProjectionDocumentArtifact,
  type AflTradeProjectionDocumentArtifact,
} from './projectionDocumentContracts';
import {
  aflTradeProjectionEvidenceSourceVerificationVerifyInputSchema,
  verifyAflTradeProjectionEvidenceSourceVerification,
} from './projectionEvidenceSourceVerification';
import {
  createAflTradeProjectionFailClosedValue,
  evaluateAflTradeProjectionAssessment,
  evaluateAflTradeProjectionPublicationEligibility,
  selectAflTradeProjectionPublicFactors,
  selectAflTradeProjectionUncertaintyComponents,
  aflTradeProjectionPresentationPolicyResultSchema,
} from './projectionPresentationPolicy';
import { aflTradeProjectionPublicEvidenceIndexResultSchema } from './projectionPublicEvidenceIndex';
import { aflTradeProjectionPublicEvidenceResultSchema } from './projectionPublicEvidence';

export const AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_SCHEMA_VERSION =
  'afl-trade-projection-trade-materialization/v1' as const;
export const AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_DEFINITION =
  'verified_complete_selected_layer_trade_projection_compilation_v1' as const;
export const AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_NUMERIC_DIGEST_DEFINITION =
  'sha256_of_canonical_selected_coordinate_identity_and_artifact_ref_bindings_v1' as const;
export const AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_DOCUMENT_DIGEST_DEFINITION =
  'sha256_of_detail_first_then_summary_view_then_export_view_row_bindings_v1' as const;
export const AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_LIMITATION =
  'This immutable receipt authenticates one complete public AFL trade projection compiled from supplied verified artifacts. It does not approve or activate a publication, persist detached bytes, establish source rights or model validity, authorize fantasy state, or create user or fantasy ownership.' as const;

export const AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_SELECTED_DISTRIBUTIONS =
  AFL_TRADE_VALUATION_VIEWS.length * AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SUBJECTS_PER_SHARD;
export const AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_SELECTED_COMPARISON_COUNT =
  AFL_TRADE_VALUATION_VIEWS.length;
export const AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_DOCUMENTS =
  1 + AFL_TRADE_VALUATION_VIEWS.length + AFL_TRADE_VALUATION_VIEWS.length * 18;
export const AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_NUMERIC_ARTIFACT_BYTES =
  64 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_RECEIPT_BYTES = 256 * 1024;

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Trade materialization requires canonical JSON artifact references.'
);

const publicationInputSchema = z
  .object({
    publicationManifest: z.union([
      aflTradePublicationManifestV3Schema,
      aflTradePublicationManifestV4Schema,
    ]),
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

const valuationCaseInputSchema = z
  .object({
    valuationCase: aflTradeValuationCaseSchema,
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

const completeTradeAssessmentVerificationSchema = z
  .object({
    assessmentInput: z.unknown(),
    output: aflTradeCompleteAssessmentV2Schema,
  })
  .strict();

export const aflTradeProjectionTradeMaterializerCreateInputSchema = z
  .object({
    publication: publicationInputSchema,
    valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexResultSchema,
    projectionPublicEvidenceIndex: aflTradeProjectionPublicEvidenceIndexResultSchema,
    projectionPresentationPolicy: aflTradeProjectionPresentationPolicyResultSchema,
    valuationOutputInventory: aflTradeValuationOutputInventoryResultSchema,
    valuationCase: valuationCaseInputSchema,
    selectedDistributions: z
      .array(aflTradeValuationOutputInventoryDistributionInputSchema)
      .min(1)
      .max(AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_SELECTED_DISTRIBUTIONS),
    selectedComparisons: z
      .array(aflTradeValuationOutputInventoryComparisonInputSchema)
      .length(AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_SELECTED_COMPARISON_COUNT),
    projectionPublicEvidence: aflTradeProjectionPublicEvidenceResultSchema,
    evidenceSourceVerification: aflTradeProjectionEvidenceSourceVerificationVerifyInputSchema,
    valuationOutputCustodyIndexVerification:
      aflTradeValuationOutputCustodyIndexVerificationSchema.optional(),
    completeTradeAssessmentVerification: completeTradeAssessmentVerificationSchema.optional(),
    materializedAt: aflTradeIsoDateTimeSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const custodyBound =
      input.publication.publicationManifest.content.schemaVersion === 'afl-trade-publication/v4';
    const hasCustody = input.valuationOutputCustodyIndexVerification !== undefined;
    const hasAssessment = input.completeTradeAssessmentVerification !== undefined;
    if (hasCustody !== hasAssessment || custodyBound !== hasCustody) {
      context.addIssue({
        code: 'custom',
        message:
          'Custodied v4 materialization requires the exact custody index and complete-trade assessment; legacy v3 accepts neither.',
      });
    }
  });

export type AflTradeProjectionTradeMaterializerCreateInput = z.infer<
  typeof aflTradeProjectionTradeMaterializerCreateInputSchema
>;

const parentBindingSchema = <Prefix extends string>(prefix: Prefix) =>
  z
    .object({
      semanticId: aflTradeContentAddressedIdSchema(prefix),
      artifactRef: canonicalJsonArtifactRefSchema,
    })
    .strict();

const selectedNumericSetBindingSchema = z
  .object({
    distributionCount: z
      .number()
      .int()
      .positive()
      .max(AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_SELECTED_DISTRIBUTIONS),
    distributionSetSha256: aflTradeSha256Schema,
    comparisonCount: z.literal(
      AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_SELECTED_COMPARISON_COUNT
    ),
    comparisonSetSha256: aflTradeSha256Schema,
    digestDefinition: z.literal(
      AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_NUMERIC_DIGEST_DEFINITION
    ),
  })
  .strict();

const documentBindingSchema = z
  .object({
    projectionDocumentId: aflTradeContentAddressedIdSchema('projection-document'),
    artifactRef: canonicalJsonArtifactRefSchema,
    kind: z.enum(['trade_detail', 'trade_summary', 'valuation_export_row']),
    tradeId: aflTradePublicIdSchema,
    view: z.enum(AFL_TRADE_VALUATION_VIEWS).nullable(),
    rowOrdinal: z.number().int().nonnegative().max(17).nullable(),
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.kind === 'trade_detail') {
      if (binding.view !== null || binding.rowOrdinal !== null) {
        context.addIssue({ code: 'custom', message: 'Detail bindings have no view or row.' });
      }
      return;
    }
    if (binding.view === null) {
      context.addIssue({ code: 'custom', path: ['view'], message: 'View is required.' });
    }
    if ((binding.kind === 'valuation_export_row') !== (binding.rowOrdinal !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['rowOrdinal'],
        message: 'Only export bindings carry a row ordinal.',
      });
    }
  });

type DocumentBinding = z.infer<typeof documentBindingSchema>;

function documentsUseCompiledOrder(bindings: readonly DocumentBinding[]): boolean {
  if (bindings.filter(({ kind }) => kind === 'trade_detail').length !== 1) return false;
  const summaries = bindings.filter(({ kind }) => kind === 'trade_summary');
  if (
    summaries.length !== AFL_TRADE_VALUATION_VIEWS.length ||
    summaries.some((binding, index) => binding.view !== AFL_TRADE_VALUATION_VIEWS[index])
  ) {
    return false;
  }
  const expectedPrefix = [bindings[0], ...summaries];
  if (
    expectedPrefix.some((binding, index) => binding !== bindings[index]) ||
    bindings.slice(expectedPrefix.length).some(({ kind }) => kind !== 'valuation_export_row')
  ) {
    return false;
  }
  let offset = expectedPrefix.length;
  for (const view of AFL_TRADE_VALUATION_VIEWS) {
    const rows = bindings
      .slice(offset)
      .filter((binding) => binding.kind === 'valuation_export_row' && binding.view === view);
    if (
      rows.length < 1 ||
      rows.length > 18 ||
      rows.some((binding, rowOrdinal) => binding.rowOrdinal !== rowOrdinal) ||
      bindings.slice(offset, offset + rows.length).some((binding, index) => binding !== rows[index])
    ) {
      return false;
    }
    offset += rows.length;
  }
  return offset === bindings.length;
}

export const aflTradeProjectionTradeMaterializationContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY),
    definition: z.literal(AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_DEFINITION),
    publication: parentBindingSchema('publication'),
    valuationOutputInventoryIndex: parentBindingSchema('valuation-output-inventory-index'),
    projectionPublicEvidenceIndex: parentBindingSchema('projection-public-evidence-index'),
    projectionPresentationPolicy: parentBindingSchema('projection-presentation-policy'),
    valuationOutputInventory: parentBindingSchema('valuation-output-inventory'),
    valuationCase: parentBindingSchema('valuation-case'),
    completeTradeAssessment: parentBindingSchema('complete-trade-assessment').optional(),
    projectionPublicEvidence: parentBindingSchema('projection-public-evidence'),
    evidenceSourceVerification: z
      .object({
        semanticId: aflTradeContentAddressedIdSchema('projection-evidence-source-verification'),
        artifactRef: canonicalJsonArtifactRefSchema,
        status: z.literal('passed'),
        sourceArtifactSetSha256: aflTradeSha256Schema,
      })
      .strict(),
    tradeId: aflTradePublicIdSchema,
    scopeKey: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    calculationAsOf: aflTradeIsoDateTimeSchema,
    knowledgeCutoffAt: aflTradeIsoDateTimeSchema,
    selectedNumericSet: selectedNumericSetBindingSchema,
    documentDigestDefinition: z.literal(
      AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_DOCUMENT_DIGEST_DEFINITION
    ),
    documentCount: z
      .number()
      .int()
      .positive()
      .max(AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_DOCUMENTS),
    documentSetSha256: aflTradeSha256Schema,
    documents: z
      .array(documentBindingSchema)
      .min(1)
      .max(AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_DOCUMENTS),
    materializedAt: aflTradeIsoDateTimeSchema,
    limitation: z.literal(AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.documentCount !== content.documents.length) {
      context.addIssue({
        code: 'custom',
        path: ['documentCount'],
        message: 'Document count must match the compact bindings.',
      });
    }
    if (content.documentSetSha256 !== sha256AflTradeCanonicalJson(content.documents)) {
      context.addIssue({
        code: 'custom',
        path: ['documentSetSha256'],
        message: 'Document digest must authenticate every ordered binding.',
      });
    }
    if (content.documents[0]?.kind !== 'trade_detail') {
      context.addIssue({
        code: 'custom',
        path: ['documents'],
        message: 'The mechanically compiled detail document must be first.',
      });
    }
    if (!documentsUseCompiledOrder(content.documents)) {
      context.addIssue({
        code: 'custom',
        path: ['documents'],
        message:
          'Receipt documents must contain detail first, four canonical summaries, then contiguous canonical export rows.',
      });
    }
    for (const identities of [
      content.documents.map(({ projectionDocumentId }) => projectionDocumentId),
      content.documents.map(({ artifactRef }) => artifactRef.artifactId),
    ]) {
      if (new Set(identities).size !== identities.length) {
        context.addIssue({
          code: 'custom',
          path: ['documents'],
          message: 'Receipt document semantic and artifact identities must be unique.',
        });
      }
    }
    if (
      content.documents.some(
        (binding) =>
          binding.tradeId !== content.tradeId ||
          Date.parse(binding.artifactRef.createdAt) > Date.parse(content.materializedAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['documents'],
        message: 'Document coordinates and times must match the receipt.',
      });
    }
    if (
      Date.parse(content.knowledgeCutoffAt) > Date.parse(content.calculationAsOf) ||
      Date.parse(content.calculationAsOf) > Date.parse(content.materializedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializedAt'],
        message: 'Knowledge, calculation, and materialization times must be monotonic.',
      });
    }
  });

export const aflTradeProjectionTradeMaterializationSchema = z
  .object({
    projectionTradeMaterializationId: aflTradeContentAddressedIdSchema(
      'projection-trade-materialization'
    ),
    content: aflTradeProjectionTradeMaterializationContentSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'projection-trade-materialization',
      receipt.projectionTradeMaterializationId,
      receipt.content,
      context,
      ['projectionTradeMaterializationId']
    );
  });

export type AflTradeProjectionTradeMaterialization = z.infer<
  typeof aflTradeProjectionTradeMaterializationSchema
>;

const projectionDocumentArtifactSchema = z
  .object({
    projectionDocument: aflTradeProjectionDocumentSchema,
    projectionDocumentArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    if (!verifyAflTradeProjectionDocumentArtifact(artifact)) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentArtifactRef'],
        message: 'Projection document artifact must satisfy its exact contract.',
      });
    }
  });

function addProjectionDocumentLosslessnessIssues(
  documents: readonly AflTradeProjectionDocumentArtifact[],
  context: z.RefinementCtx
): void {
  const detailDocuments = documents.filter(
    ({ projectionDocument }) => projectionDocument.content.kind === 'trade_detail'
  );
  if (detailDocuments.length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['projectionDocuments'],
      message: 'Materialization requires exactly one canonical detail document.',
    });
    return;
  }
  const detail = detailDocuments[0]?.projectionDocument.content;
  if (detail?.kind !== 'trade_detail') return;

  for (const [viewIndex, view] of AFL_TRADE_VALUATION_VIEWS.entries()) {
    const detailedValue = detail.valuations[viewIndex];
    const detailedFactors = detail.viewGlobalFactors[viewIndex];
    const summaryDocuments = documents.filter(({ projectionDocument }) => {
      const content = projectionDocument.content;
      return content.kind === 'trade_summary' && content.view === view;
    });
    const exportDocuments = documents.filter(({ projectionDocument }) => {
      const content = projectionDocument.content;
      return content.kind === 'valuation_export_row' && content.exportRow.view === view;
    });
    const summary = summaryDocuments[0]?.projectionDocument.content;
    if (
      detailedValue === undefined ||
      detailedValue.view !== view ||
      detailedFactors === undefined ||
      detailedFactors.view !== view ||
      summaryDocuments.length !== 1 ||
      summary?.kind !== 'trade_summary'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocuments'],
        message: `Materialized ${view} documents must bind one exact detail and summary view.`,
      });
      continue;
    }

    let expectedSummary: AflTradeValueSummary;
    try {
      expectedSummary = summaryFromValue(detailedValue);
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocuments'],
        message: `Materialized ${view} detail cannot be converted to its governed summary.`,
      });
      continue;
    }
    if (
      !sameCanonicalJson(summary.valuation, expectedSummary) ||
      !sameCanonicalJson(summary.viewGlobalFactors, detailedFactors)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocuments'],
        message: `Materialized ${view} summary must be the exact detail projection.`,
      });
    }

    const expectedRowCount =
      detailedValue.availability === 'available' ? detailedValue.clubValues.length : 1;
    if (exportDocuments.length !== expectedRowCount) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocuments'],
        message: `Materialized ${view} exports must cover the exact summary row cardinality.`,
      });
      continue;
    }

    for (const [rowOrdinal, exportArtifact] of exportDocuments.entries()) {
      const exportDocument = exportArtifact.projectionDocument.content;
      if (exportDocument.kind !== 'valuation_export_row') continue;
      const expectedFactors = rowOrdinal === 0 ? detailedFactors : null;
      if (
        exportDocument.exportRow.rowOrdinal !== rowOrdinal ||
        !sameCanonicalJson(exportDocument.exportRow.valuation, expectedSummary) ||
        !sameCanonicalJson(exportDocument.viewGlobalFactors, expectedFactors)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['projectionDocuments'],
          message: `Materialized ${view} export rows must preserve canonical order, valuation, and view-global factors.`,
        });
      }

      if (detailedValue.availability !== 'available') {
        if (
          exportDocument.exportRow.clubValue !== null ||
          exportDocument.exportRow.selectedClubOutcome !== null
        ) {
          context.addIssue({
            code: 'custom',
            path: ['projectionDocuments'],
            message: `Unavailable ${view} requires one null-club, null-outcome export row.`,
          });
        }
        continue;
      }

      const detailedClubValue = detailedValue.clubValues[rowOrdinal];
      const expectedClubValue =
        'clubValues' in expectedSummary ? expectedSummary.clubValues[rowOrdinal] : undefined;
      if (
        detailedClubValue === undefined ||
        expectedClubValue === undefined ||
        !sameCanonicalJson(exportDocument.exportRow.clubValue, expectedClubValue) ||
        !sameCanonicalJson(exportDocument.exportRow.selectedClubOutcome, {
          aflClubId: detailedClubValue.aflClubId,
          distribution: detailedClubValue.distribution,
        })
      ) {
        context.addIssue({
          code: 'custom',
          path: ['projectionDocuments'],
          message: `Materialized ${view} export row must preserve its exact club and outcome facts.`,
        });
      }
    }
  }
}

export const aflTradeProjectionTradeMaterializationResultSchema = z
  .object({
    projectionDocuments: z
      .array(projectionDocumentArtifactSchema)
      .min(1)
      .max(AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_DOCUMENTS),
    projectionTradeMaterialization: aflTradeProjectionTradeMaterializationSchema,
    projectionTradeMaterializationArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const receipt = result.projectionTradeMaterialization;
    const reference = result.projectionTradeMaterializationArtifactRef;
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(reference, receipt) ||
      reference.createdAt !== receipt.content.materializedAt ||
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_RECEIPT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionTradeMaterializationArtifactRef'],
        message: 'Receipt reference must authenticate bounded canonical receipt bytes.',
      });
    }
    const bindings = result.projectionDocuments.map(documentBindingFor);
    if (
      canonicalizeAflTradeJson(bindings) !== canonicalizeAflTradeJson(receipt.content.documents)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocuments'],
        message: 'Detached documents must exactly match receipt membership.',
      });
    }
    addProjectionDocumentLosslessnessIssues(result.projectionDocuments, context);
  });

export type AflTradeProjectionTradeMaterializationResult = z.infer<
  typeof aflTradeProjectionTradeMaterializationResultSchema
>;

export const aflTradeProjectionTradeMaterializationVerifyInputSchema =
  aflTradeProjectionTradeMaterializerCreateInputSchema.safeExtend({
    output: aflTradeProjectionTradeMaterializationResultSchema,
  });

export type AflTradeProjectionTradeMaterializationVerifyInput = z.infer<
  typeof aflTradeProjectionTradeMaterializationVerifyInputSchema
>;

export const AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_ERROR_CODES = [
  'INVALID_INPUT_ENVELOPE',
  'INVALID_PUBLICATION_BINDING',
  'INVALID_INVENTORY_INDEX',
  'INVALID_EVIDENCE_INDEX',
  'INVALID_PRESENTATION_POLICY',
  'INVALID_INVENTORY',
  'INVALID_VALUATION_CASE_BINDING',
  'INVALID_CUSTODY_INDEX',
  'INVALID_COMPLETE_TRADE_ASSESSMENT',
  'INVALID_SELECTED_DISTRIBUTIONS',
  'INVALID_SELECTED_COMPARISONS',
  'INVALID_PUBLIC_EVIDENCE',
  'INVALID_SOURCE_VERIFICATION_REPLAY',
  'PARENT_BINDING_MISMATCH',
  'PUBLIC_ASSET_BOUNDARY_MISMATCH',
  'SELECTED_DISTRIBUTION_BIJECTION_MISMATCH',
  'SELECTED_COMPARISON_BIJECTION_MISMATCH',
  'SOURCE_VERIFICATION_NOT_PASSED',
  'PUBLICATION_INELIGIBLE',
  'INCOMPLETE_NUMERIC_INPUT',
  'CURRENT_IDENTITY_MISMATCH',
  'NON_MONOTONIC_ARTIFACT_TIME',
  'AGGREGATE_NUMERIC_SIZE_LIMIT_EXCEEDED',
  'RECEIPT_SIZE_LIMIT_EXCEEDED',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const;

export type AflTradeProjectionTradeMaterializationErrorCode =
  (typeof AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<AflTradeProjectionTradeMaterializationErrorCode, string>> =
  Object.freeze({
    INVALID_INPUT_ENVELOPE: 'The trade-materializer input envelope is invalid.',
    INVALID_PUBLICATION_BINDING: 'The publication v3 binding is invalid.',
    INVALID_INVENTORY_INDEX: 'The valuation-output inventory-index result is invalid.',
    INVALID_EVIDENCE_INDEX: 'The projection public-evidence-index result is invalid.',
    INVALID_PRESENTATION_POLICY: 'The projection presentation-policy result is invalid.',
    INVALID_INVENTORY: 'The full valuation-output inventory result is invalid.',
    INVALID_VALUATION_CASE_BINDING: 'The valuation-case binding is invalid.',
    INVALID_CUSTODY_INDEX: 'The valuation-output custody-index verification is invalid.',
    INVALID_COMPLETE_TRADE_ASSESSMENT: 'The complete-trade assessment verification is invalid.',
    INVALID_SELECTED_DISTRIBUTIONS: 'The selected-layer distribution bindings are invalid.',
    INVALID_SELECTED_COMPARISONS: 'The selected-layer comparison bindings are invalid.',
    INVALID_PUBLIC_EVIDENCE: 'The projection public-evidence result is invalid.',
    INVALID_SOURCE_VERIFICATION_REPLAY: 'The full source-verification replay is invalid.',
    PARENT_BINDING_MISMATCH: 'Trade materializer parents do not form one exact publication chain.',
    PUBLIC_ASSET_BOUNDARY_MISMATCH: 'A parent crosses the source-native public AFL asset boundary.',
    SELECTED_DISTRIBUTION_BIJECTION_MISMATCH:
      'Selected distributions are not the exact policy-layer inventory bijection.',
    SELECTED_COMPARISON_BIJECTION_MISMATCH:
      'Selected comparisons are not the exact policy-layer inventory bijection.',
    SOURCE_VERIFICATION_NOT_PASSED:
      'Public materialization requires an exact replayed passing source verification.',
    PUBLICATION_INELIGIBLE: 'The trade is not eligible for complete numerical publication.',
    INCOMPLETE_NUMERIC_INPUT: 'Public materialization requires complete selected-layer numbers.',
    CURRENT_IDENTITY_MISMATCH: 'Current mean value must equal realized plus remaining mean value.',
    NON_MONOTONIC_ARTIFACT_TIME:
      'A materialization parent postdates the requested materialization.',
    AGGREGATE_NUMERIC_SIZE_LIMIT_EXCEEDED:
      'Selected numeric artifact bytes exceed the 64 MiB operation limit.',
    RECEIPT_SIZE_LIMIT_EXCEEDED: 'The compact materialization receipt exceeds 256 KiB.',
    INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
      'The trade materializer failed its internal artifact contract.',
  });

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeProjectionTradeMaterializationError extends Error {
  readonly code: AflTradeProjectionTradeMaterializationErrorCode;

  constructor(code: AflTradeProjectionTradeMaterializationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionTradeMaterializationError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeProjectionTradeMaterializationError';
    code: AflTradeProjectionTradeMaterializationErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeProjectionTradeMaterializationError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeProjectionTradeMaterializationError(
  value: unknown
): value is AflTradeProjectionTradeMaterializationError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function constructionError(
  code: AflTradeProjectionTradeMaterializationErrorCode
): AflTradeProjectionTradeMaterializationError {
  return new AflTradeProjectionTradeMaterializationError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeProjectionTradeMaterializationErrorCode
): T {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // Hostile values are converted to the stable branded error below.
  }
  throw constructionError(code);
}

const CREATE_INPUT_KEYS = [
  'publication',
  'valuationOutputInventoryIndex',
  'projectionPublicEvidenceIndex',
  'projectionPresentationPolicy',
  'valuationOutputInventory',
  'valuationCase',
  'selectedDistributions',
  'selectedComparisons',
  'projectionPublicEvidence',
  'evidenceSourceVerification',
  'materializedAt',
] as const;
const CUSTODIED_CREATE_INPUT_KEYS = [
  ...CREATE_INPUT_KEYS.slice(0, -1),
  'valuationOutputCustodyIndexVerification',
  'completeTradeAssessmentVerification',
  'materializedAt',
] as const;
const VERIFY_INPUT_KEYS = [...CREATE_INPUT_KEYS, 'output'] as const;
const CUSTODIED_VERIFY_INPUT_KEYS = [...CUSTODIED_CREATE_INPUT_KEYS, 'output'] as const;

function snapshotExactEnvelope(
  value: unknown,
  keyAlternatives: readonly (readonly string[])[]
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const ownKeys = Reflect.ownKeys(value);
    const keys = keyAlternatives.find((candidate) => {
      const expected = new Set<string>(candidate);
      return (
        ownKeys.length === candidate.length &&
        ownKeys.every((key) => typeof key === 'string' && expected.has(key))
      );
    });
    if (keys === undefined) return null;
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) snapshot[key] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key, value), seen);
  return Object.freeze(value);
}

function documentBindingFor(artifact: AflTradeProjectionDocumentArtifact) {
  const document = artifact.projectionDocument;
  const content = document.content;
  if (content.kind === 'trade_detail') {
    return {
      projectionDocumentId: document.projectionDocumentId,
      artifactRef: artifact.projectionDocumentArtifactRef,
      kind: content.kind,
      tradeId: content.tradeId,
      view: null,
      rowOrdinal: null,
    };
  }
  if (content.kind === 'trade_summary') {
    return {
      projectionDocumentId: document.projectionDocumentId,
      artifactRef: artifact.projectionDocumentArtifactRef,
      kind: content.kind,
      tradeId: content.tradeId,
      view: content.view,
      rowOrdinal: null,
    };
  }
  if (content.kind !== 'valuation_export_row') {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  return {
    projectionDocumentId: document.projectionDocumentId,
    artifactRef: artifact.projectionDocumentArtifactRef,
    kind: content.kind,
    tradeId: content.exportRow.tradeId,
    view: content.exportRow.view,
    rowOrdinal: content.exportRow.rowOrdinal,
  };
}

interface AuthenticatedTradeInputs {
  input: AflTradeProjectionTradeMaterializerCreateInput;
  publication: AflTradePublicationManifestV3 | AflTradePublicationManifestV4;
  valuationCase: AflTradeValuationCase;
  completeTradeAssessment: AflTradeCompleteAssessmentV2 | null;
  completeTradeAssessmentArtifactRef: AflTradeArtifactRef | null;
  custodyIndexArtifactRef: AflTradeArtifactRef | null;
  selectedDistributions: AflTradeValuationDistribution[];
  selectedComparisons: AflTradeValuationComparison[];
  distributionSetSha256: string;
  comparisonSetSha256: string;
}

function parseCreateInput(
  snapshot: Record<string, unknown>
): AflTradeProjectionTradeMaterializerCreateInput {
  const valuationOutputCustodyIndexVerification =
    snapshot.valuationOutputCustodyIndexVerification === undefined
      ? undefined
      : parseOrThrow(
          aflTradeValuationOutputCustodyIndexVerificationSchema,
          snapshot.valuationOutputCustodyIndexVerification,
          'INVALID_CUSTODY_INDEX'
        );
  const completeTradeAssessmentVerification =
    snapshot.completeTradeAssessmentVerification === undefined
      ? undefined
      : parseOrThrow(
          completeTradeAssessmentVerificationSchema,
          snapshot.completeTradeAssessmentVerification,
          'INVALID_COMPLETE_TRADE_ASSESSMENT'
        );
  return parseOrThrow(
    aflTradeProjectionTradeMaterializerCreateInputSchema,
    {
      publication: parseOrThrow(
        publicationInputSchema,
        snapshot.publication,
        'INVALID_PUBLICATION_BINDING'
      ),
      valuationOutputInventoryIndex: parseOrThrow(
        aflTradeValuationOutputInventoryIndexResultSchema,
        snapshot.valuationOutputInventoryIndex,
        'INVALID_INVENTORY_INDEX'
      ),
      projectionPublicEvidenceIndex: parseOrThrow(
        aflTradeProjectionPublicEvidenceIndexResultSchema,
        snapshot.projectionPublicEvidenceIndex,
        'INVALID_EVIDENCE_INDEX'
      ),
      projectionPresentationPolicy: parseOrThrow(
        aflTradeProjectionPresentationPolicyResultSchema,
        snapshot.projectionPresentationPolicy,
        'INVALID_PRESENTATION_POLICY'
      ),
      valuationOutputInventory: parseOrThrow(
        aflTradeValuationOutputInventoryResultSchema,
        snapshot.valuationOutputInventory,
        'INVALID_INVENTORY'
      ),
      valuationCase: parseOrThrow(
        valuationCaseInputSchema,
        snapshot.valuationCase,
        'INVALID_VALUATION_CASE_BINDING'
      ),
      selectedDistributions: parseOrThrow(
        aflTradeProjectionTradeMaterializerCreateInputSchema.shape.selectedDistributions,
        snapshot.selectedDistributions,
        'INVALID_SELECTED_DISTRIBUTIONS'
      ),
      selectedComparisons: parseOrThrow(
        aflTradeProjectionTradeMaterializerCreateInputSchema.shape.selectedComparisons,
        snapshot.selectedComparisons,
        'INVALID_SELECTED_COMPARISONS'
      ),
      projectionPublicEvidence: parseOrThrow(
        aflTradeProjectionPublicEvidenceResultSchema,
        snapshot.projectionPublicEvidence,
        'INVALID_PUBLIC_EVIDENCE'
      ),
      evidenceSourceVerification: parseOrThrow(
        aflTradeProjectionEvidenceSourceVerificationVerifyInputSchema,
        snapshot.evidenceSourceVerification,
        'INVALID_SOURCE_VERIFICATION_REPLAY'
      ),
      valuationOutputCustodyIndexVerification,
      completeTradeAssessmentVerification,
      materializedAt: parseOrThrow(
        aflTradeIsoDateTimeSchema,
        snapshot.materializedAt,
        'INVALID_INPUT_ENVELOPE'
      ),
    },
    'INVALID_INPUT_ENVELOPE'
  );
}

function requireExactArtifactReference(reference: AflTradeArtifactRef, value: unknown): void {
  if (!doesAflTradeArtifactRefMatchCanonicalJson(reference, value)) {
    throw constructionError('PARENT_BINDING_MISMATCH');
  }
}

function subjectKey(subject: AflTradeValuationDistributionSubject): string {
  return canonicalizeAflTradeJson(subject);
}

function numericBindingForDistribution(input: {
  valuationDistribution: AflTradeValuationDistribution;
  artifactRef: AflTradeArtifactRef;
}) {
  const content = input.valuationDistribution.content;
  return {
    view: content.viewContext.view,
    subject: content.subject,
    measure: content.measure,
    valuationDistributionId: input.valuationDistribution.valuationDistributionId,
    artifactRef: input.artifactRef,
  };
}

function numericBindingForComparison(input: {
  valuationComparison: AflTradeValuationComparison;
  artifactRef: AflTradeArtifactRef;
}) {
  const content = input.valuationComparison.content;
  return {
    view: content.viewContext.view,
    measure: content.measure,
    valuationComparisonId: input.valuationComparison.valuationComparisonId,
    artifactRef: input.artifactRef,
  };
}

function authenticateSelectedDistributions(input: AflTradeProjectionTradeMaterializerCreateInput): {
  artifacts: AflTradeValuationDistribution[];
  setSha256: string;
} {
  const inventory = input.valuationOutputInventory;
  const layer =
    input.projectionPresentationPolicy.projectionPresentationPolicy.content.universalLayer;
  const selectedShards = inventory.distributionShards.filter((output) => {
    const measure = output.shard.content.coordinate.measure;
    return measure.kind === 'universal_football_value' && measure.layer === layer;
  });
  if (selectedShards.length !== AFL_TRADE_VALUATION_VIEWS.length) {
    throw constructionError('SELECTED_DISTRIBUTION_BIJECTION_MISMATCH');
  }
  const suppliedById = new Map(
    input.selectedDistributions.map((selected) => [
      selected.valuationDistribution.valuationDistributionId,
      selected,
    ])
  );
  if (suppliedById.size !== input.selectedDistributions.length) {
    throw constructionError('SELECTED_DISTRIBUTION_BIJECTION_MISMATCH');
  }
  const orderedInputs: typeof input.selectedDistributions = [];
  for (const shard of selectedShards) {
    const coordinate = shard.shard.content.coordinate;
    for (const binding of shard.shard.content.distributions) {
      const supplied = suppliedById.get(binding.valuationDistributionId);
      if (
        supplied === undefined ||
        !sameCanonicalJson(supplied.artifactRef, binding.artifactRef) ||
        !doesAflTradeArtifactRefMatchCanonicalJson(
          supplied.artifactRef,
          supplied.valuationDistribution
        )
      ) {
        throw constructionError('SELECTED_DISTRIBUTION_BIJECTION_MISMATCH');
      }
      const content = supplied.valuationDistribution.content;
      const caseViewContext = input.valuationCase.valuationCase.content.viewContexts.find(
        ({ view }) => view === coordinate.view
      );
      if (
        caseViewContext === undefined ||
        content.viewContext.view !== coordinate.view ||
        !sameCanonicalJson(content.viewContext, caseViewContext) ||
        !sameCanonicalJson(content.measure, coordinate.measure) ||
        !sameCanonicalJson(content.subject, binding.subject) ||
        content.valuationCaseId !== input.valuationCase.valuationCase.valuationCaseId ||
        content.valuationCalculationId !==
          inventory.valuationOutputInventory.content.valuationCalculation.valuationCalculationId
      ) {
        throw constructionError('SELECTED_DISTRIBUTION_BIJECTION_MISMATCH');
      }
      orderedInputs.push(supplied);
    }
  }
  if (orderedInputs.length !== input.selectedDistributions.length) {
    throw constructionError('SELECTED_DISTRIBUTION_BIJECTION_MISMATCH');
  }
  const bindings = orderedInputs.map(numericBindingForDistribution);
  return {
    artifacts: orderedInputs.map(({ valuationDistribution }) => valuationDistribution),
    setSha256: sha256AflTradeCanonicalJson(bindings),
  };
}

function authenticateSelectedComparisons(input: AflTradeProjectionTradeMaterializerCreateInput): {
  artifacts: AflTradeValuationComparison[];
  setSha256: string;
} {
  const root = input.valuationOutputInventory.valuationOutputInventory.content;
  const layer =
    input.projectionPresentationPolicy.projectionPresentationPolicy.content.universalLayer;
  const expected = root.valuationComparisons.filter(
    (binding) =>
      binding.measure.kind === 'universal_football_value' && binding.measure.layer === layer
  );
  const suppliedById = new Map(
    input.selectedComparisons.map((selected) => [
      selected.valuationComparison.valuationComparisonId,
      selected,
    ])
  );
  if (
    expected.length !== AFL_TRADE_VALUATION_VIEWS.length ||
    suppliedById.size !== input.selectedComparisons.length
  ) {
    throw constructionError('SELECTED_COMPARISON_BIJECTION_MISMATCH');
  }
  const orderedInputs: typeof input.selectedComparisons = [];
  const expectedClubIds = input.valuationCase.valuationCase.content.parties.map(
    ({ aflClubId }) => aflClubId
  );
  const expectedPartyRootFrontiers = input.valuationCase.valuationCase.content.parties.map(
    ({ aflClubId, receivedRootAssetIds }) => ({
      aflClubId,
      rootAssetIds: receivedRootAssetIds,
    })
  );
  for (const binding of expected) {
    const supplied = suppliedById.get(binding.valuationComparisonId);
    if (
      supplied === undefined ||
      !sameCanonicalJson(supplied.artifactRef, binding.artifactRef) ||
      !doesAflTradeArtifactRefMatchCanonicalJson(supplied.artifactRef, supplied.valuationComparison)
    ) {
      throw constructionError('SELECTED_COMPARISON_BIJECTION_MISMATCH');
    }
    const content = supplied.valuationComparison.content;
    const caseViewContext = input.valuationCase.valuationCase.content.viewContexts.find(
      ({ view }) => view === binding.view
    );
    const comparison = content.comparison;
    const probabilityClubIds =
      comparison.status === 'available'
        ? comparison.probabilities.clubClearLeaderProbabilities.map(({ aflClubId }) => aflClubId)
        : comparison.conditionalOnAvailableProbabilities?.clubClearLeaderProbabilities.map(
            ({ aflClubId }) => aflClubId
          );
    if (
      caseViewContext === undefined ||
      content.viewContext.view !== binding.view ||
      !sameCanonicalJson(content.viewContext, caseViewContext) ||
      !sameCanonicalJson(content.measure, binding.measure) ||
      content.valuationCaseId !== input.valuationCase.valuationCase.valuationCaseId ||
      content.valuationCalculationId !== root.valuationCalculation.valuationCalculationId ||
      !sameCanonicalJson(comparison.aflClubIds, expectedClubIds) ||
      (probabilityClubIds !== undefined &&
        !sameCanonicalJson(probabilityClubIds, expectedClubIds)) ||
      !sameCanonicalJson(content.derivation.partyRootFrontiers, expectedPartyRootFrontiers)
    ) {
      throw constructionError('SELECTED_COMPARISON_BIJECTION_MISMATCH');
    }
    orderedInputs.push(supplied);
  }
  if (orderedInputs.length !== input.selectedComparisons.length) {
    throw constructionError('SELECTED_COMPARISON_BIJECTION_MISMATCH');
  }
  const bindings = orderedInputs.map(numericBindingForComparison);
  return {
    artifacts: orderedInputs.map(({ valuationComparison }) => valuationComparison),
    setSha256: sha256AflTradeCanonicalJson(bindings),
  };
}

function assessmentLayerForPresentation(
  layer: 'gross' | 'list_spot_adjusted' | 'scarcity_adjusted'
): 'gross' | 'listSpotAdjusted' | 'scarcityAdjusted' {
  return layer === 'list_spot_adjusted'
    ? 'listSpotAdjusted'
    : layer === 'scarcity_adjusted'
      ? 'scarcityAdjusted'
      : 'gross';
}

function authenticateCustodiedAssessment(input: AflTradeProjectionTradeMaterializerCreateInput): {
  assessment: AflTradeCompleteAssessmentV2;
  assessmentArtifactRef: AflTradeArtifactRef;
  custodyIndexArtifactRef: AflTradeArtifactRef;
} | null {
  const publication = input.publication.publicationManifest;
  if (publication.content.schemaVersion === 'afl-trade-publication/v3') return null;
  const custodyVerification = input.valuationOutputCustodyIndexVerification;
  const assessmentVerification = input.completeTradeAssessmentVerification;
  if (
    custodyVerification === undefined ||
    assessmentVerification === undefined ||
    !verifyAflTradeValuationOutputCustodyIndex(custodyVerification) ||
    !verifyAflTradeCompleteAssessmentV2(
      assessmentVerification as AflTradeCompleteAssessmentV2VerificationInput
    )
  ) {
    throw constructionError('INVALID_COMPLETE_TRADE_ASSESSMENT');
  }
  const custodyResult = custodyVerification.output;
  const custodyIndex = custodyResult.valuationOutputCustodyIndex;
  const publicationCustody = publication.content.valuationOutputCustodyIndex;
  if (
    custodyIndex.valuationOutputCustodyIndexId !==
      publicationCustody.valuationOutputCustodyIndexId ||
    !sameCanonicalJson(custodyResult.artifactRef, publicationCustody.artifactRef)
  ) {
    throw constructionError('PARENT_BINDING_MISMATCH');
  }
  const inventoryId =
    input.valuationOutputInventory.valuationOutputInventory.valuationOutputInventoryId;
  const custodyEvidence = custodyVerification.custodyReceipts.find(
    ({ receipt }) => receipt.content.valuationOutputInventoryId === inventoryId
  );
  const assessment = assessmentVerification.output;
  const assessmentBinding = custodyEvidence?.receipt.content.artifacts.find(
    ({ role }) => role === 'complete_trade_assessment'
  );
  const valuationCase = input.valuationCase.valuationCase;
  const inventory = input.valuationOutputInventory.valuationOutputInventory.content;
  const policy = input.projectionPresentationPolicy.projectionPresentationPolicy.content;
  if (
    custodyEvidence === undefined ||
    assessmentBinding === undefined ||
    assessmentBinding.semanticId !== assessment.assessmentId ||
    !doesAflTradeArtifactRefMatchCanonicalJson(assessmentBinding.artifact, assessment) ||
    custodyEvidence.receipt.content.tradeId !== valuationCase.content.tradeId ||
    custodyEvidence.receipt.content.valuationCaseId !== valuationCase.valuationCaseId ||
    custodyEvidence.receipt.content.valuationCalculationId !==
      inventory.valuationCalculation.valuationCalculationId ||
    assessment.content.tradeId !== valuationCase.content.tradeId ||
    assessment.content.source.valuationCaseId !== valuationCase.valuationCaseId ||
    assessment.content.source.valuationCalculationId !==
      inventory.valuationCalculation.valuationCalculationId ||
    assessment.content.valueUnit.valueUnitId !== valuationCase.content.valueUnitId ||
    assessment.content.source.selectedLayer !==
      assessmentLayerForPresentation(policy.universalLayer) ||
    Date.parse(assessment.content.assessedAt) >
      Date.parse(custodyEvidence.receipt.content.verifiedAt)
  ) {
    throw constructionError('PARENT_BINDING_MISMATCH');
  }
  return {
    assessment,
    assessmentArtifactRef: assessmentBinding.artifact,
    custodyIndexArtifactRef: custodyResult.artifactRef,
  };
}

function authenticateParents(
  input: AflTradeProjectionTradeMaterializerCreateInput
): AuthenticatedTradeInputs {
  const publication = input.publication.publicationManifest;
  const publicationRef = input.publication.artifactRef;
  const index = input.valuationOutputInventoryIndex.valuationOutputInventoryIndex;
  const indexRef = input.valuationOutputInventoryIndex.valuationOutputInventoryIndexArtifactRef;
  const evidenceIndex = input.projectionPublicEvidenceIndex.projectionPublicEvidenceIndex;
  const evidenceIndexRef =
    input.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexArtifactRef;
  const policy = input.projectionPresentationPolicy.projectionPresentationPolicy;
  const policyRef = input.projectionPresentationPolicy.projectionPresentationPolicyArtifactRef;
  const inventory = input.valuationOutputInventory.valuationOutputInventory;
  const inventoryRef = input.valuationOutputInventory.valuationOutputInventoryArtifactRef;
  const valuationCase = input.valuationCase.valuationCase;
  const valuationCaseRef = input.valuationCase.artifactRef;
  const evidence = input.projectionPublicEvidence.projectionPublicEvidence;
  const evidenceRef = input.projectionPublicEvidence.projectionPublicEvidenceArtifactRef;
  const custodiedAssessment = authenticateCustodiedAssessment(input);

  requireExactArtifactReference(publicationRef, publication);
  requireExactArtifactReference(valuationCaseRef, valuationCase);
  if (
    publicationRef.createdAt !== publication.content.createdAt ||
    !sameCanonicalJson(publication.content.valuationOutputInventoryIndex, {
      schemaVersion: index.content.schemaVersion,
      valuationOutputInventoryIndexId: index.valuationOutputInventoryIndexId,
      artifactRef: indexRef,
      entryCount: index.content.entryCount,
      inventorySetSha256: index.content.inventorySetSha256,
    }) ||
    !sameCanonicalJson(publication.content.projectionPresentationPolicy.artifactRef, policyRef) ||
    publication.content.projectionPresentationPolicy.projectionPresentationPolicyId !==
      policy.projectionPresentationPolicyId ||
    evidenceIndex.content.publication.publicationId !== publication.publicationId ||
    !sameCanonicalJson(evidenceIndex.content.publication.artifactRef, publicationRef) ||
    evidenceIndex.content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId !==
      index.valuationOutputInventoryIndexId ||
    !sameCanonicalJson(evidenceIndex.content.valuationOutputInventoryIndex.artifactRef, indexRef) ||
    index.content.valuationBundle.valuationBundleId !== publication.content.valuationBundleId ||
    inventory.content.valuationBundle.valuationBundleId !== publication.content.valuationBundleId ||
    valuationCase.content.valuationBundleId !== publication.content.valuationBundleId ||
    inventory.content.valuationCase.valuationCaseId !== valuationCase.valuationCaseId
  ) {
    throw constructionError('PARENT_BINDING_MISMATCH');
  }

  const inventoryEntry = index.content.entries.find(
    (entry) => entry.tradeId === inventory.content.tradeId
  );
  const evidenceEntry = evidenceIndex.content.entries.find(
    (entry) => entry.tradeId === inventory.content.tradeId
  );
  if (
    inventoryEntry === undefined ||
    evidenceEntry === undefined ||
    inventoryEntry.valuationCaseId !== valuationCase.valuationCaseId ||
    inventoryEntry.valuationOutputInventoryId !== inventory.valuationOutputInventoryId ||
    !sameCanonicalJson(inventoryEntry.inventoryArtifactRef, inventoryRef) ||
    !sameCanonicalJson(inventory.content.valuationCase.artifactRef, valuationCaseRef) ||
    evidenceEntry.valuationCaseId !== valuationCase.valuationCaseId ||
    evidenceEntry.valuationCalculationId !==
      inventory.content.valuationCalculation.valuationCalculationId ||
    evidenceEntry.valuationOutputInventoryId !== inventory.valuationOutputInventoryId ||
    evidenceEntry.projectionPublicEvidenceId !== evidence.projectionPublicEvidenceId ||
    !sameCanonicalJson(evidenceEntry.evidenceArtifactRef, evidenceRef) ||
    !sameCanonicalJson(evidenceEntry.inventoryArtifactRef, inventoryRef)
  ) {
    throw constructionError('PARENT_BINDING_MISMATCH');
  }

  const expectedEvidenceViewContexts = valuationCase.content.viewContexts.map(
    ({ view, effectiveAt, knowledgeCutoffAt, valuationAsOf }) => ({
      view,
      temporalContext: { effectiveAt, knowledgeCutoffAt, valuationAsOf },
    })
  );
  if (
    evidence.content.publicationId !== publication.publicationId ||
    evidence.content.valuationBundleId !== publication.content.valuationBundleId ||
    evidence.content.valuationOutputInventoryIndexId !== index.valuationOutputInventoryIndexId ||
    evidence.content.valuationOutputInventoryId !== inventory.valuationOutputInventoryId ||
    evidence.content.valuationCaseId !== valuationCase.valuationCaseId ||
    evidence.content.valuationCalculationId !==
      inventory.content.valuationCalculation.valuationCalculationId ||
    evidence.content.tradeId !== valuationCase.content.tradeId ||
    inventory.content.tradeId !== valuationCase.content.tradeId ||
    evidence.content.scopeKey !== publication.content.scopeKey ||
    evidence.content.valueUnitId !== publication.content.valueUnitId ||
    evidence.content.valueUnitId !== inventory.content.valueUnitId ||
    evidence.content.valueUnitId !== valuationCase.content.valueUnitId ||
    policy.content.valueUnit.id !== evidence.content.valueUnitId ||
    !sameCanonicalJson(evidence.content.viewContexts, expectedEvidenceViewContexts)
  ) {
    throw constructionError('PARENT_BINDING_MISMATCH');
  }

  const boundaries = [
    publication.content.publicAssetBoundary,
    index.content.publicAssetBoundary,
    evidenceIndex.content.publicAssetBoundary,
    policy.content.publicAssetBoundary,
    inventory.content.publicAssetBoundary,
    valuationCase.content.publicAssetBoundary,
    evidence.content.publicAssetBoundary,
  ];
  if (boundaries.some((boundary) => boundary !== AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY)) {
    throw constructionError('PUBLIC_ASSET_BOUNDARY_MISMATCH');
  }

  if (
    !sameCanonicalJson(
      input.evidenceSourceVerification.projectionPublicEvidenceResult,
      input.projectionPublicEvidence
    ) ||
    !verifyAflTradeProjectionEvidenceSourceVerification(input.evidenceSourceVerification)
  ) {
    throw constructionError('INVALID_SOURCE_VERIFICATION_REPLAY');
  }
  const verification =
    input.evidenceSourceVerification.output.projectionEvidenceSourceVerification.content;
  if (verification.status !== 'passed' || verification.observedFailureCount !== 0) {
    throw constructionError('SOURCE_VERIFICATION_NOT_PASSED');
  }

  const selectedDistributions = authenticateSelectedDistributions(input);
  const selectedComparisons = authenticateSelectedComparisons(input);
  const numericBytes = [
    ...input.selectedDistributions.map(({ artifactRef }) => artifactRef.byteLength),
    ...input.selectedComparisons.map(({ artifactRef }) => artifactRef.byteLength),
  ].reduce((sum, byteLength) => sum + byteLength, 0);
  if (numericBytes > AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_NUMERIC_ARTIFACT_BYTES) {
    throw constructionError('AGGREGATE_NUMERIC_SIZE_LIMIT_EXCEEDED');
  }

  const materializedAt = Date.parse(input.materializedAt);
  const references = [
    publicationRef,
    indexRef,
    evidenceIndexRef,
    policyRef,
    inventoryRef,
    valuationCaseRef,
    evidenceRef,
    input.evidenceSourceVerification.output.projectionEvidenceSourceVerificationArtifactRef,
    ...(custodiedAssessment === null
      ? []
      : [custodiedAssessment.assessmentArtifactRef, custodiedAssessment.custodyIndexArtifactRef]),
    ...input.selectedDistributions.map(({ artifactRef }) => artifactRef),
    ...input.selectedComparisons.map(({ artifactRef }) => artifactRef),
  ];
  if (references.some((reference) => Date.parse(reference.createdAt) > materializedAt)) {
    throw constructionError('NON_MONOTONIC_ARTIFACT_TIME');
  }

  return {
    input,
    publication,
    valuationCase,
    completeTradeAssessment: custodiedAssessment?.assessment ?? null,
    completeTradeAssessmentArtifactRef: custodiedAssessment?.assessmentArtifactRef ?? null,
    custodyIndexArtifactRef: custodiedAssessment?.custodyIndexArtifactRef ?? null,
    selectedDistributions: selectedDistributions.artifacts,
    selectedComparisons: selectedComparisons.artifacts,
    distributionSetSha256: selectedDistributions.setSha256,
    comparisonSetSha256: selectedComparisons.setSha256,
  };
}

function completeDistributionParts(distribution: AflTradeValuationDistribution) {
  const result = distribution.content.distribution;
  if (result.status !== 'complete') throw constructionError('INCOMPLETE_NUMERIC_INPUT');
  return {
    estimate: result.statistics.mean,
    uncertainty: {
      lower: result.statistics.centralInterval.lower,
      median: result.statistics.median,
      upper: result.statistics.centralInterval.upper,
      intervalLevel: result.statistics.centralInterval.level,
    },
    distribution: {
      downside: result.statistics.downside,
      upside: result.statistics.upside,
      lowReturn: {
        threshold: result.policy.lowReturnEvent.threshold,
        probability: result.eventProbabilities.lowReturnProbability,
      },
      eliteOutcome: {
        threshold: result.policy.eliteOutcomeEvent.threshold,
        probability: result.eventProbabilities.eliteOutcomeProbability,
      },
    },
  };
}

function evidenceReplayForPolicy(input: AflTradeProjectionTradeMaterializerCreateInput): {
  sourceArtifacts: AflTradeProjectionTradeMaterializerCreateInput['evidenceSourceVerification']['sourceArtifacts'];
  verifiedAt: string;
  output: AflTradeProjectionTradeMaterializerCreateInput['evidenceSourceVerification']['output'];
} {
  return {
    sourceArtifacts: input.evidenceSourceVerification.sourceArtifacts,
    verifiedAt: input.evidenceSourceVerification.verifiedAt,
    output: input.evidenceSourceVerification.output,
  };
}

function comparisonForView(
  authenticated: AuthenticatedTradeInputs,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number]
): AflTradeValuationComparison {
  const comparison = authenticated.selectedComparisons.find(
    (candidate) => candidate.content.viewContext.view === view
  );
  if (comparison === undefined) throw constructionError('INCOMPLETE_NUMERIC_INPUT');
  return comparison;
}

function distributionsForView(
  authenticated: AuthenticatedTradeInputs,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number]
): AflTradeValuationDistribution[] {
  return authenticated.selectedDistributions.filter(
    (candidate) => candidate.content.viewContext.view === view
  );
}

function distributionForSubject(
  authenticated: AuthenticatedTradeInputs,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number],
  subject: AflTradeValuationDistributionSubject
): AflTradeValuationDistribution {
  const key = subjectKey(subject);
  const distribution = authenticated.selectedDistributions.find(
    (candidate) =>
      candidate.content.viewContext.view === view && subjectKey(candidate.content.subject) === key
  );
  if (distribution === undefined) throw constructionError('INCOMPLETE_NUMERIC_INPUT');
  return distribution;
}

function expectedDistributionSubjects(
  authenticated: AuthenticatedTradeInputs
): AflTradeValuationDistributionSubject[] {
  return authenticated.valuationCase.content.parties.flatMap((party) => [
    { kind: 'afl_club_received_package' as const, aflClubId: party.aflClubId },
    ...party.receivedRootAssetIds.map((rootAssetId) => ({
      kind: 'source_native_afl_trade_root' as const,
      aflClubId: party.aflClubId,
      rootAssetId,
    })),
  ]);
}

function assertCompleteCoordinateLattice(authenticated: AuthenticatedTradeInputs): void {
  const expectedSubjects = expectedDistributionSubjects(authenticated);
  const expectedKeys = expectedSubjects.map(subjectKey);
  const evidence = authenticated.input.projectionPublicEvidence.projectionPublicEvidence.content;
  const expectedAssets = expectedSubjects
    .filter((subject) => subject.kind === 'source_native_afl_trade_root')
    .map((subject) => ({ assetId: subject.rootAssetId, receivedByAflClubId: subject.aflClubId }))
    .sort((left, right) => compareAflTradeCodeUnits(left.assetId, right.assetId));
  const evidenceAssets = evidence.assets.map(({ assetId, receivedByAflClubId }) => ({
    assetId,
    receivedByAflClubId,
  }));
  if (!sameCanonicalJson(expectedAssets, evidenceAssets)) {
    throw constructionError('PARENT_BINDING_MISMATCH');
  }
  for (const view of AFL_TRADE_VALUATION_VIEWS) {
    const distributions = distributionsForView(authenticated, view);
    const actualKeys = distributions.map(({ content }) => subjectKey(content.subject));
    if (
      actualKeys.length !== expectedKeys.length ||
      new Set(actualKeys).size !== actualKeys.length ||
      expectedKeys.some((key) => !actualKeys.includes(key))
    ) {
      throw constructionError('INCOMPLETE_NUMERIC_INPUT');
    }
  }
}

function eligibilityForView(
  authenticated: AuthenticatedTradeInputs,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number]
) {
  const input = authenticated.input;
  const evidence = input.projectionPublicEvidence.projectionPublicEvidence.content;
  const identityEvidenceResolved = evidence.assets.every(
    (asset) => asset.assetKind !== 'unresolved'
  );
  const lineageAttributionResolved = evidence.assets.every(
    (asset) => asset.lineage.status === 'resolved'
  );
  const replay = evidenceReplayForPolicy(input);
  const requiredDistributionViews =
    view === 'current' ? (['realized', 'remaining', 'current'] as const) : [view];
  const distributionsComplete = (kind: AflTradeValuationDistributionSubject['kind']) =>
    requiredDistributionViews.every((requiredView) =>
      distributionsForView(authenticated, requiredView)
        .filter(({ content }) => content.subject.kind === kind)
        .every(({ content }) => content.distribution.status === 'complete')
    );
  return evaluateAflTradeProjectionPublicationEligibility({
    policy: input.projectionPresentationPolicy.projectionPresentationPolicy,
    view,
    projectionPublicEvidence: input.projectionPublicEvidence,
    evidenceSourceVerification: replay,
    predicateFacts: {
      assetCoverageComplete:
        evidence.coverageByView.find((candidate) => candidate.view === view)?.status === 'complete',
      identityEvidenceResolved,
      lineageAttributionResolved,
      packageDistributionComplete: distributionsComplete('afl_club_received_package'),
      rootDistributionComplete: distributionsComplete('source_native_afl_trade_root'),
      selectedComparisonAvailable:
        comparisonForView(authenticated, view).content.comparison.status === 'available',
    },
  });
}

function viewGlobalFactorsFor(
  authenticated: AuthenticatedTradeInputs,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number]
) {
  const input = authenticated.input;
  const factors = selectAflTradeProjectionPublicFactors({
    view,
    projectionPublicEvidence: input.projectionPublicEvidence,
    evidenceSourceVerification: evidenceReplayForPolicy(input),
  });
  if (
    factors.canRepeatIntoPerSubjectFactors ||
    factors.perClubFactors.length !== 0 ||
    factors.perAssetFactors.length !== 0
  ) {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  return { view, factors: factors.viewGlobalFactors };
}

function createValueForView(
  authenticated: AuthenticatedTradeInputs,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number]
): AflTradeValueResult {
  const input = authenticated.input;
  const policy = input.projectionPresentationPolicy.projectionPresentationPolicy;
  const eligibility = eligibilityForView(authenticated, view);
  if (eligibility.status === 'ineligible') {
    return createAflTradeProjectionFailClosedValue({
      policy,
      cause: eligibility.failureCause,
      view,
    });
  }
  const evidence = input.projectionPublicEvidence.projectionPublicEvidence.content;
  const evidenceConfidence = evidence.confidenceByView.find((candidate) => candidate.view === view);
  const evidenceCoverage = evidence.coverageByView.find((candidate) => candidate.view === view);
  const viewContext = authenticated.valuationCase.content.viewContexts.find(
    (candidate) => candidate.view === view
  );
  const comparisonArtifact = comparisonForView(authenticated, view);
  const comparison = comparisonArtifact.content.comparison;
  if (
    evidenceConfidence === undefined ||
    evidenceCoverage?.status !== 'complete' ||
    viewContext === undefined ||
    comparison.status !== 'available'
  ) {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  const uncertaintyComponents = selectAflTradeProjectionUncertaintyComponents({ policy });
  const confidence = {
    level: evidenceConfidence.overallLevel,
    dimensions: evidenceConfidence.dimensions.map((dimension) => ({
      kind: dimension.dimension,
      level: dimension.level,
      reasonCode: dimension.reasonCode,
      explanation: dimension.explanation,
    })),
  };
  const completeAssessmentParties =
    authenticated.completeTradeAssessment?.content.partyAssessments ?? null;
  const completeAssessmentByClub =
    completeAssessmentParties === null
      ? null
      : new Map(completeAssessmentParties.map((party) => [party.clubId, party] as const));
  const completeAssessmentProbabilities =
    completeAssessmentParties === null
      ? null
      : completeAssessmentParties.map((party) => {
          const partyView = party.views.find((candidate) => candidate.view === view);
          if (partyView === undefined) {
            throw constructionError('PARENT_BINDING_MISMATCH');
          }
          return { aflClubId: party.clubId, probability: partyView.finishAheadProbability };
        });
  const probabilities =
    completeAssessmentProbabilities === null
      ? comparison.probabilities
      : {
          clubClearLeaderProbabilities: completeAssessmentProbabilities,
          noClearLeaderProbability: 0,
        };
  const assessment = evaluateAflTradeProjectionAssessment({
    policy,
    comparisonProbabilities: probabilities,
  });
  const clubValues = comparison.aflClubIds.map((aflClubId) => {
    const party = authenticated.valuationCase.content.parties.find(
      (candidate) => candidate.aflClubId === aflClubId
    );
    if (party === undefined) throw constructionError('PARENT_BINDING_MISMATCH');
    const parts = completeDistributionParts(
      distributionForSubject(authenticated, view, {
        kind: 'afl_club_received_package',
        aflClubId,
      })
    );
    const completeAssessmentParty = completeAssessmentByClub?.get(aflClubId) ?? null;
    const completeAssessmentView = completeAssessmentParty?.views.find(
      (candidate) => candidate.view === view
    );
    if (
      completeAssessmentByClub !== null &&
      (completeAssessmentParty === null || completeAssessmentView === undefined)
    ) {
      throw constructionError('PARENT_BINDING_MISMATCH');
    }
    return {
      aflClubId,
      clubName: party.clubName,
      estimate: parts.estimate,
      estimateStatistic: 'mean' as const,
      uncertainty: { ...parts.uncertainty, components: uncertaintyComponents },
      distribution: parts.distribution,
      factors: [],
      ...(completeAssessmentView === undefined
        ? {}
        : {
            packageValue: {
              received: {
                median: completeAssessmentView.received.median,
                interval: {
                  lower: completeAssessmentView.received.p10,
                  upper: completeAssessmentView.received.p90,
                },
              },
              givenUp: {
                median: completeAssessmentView.givenUp.median,
                interval: {
                  lower: completeAssessmentView.givenUp.p10,
                  upper: completeAssessmentView.givenUp.p90,
                },
              },
              net: {
                median: completeAssessmentView.netAdvantage.median,
                interval: {
                  lower: completeAssessmentView.netAdvantage.p10,
                  upper: completeAssessmentView.netAdvantage.p90,
                },
              },
            },
          }),
    };
  });
  return {
    availability: 'available',
    view,
    modelVintage: viewContext.modelVintage,
    temporalContext: {
      effectiveAt: viewContext.effectiveAt,
      knowledgeCutoffAt: viewContext.knowledgeCutoffAt,
      valuationAsOf: viewContext.valuationAsOf,
    },
    unit: policy.content.valueUnit,
    clubValues,
    comparison: {
      basis: 'complete_trade',
      aflClubIds: comparison.aflClubIds,
      probabilities: probabilities.clubClearLeaderProbabilities.map(
        ({ aflClubId, probability }) => ({ aflClubId, finishesAhead: probability })
      ),
      practicalEquivalenceProbability: probabilities.noClearLeaderProbability,
    },
    assessment,
    confidence,
    coverage: {
      totalAssetCount: evidenceCoverage.totalAssetCount,
      valuedAssetCount: evidenceCoverage.valuedAssetCount,
      excludedAssetCount: 0,
      coverageRatio: 1,
      excludedAssets: [],
    },
    warnings: [],
    methodologyHref: policy.content.methodologyHref,
  };
}

function assertCurrentIdentityForEligibleView(
  authenticated: AuthenticatedTradeInputs,
  values: readonly AflTradeValueResult[]
): void {
  if (values.find(({ view }) => view === 'current')?.availability !== 'available') return;
  for (const subject of expectedDistributionSubjects(authenticated)) {
    const current = completeDistributionParts(
      distributionForSubject(authenticated, 'current', subject)
    ).estimate;
    const realized = completeDistributionParts(
      distributionForSubject(authenticated, 'realized', subject)
    ).estimate;
    const remaining = completeDistributionParts(
      distributionForSubject(authenticated, 'remaining', subject)
    ).estimate;
    if (Math.abs(current - (realized + remaining)) > 1e-9) {
      throw constructionError('CURRENT_IDENTITY_MISMATCH');
    }
  }
}

function assetValueForView(
  authenticated: AuthenticatedTradeInputs,
  asset: AuthenticatedTradeInputs['input']['projectionPublicEvidence']['projectionPublicEvidence']['content']['assets'][number],
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number]
) {
  const policy = authenticated.input.projectionPresentationPolicy.projectionPresentationPolicy;
  const parts = completeDistributionParts(
    distributionForSubject(authenticated, view, {
      kind: 'source_native_afl_trade_root',
      aflClubId: asset.receivedByAflClubId,
      rootAssetId: asset.assetId,
    })
  );
  const uncertaintyComponents = selectAflTradeProjectionUncertaintyComponents({ policy });
  const currentComponents =
    view === 'current'
      ? {
          realizedValue: completeDistributionParts(
            distributionForSubject(authenticated, 'realized', {
              kind: 'source_native_afl_trade_root',
              aflClubId: asset.receivedByAflClubId,
              rootAssetId: asset.assetId,
            })
          ).estimate,
          remainingValue: completeDistributionParts(
            distributionForSubject(authenticated, 'remaining', {
              kind: 'source_native_afl_trade_root',
              aflClubId: asset.receivedByAflClubId,
              rootAssetId: asset.assetId,
            })
          ).estimate,
        }
      : null;
  return {
    status: 'valued' as const,
    view,
    estimate: parts.estimate,
    estimateStatistic: 'mean' as const,
    uncertainty: { ...parts.uncertainty, components: uncertaintyComponents },
    distribution: parts.distribution,
    factors: [],
    currentComponents,
  };
}

function createAssets(
  authenticated: AuthenticatedTradeInputs,
  values: readonly AflTradeValueResult[]
): AflTradeAssetBreakdown[] {
  const availableValues = values.filter(
    (value): value is Extract<AflTradeValueResult, { availability: 'available' }> =>
      value.availability === 'available'
  );
  if (availableValues.length === 0) return [];
  return authenticated.input.projectionPublicEvidence.projectionPublicEvidence.content.assets.map(
    (asset) => ({
      assetId: asset.assetId,
      assetKind: asset.assetKind,
      label: asset.label,
      receivedByAflClubId: asset.receivedByAflClubId,
      lineage: {
        status: asset.lineage.status,
        rootAssetId: asset.lineage.rootAssetId,
        creditedAssetIds: asset.lineage.creditedAssetIds,
        summary: asset.lineage.summary,
      },
      values: availableValues.map((value) => assetValueForView(authenticated, asset, value.view)),
    })
  );
}

function createLineageSummary(
  authenticated: AuthenticatedTradeInputs,
  values: readonly AflTradeValueResult[]
): AflTradeLineageSummary {
  if (values.every(({ availability }) => availability !== 'available')) {
    return {
      status: 'unavailable',
      totalAssetCount: null,
      resolvedAssetCount: null,
      unresolvedAssetCount: null,
      lineageEdgeCount: null,
      maximumDepth: null,
    };
  }
  const assets =
    authenticated.input.projectionPublicEvidence.projectionPublicEvidence.content.assets;
  const resolvedAssetCount = assets.filter((asset) => asset.lineage.status === 'resolved').length;
  const unresolvedAssetCount = assets.length - resolvedAssetCount;
  const lineageEdgeCount = assets.reduce((sum, asset) => sum + asset.lineage.edgeCount, 0);
  const maximumDepth = Math.max(...assets.map((asset) => asset.lineage.maximumDepth));
  if (unresolvedAssetCount === 0) {
    return {
      status: 'resolved',
      totalAssetCount: assets.length,
      resolvedAssetCount,
      unresolvedAssetCount: 0,
      lineageEdgeCount,
      maximumDepth,
    };
  }
  return {
    status: 'partial',
    totalAssetCount: assets.length,
    resolvedAssetCount,
    unresolvedAssetCount,
    lineageEdgeCount,
    maximumDepth,
  };
}

function summaryFromValue(value: AflTradeValueResult): AflTradeValueSummary {
  if (value.availability === 'available_partial') {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  if (value.availability !== 'available') {
    const summary = aflTradeValueSummarySchema.safeParse(value);
    if (!summary.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return summary.data;
  }
  return {
    availability: 'available',
    view: value.view,
    modelVintage: value.modelVintage,
    unit: value.unit,
    clubValues: value.clubValues.map((club) => {
      const probability = value.comparison.probabilities.find(
        (candidate) => candidate.aflClubId === club.aflClubId
      );
      if (probability === undefined) {
        throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
      }
      return {
        aflClubId: club.aflClubId,
        clubName: club.clubName,
        expectedValue: club.estimate,
        medianValue: club.uncertainty.median,
        interval: {
          lower: club.uncertainty.lower,
          upper: club.uncertainty.upper,
          level: club.uncertainty.intervalLevel,
        },
        finishesAheadProbability: probability.finishesAhead,
        ...(club.packageValue === undefined ? {} : { packageValue: club.packageValue }),
      };
    }),
    practicalEquivalenceProbability: value.comparison.practicalEquivalenceProbability,
    comparisonBasis: value.comparison.basis,
    assessment: value.assessment,
    confidence: value.confidence,
    coverage: { status: 'complete', coverageRatio: 1, excludedAssetCount: 0 },
    warnings: value.warnings,
    methodologyHref: value.methodologyHref,
  };
}

function createDocuments(
  authenticated: AuthenticatedTradeInputs
): AflTradeProjectionDocumentArtifact[] {
  const input = authenticated.input;
  const publication = authenticated.publication;
  const inventoryIndex = input.valuationOutputInventoryIndex.valuationOutputInventoryIndex;
  const evidence = input.projectionPublicEvidence.projectionPublicEvidence.content;
  const currentContext = authenticated.valuationCase.content.viewContexts.find(
    ({ view }) => view === 'current'
  );
  if (currentContext === undefined) {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  const common = {
    schemaVersion: AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
    publicationId: publication.publicationId,
    valuationBundleId: publication.content.valuationBundleId,
    valuationOutputInventoryIndexId: inventoryIndex.valuationOutputInventoryIndexId,
    scopeKey: publication.content.scopeKey,
    valueUnitId: publication.content.valueUnitId,
    calculationAsOf: currentContext.valuationAsOf,
    knowledgeCutoffAt: currentContext.knowledgeCutoffAt,
  };
  const values = AFL_TRADE_VALUATION_VIEWS.map((view) => createValueForView(authenticated, view));
  assertCurrentIdentityForEligibleView(authenticated, values);
  const viewGlobalFactors = AFL_TRADE_VALUATION_VIEWS.map((view) =>
    viewGlobalFactorsFor(authenticated, view)
  );
  const detail = createAflTradeProjectionDocumentArtifact({
    content: {
      ...common,
      kind: 'trade_detail',
      tradeId: evidence.tradeId,
      valuations: values,
      viewGlobalFactors,
      assets: createAssets(authenticated, values),
      lineageSummary: createLineageSummary(authenticated, values),
    },
    materializedAt: input.materializedAt,
  });
  const summaries = values.map((value, index) => {
    const summary = summaryFromValue(value);
    const factors = viewGlobalFactors[index];
    if (factors === undefined || factors.view !== summary.view) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    return createAflTradeProjectionDocumentArtifact({
      content: {
        ...common,
        kind: 'trade_summary',
        tradeId: evidence.tradeId,
        view: summary.view,
        valuation: summary,
        viewGlobalFactors: factors,
      },
      materializedAt: input.materializedAt,
    });
  });
  const exports = summaries.flatMap((summaryArtifact, viewIndex) => {
    const summaryDocument = summaryArtifact.projectionDocument.content;
    const detailedValue = values[viewIndex];
    const factors = viewGlobalFactors[viewIndex];
    if (
      summaryDocument.kind !== 'trade_summary' ||
      detailedValue === undefined ||
      factors === undefined ||
      detailedValue.view !== summaryDocument.view ||
      factors.view !== summaryDocument.view
    ) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const clubValues =
      'clubValues' in summaryDocument.valuation ? summaryDocument.valuation.clubValues : [null];
    return clubValues.map((clubValue, rowOrdinal) => {
      const detailedClubValue =
        clubValue === null || detailedValue.availability !== 'available'
          ? null
          : detailedValue.clubValues[rowOrdinal];
      if (
        (clubValue === null) !== (detailedClubValue === null) ||
        (clubValue !== null && detailedClubValue?.aflClubId !== clubValue.aflClubId)
      ) {
        throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
      }
      return createAflTradeProjectionDocumentArtifact({
        content: {
          ...common,
          kind: 'valuation_export_row',
          viewGlobalFactors: rowOrdinal === 0 ? factors : null,
          exportRow: {
            rowSchemaVersion: 'afl-trade-valuation-export-row/v1',
            rowOrdinal,
            tradeId: evidence.tradeId,
            view: summaryDocument.view,
            valuation: summaryDocument.valuation,
            clubValue,
            selectedClubOutcome:
              detailedClubValue === null
                ? null
                : {
                    aflClubId: detailedClubValue.aflClubId,
                    distribution: detailedClubValue.distribution,
                  },
          },
        },
        materializedAt: input.materializedAt,
      });
    });
  });
  const documents = [detail, ...summaries, ...exports];
  if (
    documents.length > AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_DOCUMENTS ||
    documents.some(
      ({ projectionDocumentArtifactRef }) =>
        projectionDocumentArtifactRef.byteLength > AFL_TRADE_PROJECTION_DOCUMENT_MAX_BYTES
    )
  ) {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  return documents;
}

function createReceipt(
  authenticated: AuthenticatedTradeInputs,
  documents: readonly AflTradeProjectionDocumentArtifact[]
): AflTradeProjectionTradeMaterialization {
  const input = authenticated.input;
  const publication = authenticated.publication;
  const inventoryIndex = input.valuationOutputInventoryIndex.valuationOutputInventoryIndex;
  const evidenceIndex = input.projectionPublicEvidenceIndex.projectionPublicEvidenceIndex;
  const policy = input.projectionPresentationPolicy.projectionPresentationPolicy;
  const inventory = input.valuationOutputInventory.valuationOutputInventory;
  const evidence = input.projectionPublicEvidence.projectionPublicEvidence;
  const verificationResult = input.evidenceSourceVerification.output;
  const verification = verificationResult.projectionEvidenceSourceVerification;
  const currentContext = authenticated.valuationCase.content.viewContexts.find(
    ({ view }) => view === 'current'
  );
  if (currentContext === undefined) {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  const documentBindings = documents.map(documentBindingFor);
  const content = {
    schemaVersion: AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
    definition: AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_DEFINITION,
    publication: {
      semanticId: publication.publicationId,
      artifactRef: input.publication.artifactRef,
    },
    valuationOutputInventoryIndex: {
      semanticId: inventoryIndex.valuationOutputInventoryIndexId,
      artifactRef: input.valuationOutputInventoryIndex.valuationOutputInventoryIndexArtifactRef,
    },
    projectionPublicEvidenceIndex: {
      semanticId: evidenceIndex.projectionPublicEvidenceIndexId,
      artifactRef: input.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexArtifactRef,
    },
    projectionPresentationPolicy: {
      semanticId: policy.projectionPresentationPolicyId,
      artifactRef: input.projectionPresentationPolicy.projectionPresentationPolicyArtifactRef,
    },
    valuationOutputInventory: {
      semanticId: inventory.valuationOutputInventoryId,
      artifactRef: input.valuationOutputInventory.valuationOutputInventoryArtifactRef,
    },
    valuationCase: {
      semanticId: authenticated.valuationCase.valuationCaseId,
      artifactRef: input.valuationCase.artifactRef,
    },
    projectionPublicEvidence: {
      semanticId: evidence.projectionPublicEvidenceId,
      artifactRef: input.projectionPublicEvidence.projectionPublicEvidenceArtifactRef,
    },
    evidenceSourceVerification: {
      semanticId: verification.projectionEvidenceSourceVerificationId,
      artifactRef: verificationResult.projectionEvidenceSourceVerificationArtifactRef,
      status: 'passed' as const,
      sourceArtifactSetSha256: verification.content.sourceArtifactSetSha256,
    },
    ...(authenticated.completeTradeAssessment === null ||
    authenticated.completeTradeAssessmentArtifactRef === null
      ? {}
      : {
          completeTradeAssessment: {
            semanticId: authenticated.completeTradeAssessment.assessmentId,
            artifactRef: authenticated.completeTradeAssessmentArtifactRef,
          },
        }),
    tradeId: evidence.content.tradeId,
    scopeKey: publication.content.scopeKey,
    valueUnitId: publication.content.valueUnitId,
    calculationAsOf: currentContext.valuationAsOf,
    knowledgeCutoffAt: currentContext.knowledgeCutoffAt,
    selectedNumericSet: {
      distributionCount: authenticated.selectedDistributions.length,
      distributionSetSha256: authenticated.distributionSetSha256,
      comparisonCount: AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_SELECTED_COMPARISON_COUNT,
      comparisonSetSha256: authenticated.comparisonSetSha256,
      digestDefinition: AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_NUMERIC_DIGEST_DEFINITION,
    },
    documentDigestDefinition: AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_DOCUMENT_DIGEST_DEFINITION,
    documentCount: documentBindings.length,
    documentSetSha256: sha256AflTradeCanonicalJson(documentBindings),
    documents: documentBindings,
    materializedAt: input.materializedAt,
    limitation: AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_LIMITATION,
  };
  return aflTradeProjectionTradeMaterializationSchema.parse({
    projectionTradeMaterializationId: createAflTradeContentAddress(
      'projection-trade-materialization',
      content
    ),
    content,
  });
}

export function createAflTradeProjectionTradeMaterialization(
  unparsedInput: unknown
): AflTradeProjectionTradeMaterializationResult {
  try {
    const snapshot = snapshotExactEnvelope(unparsedInput, [
      CREATE_INPUT_KEYS,
      CUSTODIED_CREATE_INPUT_KEYS,
    ]);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');
    const input = parseCreateInput(snapshot);
    const authenticated = authenticateParents(input);
    assertCompleteCoordinateLattice(authenticated);
    const projectionDocuments = createDocuments(authenticated);
    const projectionTradeMaterialization = createReceipt(authenticated, projectionDocuments);
    const projectionTradeMaterializationArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      projectionTradeMaterialization,
      input.materializedAt
    );
    if (
      projectionTradeMaterializationArtifactRef.byteLength < 1 ||
      projectionTradeMaterializationArtifactRef.byteLength >
        AFL_TRADE_PROJECTION_TRADE_MATERIALIZATION_MAX_RECEIPT_BYTES
    ) {
      throw constructionError('RECEIPT_SIZE_LIMIT_EXCEEDED');
    }
    const result = aflTradeProjectionTradeMaterializationResultSchema.safeParse({
      projectionDocuments,
      projectionTradeMaterialization,
      projectionTradeMaterializationArtifactRef,
    });
    if (!result.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeProjectionTradeMaterializationError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

export function verifyAflTradeProjectionTradeMaterialization(input: unknown): boolean {
  try {
    const snapshot = snapshotExactEnvelope(input, [VERIFY_INPUT_KEYS, CUSTODIED_VERIFY_INPUT_KEYS]);
    if (snapshot === null) return false;
    const output = aflTradeProjectionTradeMaterializationResultSchema.safeParse(snapshot.output);
    if (!output.success) return false;
    const replayKeys =
      snapshot.completeTradeAssessmentVerification === undefined
        ? CREATE_INPUT_KEYS
        : CUSTODIED_CREATE_INPUT_KEYS;
    const replayed = createAflTradeProjectionTradeMaterialization(
      Object.fromEntries(replayKeys.map((key) => [key, snapshot[key]]))
    );
    return canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(output.data);
  } catch {
    return false;
  }
}
