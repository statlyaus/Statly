import { types as nodeUtilTypes } from 'node:util';

import { z } from 'zod';

import { aflTradeIsoDateTimeSchema, aflTradePublicIdSchema } from '@/types/aflTradeIntelligence';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
  aflTradeProjectionMaterializationBindingSchema,
  aflTradeProjectionDocumentSchema,
  type AflTradeProjectionDocumentArtifact,
  verifyAflTradeProjectionDocumentArtifact,
} from './projectionDocumentContracts';
import {
  AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS,
  AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_ROOT_BYTES,
  AFL_TRADE_PROJECTION_DOCUMENT_SET_SCHEMA_VERSION,
  aflTradeProjectionDocumentSetSchema,
  aflTradeProjectionDocumentSetShardArtifactSchema,
  aflTradeProjectionDocumentSetResultSchema,
  aflTradeProjectionDocumentSetVerifyInputSchema,
  verifyAflTradeProjectionDocumentSet,
  type AflTradeProjectionDocumentSetBinding,
  type AflTradeProjectionDocumentSetResult,
} from './projectionDocumentSet';
import {
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_SCHEMA_VERSION,
  aflTradeProjectionPresentationPolicyResultSchema,
  type AflTradeProjectionPresentationPolicyResult,
} from './projectionPresentationPolicy';
import {
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION,
  aflTradeProjectionPublicEvidenceIndexResultSchema,
  type AflTradeProjectionPublicEvidenceIndexResult,
} from './projectionPublicEvidenceIndex';
import {
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_SCHEMA_VERSION,
  aflTradeAnyProjectionSchemaBundleResultSchema,
  type AflTradeAnyProjectionSchemaBundleResult,
} from './projectionSchemaBundle';

export const AFL_TRADE_PROJECTION_PARITY_REPORT_SCHEMA_VERSION =
  'afl-trade-projection-parity-report/v1' as const;
export const AFL_TRADE_PROJECTION_PARITY_REPORT_PUBLIC_ASSET_BOUNDARY =
  AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY;
export const AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_FAILURE_DETAILS = 1_000;
export const AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_ARTIFACT_BYTES = 1024 * 1024;
/**
 * Bounds the authenticated canonical bytes materialized by one in-memory parity operation. The
 * document-set root and shards, expected documents, and stored documents all count because Zod
 * snapshots them independently. Larger sets must be compared through a future bounded
 * repository/streaming boundary rather than expanded in this process. The nested aggregate
 * materialization has its own separately enforced 64 MiB replay budgets.
 */
export const AFL_TRADE_PROJECTION_PARITY_MAX_AGGREGATE_DOCUMENT_BYTES = 64 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_PARITY_REPORT_PREDECESSOR_COMPATIBILITY =
  'no_predecessor_no_latest_alias_no_implicit_conversion_v1' as const;
export const AFL_TRADE_PROJECTION_PARITY_REPORT_RUNTIME_FALLBACK = 'prohibited' as const;
export const AFL_TRADE_PROJECTION_PARITY_REPORT_LIMITATION =
  'Immutable deterministic comparison of stored projection artifacts against a totally replayed document-set and aggregate-materialization chain; it does not fetch omitted storage, independently prove source-rights or model-validity claims, activate publication, authorize serving or fantasy state, or establish user or fantasy ownership.' as const;

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Projection parity requires canonical JSON artifact references.'
);

/** The document contract exposes this exact result envelope through its creator and total verifier. */
export const aflTradeProjectionParityDocumentArtifactSchema = z
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
        message: 'Projection document result must satisfy its exact artifact contract.',
      });
    }
  });

const projectionDocumentsSchema = z
  .array(aflTradeProjectionParityDocumentArtifactSchema)
  .max(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS);

export const aflTradeProjectionParityCreateInputSchema = z
  .object({
    projectionPresentationPolicy: aflTradeProjectionPresentationPolicyResultSchema,
    projectionPublicEvidenceIndex: aflTradeProjectionPublicEvidenceIndexResultSchema,
    projectionSchemaBundle: aflTradeAnyProjectionSchemaBundleResultSchema,
    projectionDocumentSetVerification: aflTradeProjectionDocumentSetVerifyInputSchema,
    storedDocuments: projectionDocumentsSchema,
    checkedAt: aflTradeIsoDateTimeSchema,
  })
  .strict();

export type AflTradeProjectionParityCreateInput = z.infer<
  typeof aflTradeProjectionParityCreateInputSchema
>;

export const AFL_TRADE_PROJECTION_PARITY_FAILURE_CODES = Object.freeze([
  'parent_publication_mismatch',
  'parent_inventory_index_mismatch',
  'parent_trade_count_mismatch',
  'parent_trade_universe_mismatch',
  'parent_scope_mismatch',
  'parent_value_unit_mismatch',
  'parent_materialization_mismatch',
  'parent_chronology_invalid',
  'expected_document_count_mismatch',
  'expected_document_id_duplicate',
  'expected_document_artifact_duplicate',
  'expected_document_missing',
  'expected_document_order_mismatch',
  'expected_document_artifact_mismatch',
  'expected_document_coordinate_mismatch',
  'expected_document_parent_mismatch',
  'expected_document_chronology_invalid',
  'stored_document_count_mismatch',
  'stored_document_id_duplicate',
  'stored_document_artifact_duplicate',
  'stored_document_order_mismatch',
  'stored_document_missing',
  'stored_document_unexpected',
  'stored_document_artifact_mismatch',
  'stored_document_chronology_invalid',
] as const);

const failureCodeSchema = z.enum(AFL_TRADE_PROJECTION_PARITY_FAILURE_CODES);

export const aflTradeProjectionParityFailureDetailSchema = z
  .object({
    ordinal: z
      .number()
      .int()
      .positive()
      .max(AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_FAILURE_DETAILS),
    code: failureCodeSchema,
    projectionDocumentId: aflTradeContentAddressedIdSchema('projection-document').nullable(),
    message: z.string().trim().min(1).max(300),
  })
  .strict();

