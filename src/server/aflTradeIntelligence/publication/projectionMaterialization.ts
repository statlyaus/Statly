import { types as nodeUtilTypes } from 'node:util';

import { z } from 'zod';

import {
  AFL_TRADE_VALUATION_VIEWS,
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
} from '@/types/aflTradeIntelligence';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
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
  aflTradeProjectionPresentationPolicyBindingSchema,
  aflTradeProjectionPublicEvidenceIndexBindingSchema,
  aflTradeAnyProjectionSchemaBundleBindingSchema,
  aflTradePublicationManifestV3Schema,
  aflTradePublicationManifestV4Schema,
  aflTradeValuationOutputInventoryIndexBindingSchema,
  type AflTradePublicationManifestV3,
  type AflTradePublicationManifestV4,
} from '../artifacts/publicationProjectionManifests';
import {
  aflTradeValuationOutputInventoryIndexResultSchema,
  type AflTradeValuationOutputInventoryIndexResult,
} from '../artifacts/valuationOutputInventoryIndex';
import { AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY } from './projectionDocumentContracts';
import { type AflTradeProjectionEvidenceSourceVerificationResult } from './projectionEvidenceSourceVerification';
import {
  aflTradeProjectionPresentationPolicyResultSchema,
  type AflTradeProjectionPresentationPolicyResult,
} from './projectionPresentationPolicy';
import {
  aflTradeProjectionPublicEvidenceIndexResultSchema,
  type AflTradeProjectionPublicEvidenceIndexEntry,
  type AflTradeProjectionPublicEvidenceIndexResult,
} from './projectionPublicEvidenceIndex';
import {
  aflTradeAnyProjectionSchemaBundleResultSchema,
  type AflTradeAnyProjectionSchemaBundleResult,
} from './projectionSchemaBundle';
import {
  aflTradeProjectionTradeMaterializationVerifyInputSchema,
  verifyAflTradeProjectionTradeMaterialization,
  type AflTradeProjectionTradeMaterializationResult,
} from './projectionTradeMaterializer';

export const AFL_TRADE_PROJECTION_MATERIALIZATION_SHARD_SCHEMA_VERSION =
  'afl-trade-projection-materialization-shard/v1' as const;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_SCHEMA_VERSION =
  'afl-trade-projection-materialization/v1' as const;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_ORDERING =
  'trade_id_code_unit_ascending_v1' as const;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_DIGEST_DEFINITION =
  'sha256_of_canonical_ordered_complete_trade_entries_v1' as const;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_SHARD_DIGEST_DEFINITION =
  'sha256_of_canonical_contiguous_detached_shard_bindings_v1' as const;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_TRADES_PER_SHARD = 26;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_DOCUMENTS_PER_SHARD = 2_048;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARD_BYTES = 4 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARD_INPUT_BYTES = 64 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARDS = 512;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_ROOT_BYTES = 512 * 1024;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_ROOT_INPUT_BYTES = 64 * 1024 * 1024;
const AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_ADMISSION_DEPTH = 256;
const AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_ADMISSION_NODES = 1_000_000;
export const AFL_TRADE_PROJECTION_MATERIALIZATION_LIMITATION =
  'This immutable DAG authenticates complete trade materialization receipts, their non-methodology projection documents, literal passing source-verification reports, and exact evidence-index membership. Callers must use externally bounded streaming stages above the declared in-memory shard-input and root-input budgets. It does not approve or activate publication, authorize serving or fantasy state, establish source rights or model validity, or create user or fantasy ownership.' as const;

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Projection materialization requires canonical JSON artifact references.'
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

const publicationBindingSchema = z
  .object({
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    artifactRef: canonicalJsonArtifactRefSchema,
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
  .strict();

type MaterializationDocumentBinding = z.infer<typeof documentBindingSchema>;

function documentsUseExactTradeLattice(
  documents: readonly MaterializationDocumentBinding[]
): boolean {
  if (documents.length < 9 || documents.length > 77) return false;
  const detail = documents[0];
  if (detail?.kind !== 'trade_detail' || detail.view !== null || detail.rowOrdinal !== null) {
    return false;
  }
  for (const [viewIndex, view] of AFL_TRADE_VALUATION_VIEWS.entries()) {
    const summary = documents[viewIndex + 1];
    if (summary?.kind !== 'trade_summary' || summary.view !== view || summary.rowOrdinal !== null) {
      return false;
    }
  }
  let offset = 1 + AFL_TRADE_VALUATION_VIEWS.length;
  for (const view of AFL_TRADE_VALUATION_VIEWS) {
    let rowOrdinal = 0;
    while (
      offset < documents.length &&
      documents[offset].kind === 'valuation_export_row' &&
      documents[offset].view === view
    ) {
      if (documents[offset].rowOrdinal !== rowOrdinal || rowOrdinal >= 18) return false;
      rowOrdinal += 1;
      offset += 1;
    }
    if (rowOrdinal < 1) return false;
  }
  return offset === documents.length;
}

export const aflTradeProjectionMaterializationEntrySchema = z
  .object({
    tradeId: aflTradePublicIdSchema,
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    valuationOutputInventoryId: aflTradeContentAddressedIdSchema('valuation-output-inventory'),
    inventoryArtifactRef: canonicalJsonArtifactRefSchema,
    projectionPublicEvidence: z
      .object({
        projectionPublicEvidenceId: aflTradeContentAddressedIdSchema('projection-public-evidence'),
        artifactRef: canonicalJsonArtifactRefSchema,
      })
      .strict(),
    evidenceSourceVerification: z
      .object({
        projectionEvidenceSourceVerificationId: aflTradeContentAddressedIdSchema(
          'projection-evidence-source-verification'
        ),
        artifactRef: canonicalJsonArtifactRefSchema,
        status: z.literal('passed'),
        sourceArtifactSetSha256: aflTradeSha256Schema,
      })
      .strict(),
    projectionTradeMaterialization: z
      .object({
        projectionTradeMaterializationId: aflTradeContentAddressedIdSchema(
          'projection-trade-materialization'
        ),
        artifactRef: canonicalJsonArtifactRefSchema,
        documentSetSha256: aflTradeSha256Schema,
      })
      .strict(),
    documentCount: z.number().int().min(9).max(77),
    documents: z.array(documentBindingSchema).min(9).max(77),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.documentCount !== entry.documents.length) {
      context.addIssue({
        code: 'custom',
        path: ['documentCount'],
        message: 'Materialization entry document count must match its complete bindings.',
      });
    }
    if (entry.documents.some((document) => document.tradeId !== entry.tradeId)) {
      context.addIssue({
        code: 'custom',
        path: ['documents'],
        message: 'Every materialization-entry document must belong to its trade.',
      });
    }
    if (!documentsUseExactTradeLattice(entry.documents)) {
      context.addIssue({
        code: 'custom',
        path: ['documents'],
        message:
          'A trade entry requires detail first, four canonical summaries, and one to eighteen contiguous export rows per canonical view.',
      });
    }
    if (
      entry.projectionTradeMaterialization.documentSetSha256 !==
      sha256AflTradeCanonicalJson(entry.documents)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionTradeMaterialization', 'documentSetSha256'],
        message: 'The trade receipt digest must authenticate every entry document.',
      });
    }
  });

export type AflTradeProjectionMaterializationEntry = z.infer<
  typeof aflTradeProjectionMaterializationEntrySchema
>;

const parentShape = {
  publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY),
  publication: publicationBindingSchema,
  valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexBindingSchema,
  projectionPublicEvidenceIndex: aflTradeProjectionPublicEvidenceIndexBindingSchema,
  projectionPresentationPolicy: aflTradeProjectionPresentationPolicyBindingSchema,
  projectionSchemaBundle: aflTradeAnyProjectionSchemaBundleBindingSchema,
  scopeKey: aflTradePublicIdSchema,
  valueUnitId: aflTradePublicIdSchema,
} as const;

export const aflTradeProjectionMaterializationShardContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_MATERIALIZATION_SHARD_SCHEMA_VERSION),
    ...parentShape,
    calculationAsOf: aflTradeIsoDateTimeSchema,
    knowledgeCutoffAt: aflTradeIsoDateTimeSchema,
    shardOrdinal: z
      .number()
      .int()
      .nonnegative()
      .max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARDS - 1),
    ordering: z.literal(AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_ORDERING),
    digestDefinition: z.literal(AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_DIGEST_DEFINITION),
    tradeCount: z
      .number()
      .int()
      .positive()
      .max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_TRADES_PER_SHARD),
    documentCount: z
      .number()
      .int()
      .positive()
      .max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_DOCUMENTS_PER_SHARD),
    entrySetSha256: aflTradeSha256Schema,
    entries: z
      .array(aflTradeProjectionMaterializationEntrySchema)
      .min(1)
      .max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_TRADES_PER_SHARD),
    materializedAt: aflTradeIsoDateTimeSchema,
    limitation: z.literal(AFL_TRADE_PROJECTION_MATERIALIZATION_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.tradeCount !== content.entries.length) {
      context.addIssue({
        code: 'custom',
        path: ['tradeCount'],
        message: 'Shard trade count must match entries.',
      });
    }
    const documentCount = content.entries.reduce((sum, entry) => sum + entry.documentCount, 0);
    if (content.documentCount !== documentCount) {
      context.addIssue({
        code: 'custom',
        path: ['documentCount'],
        message: 'Shard document count must reconcile to entries.',
      });
    }
    if (content.entrySetSha256 !== sha256AflTradeCanonicalJson(content.entries)) {
      context.addIssue({
        code: 'custom',
        path: ['entrySetSha256'],
        message: 'Shard digest must authenticate canonical entries.',
      });
    }
    if (
      content.entries.some(
        (entry, index) => index > 0 && content.entries[index - 1].tradeId >= entry.tradeId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Shard trades require strict canonical order.',
      });
    }
    const materializedAt = Date.parse(content.materializedAt);
    if (
      Date.parse(content.knowledgeCutoffAt) > Date.parse(content.calculationAsOf) ||
      Date.parse(content.calculationAsOf) > materializedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializedAt'],
        message: 'Shard knowledge, calculation, and materialization times must be monotonic.',
      });
    }
    const references = [
      content.publication.artifactRef,
      content.valuationOutputInventoryIndex.artifactRef,
      content.projectionPublicEvidenceIndex.artifactRef,
      content.projectionPresentationPolicy.artifactRef,
      content.projectionSchemaBundle.artifactRef,
      ...content.entries.flatMap((entry) => [
        entry.projectionPublicEvidence.artifactRef,
        entry.evidenceSourceVerification.artifactRef,
        entry.projectionTradeMaterialization.artifactRef,
        ...entry.documents.map((document) => document.artifactRef),
      ]),
    ];
    if (references.some((reference) => Date.parse(reference.createdAt) > materializedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['materializedAt'],
        message: 'No shard parent or member artifact may postdate the shard.',
      });
    }
    for (const identities of [
      content.entries.map((entry) => entry.projectionPublicEvidence.projectionPublicEvidenceId),
      content.entries.map((entry) => entry.projectionPublicEvidence.artifactRef.artifactId),
      content.entries.map(
        (entry) => entry.evidenceSourceVerification.projectionEvidenceSourceVerificationId
      ),
      content.entries.map((entry) => entry.evidenceSourceVerification.artifactRef.artifactId),
      content.entries.map(
        (entry) => entry.projectionTradeMaterialization.projectionTradeMaterializationId
      ),
      content.entries.map((entry) => entry.projectionTradeMaterialization.artifactRef.artifactId),
      content.entries.flatMap((entry) =>
        entry.documents.map((document) => document.projectionDocumentId)
      ),
      content.entries.flatMap((entry) =>
        entry.documents.map((document) => document.artifactRef.artifactId)
      ),
    ]) {
      if (new Set(identities).size !== identities.length) {
        context.addIssue({
          code: 'custom',
          path: ['entries'],
          message: 'Shard evidence, verification, receipt, and document identities must be unique.',
        });
      }
    }
  });

export const aflTradeProjectionMaterializationShardSchema = z
  .object({
    projectionMaterializationShardId: aflTradeContentAddressedIdSchema(
      'projection-materialization-shard'
    ),
    content: aflTradeProjectionMaterializationShardContentSchema,
  })
  .strict()
  .superRefine((shard, context) => {
    addAflTradeContentAddressIssue(
      'projection-materialization-shard',
      shard.projectionMaterializationShardId,
      shard.content,
      context,
      ['projectionMaterializationShardId']
    );
  });

export type AflTradeProjectionMaterializationShardContent = z.infer<
  typeof aflTradeProjectionMaterializationShardContentSchema
>;
export type AflTradeProjectionMaterializationShard = z.infer<
  typeof aflTradeProjectionMaterializationShardSchema
>;

export const aflTradeProjectionMaterializationShardResultSchema = z
  .object({
    projectionMaterializationShard: aflTradeProjectionMaterializationShardSchema,
    projectionMaterializationShardArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const shard = result.projectionMaterializationShard;
    const reference = result.projectionMaterializationShardArtifactRef;
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(reference, shard) ||
      reference.createdAt !== shard.content.materializedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionMaterializationShardArtifactRef'],
        message: 'Shard reference must authenticate exact canonical bytes and time.',
      });
    }
    if (
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARD_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionMaterializationShardArtifactRef', 'byteLength'],
        message: 'Materialization shard exceeds four MiB.',
      });
    }
  });

export type AflTradeProjectionMaterializationShardResult = z.infer<
  typeof aflTradeProjectionMaterializationShardResultSchema
>;

export const aflTradeProjectionMaterializationShardBindingSchema = z
  .object({
    shardOrdinal: z.number().int().nonnegative(),
    projectionMaterializationShardId: aflTradeContentAddressedIdSchema(
      'projection-materialization-shard'
    ),
    artifactRef: canonicalJsonArtifactRefSchema,
    tradeCount: z
      .number()
      .int()
      .positive()
      .max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_TRADES_PER_SHARD),
    documentCount: z
      .number()
      .int()
      .positive()
      .max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_DOCUMENTS_PER_SHARD),
    entrySetSha256: aflTradeSha256Schema,
    firstTradeId: aflTradePublicIdSchema,
    lastTradeId: aflTradePublicIdSchema,
  })
  .strict();

export type AflTradeProjectionMaterializationShardBinding = z.infer<
  typeof aflTradeProjectionMaterializationShardBindingSchema
>;

export const aflTradeProjectionMaterializationContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_MATERIALIZATION_SCHEMA_VERSION),
    ...parentShape,
    calculationAsOf: aflTradeIsoDateTimeSchema,
    knowledgeCutoffAt: aflTradeIsoDateTimeSchema,
    ordering: z.literal(AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_ORDERING),
    entryDigestDefinition: z.literal(AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_DIGEST_DEFINITION),
    shardDigestDefinition: z.literal(AFL_TRADE_PROJECTION_MATERIALIZATION_SHARD_DIGEST_DEFINITION),
    shardCount: z.number().int().positive().max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARDS),
    tradeCount: z.number().int().positive().max(10_000),
    documentCount: z.number().int().positive().max(770_000),
    evidenceTradeSetSha256: aflTradeSha256Schema,
    entrySetSha256: aflTradeSha256Schema,
    shardSetSha256: aflTradeSha256Schema,
    shards: z
      .array(aflTradeProjectionMaterializationShardBindingSchema)
      .min(1)
      .max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARDS),
    materializedAt: aflTradeIsoDateTimeSchema,
    limitation: z.literal(AFL_TRADE_PROJECTION_MATERIALIZATION_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.shardCount !== content.shards.length) {
      context.addIssue({
        code: 'custom',
        path: ['shardCount'],
        message: 'Root shard count must match bindings.',
      });
    }
    if (content.tradeCount !== content.shards.reduce((sum, shard) => sum + shard.tradeCount, 0)) {
      context.addIssue({
        code: 'custom',
        path: ['tradeCount'],
        message: 'Root trade count must reconcile to shards.',
      });
    }
    if (
      content.documentCount !== content.shards.reduce((sum, shard) => sum + shard.documentCount, 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['documentCount'],
        message: 'Root document count must reconcile to shards.',
      });
    }
    if (content.shardSetSha256 !== sha256AflTradeCanonicalJson(content.shards)) {
      context.addIssue({
        code: 'custom',
        path: ['shardSetSha256'],
        message: 'Root shard digest must authenticate bindings.',
      });
    }
    if (content.shards.some((shard, index) => shard.shardOrdinal !== index)) {
      context.addIssue({
        code: 'custom',
        path: ['shards'],
        message: 'Root shard ordinals must be contiguous.',
      });
    }
    if (
      content.shards.some(
        (shard, index) => index > 0 && content.shards[index - 1].lastTradeId >= shard.firstTradeId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['shards'],
        message: 'Root shard trade ranges must be disjoint and ordered.',
      });
    }
    if (
      Date.parse(content.knowledgeCutoffAt) > Date.parse(content.calculationAsOf) ||
      Date.parse(content.calculationAsOf) > Date.parse(content.materializedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializedAt'],
        message: 'Root knowledge, calculation, and materialization times must be monotonic.',
      });
    }
  });