const parentBindingSchemas = {
  presentationPolicy: z
    .object({
      schemaVersion: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_SCHEMA_VERSION),
      projectionPresentationPolicyId: aflTradeContentAddressedIdSchema(
        'projection-presentation-policy'
      ),
      artifactRef: canonicalJsonArtifactRefSchema,
    })
    .strict(),
  publicEvidenceIndex: z
    .object({
      schemaVersion: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION),
      projectionPublicEvidenceIndexId: aflTradeContentAddressedIdSchema(
        'projection-public-evidence-index'
      ),
      artifactRef: canonicalJsonArtifactRefSchema,
    })
    .strict(),
  schemaBundle: z
    .object({
      schemaVersion: z.union([
        z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_SCHEMA_VERSION),
        z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_SCHEMA_VERSION),
      ]),
      projectionSchemaBundleId: aflTradeContentAddressedIdSchema('projection-schema-bundle'),
      artifactRef: canonicalJsonArtifactRefSchema,
    })
    .strict(),
  materialization: aflTradeProjectionMaterializationBindingSchema,
  documentSet: z
    .object({
      schemaVersion: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_SCHEMA_VERSION),
      projectionDocumentSetId: aflTradeContentAddressedIdSchema('projection-document-set'),
      artifactRef: canonicalJsonArtifactRefSchema,
      documentCount: z
        .number()
        .int()
        .positive()
        .max(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS),
    })
    .strict(),
} as const;

const predecessorPolicySchema = z
  .object({
    predecessorSchemaVersion: z.null(),
    compatibility: z.literal(AFL_TRADE_PROJECTION_PARITY_REPORT_PREDECESSOR_COMPATIBILITY),
    latestAlias: z.literal('prohibited'),
    runtimeFallback: z.literal(AFL_TRADE_PROJECTION_PARITY_REPORT_RUNTIME_FALLBACK),
  })
  .strict();

const AFL_TRADE_PROJECTION_PARITY_PASSED_BASE_CHECK_COUNT = 18;
const AFL_TRADE_PROJECTION_PARITY_PASSED_CHECKS_PER_DOCUMENT = 7;

export const aflTradeProjectionParityReportContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_PARITY_REPORT_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_PARITY_REPORT_PUBLIC_ASSET_BOUNDARY),
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    valuationOutputInventoryIndexId: aflTradeContentAddressedIdSchema(
      'valuation-output-inventory-index'
    ),
    scopeKey: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    presentationPolicy: parentBindingSchemas.presentationPolicy,
    publicEvidenceIndex: parentBindingSchemas.publicEvidenceIndex,
    schemaBundle: parentBindingSchemas.schemaBundle,
    materialization: parentBindingSchemas.materialization,
    documentSet: parentBindingSchemas.documentSet,
    projectionDocumentSchemaVersion: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION),
    status: z.enum(['passed', 'failed']),
    checkCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    checkedDocumentCount: z
      .number()
      .int()
      .nonnegative()
      .max(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS),
    expectedDocumentCount: z
      .number()
      .int()
      .nonnegative()
      .max(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS),
    storedDocumentCount: z
      .number()
      .int()
      .nonnegative()
      .max(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS),
    failureCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    failureDetails: z
      .array(aflTradeProjectionParityFailureDetailSchema)
      .max(AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_FAILURE_DETAILS),
    failureDetailsTruncated: z.boolean(),
    checkedAt: aflTradeIsoDateTimeSchema,
    predecessorPolicy: predecessorPolicySchema,
    limitation: z.literal(AFL_TRADE_PROJECTION_PARITY_REPORT_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.failureCount > content.checkCount) {
      context.addIssue({
        code: 'custom',
        path: ['failureCount'],
        message: 'Failure count cannot exceed the number of performed checks.',
      });
    }
    if (content.checkedDocumentCount !== content.documentSet.documentCount) {
      context.addIssue({
        code: 'custom',
        path: ['checkedDocumentCount'],
        message: 'Checked document count must equal detached document-set membership.',
      });
    }
    if (
      content.status === 'passed' &&
      (content.materialization.publicationId !== content.publicationId ||
        content.materialization.valuationOutputInventoryIndexId !==
          content.valuationOutputInventoryIndexId ||
        content.materialization.scopeKey !== content.scopeKey ||
        content.materialization.valueUnitId !== content.valueUnitId ||
        content.materialization.projectionPresentationPolicyId !==
          content.presentationPolicy.projectionPresentationPolicyId ||
        content.materialization.projectionPublicEvidenceIndexId !==
          content.publicEvidenceIndex.projectionPublicEvidenceIndexId ||
        content.materialization.projectionSchemaBundleId !==
          content.schemaBundle.projectionSchemaBundleId ||
        content.documentSet.documentCount !== content.materialization.documentCount + 1 ||
        Date.parse(content.materialization.artifactRef.createdAt) >
          Date.parse(content.documentSet.artifactRef.createdAt) ||
        Date.parse(content.documentSet.artifactRef.createdAt) > Date.parse(content.checkedAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materialization'],
        message:
          'Parity parents must bind one exact materialization-to-document-set chain with monotonic time.',
      });
    }
    const expectedDetailCount = Math.min(
      content.failureCount,
      AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_FAILURE_DETAILS
    );
    if (content.failureDetails.length !== expectedDetailCount) {
      context.addIssue({
        code: 'custom',
        path: ['failureDetails'],
        message: 'Failure details must contain the complete bounded deterministic prefix.',
      });
    }
    if (
      content.failureDetails.some((detail, index) => detail.ordinal !== index + 1) ||
      content.failureDetailsTruncated !==
        content.failureCount > AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_FAILURE_DETAILS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failureDetails'],
        message: 'Failure detail ordinals and truncation must match the total failure count.',
      });
    }
    if (
      content.failureDetails.some(
        (detail, index) =>
          index > 0 && compareFailures(content.failureDetails[index - 1], detail) > 0
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failureDetails'],
        message: 'Failure details must use deterministic canonical order.',
      });
    }
    if (
      (content.status === 'passed' && content.failureCount !== 0) ||
      (content.status === 'failed' && content.failureCount === 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Passing parity requires exactly zero failures.',
      });
    }
    if (
      content.status === 'passed' &&
      (content.expectedDocumentCount !== content.checkedDocumentCount ||
        content.storedDocumentCount !== content.checkedDocumentCount)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Passing parity requires complete expected and stored document coverage.',
      });
    }
    if (
      content.status === 'passed' &&
      content.checkCount !==
        AFL_TRADE_PROJECTION_PARITY_PASSED_BASE_CHECK_COUNT +
          content.checkedDocumentCount * AFL_TRADE_PROJECTION_PARITY_PASSED_CHECKS_PER_DOCUMENT
    ) {
      context.addIssue({
        code: 'custom',
        path: ['checkCount'],
        message: 'Passing parity must account for every defined parent and document check.',
      });
    }
  });

export const aflTradeProjectionParityReportSchema = z
  .object({
    projectionParityReportId: aflTradeContentAddressedIdSchema('projection-parity-report'),
    content: aflTradeProjectionParityReportContentSchema,
  })
  .strict()
  .superRefine((report, context) => {
    addAflTradeContentAddressIssue(
      'projection-parity-report',
      report.projectionParityReportId,
      report.content,
      context,
      ['projectionParityReportId']
    );
  });

export const aflTradeProjectionParityReportResultSchema = z
  .object({
    projectionParityReport: aflTradeProjectionParityReportSchema,
    projectionParityReportArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const reference = result.projectionParityReportArtifactRef;
    const report = result.projectionParityReport;
    if (!doesAflTradeArtifactRefMatchCanonicalJson(reference, report)) {
      context.addIssue({
        code: 'custom',
        path: ['projectionParityReportArtifactRef'],
        message: 'Parity-report artifact reference must authenticate the complete report.',
      });
    }
    if (reference.createdAt !== report.content.checkedAt) {
      context.addIssue({
        code: 'custom',
        path: ['projectionParityReportArtifactRef', 'createdAt'],
        message: 'Parity-report artifact time must equal its checked time.',
      });
    }
    if (
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_ARTIFACT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionParityReportArtifactRef', 'byteLength'],
        message: 'Projection parity report exceeds its one MiB artifact limit.',
      });
    }
  });

export type AflTradeProjectionParityFailureDetail = z.infer<
  typeof aflTradeProjectionParityFailureDetailSchema
>;
export type AflTradeProjectionParityReportContent = z.infer<
  typeof aflTradeProjectionParityReportContentSchema
>;
export type AflTradeProjectionParityReport = z.infer<typeof aflTradeProjectionParityReportSchema>;
export type AflTradeProjectionParityReportResult = z.infer<
  typeof aflTradeProjectionParityReportResultSchema
>;

export const aflTradeProjectionParityVerifyInputSchema =
  aflTradeProjectionParityCreateInputSchema.safeExtend({
    output: aflTradeProjectionParityReportResultSchema,
  });

export type AflTradeProjectionParityVerifyInput = z.infer<
  typeof aflTradeProjectionParityVerifyInputSchema
>;

interface RawFailure {
  code: (typeof AFL_TRADE_PROJECTION_PARITY_FAILURE_CODES)[number];
  projectionDocumentId: string | null;
  message: string;
}

interface ComparisonAccumulator {
  checkCount: number;
  failureCount: number;
  /** Max-heap retaining the exact canonical prefix without retaining every failure. */
  boundedFailureHeap: RawFailure[];
}

function siftFailureUp(heap: RawFailure[], startIndex: number): void {
  let index = startIndex;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (compareFailures(heap[parentIndex], heap[index]) >= 0) return;
    [heap[parentIndex], heap[index]] = [heap[index], heap[parentIndex]];
    index = parentIndex;
  }
}

function siftFailureDown(heap: RawFailure[], startIndex: number): void {
  let index = startIndex;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    let greatestIndex = index;
    if (leftIndex < heap.length && compareFailures(heap[leftIndex], heap[greatestIndex]) > 0) {
      greatestIndex = leftIndex;
    }
    if (rightIndex < heap.length && compareFailures(heap[rightIndex], heap[greatestIndex]) > 0) {
      greatestIndex = rightIndex;
    }
    if (greatestIndex === index) return;
    [heap[index], heap[greatestIndex]] = [heap[greatestIndex], heap[index]];
    index = greatestIndex;
  }
}

function retainFailurePrefix(accumulator: ComparisonAccumulator, failure: RawFailure): void {
  const heap = accumulator.boundedFailureHeap;
  if (heap.length < AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_FAILURE_DETAILS) {
    heap.push(failure);
    siftFailureUp(heap, heap.length - 1);
    return;
  }
  if (compareFailures(failure, heap[0]) >= 0) return;
  heap[0] = failure;
  siftFailureDown(heap, 0);
}