export const aflTradeProjectionMaterializationSchema = z
  .object({
    projectionMaterializationId: aflTradeContentAddressedIdSchema('projection-materialization'),
    content: aflTradeProjectionMaterializationContentSchema,
  })
  .strict()
  .superRefine((root, context) => {
    addAflTradeContentAddressIssue(
      'projection-materialization',
      root.projectionMaterializationId,
      root.content,
      context,
      ['projectionMaterializationId']
    );
  });

export type AflTradeProjectionMaterializationContent = z.infer<
  typeof aflTradeProjectionMaterializationContentSchema
>;
export type AflTradeProjectionMaterialization = z.infer<
  typeof aflTradeProjectionMaterializationSchema
>;

export const aflTradeProjectionMaterializationResultSchema = z
  .object({
    projectionMaterialization: aflTradeProjectionMaterializationSchema,
    projectionMaterializationArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const root = result.projectionMaterialization;
    const reference = result.projectionMaterializationArtifactRef;
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(reference, root) ||
      reference.createdAt !== root.content.materializedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionMaterializationArtifactRef'],
        message: 'Root reference must authenticate exact canonical bytes and time.',
      });
    }
    if (
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_ROOT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionMaterializationArtifactRef', 'byteLength'],
        message: 'Materialization root exceeds 512 KiB.',
      });
    }
  });

export type AflTradeProjectionMaterializationResult = z.infer<
  typeof aflTradeProjectionMaterializationResultSchema
>;

const commonInputShape = {
  publication: publicationInputSchema,
  valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexResultSchema,
  projectionPublicEvidenceIndex: aflTradeProjectionPublicEvidenceIndexResultSchema,
  projectionPresentationPolicy: aflTradeProjectionPresentationPolicyResultSchema,
  projectionSchemaBundle: aflTradeAnyProjectionSchemaBundleResultSchema,
} as const;

export const aflTradeProjectionMaterializationShardCreateInputSchema = z
  .object({
    ...commonInputShape,
    shardOrdinal: z
      .number()
      .int()
      .nonnegative()
      .max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARDS - 1),
    projectionTradeMaterializerVerifications: z
      .array(aflTradeProjectionTradeMaterializationVerifyInputSchema)
      .min(1)
      .max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_TRADES_PER_SHARD),
    materializedAt: aflTradeIsoDateTimeSchema,
  })
  .strict();

export type AflTradeProjectionMaterializationShardCreateInput = z.infer<
  typeof aflTradeProjectionMaterializationShardCreateInputSchema
>;

export const aflTradeProjectionMaterializationShardVerifyInputSchema =
  aflTradeProjectionMaterializationShardCreateInputSchema.safeExtend({
    output: aflTradeProjectionMaterializationShardResultSchema,
  });

export const aflTradeProjectionMaterializationCreateInputSchema = z
  .object({
    ...commonInputShape,
    projectionMaterializationShardVerifications: z
      .array(aflTradeProjectionMaterializationShardVerifyInputSchema)
      .min(1)
      .max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARDS),
    materializedAt: aflTradeIsoDateTimeSchema,
  })
  .strict();

export type AflTradeProjectionMaterializationCreateInput = z.infer<
  typeof aflTradeProjectionMaterializationCreateInputSchema
>;

export const aflTradeProjectionMaterializationVerifyInputSchema =
  aflTradeProjectionMaterializationCreateInputSchema.safeExtend({
    output: aflTradeProjectionMaterializationResultSchema,
  });

export type AflTradeProjectionMaterializationShardVerifyInput = z.infer<
  typeof aflTradeProjectionMaterializationShardVerifyInputSchema
>;
export type AflTradeProjectionMaterializationVerifyInput = z.infer<
  typeof aflTradeProjectionMaterializationVerifyInputSchema
>;

export const AFL_TRADE_PROJECTION_MATERIALIZATION_ERROR_CODES = [
  'INVALID_INPUT_ENVELOPE',
  'INVALID_PUBLICATION_BINDING',
  'INVALID_INVENTORY_INDEX',
  'INVALID_EVIDENCE_INDEX',
  'INVALID_PRESENTATION_POLICY',
  'INVALID_SCHEMA_BUNDLE',
  'INVALID_TRADE_MATERIALIZATIONS',
  'INVALID_SHARDS',
  'PARENT_BINDING_MISMATCH',
  'TRADE_UNIVERSE_MISMATCH',
  'SOURCE_VERIFICATION_NOT_PASSED',
  'MATERIALIZATION_BINDING_MISMATCH',
  'NON_MONOTONIC_ARTIFACT_TIME',
  'SHARD_INPUT_SIZE_LIMIT_EXCEEDED',
  'ROOT_INPUT_SIZE_LIMIT_EXCEEDED',
  'SHARD_LIMIT_EXCEEDED',
  'ROOT_LIMIT_EXCEEDED',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const;

export type AflTradeProjectionMaterializationErrorCode =
  (typeof AFL_TRADE_PROJECTION_MATERIALIZATION_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<AflTradeProjectionMaterializationErrorCode, string>> =
  Object.freeze({
    INVALID_INPUT_ENVELOPE: 'The projection-materialization input envelope is invalid.',
    INVALID_PUBLICATION_BINDING: 'The publication v3 binding is invalid.',
    INVALID_INVENTORY_INDEX: 'The valuation-output inventory-index result is invalid.',
    INVALID_EVIDENCE_INDEX: 'The projection public-evidence-index result is invalid.',
    INVALID_PRESENTATION_POLICY: 'The projection presentation-policy result is invalid.',
    INVALID_SCHEMA_BUNDLE: 'The projection schema-bundle result is invalid.',
    INVALID_TRADE_MATERIALIZATIONS:
      'The trade-materializer verification envelopes are invalid or fail total replay.',
    INVALID_SHARDS: 'The shard verification envelopes are invalid or fail total replay.',
    PARENT_BINDING_MISMATCH: 'Projection materialization parents do not form one exact chain.',
    TRADE_UNIVERSE_MISMATCH:
      'Materialization trades do not exactly match the public-evidence index.',
    SOURCE_VERIFICATION_NOT_PASSED:
      'Every materialized trade requires a literal passing source verification.',
    MATERIALIZATION_BINDING_MISMATCH:
      'A trade receipt, evidence entry, verification, or document binding does not match.',
    NON_MONOTONIC_ARTIFACT_TIME:
      'An upstream artifact postdates its containing materialization artifact.',
    SHARD_INPUT_SIZE_LIMIT_EXCEEDED:
      'Complete trade-materializer verification envelopes and common parents exceed the 64 MiB in-memory shard budget; use an externally bounded streaming stage.',
    ROOT_INPUT_SIZE_LIMIT_EXCEEDED:
      'Complete shard-verification envelopes and common parents exceed the 64 MiB in-memory root budget; use an externally bounded streaming stage.',
    SHARD_LIMIT_EXCEEDED:
      'The materialization shard exceeds its trade, document, or four MiB limit.',
    ROOT_LIMIT_EXCEEDED: 'The materialization root exceeds its shard or 512 KiB limit.',
    INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
      'Projection materialization failed its internal artifact contract.',
  });

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeProjectionMaterializationError extends Error {
  readonly code: AflTradeProjectionMaterializationErrorCode;

  constructor(code: AflTradeProjectionMaterializationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionMaterializationError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeProjectionMaterializationError';
    code: AflTradeProjectionMaterializationErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeProjectionMaterializationError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeProjectionMaterializationError(
  value: unknown
): value is AflTradeProjectionMaterializationError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function fail(code: AflTradeProjectionMaterializationErrorCode): never {
  throw new AflTradeProjectionMaterializationError(code);
}

function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeProjectionMaterializationErrorCode
): T {
  try {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
  } catch {
    // Hostile inputs collapse to a stable trusted error.
  }
  return fail(code);
}

function snapshot(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    if (nodeUtilTypes.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    const expected = new Set(keys);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !expected.has(key))
    )
      return null;
    const captured = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
        return null;
      }
      captured[key] = descriptor.value;
    }
    return captured;
  } catch {
    return null;
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key, value), seen);
  return Object.freeze(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

type AdmissionContainer = unknown[] | Record<string, unknown>;

interface AdmissionVisitFrame {
  readonly kind: 'visit';
  readonly value: unknown;
  readonly depth: number;
  readonly parent: AdmissionContainer | null;
  readonly key: string | number | null;
}

interface AdmissionExitFrame {
  readonly kind: 'exit';
  readonly source: object;
}

type AdmissionFrame = AdmissionVisitFrame | AdmissionExitFrame;

interface AdmittedCanonicalJson {
  readonly snapshot: unknown;
  readonly byteLength: number;
  readonly nodeCount: number;
}

function assignAdmissionSnapshot(
  parent: AdmissionContainer | null,
  key: string | number | null,
  snapshot: unknown,
  setRoot: (value: unknown) => void
): void {
  if (parent === null) {
    setRoot(snapshot);
    return;
  }
  if (Array.isArray(parent)) {
    parent[key as number] = snapshot;
    return;
  }
  Object.defineProperty(parent, key as string, {
    configurable: true,
    enumerable: true,
    value: snapshot,
    writable: true,
  });
}

function canonicalJsonStringByteLength(
  value: string,
  remainingBytes: number,
  sizeCode: AflTradeProjectionMaterializationErrorCode
): number {
  if (value.length + 2 > remainingBytes) fail(sizeCode);
  let byteLength = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      byteLength += 2;
    } else if (codeUnit <= 0x1f) {
      byteLength +=
        codeUnit === 0x08 ||
        codeUnit === 0x09 ||
        codeUnit === 0x0a ||
        codeUnit === 0x0c ||
        codeUnit === 0x0d
          ? 2
          : 6;
    } else if (codeUnit <= 0x7f) {
      byteLength += 1;
    } else if (codeUnit <= 0x7ff) {
      byteLength += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        byteLength += 4;
        index += 1;
      } else {
        byteLength += 6;
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      byteLength += 6;
    } else {
      byteLength += 3;
    }
    if (byteLength > remainingBytes) fail(sizeCode);
  }
  return byteLength;
}

function admitCanonicalJson(
  value: unknown,
  maximumBytes: number,
  maximumNodes: number,
  invalidCode: AflTradeProjectionMaterializationErrorCode,
  sizeCode: AflTradeProjectionMaterializationErrorCode
): AdmittedCanonicalJson {
  let rootSnapshot: unknown;
  let byteLength = 0;
  let nodeCount = 0;
  const ancestors = new WeakSet<object>();
  const frames: AdmissionFrame[] = [{ kind: 'visit', value, depth: 0, parent: null, key: null }];
  const charge = (additionalBytes: number): void => {
    if (additionalBytes > maximumBytes - byteLength) fail(sizeCode);
    byteLength += additionalBytes;
  };
  try {
    while (frames.length > 0) {
      const frame = frames.pop();
      if (frame === undefined) break;
      if (frame.kind === 'exit') {
        ancestors.delete(frame.source);
        continue;
      }
      nodeCount += 1;
      if (
        nodeCount > maximumNodes ||
        frame.depth > AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_ADMISSION_DEPTH
      ) {
        fail(sizeCode);
      }
      const setSnapshot = (snapshot: unknown): void => {
        assignAdmissionSnapshot(frame.parent, frame.key, snapshot, (root) => {
          rootSnapshot = root;
        });
      };
      if (frame.value === null) {
        charge(4);
        setSnapshot(null);
        continue;
      }
      if (typeof frame.value === 'boolean') {
        charge(frame.value ? 4 : 5);
        setSnapshot(frame.value);
        continue;
      }
      if (typeof frame.value === 'string') {
        charge(canonicalJsonStringByteLength(frame.value, maximumBytes - byteLength, sizeCode));
        setSnapshot(frame.value);
        continue;
      }
      if (typeof frame.value === 'number') {
        if (!Number.isFinite(frame.value)) fail(invalidCode);
        const serialized = JSON.stringify(frame.value);
        charge(serialized.length);
        setSnapshot(frame.value);
        continue;
      }
      if (
        typeof frame.value !== 'object' ||
        nodeUtilTypes.isProxy(frame.value) ||
        ancestors.has(frame.value)
      ) {
        fail(invalidCode);
      }
      const source = frame.value;
      const prototype = Object.getPrototypeOf(source);
      const ownKeys = Reflect.ownKeys(source);
      if (Array.isArray(source)) {
        if (prototype !== Array.prototype || ownKeys.some((key) => typeof key !== 'string')) {
          fail(invalidCode);
        }
        const lengthDescriptor = Reflect.getOwnPropertyDescriptor(source, 'length');
        const rawLength = lengthDescriptor?.value;
        if (
          lengthDescriptor === undefined ||
          'get' in lengthDescriptor ||
          !Number.isSafeInteger(rawLength) ||
          (rawLength as number) < 0
        ) {
          fail(invalidCode);
        }
        const length = rawLength as number;
        if (
          ownKeys.length !== length + 1 ||
          nodeCount + length > maximumNodes ||
          (length > 0 && length * 2 + 1 > maximumBytes - byteLength)
        ) {
          fail(
            nodeCount + length > maximumNodes ||
              (length > 0 && length * 2 + 1 > maximumBytes - byteLength)
              ? sizeCode
              : invalidCode
          );
        }
        const values: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = Reflect.getOwnPropertyDescriptor(source, String(index));
          if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
            fail(invalidCode);
          }
          values.push(descriptor.value);
        }
        charge(2 + Math.max(0, length - 1));
        const snapshot = new Array<unknown>(length);
        setSnapshot(snapshot);
        ancestors.add(source);
        frames.push({ kind: 'exit', source });
        for (let index = length - 1; index >= 0; index -= 1) {
          frames.push({
            kind: 'visit',
            value: values[index],
            depth: frame.depth + 1,
            parent: snapshot,
            key: index,
          });
        }
        continue;
      }
      if (
        (prototype !== Object.prototype && prototype !== null) ||
        ownKeys.some((key) => typeof key !== 'string')
      ) {
        fail(invalidCode);
      }
      const keys = (ownKeys as string[]).sort();
      if (
        nodeCount + keys.length > maximumNodes ||
        (keys.length > 0 && keys.length * 4 + 1 > maximumBytes - byteLength)
      ) {
        fail(sizeCode);
      }
      const values = new Map<string, unknown>();
      charge(2 + Math.max(0, keys.length - 1));
      for (const key of keys) {
        const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
        if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
          fail(invalidCode);
        }
        charge(canonicalJsonStringByteLength(key, maximumBytes - byteLength, sizeCode));
        charge(1);
        values.set(key, descriptor.value);
      }
      const snapshot = Object.create(null) as Record<string, unknown>;
      setSnapshot(snapshot);
      ancestors.add(source);
      frames.push({ kind: 'exit', source });
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        frames.push({
          kind: 'visit',
          value: values.get(key),
          depth: frame.depth + 1,
          parent: snapshot,
          key,
        });
      }
    }
  } catch (error) {
    if (isAflTradeProjectionMaterializationError(error)) throw error;
    return fail(invalidCode);
  }
  return { snapshot: rootSnapshot, byteLength, nodeCount };
}