function recordCheck(
  accumulator: ComparisonAccumulator,
  passed: boolean,
  code: RawFailure['code'],
  message: string,
  projectionDocumentId: string | null = null
): void {
  accumulator.checkCount += 1;
  if (passed) return;
  accumulator.failureCount += 1;
  retainFailurePrefix(accumulator, { code, projectionDocumentId, message });
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function documentCoordinate(artifact: AflTradeProjectionDocumentArtifact): {
  kind: AflTradeProjectionDocumentSetBinding['kind'];
  tradeId: string | null;
  view: AflTradeProjectionDocumentSetBinding['view'];
  rowOrdinal: number | null;
} {
  const content = artifact.projectionDocument.content;
  if (content.kind === 'methodology') {
    return { kind: content.kind, tradeId: null, view: null, rowOrdinal: null };
  }
  if (content.kind === 'trade_detail') {
    return { kind: content.kind, tradeId: content.tradeId, view: null, rowOrdinal: null };
  }
  if (content.kind === 'trade_summary') {
    return { kind: content.kind, tradeId: content.tradeId, view: content.view, rowOrdinal: null };
  }
  return {
    kind: content.kind,
    tradeId: content.exportRow.tradeId,
    view: content.exportRow.view,
    rowOrdinal: content.exportRow.rowOrdinal,
  };
}

function documentMap(
  documents: readonly AflTradeProjectionDocumentArtifact[]
): ReadonlyMap<string, AflTradeProjectionDocumentArtifact> {
  const result = new Map<string, AflTradeProjectionDocumentArtifact>();
  for (const document of documents) {
    const id = document.projectionDocument.projectionDocumentId;
    const existing = result.get(id);
    if (
      existing === undefined ||
      compareCodeUnits(
        canonicalizeAflTradeJson(document.projectionDocumentArtifactRef),
        canonicalizeAflTradeJson(existing.projectionDocumentArtifactRef)
      ) < 0
    ) {
      result.set(id, document);
    }
  }
  return result;
}

function addParentChecks(
  accumulator: ComparisonAccumulator,
  policy: AflTradeProjectionPresentationPolicyResult,
  evidenceIndex: AflTradeProjectionPublicEvidenceIndexResult,
  schemaBundle: AflTradeAnyProjectionSchemaBundleResult,
  documentSet: AflTradeProjectionDocumentSetResult,
  bindings: readonly AflTradeProjectionDocumentSetBinding[],
  checkedAt: string
): void {
  const policyContent = policy.projectionPresentationPolicy.content;
  const evidenceContent = evidenceIndex.projectionPublicEvidenceIndex.content;
  const setContent = documentSet.projectionDocumentSet.content;

  recordCheck(
    accumulator,
    evidenceContent.publication.publicationId === setContent.publicationId,
    'parent_publication_mismatch',
    'Public-evidence index and document set must bind the same publication.'
  );
  recordCheck(
    accumulator,
    sameCanonicalJson(
      evidenceContent.valuationOutputInventoryIndex,
      setContent.valuationOutputInventoryIndex
    ),
    'parent_inventory_index_mismatch',
    'Public-evidence index and document set must bind the exact same inventory index.'
  );
  recordCheck(
    accumulator,
    evidenceContent.entryCount === setContent.tradeCount,
    'parent_trade_count_mismatch',
    'Public-evidence and projection-document trade counts must match.'
  );
  const evidenceTradeIds = evidenceContent.entries.map((entry) => entry.tradeId);
  const documentSetTradeIds = [
    ...new Set(bindings.flatMap((binding) => (binding.tradeId === null ? [] : [binding.tradeId]))),
  ].sort(compareCodeUnits);
  recordCheck(
    accumulator,
    sameCanonicalJson(evidenceTradeIds, documentSetTradeIds),
    'parent_trade_universe_mismatch',
    'Public evidence and projection documents must cover the same canonical trade identities.'
  );
  recordCheck(
    accumulator,
    evidenceContent.scopeKey === setContent.scopeKey,
    'parent_scope_mismatch',
    'Public-evidence index and document set must share scope.'
  );
  recordCheck(
    accumulator,
    policyContent.valueUnit.id === evidenceContent.valueUnitId &&
      evidenceContent.valueUnitId === setContent.valueUnitId,
    'parent_value_unit_mismatch',
    'Policy, evidence index, and document set must share the value unit.'
  );
  const materialization = setContent.projectionMaterialization;
  recordCheck(
    accumulator,
    materialization.publicationId === setContent.publicationId &&
      materialization.valuationOutputInventoryIndexId ===
        setContent.valuationOutputInventoryIndex.valuationOutputInventoryIndexId &&
      materialization.projectionPublicEvidenceIndexId ===
        evidenceIndex.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId &&
      materialization.projectionPresentationPolicyId ===
        policy.projectionPresentationPolicy.projectionPresentationPolicyId &&
      materialization.projectionSchemaBundleId ===
        schemaBundle.projectionSchemaBundle.projectionSchemaBundleId &&
      materialization.scopeKey === setContent.scopeKey &&
      materialization.valueUnitId === setContent.valueUnitId &&
      materialization.tradeCount === setContent.tradeCount &&
      materialization.documentCount + 1 === setContent.documentCount &&
      Date.parse(materialization.artifactRef.createdAt) <=
        Date.parse(documentSet.projectionDocumentSetArtifactRef.createdAt),
    'parent_materialization_mismatch',
    'Parity requires the exact evidence, policy, schema, materialization, and document-set chain.'
  );
  const documentSetTime = Date.parse(documentSet.projectionDocumentSetArtifactRef.createdAt);
  for (const reference of [
    policy.projectionPresentationPolicyArtifactRef,
    evidenceIndex.projectionPublicEvidenceIndexArtifactRef,
    schemaBundle.projectionSchemaBundleArtifactRef,
  ]) {
    recordCheck(
      accumulator,
      Date.parse(reference.createdAt) <= documentSetTime,
      'parent_chronology_invalid',
      'Presentation policy, public evidence, and schema bundle cannot postdate the document set.'
    );
  }
  const checkedTime = Date.parse(checkedAt);
  recordCheck(
    accumulator,
    documentSetTime <= checkedTime,
    'parent_chronology_invalid',
    'The projection document set cannot postdate the parity check.'
  );
}

function addExpectedDocumentChecks(
  accumulator: ComparisonAccumulator,
  bindings: readonly AflTradeProjectionDocumentSetBinding[],
  expectedDocuments: readonly AflTradeProjectionDocumentArtifact[],
  documentSet: AflTradeProjectionDocumentSetResult,
  checkedAt: string
): void {
  // These are defensive replay invariants. Invalid caller-owned document-set envelopes are
  // rejected before report construction, so a failure here signals implementation drift.
  const setContent = documentSet.projectionDocumentSet.content;
  recordCheck(
    accumulator,
    expectedDocuments.length === bindings.length && bindings.length === setContent.documentCount,
    'expected_document_count_mismatch',
    'Expected documents must form the complete detached set membership.'
  );
  recordCheck(
    accumulator,
    hasUniqueValues(
      expectedDocuments.map((document) => document.projectionDocument.projectionDocumentId)
    ),
    'expected_document_id_duplicate',
    'Expected projection-document identities must be globally unique.'
  );
  recordCheck(
    accumulator,
    hasUniqueValues(
      expectedDocuments.map((document) => document.projectionDocumentArtifactRef.artifactId)
    ),
    'expected_document_artifact_duplicate',
    'Expected projection-document byte identities must be globally unique.'
  );

  const checkedTime = Date.parse(checkedAt);
  const expectedById = documentMap(expectedDocuments);
  for (const [index, binding] of bindings.entries()) {
    const positionalExpected = expectedDocuments[index];
    if (positionalExpected !== undefined) {
      recordCheck(
        accumulator,
        positionalExpected.projectionDocument.projectionDocumentId === binding.projectionDocumentId,
        'expected_document_order_mismatch',
        'Expected documents must follow exact flattened shard membership order.',
        binding.projectionDocumentId
      );
    }
    if (!expectedById.has(binding.projectionDocumentId)) {
      recordCheck(
        accumulator,
        false,
        'expected_document_missing',
        'A detached set member has no expected document.',
        binding.projectionDocumentId
      );
    }
    if (positionalExpected === undefined) continue;
    const expected = positionalExpected;
    const document = expected.projectionDocument;
    recordCheck(
      accumulator,
      sameCanonicalJson(expected.projectionDocumentArtifactRef, binding.artifactRef),
      'expected_document_artifact_mismatch',
      'Expected document bytes must match the detached membership reference.',
      binding.projectionDocumentId
    );
    recordCheck(
      accumulator,
      sameCanonicalJson(documentCoordinate(expected), {
        kind: binding.kind,
        tradeId: binding.tradeId,
        view: binding.view,
        rowOrdinal: binding.rowOrdinal,
      }),
      'expected_document_coordinate_mismatch',
      'Expected document coordinates must match detached membership.',
      binding.projectionDocumentId
    );
    const content = document.content;
    recordCheck(
      accumulator,
      content.schemaVersion === AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION &&
        content.publicAssetBoundary === setContent.publicAssetBoundary &&
        content.publicationId === setContent.publicationId &&
        content.valuationBundleId === setContent.valuationBundleId &&
        content.valuationOutputInventoryIndexId ===
          setContent.valuationOutputInventoryIndex.valuationOutputInventoryIndexId &&
        content.scopeKey === setContent.scopeKey &&
        content.valueUnitId === setContent.valueUnitId &&
        content.calculationAsOf === setContent.calculationAsOf &&
        content.knowledgeCutoffAt === setContent.knowledgeCutoffAt,
      'expected_document_parent_mismatch',
      'Expected document common identity must match the document-set root.',
      binding.projectionDocumentId
    );
    recordCheck(
      accumulator,
      Date.parse(expected.projectionDocumentArtifactRef.createdAt) <= checkedTime,
      'expected_document_chronology_invalid',
      'An expected document artifact cannot postdate the parity check.',
      binding.projectionDocumentId
    );
  }
}

function addStoredDocumentChecks(
  accumulator: ComparisonAccumulator,
  bindings: readonly AflTradeProjectionDocumentSetBinding[],
  storedDocuments: readonly AflTradeProjectionDocumentArtifact[],
  checkedAt: string
): void {
  const expectedIds = bindings.map((binding) => binding.projectionDocumentId);
  const expectedIdSet = new Set(expectedIds);
  const storedIds = storedDocuments.map(
    (document) => document.projectionDocument.projectionDocumentId
  );
  recordCheck(
    accumulator,
    storedDocuments.length === bindings.length,
    'stored_document_count_mismatch',
    'Stored documents must contain every expected detached member exactly once.'
  );
  recordCheck(
    accumulator,
    hasUniqueValues(storedIds),
    'stored_document_id_duplicate',
    'Stored projection-document identities must be globally unique.'
  );
  recordCheck(
    accumulator,
    hasUniqueValues(
      storedDocuments.map((document) => document.projectionDocumentArtifactRef.artifactId)
    ),
    'stored_document_artifact_duplicate',
    'Stored projection-document byte identities must be globally unique.'
  );
  recordCheck(
    accumulator,
    storedIds.length === expectedIds.length &&
      storedIds.every((documentId, index) => documentId === expectedIds[index]),
    'stored_document_order_mismatch',
    'Stored documents must use exact canonical detached membership order.'
  );

  const storedById = documentMap(storedDocuments);
  const checkedTime = Date.parse(checkedAt);
  for (const binding of bindings) {
    const stored = storedById.get(binding.projectionDocumentId);
    if (stored === undefined) {
      recordCheck(
        accumulator,
        false,
        'stored_document_missing',
        'An expected projection document is missing from stored artifacts.',
        binding.projectionDocumentId
      );
      continue;
    }
    recordCheck(
      accumulator,
      sameCanonicalJson(stored.projectionDocumentArtifactRef, binding.artifactRef),
      'stored_document_artifact_mismatch',
      'Stored document artifact reference must equal detached membership.',
      binding.projectionDocumentId
    );
    recordCheck(
      accumulator,
      Date.parse(stored.projectionDocumentArtifactRef.createdAt) <= checkedTime,
      'stored_document_chronology_invalid',
      'A stored document artifact cannot postdate the parity check.',
      binding.projectionDocumentId
    );
  }
  for (const stored of storedDocuments) {
    const documentId = stored.projectionDocument.projectionDocumentId;
    if (!expectedIdSet.has(documentId)) {
      recordCheck(
        accumulator,
        false,
        'stored_document_unexpected',
        'Stored artifacts contain a document outside detached membership.',
        documentId
      );
    }
  }
}

function compareFailures(left: RawFailure, right: RawFailure): number {
  const codeDifference = compareCodeUnits(left.code, right.code);
  if (codeDifference !== 0) return codeDifference;
  const idDifference = compareCodeUnits(
    left.projectionDocumentId ?? '',
    right.projectionDocumentId ?? ''
  );
  if (idDifference !== 0) return idDifference;
  return compareCodeUnits(left.message, right.message);
}

function boundedFailureDetails(
  failures: readonly RawFailure[]
): AflTradeProjectionParityFailureDetail[] {
  return [...failures]
    .sort(compareFailures)
    .slice(0, AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_FAILURE_DETAILS)
    .map((failure, index) => ({ ordinal: index + 1, ...failure }));
}

interface PreparedProjectionParityInput {
  projectionPresentationPolicy: AflTradeProjectionPresentationPolicyResult;
  projectionPublicEvidenceIndex: AflTradeProjectionPublicEvidenceIndexResult;
  projectionSchemaBundle: AflTradeAnyProjectionSchemaBundleResult;
  projectionDocumentSet: AflTradeProjectionDocumentSetResult;
  expectedDocuments: AflTradeProjectionDocumentArtifact[];
  storedDocuments: AflTradeProjectionDocumentArtifact[];
  checkedAt: string;
}

function buildContent(input: PreparedProjectionParityInput): AflTradeProjectionParityReportContent {
  const policy = input.projectionPresentationPolicy;
  const evidenceIndex = input.projectionPublicEvidenceIndex;
  const schemaBundle = input.projectionSchemaBundle;
  const documentSet = input.projectionDocumentSet;
  const evidenceContent = evidenceIndex.projectionPublicEvidenceIndex.content;
  const setContent = documentSet.projectionDocumentSet.content;
  const bindings = documentSet.projectionDocumentShards.flatMap(
    (shard) => shard.projectionDocumentSetShard.content.bindings
  );
  const accumulator: ComparisonAccumulator = {
    checkCount: 0,
    failureCount: 0,
    boundedFailureHeap: [],
  };

  addParentChecks(
    accumulator,
    policy,
    evidenceIndex,
    schemaBundle,
    documentSet,
    bindings,
    input.checkedAt
  );
  addExpectedDocumentChecks(
    accumulator,
    bindings,
    input.expectedDocuments,
    documentSet,
    input.checkedAt
  );
  addStoredDocumentChecks(accumulator, bindings, input.storedDocuments, input.checkedAt);

  const failureCount = accumulator.failureCount;
  return aflTradeProjectionParityReportContentSchema.parse({
    schemaVersion: AFL_TRADE_PROJECTION_PARITY_REPORT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_PROJECTION_PARITY_REPORT_PUBLIC_ASSET_BOUNDARY,
    publicationId: evidenceContent.publication.publicationId,
    valuationOutputInventoryIndexId:
      evidenceContent.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
    scopeKey: evidenceContent.scopeKey,
    valueUnitId: evidenceContent.valueUnitId,
    presentationPolicy: {
      schemaVersion: policy.projectionPresentationPolicy.content.schemaVersion,
      projectionPresentationPolicyId:
        policy.projectionPresentationPolicy.projectionPresentationPolicyId,
      artifactRef: policy.projectionPresentationPolicyArtifactRef,
    },
    publicEvidenceIndex: {
      schemaVersion: evidenceContent.schemaVersion,
      projectionPublicEvidenceIndexId:
        evidenceIndex.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId,
      artifactRef: evidenceIndex.projectionPublicEvidenceIndexArtifactRef,
    },
    schemaBundle: {
      schemaVersion: schemaBundle.projectionSchemaBundle.content.schemaVersion,
      projectionSchemaBundleId: schemaBundle.projectionSchemaBundle.projectionSchemaBundleId,
      artifactRef: schemaBundle.projectionSchemaBundleArtifactRef,
    },
    materialization: setContent.projectionMaterialization,
    documentSet: {
      schemaVersion: setContent.schemaVersion,
      projectionDocumentSetId: documentSet.projectionDocumentSet.projectionDocumentSetId,
      artifactRef: documentSet.projectionDocumentSetArtifactRef,
      documentCount: setContent.documentCount,
    },
    projectionDocumentSchemaVersion: AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION,
    status: failureCount === 0 ? 'passed' : 'failed',
    checkCount: accumulator.checkCount,
    checkedDocumentCount: bindings.length,
    expectedDocumentCount: input.expectedDocuments.length,
    storedDocumentCount: input.storedDocuments.length,
    failureCount,
    failureDetails: boundedFailureDetails(accumulator.boundedFailureHeap),
    failureDetailsTruncated: failureCount > AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_FAILURE_DETAILS,
    checkedAt: input.checkedAt,
    predecessorPolicy: {
      predecessorSchemaVersion: null,
      compatibility: AFL_TRADE_PROJECTION_PARITY_REPORT_PREDECESSOR_COMPATIBILITY,
      latestAlias: 'prohibited',
      runtimeFallback: AFL_TRADE_PROJECTION_PARITY_REPORT_RUNTIME_FALLBACK,
    },
    limitation: AFL_TRADE_PROJECTION_PARITY_REPORT_LIMITATION,
  });
}

export const AFL_TRADE_PROJECTION_PARITY_CONSTRUCTION_ERROR_CODES = Object.freeze([
  'INVALID_INPUT_ENVELOPE',
  'INVALID_CHECKED_AT',
  'INVALID_PRESENTATION_POLICY_RESULT',
  'INVALID_PUBLIC_EVIDENCE_INDEX_RESULT',
  'INVALID_SCHEMA_BUNDLE_RESULT',
  'INVALID_DOCUMENT_SET_VERIFICATION',
  'INVALID_DOCUMENT_SET_RESULT',
  'INVALID_EXPECTED_DOCUMENTS',
  'INVALID_STORED_DOCUMENTS',
  'AGGREGATE_INPUT_SIZE_LIMIT_EXCEEDED',
  'ARTIFACT_SIZE_LIMIT_EXCEEDED',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const);

export type AflTradeProjectionParityConstructionErrorCode =
  (typeof AFL_TRADE_PROJECTION_PARITY_CONSTRUCTION_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<AflTradeProjectionParityConstructionErrorCode, string>> =
  Object.freeze({
    INVALID_INPUT_ENVELOPE: 'The projection-parity input envelope is invalid.',
    INVALID_CHECKED_AT: 'The projection-parity checked time is invalid.',
    INVALID_PRESENTATION_POLICY_RESULT: 'The projection presentation-policy result is invalid.',
    INVALID_PUBLIC_EVIDENCE_INDEX_RESULT: 'The projection public-evidence-index result is invalid.',
    INVALID_SCHEMA_BUNDLE_RESULT: 'The projection schema-bundle result is invalid.',
    INVALID_DOCUMENT_SET_VERIFICATION:
      'The projection document-set verification envelope is invalid or fails total replay.',
    INVALID_DOCUMENT_SET_RESULT: 'The projection document-set result is invalid.',
    INVALID_EXPECTED_DOCUMENTS: 'The expected projection-document results are invalid.',
    INVALID_STORED_DOCUMENTS: 'The stored projection-document results are invalid.',
    AGGREGATE_INPUT_SIZE_LIMIT_EXCEEDED:
      'The aggregate projection-document input exceeds the 64 MiB in-memory limit.',
    ARTIFACT_SIZE_LIMIT_EXCEEDED: 'The projection parity report exceeds one MiB.',
    INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
      'The projection parity report failed its internal artifact contract.',
  });

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeProjectionParityConstructionError extends Error {
  readonly code: AflTradeProjectionParityConstructionErrorCode;

  constructor(code: AflTradeProjectionParityConstructionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionParityConstructionError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeProjectionParityConstructionError';
    code: AflTradeProjectionParityConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeProjectionParityConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeProjectionParityConstructionError(
  value: unknown
): value is AflTradeProjectionParityConstructionError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function constructionError(
  code: AflTradeProjectionParityConstructionErrorCode
): AflTradeProjectionParityConstructionError {
  return new AflTradeProjectionParityConstructionError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeProjectionParityConstructionErrorCode
): T {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // Hostile values are replaced with the stable contract error below.
  }
  throw constructionError(code);
}

interface AggregateInputByteBudget {
  byteLength: number;
}

function chargeAggregateInputBytes(budget: AggregateInputByteBudget, byteLength: number): void {
  if (byteLength > AFL_TRADE_PROJECTION_PARITY_MAX_AGGREGATE_DOCUMENT_BYTES - budget.byteLength) {
    throw constructionError('AGGREGATE_INPUT_SIZE_LIMIT_EXCEEDED');
  }
  budget.byteLength += byteLength;
}

function parseProjectionDocumentsWithBudget(
  value: unknown,
  code: 'INVALID_EXPECTED_DOCUMENTS' | 'INVALID_STORED_DOCUMENTS',
  budget: AggregateInputByteBudget
): AflTradeProjectionDocumentArtifact[] {
  try {
    if (!Array.isArray(value) || nodeUtilTypes.isProxy(value)) throw constructionError(code);
    const prototype = Object.getPrototypeOf(value);
    const ownKeys = Reflect.ownKeys(value);
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (
      prototype !== Array.prototype ||
      lengthDescriptor === undefined ||
      'get' in lengthDescriptor ||
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS ||
      ownKeys.some((key) => typeof key !== 'string') ||
      ownKeys.length !== length + 1
    ) {
      throw constructionError(code);
    }
    const documents: AflTradeProjectionDocumentArtifact[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
        throw constructionError(code);
      }
      const document = parseOrThrow(
        aflTradeProjectionParityDocumentArtifactSchema,
        descriptor.value,
        code
      );
      chargeAggregateInputBytes(budget, document.projectionDocumentArtifactRef.byteLength);
      documents.push(document);
    }
    return documents;
  } catch (error) {
    if (isAflTradeProjectionParityConstructionError(error)) throw error;
    throw constructionError(code);
  }
}

const DOCUMENT_SET_RESULT_KEYS = [
  'projectionDocumentShards',
  'projectionDocumentSet',
  'projectionDocumentSetArtifactRef',
] as const;

function parseProjectionDocumentSetWithBudget(
  value: unknown,
  budget: AggregateInputByteBudget
): AflTradeProjectionDocumentSetResult {
  const code = 'INVALID_DOCUMENT_SET_RESULT' as const;
  try {
    const snapshot = snapshotExactEnvelope(value, DOCUMENT_SET_RESULT_KEYS);
    if (snapshot === null) throw constructionError(code);

    const root = parseOrThrow(
      aflTradeProjectionDocumentSetSchema,
      snapshot.projectionDocumentSet,
      code
    );
    const rootArtifactRef = parseOrThrow(
      canonicalJsonArtifactRefSchema,
      snapshot.projectionDocumentSetArtifactRef,
      code
    );
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(rootArtifactRef, root) ||
      rootArtifactRef.createdAt !== root.content.materializedAt ||
      rootArtifactRef.byteLength < 1 ||
      rootArtifactRef.byteLength > AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_ROOT_BYTES
    ) {
      throw constructionError(code);
    }
    chargeAggregateInputBytes(budget, rootArtifactRef.byteLength);

    const unparsedShards = snapshot.projectionDocumentShards;
    if (!Array.isArray(unparsedShards) || nodeUtilTypes.isProxy(unparsedShards)) {
      throw constructionError(code);
    }
    const prototype = Object.getPrototypeOf(unparsedShards);
    const ownKeys = Reflect.ownKeys(unparsedShards);
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(unparsedShards, 'length');
    const shardCount = lengthDescriptor?.value;
    if (
      prototype !== Array.prototype ||
      lengthDescriptor === undefined ||
      'get' in lengthDescriptor ||
      typeof shardCount !== 'number' ||
      !Number.isSafeInteger(shardCount) ||
      shardCount !== root.content.shards.length ||
      ownKeys.some((key) => typeof key !== 'string') ||
      ownKeys.length !== shardCount + 1
    ) {
      throw constructionError(code);
    }
    const shards = [];
    for (let index = 0; index < shardCount; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(unparsedShards, String(index));
      if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
        throw constructionError(code);
      }
      const shard = parseOrThrow(
        aflTradeProjectionDocumentSetShardArtifactSchema,
        descriptor.value,
        code
      );
      chargeAggregateInputBytes(budget, shard.projectionDocumentSetShardArtifactRef.byteLength);
      shards.push(shard);
    }

    return parseOrThrow(
      aflTradeProjectionDocumentSetResultSchema,
      {
        projectionDocumentShards: shards,
        projectionDocumentSet: root,
        projectionDocumentSetArtifactRef: rootArtifactRef,
      },
      code
    );
  } catch (error) {
    if (isAflTradeProjectionParityConstructionError(error)) throw error;
    throw constructionError(code);
  }
}

const DOCUMENT_SET_VERIFICATION_KEYS = [
  'publicationManifest',
  'valuationOutputInventoryIndex',
  'valuationOutputInventoryIndexArtifactRef',
  'projectionMaterializationVerification',
  'projectionDocuments',
  'materializedAt',
  'output',
] as const;

function parseProjectionDocumentSetVerificationWithBudget(
  value: unknown,
  budget: AggregateInputByteBudget
): {
  documentSet: AflTradeProjectionDocumentSetResult;
  expectedDocuments: AflTradeProjectionDocumentArtifact[];
} {
  const snapshot = snapshotExactEnvelope(value, DOCUMENT_SET_VERIFICATION_KEYS);
  if (snapshot === null) {
    throw constructionError('INVALID_DOCUMENT_SET_VERIFICATION');
  }
  const documentSet = parseProjectionDocumentSetWithBudget(snapshot.output, budget);
  const sourceDocuments = parseProjectionDocumentsWithBudget(
    snapshot.projectionDocuments,
    'INVALID_EXPECTED_DOCUMENTS',
    budget
  );
  if (!verifyAflTradeProjectionDocumentSet(value)) {
    throw constructionError('INVALID_DOCUMENT_SET_VERIFICATION');
  }
  const sourceById = new Map(
    sourceDocuments.map((document) => [document.projectionDocument.projectionDocumentId, document])
  );
  const bindings = documentSet.projectionDocumentShards.flatMap(
    (shard) => shard.projectionDocumentSetShard.content.bindings
  );
  const expectedDocuments = bindings.map((binding) => {
    const document = sourceById.get(binding.projectionDocumentId);
    if (document === undefined) throw constructionError('INVALID_EXPECTED_DOCUMENTS');
    return document;
  });
  if (
    expectedDocuments.length !== sourceDocuments.length ||
    sourceById.size !== sourceDocuments.length
  ) {
    throw constructionError('INVALID_EXPECTED_DOCUMENTS');
  }
  return { documentSet, expectedDocuments };
}

function snapshotExactEnvelope<const Key extends string>(
  value: unknown,
  keys: readonly Key[]
): Record<Key, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    if (nodeUtilTypes.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const expected = new Set<string>(keys);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !expected.has(key))
    ) {
      return null;
    }
    const snapshot = Object.create(null) as Record<Key, unknown>;
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