function preflightArray(
  value: unknown,
  maximumItems: number,
  invalidCode: AflTradeProjectionMaterializationErrorCode
): unknown[] {
  try {
    if (!Array.isArray(value) || nodeUtilTypes.isProxy(value)) fail(invalidCode);
    const prototype = Object.getPrototypeOf(value);
    const ownKeys = Reflect.ownKeys(value);
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    const rawLength = lengthDescriptor?.value;
    if (
      prototype !== Array.prototype ||
      lengthDescriptor === undefined ||
      'get' in lengthDescriptor ||
      !Number.isInteger(rawLength) ||
      (rawLength as number) < 1 ||
      (rawLength as number) > maximumItems ||
      ownKeys.some((key) => typeof key !== 'string') ||
      ownKeys.length !== (rawLength as number) + 1
    ) {
      fail(invalidCode);
    }
    const length = rawLength as number;
    const items: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
        fail(invalidCode);
      }
      const item = descriptor.value;
      if (item === null || typeof item !== 'object') fail(invalidCode);
      items.push(item);
    }
    return items;
  } catch (error) {
    if (isAflTradeProjectionMaterializationError(error)) throw error;
    return fail(invalidCode);
  }
}

function admitCapturedInput(
  captured: Record<string, unknown>,
  collectionKey: string,
  collection: readonly unknown[],
  maximumBytes: number,
  invalidCode: AflTradeProjectionMaterializationErrorCode,
  sizeCode: AflTradeProjectionMaterializationErrorCode
): Readonly<{ captured: Record<string, unknown>; collection: unknown[] }> {
  let aggregateBytes = 0;
  let aggregateNodes = 0;
  const admittedCaptured = Object.create(null) as Record<string, unknown>;
  for (const [key, fieldValue] of Object.entries(captured)) {
    if (key === collectionKey) continue;
    const admitted = admitCanonicalJson(
      { key, value: fieldValue },
      maximumBytes - aggregateBytes,
      AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_ADMISSION_NODES - aggregateNodes,
      invalidCode,
      sizeCode
    );
    aggregateBytes += admitted.byteLength;
    aggregateNodes += admitted.nodeCount;
    const wrapper = admitted.snapshot as Record<string, unknown>;
    admittedCaptured[key] = wrapper.value;
  }
  const admittedCollection: unknown[] = [];
  for (const [index, item] of collection.entries()) {
    const admitted = admitCanonicalJson(
      { key: collectionKey, index, value: item },
      maximumBytes - aggregateBytes,
      AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_ADMISSION_NODES - aggregateNodes,
      invalidCode,
      sizeCode
    );
    aggregateBytes += admitted.byteLength;
    aggregateNodes += admitted.nodeCount;
    const wrapper = admitted.snapshot as Record<string, unknown>;
    admittedCollection.push(wrapper.value);
  }
  admittedCaptured[collectionKey] = admittedCollection;
  return Object.freeze({ captured: admittedCaptured, collection: admittedCollection });
}

interface Parents {
  publication: AflTradePublicationManifestV3 | AflTradePublicationManifestV4;
  inventoryIndex: AflTradeValuationOutputInventoryIndexResult;
  evidenceIndex: AflTradeProjectionPublicEvidenceIndexResult;
  policy: AflTradeProjectionPresentationPolicyResult;
  schemaBundle: AflTradeAnyProjectionSchemaBundleResult;
  bindings: Pick<
    AflTradeProjectionMaterializationShardResult['projectionMaterializationShard']['content'],
    | 'publication'
    | 'valuationOutputInventoryIndex'
    | 'projectionPublicEvidenceIndex'
    | 'projectionPresentationPolicy'
    | 'projectionSchemaBundle'
    | 'scopeKey'
    | 'valueUnitId'
    | 'publicAssetBoundary'
  >;
}

function authenticateParents(
  input: {
    publication: z.infer<typeof publicationInputSchema>;
    valuationOutputInventoryIndex: AflTradeValuationOutputInventoryIndexResult;
    projectionPublicEvidenceIndex: AflTradeProjectionPublicEvidenceIndexResult;
    projectionPresentationPolicy: AflTradeProjectionPresentationPolicyResult;
    projectionSchemaBundle: AflTradeAnyProjectionSchemaBundleResult;
  },
  materializedAt: string
): Parents {
  const publication = input.publication.publicationManifest;
  const inventoryIndex = input.valuationOutputInventoryIndex;
  const evidenceIndex = input.projectionPublicEvidenceIndex;
  const policy = input.projectionPresentationPolicy;
  const schemaBundle = input.projectionSchemaBundle;
  if (
    !doesAflTradeArtifactRefMatchCanonicalJson(input.publication.artifactRef, publication) ||
    input.publication.artifactRef.createdAt !== publication.content.createdAt
  )
    fail('PARENT_BINDING_MISMATCH');
  const publicationIndex = publication.content.valuationOutputInventoryIndex;
  const publicationPolicy = publication.content.projectionPresentationPolicy;
  const evidenceContent = evidenceIndex.projectionPublicEvidenceIndex.content;
  const inventoryContent = inventoryIndex.valuationOutputInventoryIndex.content;
  const policyContent = policy.projectionPresentationPolicy.content;
  const schemaBundleContent = schemaBundle.projectionSchemaBundle.content;
  const completeInventoryBinding = {
    schemaVersion: inventoryContent.schemaVersion,
    valuationOutputInventoryIndexId:
      inventoryIndex.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
    artifactRef: inventoryIndex.valuationOutputInventoryIndexArtifactRef,
    entryCount: inventoryContent.entryCount,
    inventorySetSha256: inventoryContent.inventorySetSha256,
  };
  const completePolicyBinding = {
    schemaVersion: policyContent.schemaVersion,
    projectionPresentationPolicyId:
      policy.projectionPresentationPolicy.projectionPresentationPolicyId,
    artifactRef: policy.projectionPresentationPolicyArtifactRef,
    valueUnitId: policyContent.valueUnit.id,
    universalLayer: policyContent.universalLayer,
    supportedViews: policyContent.supportedViews,
  };
  const completeEvidenceIndexBinding = {
    schemaVersion: evidenceContent.schemaVersion,
    projectionPublicEvidenceIndexId:
      evidenceIndex.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId,
    artifactRef: evidenceIndex.projectionPublicEvidenceIndexArtifactRef,
    publicationId: evidenceContent.publication.publicationId,
    valuationOutputInventoryIndexId:
      evidenceContent.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
    scopeKey: evidenceContent.scopeKey,
    valueUnitId: evidenceContent.valueUnitId,
    indexedEvidenceSchemaVersion: evidenceContent.indexedEvidenceSchemaVersion,
    entryCount: evidenceContent.entryCount,
    evidenceBindingSetSha256: evidenceContent.evidenceBindingSetSha256,
  };
  const commonSchemaBundleBinding = {
    projectionSchemaBundleId: schemaBundle.projectionSchemaBundle.projectionSchemaBundleId,
    artifactRef: schemaBundle.projectionSchemaBundleArtifactRef,
    responseContractVersion: schemaBundleContent.responseContractVersion,
    valuationExportContractVersion: schemaBundleContent.valuationExportContractVersion,
  };
  const completeSchemaBundleBinding =
    schemaBundleContent.schemaVersion === 'afl-trade-projection-schema-bundle/v2'
      ? {
          ...commonSchemaBundleBinding,
          schemaVersion: schemaBundleContent.schemaVersion,
          publicationManifestSchemaVersion: schemaBundleContent.publicationManifestSchemaVersion,
          projectionManifestSchemaVersion: schemaBundleContent.projectionManifestSchemaVersion,
        }
      : {
          ...commonSchemaBundleBinding,
          schemaVersion: schemaBundleContent.schemaVersion,
        };
  if (
    (publication.content.schemaVersion === 'afl-trade-publication/v3' &&
      schemaBundleContent.schemaVersion !== 'afl-trade-projection-schema-bundle/v1') ||
    (publication.content.schemaVersion === 'afl-trade-publication/v4' &&
      schemaBundleContent.schemaVersion !== 'afl-trade-projection-schema-bundle/v2') ||
    inventoryContent.scopeKey !== publication.content.scopeKey ||
    inventoryContent.valueUnitId !== publication.content.valueUnitId ||
    inventoryContent.valuationBundle.valuationBundleId !== publication.content.valuationBundleId ||
    inventoryContent.entryCount !== publication.content.entryCount ||
    !sameJson(publicationIndex, completeInventoryBinding) ||
    !sameJson(publicationPolicy, completePolicyBinding) ||
    evidenceContent.publication.publicationId !== publication.publicationId ||
    !sameJson(evidenceContent.publication.artifactRef, input.publication.artifactRef) ||
    !sameJson(evidenceContent.valuationOutputInventoryIndex, completeInventoryBinding) ||
    evidenceContent.scopeKey !== publication.content.scopeKey ||
    evidenceContent.valueUnitId !== publication.content.valueUnitId ||
    policy.projectionPresentationPolicy.content.valueUnit.id !== publication.content.valueUnitId ||
    !sameJson(
      policy.projectionPresentationPolicy.content.supportedViews,
      publication.content.supportedViews
    ) ||
    !sameJson(
      schemaBundle.projectionSchemaBundle.content.supportedViews,
      publication.content.supportedViews
    )
  )
    fail('PARENT_BINDING_MISMATCH');
  if (
    evidenceContent.entries.length !== inventoryContent.entries.length ||
    evidenceContent.entries.some((evidenceEntry, index) => {
      const inventoryEntry = inventoryContent.entries[index];
      return (
        inventoryEntry === undefined ||
        evidenceEntry.tradeId !== inventoryEntry.tradeId ||
        evidenceEntry.valuationCaseId !== inventoryEntry.valuationCaseId ||
        evidenceEntry.valuationOutputInventoryId !== inventoryEntry.valuationOutputInventoryId ||
        !sameJson(evidenceEntry.inventoryArtifactRef, inventoryEntry.inventoryArtifactRef)
      );
    })
  )
    fail('PARENT_BINDING_MISMATCH');
  const parentRefs = [
    input.publication.artifactRef,
    inventoryIndex.valuationOutputInventoryIndexArtifactRef,
    evidenceIndex.projectionPublicEvidenceIndexArtifactRef,
    policy.projectionPresentationPolicyArtifactRef,
    schemaBundle.projectionSchemaBundleArtifactRef,
  ];
  if (parentRefs.some((reference) => Date.parse(reference.createdAt) > Date.parse(materializedAt)))
    fail('NON_MONOTONIC_ARTIFACT_TIME');
  return {
    publication,
    inventoryIndex,
    evidenceIndex,
    policy,
    schemaBundle,
    bindings: {
      publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
      publication: {
        publicationId: publication.publicationId,
        artifactRef: input.publication.artifactRef,
      },
      valuationOutputInventoryIndex: {
        ...completeInventoryBinding,
      },
      projectionPublicEvidenceIndex: {
        ...completeEvidenceIndexBinding,
      },
      projectionPresentationPolicy: {
        ...completePolicyBinding,
      },
      projectionSchemaBundle: {
        ...completeSchemaBundleBinding,
      },
      scopeKey: publication.content.scopeKey,
      valueUnitId: publication.content.valueUnitId,
    },
  };
}