const CREATE_INPUT_KEYS = [
  'projectionPresentationPolicy',
  'projectionPublicEvidenceIndex',
  'projectionSchemaBundle',
  'projectionDocumentSetVerification',
  'storedDocuments',
  'checkedAt',
] as const;
const VERIFY_INPUT_KEYS = [...CREATE_INPUT_KEYS, 'output'] as const;

export function createAflTradeProjectionParityReport(
  unparsedInput: unknown
): AflTradeProjectionParityReportResult {
  try {
    const snapshot = snapshotExactEnvelope(unparsedInput, CREATE_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');
    const checkedAt = parseOrThrow(
      aflTradeIsoDateTimeSchema,
      snapshot.checkedAt,
      'INVALID_CHECKED_AT'
    );
    const aggregateInputByteBudget: AggregateInputByteBudget = { byteLength: 0 };
    const storedDocuments = parseProjectionDocumentsWithBudget(
      snapshot.storedDocuments,
      'INVALID_STORED_DOCUMENTS',
      aggregateInputByteBudget
    );
    const verifiedDocumentSet = parseProjectionDocumentSetVerificationWithBudget(
      snapshot.projectionDocumentSetVerification,
      aggregateInputByteBudget
    );
    const projectionPresentationPolicy = parseOrThrow(
      aflTradeProjectionPresentationPolicyResultSchema,
      snapshot.projectionPresentationPolicy,
      'INVALID_PRESENTATION_POLICY_RESULT'
    );
    const projectionPublicEvidenceIndex = parseOrThrow(
      aflTradeProjectionPublicEvidenceIndexResultSchema,
      snapshot.projectionPublicEvidenceIndex,
      'INVALID_PUBLIC_EVIDENCE_INDEX_RESULT'
    );
    const projectionSchemaBundle = parseOrThrow(
      aflTradeAnyProjectionSchemaBundleResultSchema,
      snapshot.projectionSchemaBundle,
      'INVALID_SCHEMA_BUNDLE_RESULT'
    );
    const input: PreparedProjectionParityInput = {
      projectionPresentationPolicy,
      projectionPublicEvidenceIndex,
      projectionSchemaBundle,
      projectionDocumentSet: verifiedDocumentSet.documentSet,
      expectedDocuments: verifiedDocumentSet.expectedDocuments,
      storedDocuments,
      checkedAt,
    };
    const content = buildContent(input);
    const report = aflTradeProjectionParityReportSchema.safeParse({
      projectionParityReportId: createAflTradeContentAddress('projection-parity-report', content),
      content,
    });
    if (!report.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    const projectionParityReportArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      report.data,
      checkedAt
    );
    if (
      projectionParityReportArtifactRef.byteLength < 1 ||
      projectionParityReportArtifactRef.byteLength >
        AFL_TRADE_PROJECTION_PARITY_REPORT_MAX_ARTIFACT_BYTES
    ) {
      throw constructionError('ARTIFACT_SIZE_LIMIT_EXCEEDED');
    }
    const result = aflTradeProjectionParityReportResultSchema.safeParse({
      projectionParityReport: report.data,
      projectionParityReportArtifactRef,
    });
    if (!result.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeProjectionParityConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

export function verifyAflTradeProjectionParityReport(input: unknown): boolean {
  try {
    const snapshot = snapshotExactEnvelope(input, VERIFY_INPUT_KEYS);
    if (snapshot === null) return false;
    const output = aflTradeProjectionParityReportResultSchema.safeParse(snapshot.output);
    if (!output.success) return false;
    const replayed = createAflTradeProjectionParityReport({
      projectionPresentationPolicy: snapshot.projectionPresentationPolicy,
      projectionPublicEvidenceIndex: snapshot.projectionPublicEvidenceIndex,
      projectionSchemaBundle: snapshot.projectionSchemaBundle,
      projectionDocumentSetVerification: snapshot.projectionDocumentSetVerification,
      storedDocuments: snapshot.storedDocuments,
      checkedAt: snapshot.checkedAt,
    });
    if (
      replayed.projectionParityReport.projectionParityReportId !==
        output.data.projectionParityReport.projectionParityReportId ||
      replayed.projectionParityReportArtifactRef.artifactId !==
        output.data.projectionParityReportArtifactRef.artifactId ||
      replayed.projectionParityReportArtifactRef.contentSha256 !==
        output.data.projectionParityReportArtifactRef.contentSha256
    ) {
      return false;
    }
    return canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(output.data);
  } catch {
    return false;
  }
}