function entryFor(
  evidence: AflTradeProjectionPublicEvidenceIndexEntry,
  verification: AflTradeProjectionEvidenceSourceVerificationResult,
  result: AflTradeProjectionTradeMaterializationResult,
  parents: Parents,
  materializedAt: string
): AflTradeProjectionMaterializationEntry {
  const receipt = result.projectionTradeMaterialization;
  const content = receipt.content;
  const verificationArtifact = verification.projectionEvidenceSourceVerification;
  const verificationContent = verificationArtifact.content;
  if (verificationContent.status !== 'passed') fail('SOURCE_VERIFICATION_NOT_PASSED');
  if (
    content.tradeId !== evidence.tradeId ||
    content.scopeKey !== parents.bindings.scopeKey ||
    content.valueUnitId !== parents.bindings.valueUnitId ||
    content.publication.semanticId !== parents.publication.publicationId ||
    !sameJson(content.publication.artifactRef, parents.bindings.publication.artifactRef)
  )
    fail('MATERIALIZATION_BINDING_MISMATCH');
  if (
    content.valuationOutputInventoryIndex.semanticId !==
      parents.inventoryIndex.valuationOutputInventoryIndex.valuationOutputInventoryIndexId ||
    !sameJson(
      content.valuationOutputInventoryIndex.artifactRef,
      parents.inventoryIndex.valuationOutputInventoryIndexArtifactRef
    ) ||
    content.projectionPublicEvidenceIndex.semanticId !==
      parents.evidenceIndex.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId ||
    !sameJson(
      content.projectionPublicEvidenceIndex.artifactRef,
      parents.evidenceIndex.projectionPublicEvidenceIndexArtifactRef
    ) ||
    content.projectionPresentationPolicy.semanticId !==
      parents.policy.projectionPresentationPolicy.projectionPresentationPolicyId ||
    !sameJson(
      content.projectionPresentationPolicy.artifactRef,
      parents.policy.projectionPresentationPolicyArtifactRef
    ) ||
    content.valuationOutputInventory.semanticId !== evidence.valuationOutputInventoryId ||
    !sameJson(content.valuationOutputInventory.artifactRef, evidence.inventoryArtifactRef) ||
    content.valuationCase.semanticId !== evidence.valuationCaseId ||
    content.projectionPublicEvidence.semanticId !== evidence.projectionPublicEvidenceId ||
    !sameJson(content.projectionPublicEvidence.artifactRef, evidence.evidenceArtifactRef) ||
    verificationContent.projectionPublicEvidence.projectionPublicEvidenceId !==
      evidence.projectionPublicEvidenceId ||
    !sameJson(
      verificationContent.projectionPublicEvidence.artifactRef,
      evidence.evidenceArtifactRef
    ) ||
    content.evidenceSourceVerification.semanticId !==
      verificationArtifact.projectionEvidenceSourceVerificationId ||
    !sameJson(
      content.evidenceSourceVerification.artifactRef,
      verification.projectionEvidenceSourceVerificationArtifactRef
    ) ||
    content.evidenceSourceVerification.sourceArtifactSetSha256 !==
      verificationContent.sourceArtifactSetSha256
  )
    fail('MATERIALIZATION_BINDING_MISMATCH');
  const times = [
    evidence.evidenceArtifactRef.createdAt,
    verification.projectionEvidenceSourceVerificationArtifactRef.createdAt,
    result.projectionTradeMaterializationArtifactRef.createdAt,
    ...result.projectionDocuments.map(
      (document) => document.projectionDocumentArtifactRef.createdAt
    ),
  ];
  if (times.some((createdAt) => Date.parse(createdAt) > Date.parse(materializedAt)))
    fail('NON_MONOTONIC_ARTIFACT_TIME');
  if (
    Date.parse(parents.evidenceIndex.projectionPublicEvidenceIndexArtifactRef.createdAt) >
      Date.parse(verification.projectionEvidenceSourceVerificationArtifactRef.createdAt) ||
    Date.parse(evidence.evidenceArtifactRef.createdAt) >
      Date.parse(verification.projectionEvidenceSourceVerificationArtifactRef.createdAt) ||
    Date.parse(verification.projectionEvidenceSourceVerificationArtifactRef.createdAt) >
      Date.parse(result.projectionTradeMaterializationArtifactRef.createdAt)
  )
    fail('NON_MONOTONIC_ARTIFACT_TIME');
  if (
    [
      parents.bindings.publication.artifactRef,
      parents.bindings.valuationOutputInventoryIndex.artifactRef,
      parents.bindings.projectionPublicEvidenceIndex.artifactRef,
      parents.bindings.projectionPresentationPolicy.artifactRef,
    ].some(
      (reference) =>
        Date.parse(reference.createdAt) >
        Date.parse(result.projectionTradeMaterializationArtifactRef.createdAt)
    )
  )
    fail('NON_MONOTONIC_ARTIFACT_TIME');
  if (
    Date.parse(content.knowledgeCutoffAt) > Date.parse(content.calculationAsOf) ||
    Date.parse(content.calculationAsOf) >
      Date.parse(result.projectionTradeMaterializationArtifactRef.createdAt) ||
    result.projectionDocuments.some(
      (document) =>
        Date.parse(document.projectionDocumentArtifactRef.createdAt) <
        Date.parse(content.calculationAsOf)
    )
  )
    fail('NON_MONOTONIC_ARTIFACT_TIME');
  return parse(
    aflTradeProjectionMaterializationEntrySchema,
    {
      tradeId: evidence.tradeId,
      valuationCaseId: evidence.valuationCaseId,
      valuationCalculationId: evidence.valuationCalculationId,
      valuationOutputInventoryId: evidence.valuationOutputInventoryId,
      inventoryArtifactRef: evidence.inventoryArtifactRef,
      projectionPublicEvidence: {
        projectionPublicEvidenceId: evidence.projectionPublicEvidenceId,
        artifactRef: evidence.evidenceArtifactRef,
      },
      evidenceSourceVerification: {
        projectionEvidenceSourceVerificationId:
          verificationArtifact.projectionEvidenceSourceVerificationId,
        artifactRef: verification.projectionEvidenceSourceVerificationArtifactRef,
        status: 'passed',
        sourceArtifactSetSha256: verificationContent.sourceArtifactSetSha256,
      },
      projectionTradeMaterialization: {
        projectionTradeMaterializationId: receipt.projectionTradeMaterializationId,
        artifactRef: result.projectionTradeMaterializationArtifactRef,
        documentSetSha256: content.documentSetSha256,
      },
      documentCount: content.documentCount,
      documents: content.documents,
    },
    'INTERNAL_ARTIFACT_CONTRACT_VIOLATION'
  );
}

const SHARD_KEYS = [
  ...Object.keys(commonInputShape),
  'shardOrdinal',
  'projectionTradeMaterializerVerifications',
  'materializedAt',
] as const;
const ROOT_KEYS = [
  ...Object.keys(commonInputShape),
  'projectionMaterializationShardVerifications',
  'materializedAt',
] as const;

function parseCommon(snapshotValue: Record<string, unknown>) {
  return {
    publication: parse(
      publicationInputSchema,
      snapshotValue.publication,
      'INVALID_PUBLICATION_BINDING'
    ),
    valuationOutputInventoryIndex: parse(
      aflTradeValuationOutputInventoryIndexResultSchema,
      snapshotValue.valuationOutputInventoryIndex,
      'INVALID_INVENTORY_INDEX'
    ),
    projectionPublicEvidenceIndex: parse(
      aflTradeProjectionPublicEvidenceIndexResultSchema,
      snapshotValue.projectionPublicEvidenceIndex,
      'INVALID_EVIDENCE_INDEX'
    ),
    projectionPresentationPolicy: parse(
      aflTradeProjectionPresentationPolicyResultSchema,
      snapshotValue.projectionPresentationPolicy,
      'INVALID_PRESENTATION_POLICY'
    ),
    projectionSchemaBundle: parse(
      aflTradeAnyProjectionSchemaBundleResultSchema,
      snapshotValue.projectionSchemaBundle,
      'INVALID_SCHEMA_BUNDLE'
    ),
  };
}

export function createAflTradeProjectionMaterializationShard(
  value: unknown
): AflTradeProjectionMaterializationShardResult {
  const captured = snapshot(value, SHARD_KEYS);
  if (captured === null) fail('INVALID_INPUT_ENVELOPE');
  const rawTradeVerifications = preflightArray(
    captured.projectionTradeMaterializerVerifications,
    AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_TRADES_PER_SHARD,
    'INVALID_TRADE_MATERIALIZATIONS'
  );
  const admitted = admitCapturedInput(
    captured,
    'projectionTradeMaterializerVerifications',
    rawTradeVerifications,
    AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARD_INPUT_BYTES,
    'INVALID_TRADE_MATERIALIZATIONS',
    'SHARD_INPUT_SIZE_LIMIT_EXCEEDED'
  );
  const admittedCaptured = admitted.captured;
  const common = parseCommon(admittedCaptured);
  const shardOrdinal = parse(
    z
      .number()
      .int()
      .nonnegative()
      .max(AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARDS - 1),
    admittedCaptured.shardOrdinal,
    'INVALID_INPUT_ENVELOPE'
  );
  const tradeVerifications = admitted.collection.map((verification) =>
    parse(
      aflTradeProjectionTradeMaterializationVerifyInputSchema,
      verification,
      'INVALID_TRADE_MATERIALIZATIONS'
    )
  );
  if (
    tradeVerifications.some(
      (verification) => !verifyAflTradeProjectionTradeMaterialization(verification)
    )
  )
    fail('INVALID_TRADE_MATERIALIZATIONS');
  const materializations = tradeVerifications.map((verification) => verification.output);
  const verifications = tradeVerifications.map(
    (verification) => verification.evidenceSourceVerification.output
  );
  const calculationAsOf =
    materializations[0].projectionTradeMaterialization.content.calculationAsOf;
  const knowledgeCutoffAt =
    materializations[0].projectionTradeMaterialization.content.knowledgeCutoffAt;
  if (
    materializations.some(
      (result) =>
        result.projectionTradeMaterialization.content.calculationAsOf !== calculationAsOf ||
        result.projectionTradeMaterialization.content.knowledgeCutoffAt !== knowledgeCutoffAt
    )
  )
    fail('MATERIALIZATION_BINDING_MISMATCH');
  const materializedAt = parse(
    aflTradeIsoDateTimeSchema,
    admittedCaptured.materializedAt,
    'INVALID_INPUT_ENVELOPE'
  );
  const parents = authenticateParents(common, materializedAt);
  const evidenceByTrade = new Map(
    parents.evidenceIndex.projectionPublicEvidenceIndex.content.entries.map((entry) => [
      entry.tradeId,
      entry,
    ])
  );
  const verificationByEvidence = new Map(
    verifications.map((result) => [
      result.projectionEvidenceSourceVerification.content.projectionPublicEvidence
        .projectionPublicEvidenceId,
      result,
    ])
  );
  const receiptByTrade = new Map(
    materializations.map((result) => [
      result.projectionTradeMaterialization.content.tradeId,
      result,
    ])
  );
  if (
    verificationByEvidence.size !== verifications.length ||
    receiptByTrade.size !== materializations.length
  )
    fail('MATERIALIZATION_BINDING_MISMATCH');
  const entries = [...receiptByTrade.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([tradeId, result]) => {
      const evidence = evidenceByTrade.get(tradeId);
      if (evidence === undefined) fail('TRADE_UNIVERSE_MISMATCH');
      const verification = verificationByEvidence.get(evidence.projectionPublicEvidenceId);
      if (verification === undefined) fail('MATERIALIZATION_BINDING_MISMATCH');
      return entryFor(evidence, verification, result, parents, materializedAt);
    });
  const documentCount = entries.reduce((sum, entry) => sum + entry.documentCount, 0);
  if (documentCount > AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_DOCUMENTS_PER_SHARD)
    fail('SHARD_LIMIT_EXCEEDED');
  const content = {
    schemaVersion: AFL_TRADE_PROJECTION_MATERIALIZATION_SHARD_SCHEMA_VERSION,
    ...parents.bindings,
    calculationAsOf,
    knowledgeCutoffAt,
    shardOrdinal,
    ordering: AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_ORDERING,
    digestDefinition: AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_DIGEST_DEFINITION,
    tradeCount: entries.length,
    documentCount,
    entrySetSha256: sha256AflTradeCanonicalJson(entries),
    entries,
    materializedAt,
    limitation: AFL_TRADE_PROJECTION_MATERIALIZATION_LIMITATION,
  };
  const projectionMaterializationShard = parse(
    aflTradeProjectionMaterializationShardSchema,
    {
      projectionMaterializationShardId: createAflTradeContentAddress(
        'projection-materialization-shard',
        content
      ),
      content,
    },
    'INTERNAL_ARTIFACT_CONTRACT_VIOLATION'
  );
  const output = parse(
    aflTradeProjectionMaterializationShardResultSchema,
    {
      projectionMaterializationShard,
      projectionMaterializationShardArtifactRef: createAflTradeCanonicalJsonArtifactRef(
        projectionMaterializationShard,
        materializedAt
      ),
    },
    'SHARD_LIMIT_EXCEEDED'
  );
  return deepFreeze(output);
}

function shardBindingFor(result: AflTradeProjectionMaterializationShardResult) {
  const shard = result.projectionMaterializationShard;
  const content = shard.content;
  return {
    shardOrdinal: content.shardOrdinal,
    projectionMaterializationShardId: shard.projectionMaterializationShardId,
    artifactRef: result.projectionMaterializationShardArtifactRef,
    tradeCount: content.tradeCount,
    documentCount: content.documentCount,
    entrySetSha256: content.entrySetSha256,
    firstTradeId: content.entries[0].tradeId,
    lastTradeId: content.entries.at(-1)?.tradeId ?? content.entries[0].tradeId,
  };
}

export function createAflTradeProjectionMaterialization(
  value: unknown
): AflTradeProjectionMaterializationResult {
  const captured = snapshot(value, ROOT_KEYS);
  if (captured === null) fail('INVALID_INPUT_ENVELOPE');
  const rawShardVerifications = preflightArray(
    captured.projectionMaterializationShardVerifications,
    AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_SHARDS,
    'INVALID_SHARDS'
  );
  const admitted = admitCapturedInput(
    captured,
    'projectionMaterializationShardVerifications',
    rawShardVerifications,
    AFL_TRADE_PROJECTION_MATERIALIZATION_MAX_ROOT_INPUT_BYTES,
    'INVALID_SHARDS',
    'ROOT_INPUT_SIZE_LIMIT_EXCEEDED'
  );
  const admittedCaptured = admitted.captured;
  const common = parseCommon(admittedCaptured);
  const shardVerifications = admitted.collection.map((verification) =>
    parse(aflTradeProjectionMaterializationShardVerifyInputSchema, verification, 'INVALID_SHARDS')
  );
  if (
    shardVerifications.some(
      (verification) => !verifyAflTradeProjectionMaterializationShard(verification)
    )
  )
    fail('INVALID_SHARDS');
  const shards = shardVerifications.map((verification) => verification.output);
  const materializedAt = parse(
    aflTradeIsoDateTimeSchema,
    admittedCaptured.materializedAt,
    'INVALID_INPUT_ENVELOPE'
  );
  const parents = authenticateParents(common, materializedAt);
  const ordered = [...shards].sort(
    (left, right) =>
      left.projectionMaterializationShard.content.shardOrdinal -
      right.projectionMaterializationShard.content.shardOrdinal
  );
  if (
    ordered.some(
      (result, index) => result.projectionMaterializationShard.content.shardOrdinal !== index
    )
  )
    fail('INVALID_SHARDS');
  const calculationAsOf = ordered[0].projectionMaterializationShard.content.calculationAsOf;
  const knowledgeCutoffAt = ordered[0].projectionMaterializationShard.content.knowledgeCutoffAt;
  for (const result of ordered) {
    const content = result.projectionMaterializationShard.content;
    if (
      !sameJson(content.publication, parents.bindings.publication) ||
      !sameJson(
        content.valuationOutputInventoryIndex,
        parents.bindings.valuationOutputInventoryIndex
      ) ||
      !sameJson(
        content.projectionPublicEvidenceIndex,
        parents.bindings.projectionPublicEvidenceIndex
      ) ||
      !sameJson(
        content.projectionPresentationPolicy,
        parents.bindings.projectionPresentationPolicy
      ) ||
      !sameJson(content.projectionSchemaBundle, parents.bindings.projectionSchemaBundle) ||
      content.scopeKey !== parents.bindings.scopeKey ||
      content.valueUnitId !== parents.bindings.valueUnitId ||
      content.calculationAsOf !== calculationAsOf ||
      content.knowledgeCutoffAt !== knowledgeCutoffAt
    )
      fail('PARENT_BINDING_MISMATCH');
    if (
      Date.parse(result.projectionMaterializationShardArtifactRef.createdAt) >
      Date.parse(materializedAt)
    )
      fail('NON_MONOTONIC_ARTIFACT_TIME');
  }
  const entries = ordered.flatMap(
    (result) => result.projectionMaterializationShard.content.entries
  );
  const evidenceEntries = parents.evidenceIndex.projectionPublicEvidenceIndex.content.entries;
  if (
    entries.length !== evidenceEntries.length ||
    entries.some((entry, index) => {
      const evidence = evidenceEntries[index];
      return (
        evidence === undefined ||
        entry.tradeId !== evidence.tradeId ||
        entry.valuationCaseId !== evidence.valuationCaseId ||
        entry.valuationCalculationId !== evidence.valuationCalculationId ||
        entry.valuationOutputInventoryId !== evidence.valuationOutputInventoryId ||
        !sameJson(entry.inventoryArtifactRef, evidence.inventoryArtifactRef) ||
        entry.projectionPublicEvidence.projectionPublicEvidenceId !==
          evidence.projectionPublicEvidenceId ||
        !sameJson(entry.projectionPublicEvidence.artifactRef, evidence.evidenceArtifactRef)
      );
    })
  )
    fail('TRADE_UNIVERSE_MISMATCH');
  for (const identities of [
    entries.map((entry) => entry.tradeId),
    entries.map((entry) => entry.projectionPublicEvidence.projectionPublicEvidenceId),
    entries.map((entry) => entry.projectionPublicEvidence.artifactRef.artifactId),
    entries.map((entry) => entry.evidenceSourceVerification.projectionEvidenceSourceVerificationId),
    entries.map((entry) => entry.evidenceSourceVerification.artifactRef.artifactId),
    entries.map((entry) => entry.projectionTradeMaterialization.projectionTradeMaterializationId),
    entries.map((entry) => entry.projectionTradeMaterialization.artifactRef.artifactId),
    entries.flatMap((entry) => entry.documents.map((document) => document.projectionDocumentId)),
    entries.flatMap((entry) => entry.documents.map((document) => document.artifactRef.artifactId)),
  ]) {
    if (new Set(identities).size !== identities.length) fail('MATERIALIZATION_BINDING_MISMATCH');
  }
  const bindings = ordered.map(shardBindingFor);
  const content = {
    schemaVersion: AFL_TRADE_PROJECTION_MATERIALIZATION_SCHEMA_VERSION,
    ...parents.bindings,
    calculationAsOf,
    knowledgeCutoffAt,
    ordering: AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_ORDERING,
    entryDigestDefinition: AFL_TRADE_PROJECTION_MATERIALIZATION_ENTRY_DIGEST_DEFINITION,
    shardDigestDefinition: AFL_TRADE_PROJECTION_MATERIALIZATION_SHARD_DIGEST_DEFINITION,
    shardCount: bindings.length,
    tradeCount: entries.length,
    documentCount: entries.reduce((sum, entry) => sum + entry.documentCount, 0),
    evidenceTradeSetSha256: sha256AflTradeCanonicalJson(
      evidenceEntries.map((entry) => entry.tradeId)
    ),
    entrySetSha256: sha256AflTradeCanonicalJson(entries),
    shardSetSha256: sha256AflTradeCanonicalJson(bindings),
    shards: bindings,
    materializedAt,
    limitation: AFL_TRADE_PROJECTION_MATERIALIZATION_LIMITATION,
  };
  const projectionMaterialization = parse(
    aflTradeProjectionMaterializationSchema,
    {
      projectionMaterializationId: createAflTradeContentAddress(
        'projection-materialization',
        content
      ),
      content,
    },
    'INTERNAL_ARTIFACT_CONTRACT_VIOLATION'
  );
  const output = parse(
    aflTradeProjectionMaterializationResultSchema,
    {
      projectionMaterialization,
      projectionMaterializationArtifactRef: createAflTradeCanonicalJsonArtifactRef(
        projectionMaterialization,
        materializedAt
      ),
    },
    'ROOT_LIMIT_EXCEEDED'
  );
  return deepFreeze(output);
}

export function verifyAflTradeProjectionMaterializationShard(value: unknown): boolean {
  const captured = snapshot(value, [...SHARD_KEYS, 'output']);
  if (captured === null) return false;
  try {
    const expected = createAflTradeProjectionMaterializationShard(
      Object.fromEntries(SHARD_KEYS.map((key) => [key, captured[key]]))
    );
    const output = parse(
      aflTradeProjectionMaterializationShardResultSchema,
      captured.output,
      'INTERNAL_ARTIFACT_CONTRACT_VIOLATION'
    );
    return sameJson(expected, output);
  } catch {
    return false;
  }
}

export function verifyAflTradeProjectionMaterialization(value: unknown): boolean {
  const captured = snapshot(value, [...ROOT_KEYS, 'output']);
  if (captured === null) return false;
  try {
    const expected = createAflTradeProjectionMaterialization(
      Object.fromEntries(ROOT_KEYS.map((key) => [key, captured[key]]))
    );
    const output = parse(
      aflTradeProjectionMaterializationResultSchema,
      captured.output,
      'INTERNAL_ARTIFACT_CONTRACT_VIOLATION'
    );
    return sameJson(expected, output);
  } catch {
    return false;
  }
}
