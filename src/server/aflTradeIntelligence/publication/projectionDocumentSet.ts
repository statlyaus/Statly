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
import {
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_SCHEMA_VERSION,
  aflTradeValuationOutputInventoryIndexResultSchema,
  aflTradeValuationOutputInventoryIndexSchema,
  type AflTradeValuationOutputInventoryIndex,
} from '../artifacts/valuationOutputInventoryIndex';
import {
  AFL_TRADE_PROJECTION_DOCUMENT_KINDS,
  aflTradeProjectionMaterializationBindingSchema,
  aflTradeProjectionDocumentSchema,
  verifyAflTradeProjectionDocumentArtifact,
  type AflTradeProjectionMaterializationBinding,
} from './projectionDocumentContracts';
import {
  aflTradeProjectionMaterializationVerifyInputSchema,
  verifyAflTradeProjectionMaterialization,
  type AflTradeProjectionMaterializationResult,
} from './projectionMaterialization';

export const AFL_TRADE_PROJECTION_DOCUMENT_SET_SHARD_SCHEMA_VERSION =
  'afl-trade-projection-document-set-shard/v1' as const;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_SCHEMA_VERSION =
  'afl-trade-projection-document-set/v1' as const;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_ORDERING =
  'kind_rank_then_trade_id_then_view_rank_then_row_ordinal_then_document_id_v1' as const;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_MEMBERSHIP_DIGEST =
  'sha256_of_canonical_globally_ordered_detached_document_bindings_v1' as const;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_PREDECESSOR_COMPATIBILITY =
  'no_predecessor_no_latest_alias_no_implicit_conversion_v1' as const;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_RUNTIME_FALLBACK = 'prohibited' as const;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLICATION_AUTHORITY =
  'publication_registry_and_verified_v3_or_v4_publication_remain_sole_serving_authority_v1' as const;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_LIMITATION =
  'This immutable set totally replays the aggregate projection materialization and authenticates ordered detached projection-document membership plus one exact publication methodology. It does not persist document bytes, prove source rights or model validity, activate a publication, authorize fantasy state, or establish user or fantasy ownership.' as const;

export const AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD = 2_048;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_SHARD_BYTES = 4 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_ROOT_BYTES = 512 * 1024;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_AGGREGATE_DOCUMENT_BYTES = 64 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_AGGREGATE_SHARD_BYTES = 64 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS =
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES * (4 + 1 + 4 * 18) + 1;

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Projection document sets require canonical JSON artifact references.'
);
const projectionDocumentKindSchema = z.enum(AFL_TRADE_PROJECTION_DOCUMENT_KINDS);
const nullableViewSchema = z.enum(AFL_TRADE_VALUATION_VIEWS).nullable();

export const aflTradeProjectionDocumentSetKindCountsSchema = z
  .object({
    tradeSummary: z.number().int().nonnegative(),
    tradeDetail: z.number().int().nonnegative(),
    methodology: z.number().int().nonnegative(),
    valuationExportRow: z.number().int().nonnegative(),
  })
  .strict();

export type AflTradeProjectionDocumentSetKindCounts = z.infer<
  typeof aflTradeProjectionDocumentSetKindCountsSchema
>;

export const aflTradeProjectionDocumentSetBindingSchema = z
  .object({
    projectionDocumentId: aflTradeContentAddressedIdSchema('projection-document'),
    artifactRef: canonicalJsonArtifactRefSchema,
    kind: projectionDocumentKindSchema,
    tradeId: aflTradePublicIdSchema.nullable(),
    view: nullableViewSchema,
    rowOrdinal: z.number().int().nonnegative().max(17).nullable(),
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.kind === 'methodology') {
      if (binding.tradeId !== null || binding.view !== null || binding.rowOrdinal !== null) {
        context.addIssue({
          code: 'custom',
          message: 'Methodology membership cannot carry trade, view, or row coordinates.',
        });
      }
      return;
    }
    if (binding.tradeId === null) {
      context.addIssue({
        code: 'custom',
        path: ['tradeId'],
        message: 'Trade projection membership requires a trade identifier.',
      });
    }
    const requiresView =
      binding.kind === 'trade_summary' || binding.kind === 'valuation_export_row';
    if ((binding.view !== null) !== requiresView) {
      context.addIssue({
        code: 'custom',
        path: ['view'],
        message: 'Only summaries and export rows carry a valuation view coordinate.',
      });
    }
    const requiresOrdinal = binding.kind === 'valuation_export_row';
    if ((binding.rowOrdinal !== null) !== requiresOrdinal) {
      context.addIssue({
        code: 'custom',
        path: ['rowOrdinal'],
        message: 'Only export rows carry a row ordinal.',
      });
    }
  });

export type AflTradeProjectionDocumentSetBinding = z.infer<
  typeof aflTradeProjectionDocumentSetBindingSchema
>;

const predecessorPolicySchema = z
  .object({
    predecessorSchemaVersion: z.null(),
    compatibility: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_PREDECESSOR_COMPATIBILITY),
    latestAlias: z.literal('prohibited'),
    runtimeFallback: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_RUNTIME_FALLBACK),
    publicationAuthority: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLICATION_AUTHORITY),
  })
  .strict();

function emptyKindCounts(): AflTradeProjectionDocumentSetKindCounts {
  return {
    tradeSummary: 0,
    tradeDetail: 0,
    methodology: 0,
    valuationExportRow: 0,
  };
}

function countKinds(
  bindings: readonly AflTradeProjectionDocumentSetBinding[]
): AflTradeProjectionDocumentSetKindCounts {
  const counts = emptyKindCounts();
  for (const binding of bindings) {
    if (binding.kind === 'trade_summary') counts.tradeSummary += 1;
    else if (binding.kind === 'trade_detail') counts.tradeDetail += 1;
    else if (binding.kind === 'methodology') counts.methodology += 1;
    else counts.valuationExportRow += 1;
  }
  return counts;
}

function sumKindCounts(
  values: readonly AflTradeProjectionDocumentSetKindCounts[]
): AflTradeProjectionDocumentSetKindCounts {
  return values.reduce(
    (total, value) => ({
      tradeSummary: total.tradeSummary + value.tradeSummary,
      tradeDetail: total.tradeDetail + value.tradeDetail,
      methodology: total.methodology + value.methodology,
      valuationExportRow: total.valuationExportRow + value.valuationExportRow,
    }),
    emptyKindCounts()
  );
}

function sameKindCounts(
  left: AflTradeProjectionDocumentSetKindCounts,
  right: AflTradeProjectionDocumentSetKindCounts
): boolean {
  return (
    left.tradeSummary === right.tradeSummary &&
    left.tradeDetail === right.tradeDetail &&
    left.methodology === right.methodology &&
    left.valuationExportRow === right.valuationExportRow
  );
}

function countTotal(counts: AflTradeProjectionDocumentSetKindCounts): number {
  return counts.tradeSummary + counts.tradeDetail + counts.methodology + counts.valuationExportRow;
}

const shardCommonShape = {
  schemaVersion: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_SHARD_SCHEMA_VERSION),
  publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY),
  publicationId: aflTradeContentAddressedIdSchema('publication'),
  valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
  valuationOutputInventoryIndexId: aflTradeContentAddressedIdSchema(
    'valuation-output-inventory-index'
  ),
  projectionMaterialization: aflTradeProjectionMaterializationBindingSchema,
  scopeKey: aflTradePublicIdSchema,
  valueUnitId: aflTradePublicIdSchema,
  calculationAsOf: aflTradeIsoDateTimeSchema,
  knowledgeCutoffAt: aflTradeIsoDateTimeSchema,
  materializedAt: aflTradeIsoDateTimeSchema,
} as const;

export const aflTradeProjectionDocumentSetShardContentSchema = z
  .object({
    ...shardCommonShape,
    shardOrdinal: z.number().int().nonnegative(),
    documentCount: z
      .number()
      .int()
      .positive()
      .max(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD),
    kindCounts: aflTradeProjectionDocumentSetKindCountsSchema,
    orderedMembershipSha256: aflTradeSha256Schema,
    bindings: z
      .array(aflTradeProjectionDocumentSetBindingSchema)
      .min(1)
      .max(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.documentCount !== content.bindings.length) {
      context.addIssue({
        code: 'custom',
        path: ['documentCount'],
        message: 'Shard document count must match its detached bindings.',
      });
    }
    if (!sameKindCounts(content.kindCounts, countKinds(content.bindings))) {
      context.addIssue({
        code: 'custom',
        path: ['kindCounts'],
        message: 'Shard kind counts must reconcile to its detached bindings.',
      });
    }
    if (content.orderedMembershipSha256 !== sha256AflTradeCanonicalJson(content.bindings)) {
      context.addIssue({
        code: 'custom',
        path: ['orderedMembershipSha256'],
        message: 'Shard membership digest must authenticate its ordered bindings.',
      });
    }
    if (
      content.bindings.some(
        (binding, index) => index > 0 && compareBindings(content.bindings[index - 1], binding) >= 0
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['bindings'],
        message: 'Shard document bindings must use strict canonical global order.',
      });
    }
    if (
      Date.parse(content.knowledgeCutoffAt) > Date.parse(content.calculationAsOf) ||
      Date.parse(content.calculationAsOf) > Date.parse(content.materializedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializedAt'],
        message: 'Shard times must preserve knowledge, calculation, and materialization order.',
      });
    }
    const calculationAsOf = Date.parse(content.calculationAsOf);
    const materializedAt = Date.parse(content.materializedAt);
    if (
      content.bindings.some((binding) => {
        const artifactCreatedAt = Date.parse(binding.artifactRef.createdAt);
        return artifactCreatedAt < calculationAsOf || artifactCreatedAt > materializedAt;
      })
    ) {
      context.addIssue({
        code: 'custom',
        path: ['bindings'],
        message:
          'Every projection-document artifact must be created between calculation and shard materialization.',
      });
    }
  });

export const aflTradeProjectionDocumentSetShardSchema = z
  .object({
    projectionDocumentSetShardId: aflTradeContentAddressedIdSchema('projection-document-set-shard'),
    content: aflTradeProjectionDocumentSetShardContentSchema,
  })
  .strict()
  .superRefine((shard, context) => {
    addAflTradeContentAddressIssue(
      'projection-document-set-shard',
      shard.projectionDocumentSetShardId,
      shard.content,
      context,
      ['projectionDocumentSetShardId']
    );
  });

export type AflTradeProjectionDocumentSetShard = z.infer<
  typeof aflTradeProjectionDocumentSetShardSchema
>;

export const aflTradeProjectionDocumentSetShardArtifactSchema = z
  .object({
    projectionDocumentSetShard: aflTradeProjectionDocumentSetShardSchema,
    projectionDocumentSetShardArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(
        value.projectionDocumentSetShardArtifactRef,
        value.projectionDocumentSetShard
      ) ||
      value.projectionDocumentSetShardArtifactRef.createdAt !==
        value.projectionDocumentSetShard.content.materializedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentSetShardArtifactRef'],
        message: 'Shard artifact reference must authenticate its bytes and materialization time.',
      });
    }
    if (
      value.projectionDocumentSetShardArtifactRef.byteLength < 1 ||
      value.projectionDocumentSetShardArtifactRef.byteLength >
        AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_SHARD_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentSetShardArtifactRef', 'byteLength'],
        message: 'Projection document set shard exceeds its four MiB byte limit.',
      });
    }
  });

export type AflTradeProjectionDocumentSetShardArtifact = z.infer<
  typeof aflTradeProjectionDocumentSetShardArtifactSchema
>;

export const aflTradeProjectionDocumentSetShardBindingSchema = z
  .object({
    shardOrdinal: z.number().int().nonnegative(),
    projectionDocumentSetShardId: aflTradeContentAddressedIdSchema('projection-document-set-shard'),
    artifactRef: canonicalJsonArtifactRefSchema,
    documentCount: z
      .number()
      .int()
      .positive()
      .max(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD),
    kindCounts: aflTradeProjectionDocumentSetKindCountsSchema,
    orderedMembershipSha256: aflTradeSha256Schema,
    firstProjectionDocumentId: aflTradeContentAddressedIdSchema('projection-document'),
    lastProjectionDocumentId: aflTradeContentAddressedIdSchema('projection-document'),
  })
  .strict();

export type AflTradeProjectionDocumentSetShardBinding = z.infer<
  typeof aflTradeProjectionDocumentSetShardBindingSchema
>;

const indexBindingSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_SCHEMA_VERSION),
    valuationOutputInventoryIndexId: aflTradeContentAddressedIdSchema(
      'valuation-output-inventory-index'
    ),
    artifactRef: canonicalJsonArtifactRefSchema,
    entryCount: z
      .number()
      .int()
      .positive()
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES),
    inventorySetSha256: aflTradeSha256Schema,
  })
  .strict();

export const aflTradeProjectionDocumentSetContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY),
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valuationOutputInventoryIndex: indexBindingSchema,
    projectionMaterialization: aflTradeProjectionMaterializationBindingSchema,
    scopeKey: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    calculationAsOf: aflTradeIsoDateTimeSchema,
    knowledgeCutoffAt: aflTradeIsoDateTimeSchema,
    materializedAt: aflTradeIsoDateTimeSchema,
    ordering: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_ORDERING),
    membershipDigestDefinition: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_MEMBERSHIP_DIGEST),
    shardEntryLimit: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD),
    shardCount: z.number().int().positive(),
    tradeCount: z
      .number()
      .int()
      .positive()
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES),
    documentCount: z.number().int().positive().max(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS),
    kindCounts: aflTradeProjectionDocumentSetKindCountsSchema,
    orderedMembershipSha256: aflTradeSha256Schema,
    shards: z.array(aflTradeProjectionDocumentSetShardBindingSchema).min(1).max(1_000),
    predecessorPolicy: predecessorPolicySchema,
    limitation: z.literal(AFL_TRADE_PROJECTION_DOCUMENT_SET_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.shardCount !== content.shards.length) {
      context.addIssue({
        code: 'custom',
        path: ['shardCount'],
        message: 'Root shard count must match its canonical shard bindings.',
      });
    }
    if (content.documentCount !== countTotal(content.kindCounts)) {
      context.addIssue({
        code: 'custom',
        path: ['documentCount'],
        message: 'Root document count must reconcile to kind counts.',
      });
    }
    if (content.tradeCount !== content.valuationOutputInventoryIndex.entryCount) {
      context.addIssue({
        code: 'custom',
        path: ['tradeCount'],
        message: 'Root trade count must match its detached inventory index binding.',
      });
    }
    if (
      content.tradeCount !== content.projectionMaterialization.tradeCount ||
      content.documentCount !== content.projectionMaterialization.documentCount + 1 ||
      content.publicationId !== content.projectionMaterialization.publicationId ||
      content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId !==
        content.projectionMaterialization.valuationOutputInventoryIndexId ||
      content.scopeKey !== content.projectionMaterialization.scopeKey ||
      content.valueUnitId !== content.projectionMaterialization.valueUnitId ||
      content.calculationAsOf !== content.projectionMaterialization.calculationAsOf ||
      content.knowledgeCutoffAt !== content.projectionMaterialization.knowledgeCutoffAt ||
      Date.parse(content.projectionMaterialization.artifactRef.createdAt) >
        Date.parse(content.materializedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionMaterialization'],
        message:
          'Document set identity, times, trade count, and non-methodology count must match aggregate materialization exactly.',
      });
    }
    if (
      content.kindCounts.tradeSummary !== content.tradeCount * AFL_TRADE_VALUATION_VIEWS.length ||
      content.kindCounts.tradeDetail !== content.tradeCount ||
      content.kindCounts.methodology !== 1 ||
      content.kindCounts.valuationExportRow <
        content.tradeCount * AFL_TRADE_VALUATION_VIEWS.length ||
      content.kindCounts.valuationExportRow >
        content.tradeCount * AFL_TRADE_VALUATION_VIEWS.length * 18
    ) {
      context.addIssue({
        code: 'custom',
        path: ['kindCounts'],
        message: 'Root kind counts must cover every trade and all four valuation views.',
      });
    }
    if (
      content.documentCount !== content.shards.reduce((sum, shard) => sum + shard.documentCount, 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['documentCount'],
        message: 'Root document count must reconcile to every shard.',
      });
    }
    if (
      !sameKindCounts(
        content.kindCounts,
        sumKindCounts(content.shards.map((shard) => shard.kindCounts))
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['kindCounts'],
        message: 'Root kind counts must reconcile to every shard.',
      });
    }
    if (content.shards.some((shard, index) => shard.shardOrdinal !== index)) {
      context.addIssue({
        code: 'custom',
        path: ['shards'],
        message: 'Root shard bindings must be contiguous in ordinal order.',
      });
    }
    if (
      Date.parse(content.knowledgeCutoffAt) > Date.parse(content.calculationAsOf) ||
      Date.parse(content.calculationAsOf) > Date.parse(content.materializedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializedAt'],
        message: 'Root times must preserve knowledge, calculation, and materialization order.',
      });
    }
  });

export const aflTradeProjectionDocumentSetSchema = z
  .object({
    projectionDocumentSetId: aflTradeContentAddressedIdSchema('projection-document-set'),
    content: aflTradeProjectionDocumentSetContentSchema,
  })
  .strict()
  .superRefine((root, context) => {
    addAflTradeContentAddressIssue(
      'projection-document-set',
      root.projectionDocumentSetId,
      root.content,
      context,
      ['projectionDocumentSetId']
    );
  });

export type AflTradeProjectionDocumentSet = z.infer<typeof aflTradeProjectionDocumentSetSchema>;

function bindingsHaveCompleteCoordinateLattice(
  bindings: readonly AflTradeProjectionDocumentSetBinding[],
  tradeCount: number
): boolean {
  interface TradeCoordinates {
    detailCount: number;
    summaryCounts: Map<string, number>;
    exportOrdinals: Map<string, number[]>;
  }

  const trades = new Map<string, TradeCoordinates>();
  let methodologyCount = 0;
  for (const binding of bindings) {
    if (binding.kind === 'methodology') {
      methodologyCount += 1;
      continue;
    }
    if (binding.tradeId === null) return false;
    let coordinates = trades.get(binding.tradeId);
    if (coordinates === undefined) {
      coordinates = {
        detailCount: 0,
        summaryCounts: new Map(),
        exportOrdinals: new Map(),
      };
      trades.set(binding.tradeId, coordinates);
    }
    if (binding.kind === 'trade_detail') {
      coordinates.detailCount += 1;
    } else if (binding.kind === 'trade_summary') {
      if (binding.view === null) return false;
      coordinates.summaryCounts.set(
        binding.view,
        (coordinates.summaryCounts.get(binding.view) ?? 0) + 1
      );
    } else {
      if (binding.view === null || binding.rowOrdinal === null) return false;
      const ordinals = coordinates.exportOrdinals.get(binding.view) ?? [];
      ordinals.push(binding.rowOrdinal);
      coordinates.exportOrdinals.set(binding.view, ordinals);
    }
  }

  if (methodologyCount !== 1 || trades.size !== tradeCount) return false;
  for (const coordinates of trades.values()) {
    if (coordinates.detailCount !== 1) return false;
    for (const view of AFL_TRADE_VALUATION_VIEWS) {
      if (coordinates.summaryCounts.get(view) !== 1) return false;
      const ordinals = coordinates.exportOrdinals.get(view);
      if (
        ordinals === undefined ||
        ordinals.length < 1 ||
        ordinals.length > 18 ||
        ordinals.some((ordinal, index) => ordinal !== index)
      ) {
        return false;
      }
    }
    if (
      coordinates.summaryCounts.size !== AFL_TRADE_VALUATION_VIEWS.length ||
      coordinates.exportOrdinals.size !== AFL_TRADE_VALUATION_VIEWS.length
    ) {
      return false;
    }
  }
  return true;
}

export const aflTradeProjectionDocumentSetResultSchema = z
  .object({
    projectionDocumentShards: z.array(aflTradeProjectionDocumentSetShardArtifactSchema).min(1),
    projectionDocumentSet: aflTradeProjectionDocumentSetSchema,
    projectionDocumentSetArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const root = result.projectionDocumentSet;
    const rootContent = root.content;
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(result.projectionDocumentSetArtifactRef, root) ||
      result.projectionDocumentSetArtifactRef.createdAt !== rootContent.materializedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentSetArtifactRef'],
        message: 'Root artifact reference must authenticate its bytes and materialization time.',
      });
    }
    if (
      result.projectionDocumentSetArtifactRef.byteLength < 1 ||
      result.projectionDocumentSetArtifactRef.byteLength >
        AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_ROOT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentSetArtifactRef', 'byteLength'],
        message: 'Projection document set root exceeds its 512 KiB byte limit.',
      });
    }
    if (result.projectionDocumentShards.length !== rootContent.shards.length) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentShards'],
        message: 'Materialized shard count must match root membership.',
      });
      return;
    }
    if (
      result.projectionDocumentShards.reduce(
        (sum, shard) => sum + shard.projectionDocumentSetShardArtifactRef.byteLength,
        0
      ) > AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_AGGREGATE_SHARD_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentShards'],
        message: 'In-memory document-set shards exceed the 64 MiB aggregate budget.',
      });
    }
    for (const [index, artifact] of result.projectionDocumentShards.entries()) {
      const shard = artifact.projectionDocumentSetShard;
      const binding = rootContent.shards[index];
      if (
        binding === undefined ||
        shard.content.shardOrdinal !== index ||
        binding.shardOrdinal !== index ||
        binding.projectionDocumentSetShardId !== shard.projectionDocumentSetShardId ||
        canonicalizeAflTradeJson(binding.artifactRef) !==
          canonicalizeAflTradeJson(artifact.projectionDocumentSetShardArtifactRef) ||
        binding.documentCount !== shard.content.documentCount ||
        !sameKindCounts(binding.kindCounts, shard.content.kindCounts) ||
        binding.orderedMembershipSha256 !== shard.content.orderedMembershipSha256 ||
        binding.firstProjectionDocumentId !== shard.content.bindings[0]?.projectionDocumentId ||
        binding.lastProjectionDocumentId !== shard.content.bindings.at(-1)?.projectionDocumentId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['projectionDocumentShards', index],
          message: 'Materialized shard does not match its root binding.',
        });
      }
      for (const field of [
        'publicationId',
        'valuationBundleId',
        'scopeKey',
        'valueUnitId',
        'calculationAsOf',
        'knowledgeCutoffAt',
        'materializedAt',
      ] as const) {
        if (shard.content[field] !== rootContent[field]) {
          context.addIssue({
            code: 'custom',
            path: ['projectionDocumentShards', index, 'content', field],
            message: 'Shard common identity must match the root.',
          });
        }
      }
      if (
        shard.content.valuationOutputInventoryIndexId !==
        rootContent.valuationOutputInventoryIndex.valuationOutputInventoryIndexId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['projectionDocumentShards', index, 'content', 'valuationOutputInventoryIndexId'],
          message: 'Shard inventory-index identity must match the root.',
        });
      }
      if (
        canonicalizeAflTradeJson(shard.content.projectionMaterialization) !==
        canonicalizeAflTradeJson(rootContent.projectionMaterialization)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['projectionDocumentShards', index, 'content', 'projectionMaterialization'],
          message: 'Shard aggregate-materialization binding must match the root exactly.',
        });
      }
    }
    const flattened = result.projectionDocumentShards.flatMap(
      (artifact) => artifact.projectionDocumentSetShard.content.bindings
    );
    for (const [path, identities] of [
      ['projectionDocumentId', flattened.map((binding) => binding.projectionDocumentId)],
      ['artifactRef', flattened.map((binding) => binding.artifactRef.artifactId)],
    ] as const) {
      if (new Set(identities).size !== identities.length) {
        context.addIssue({
          code: 'custom',
          path: ['projectionDocumentShards'],
          message: `Detached ${path} identities must be globally unique.`,
        });
      }
    }
    if (!bindingsHaveCompleteCoordinateLattice(flattened, rootContent.tradeCount)) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentShards'],
        message:
          'Detached membership must contain one methodology and the complete trade/view/export coordinate lattice.',
      });
    }
    const calculationAsOf = Date.parse(rootContent.calculationAsOf);
    const materializedAt = Date.parse(rootContent.materializedAt);
    if (
      flattened.some((binding) => {
        const artifactCreatedAt = Date.parse(binding.artifactRef.createdAt);
        return artifactCreatedAt < calculationAsOf || artifactCreatedAt > materializedAt;
      })
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentShards'],
        message:
          'Detached document artifacts must be created between calculation and set materialization.',
      });
    }
    if (
      flattened.some(
        (binding, index) => index > 0 && compareBindings(flattened[index - 1], binding) >= 0
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentShards'],
        message: 'Materialized shards must preserve strict canonical global order.',
      });
    }
    if (rootContent.orderedMembershipSha256 !== sha256AflTradeCanonicalJson(flattened)) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentSet', 'content', 'orderedMembershipSha256'],
        message: 'Root membership digest must authenticate every ordered shard member.',
      });
    }
  });

export type AflTradeProjectionDocumentSetResult = z.infer<
  typeof aflTradeProjectionDocumentSetResultSchema
>;

export type AflTradeProjectionDocumentSetConstructionErrorCode =
  | 'INVALID_INPUT_ENVELOPE'
  | 'INVALID_PUBLICATION_MANIFEST'
  | 'INVALID_INVENTORY_INDEX'
  | 'INVALID_INVENTORY_INDEX_ARTIFACT_REFERENCE'
  | 'INVALID_PROJECTION_MATERIALIZATION'
  | 'INVALID_PROJECTION_DOCUMENT_BINDINGS'
  | 'DOCUMENT_INPUT_SIZE_LIMIT_EXCEEDED'
  | 'INVALID_MATERIALIZED_AT'
  | 'INVENTORY_INDEX_ARTIFACT_REFERENCE_MISMATCH'
  | 'PUBLICATION_INDEX_BINDING_MISMATCH'
  | 'PUBLICATION_IDENTITY_MISMATCH'
  | 'PROJECTION_MATERIALIZATION_MISMATCH'
  | 'INCOMPLETE_PUBLICATION_VIEWS'
  | 'PUBLIC_ASSET_BOUNDARY_MISMATCH'
  | 'NON_MONOTONIC_ARTIFACT_TIME'
  | 'DOCUMENT_ARTIFACT_REFERENCE_MISMATCH'
  | 'DOCUMENT_IDENTITY_MISMATCH'
  | 'DOCUMENT_TIME_MISMATCH'
  | 'DUPLICATE_DOCUMENT_ID'
  | 'DOCUMENT_MEMBERSHIP_MISMATCH'
  | 'INCOMPLETE_TRADE_DOCUMENT_SET'
  | 'EXPORT_ROW_MISMATCH'
  | 'METHODOLOGY_MEMBERSHIP_MISMATCH'
  | 'METHODOLOGY_PUBLICATION_ARTIFACT_MISMATCH'
  | 'SHARD_SIZE_LIMIT_EXCEEDED'
  | 'AGGREGATE_SHARD_SIZE_LIMIT_EXCEEDED'
  | 'ROOT_SIZE_LIMIT_EXCEEDED'
  | 'INTERNAL_ARTIFACT_CONTRACT_VIOLATION';

const ERROR_MESSAGES: Readonly<Record<AflTradeProjectionDocumentSetConstructionErrorCode, string>> =
  Object.freeze({
    INVALID_INPUT_ENVELOPE: 'The projection-document-set input envelope is invalid.',
    INVALID_PUBLICATION_MANIFEST: 'The publication manifest is not a valid v3 manifest.',
    INVALID_INVENTORY_INDEX: 'The valuation-output inventory index is invalid.',
    INVALID_INVENTORY_INDEX_ARTIFACT_REFERENCE:
      'The valuation-output inventory index artifact reference is invalid.',
    INVALID_PROJECTION_MATERIALIZATION:
      'The aggregate projection-materialization verification envelope is invalid or fails total replay.',
    INVALID_PROJECTION_DOCUMENT_BINDINGS: 'The projection document bindings are invalid.',
    DOCUMENT_INPUT_SIZE_LIMIT_EXCEEDED:
      'Projection-document bytes exceed the 64 MiB in-memory budget; use an externally bounded streaming stage.',
    INVALID_MATERIALIZED_AT: 'The projection-document-set materialization time is invalid.',
    INVENTORY_INDEX_ARTIFACT_REFERENCE_MISMATCH:
      'The supplied inventory-index artifact reference does not authenticate its bytes.',
    PUBLICATION_INDEX_BINDING_MISMATCH:
      'The v3 publication does not bind the supplied inventory index exactly.',
    PUBLICATION_IDENTITY_MISMATCH:
      'The publication and inventory index do not share scope, unit, bundle, and entry identities.',
    PROJECTION_MATERIALIZATION_MISMATCH:
      'The verified aggregate materialization does not exactly bind the publication, index, documents, methodology, or chronology.',
    INCOMPLETE_PUBLICATION_VIEWS:
      'Projection detail requires all four canonical valuation views in the publication.',
    PUBLIC_ASSET_BOUNDARY_MISMATCH:
      'Projection document set inputs cross the source-native public AFL asset boundary.',
    NON_MONOTONIC_ARTIFACT_TIME: 'Projection document set artifact times are not monotonic.',
    DOCUMENT_ARTIFACT_REFERENCE_MISMATCH:
      'A projection document artifact reference does not authenticate its document.',
    DOCUMENT_IDENTITY_MISMATCH:
      'A projection document does not share the publication and inventory identity.',
    DOCUMENT_TIME_MISMATCH: 'Projection documents do not share one calculation and knowledge time.',
    DUPLICATE_DOCUMENT_ID: 'Projection document identifiers must be unique.',
    DOCUMENT_MEMBERSHIP_MISMATCH:
      'Projection documents must cover exactly the inventory-index trade identifiers.',
    INCOMPLETE_TRADE_DOCUMENT_SET:
      'Each trade requires four summaries, one complete detail, and exact export rows.',
    EXPORT_ROW_MISMATCH: 'Export rows must reproduce each canonical summary valuation exactly.',
    METHODOLOGY_MEMBERSHIP_MISMATCH:
      'The projection document set requires exactly one publication methodology.',
    METHODOLOGY_PUBLICATION_ARTIFACT_MISMATCH:
      'The projection methodology payload does not match the publication methodology artifact.',
    SHARD_SIZE_LIMIT_EXCEEDED: 'A projection document set shard exceeds four MiB.',
    AGGREGATE_SHARD_SIZE_LIMIT_EXCEEDED:
      'Projection-document-set shards exceed the 64 MiB in-memory budget; use an externally bounded streaming stage.',
    ROOT_SIZE_LIMIT_EXCEEDED: 'The projection document set root exceeds 512 KiB.',
    INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
      'The projection document set failed its internal artifact contract.',
  });

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeProjectionDocumentSetConstructionError extends Error {
  readonly code: AflTradeProjectionDocumentSetConstructionErrorCode;

  constructor(code: AflTradeProjectionDocumentSetConstructionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionDocumentSetConstructionError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeProjectionDocumentSetConstructionError';
    code: AflTradeProjectionDocumentSetConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeProjectionDocumentSetConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeProjectionDocumentSetConstructionError(
  value: unknown
): value is AflTradeProjectionDocumentSetConstructionError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function constructionError(
  code: AflTradeProjectionDocumentSetConstructionErrorCode
): AflTradeProjectionDocumentSetConstructionError {
  return new AflTradeProjectionDocumentSetConstructionError(code);
}

const projectionDocumentInputSchema = z
  .object({
    projectionDocument: aflTradeProjectionDocumentSchema,
    projectionDocumentArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

type ProjectionDocumentInput = z.infer<typeof projectionDocumentInputSchema>;

export const aflTradeProjectionDocumentSetCreateInputSchema = z
  .object({
    publicationManifest: z.union([
      aflTradePublicationManifestV3Schema,
      aflTradePublicationManifestV4Schema,
    ]),
    valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexSchema,
    valuationOutputInventoryIndexArtifactRef: canonicalJsonArtifactRefSchema,
    projectionMaterializationVerification: aflTradeProjectionMaterializationVerifyInputSchema,
    projectionDocuments: z
      .array(projectionDocumentInputSchema)
      .min(1)
      .max(AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS),
    materializedAt: aflTradeIsoDateTimeSchema,
  })
  .strict();

export const aflTradeProjectionDocumentSetVerifyInputSchema =
  aflTradeProjectionDocumentSetCreateInputSchema.safeExtend({
    output: aflTradeProjectionDocumentSetResultSchema,
  });

export type AflTradeProjectionDocumentSetCreateInput = z.infer<
  typeof aflTradeProjectionDocumentSetCreateInputSchema
>;
export type AflTradeProjectionDocumentSetVerifyInput = z.infer<
  typeof aflTradeProjectionDocumentSetVerifyInputSchema
>;

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeProjectionDocumentSetConstructionErrorCode
): T {
  try {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
  } catch {
    // Hostile values are replaced with the stable contract error below.
  }
  throw constructionError(code);
}

function parseProjectionDocumentsWithBudget(
  value: unknown,
  expectedDocumentCount: number
): ProjectionDocumentInput[] {
  try {
    if (!Array.isArray(value) || nodeUtilTypes.isProxy(value)) {
      throw constructionError('INVALID_PROJECTION_DOCUMENT_BINDINGS');
    }
    const prototype = Object.getPrototypeOf(value);
    const ownKeys = Reflect.ownKeys(value);
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    const rawLength = lengthDescriptor?.value;
    if (
      prototype !== Array.prototype ||
      lengthDescriptor === undefined ||
      'get' in lengthDescriptor ||
      !Number.isSafeInteger(rawLength) ||
      rawLength !== expectedDocumentCount ||
      rawLength < 1 ||
      rawLength > AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_DOCUMENTS ||
      ownKeys.some((key) => typeof key !== 'string') ||
      ownKeys.length !== rawLength + 1
    ) {
      throw constructionError('INVALID_PROJECTION_DOCUMENT_BINDINGS');
    }
    const documents: ProjectionDocumentInput[] = [];
    let byteLength = 0;
    for (let index = 0; index < rawLength; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
        throw constructionError('INVALID_PROJECTION_DOCUMENT_BINDINGS');
      }
      const document = parseOrThrow(
        projectionDocumentInputSchema,
        descriptor.value,
        'INVALID_PROJECTION_DOCUMENT_BINDINGS'
      );
      if (!verifyAflTradeProjectionDocumentArtifact(document)) {
        throw constructionError('DOCUMENT_ARTIFACT_REFERENCE_MISMATCH');
      }
      if (
        document.projectionDocumentArtifactRef.byteLength >
        AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_AGGREGATE_DOCUMENT_BYTES - byteLength
      ) {
        throw constructionError('DOCUMENT_INPUT_SIZE_LIMIT_EXCEEDED');
      }
      byteLength += document.projectionDocumentArtifactRef.byteLength;
      documents.push(document);
    }
    return documents;
  } catch (error) {
    if (isAflTradeProjectionDocumentSetConstructionError(error)) throw error;
    throw constructionError('INVALID_PROJECTION_DOCUMENT_BINDINGS');
  }
}

function snapshotExactEnvelope<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys
): Record<Keys[number], unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    if (nodeUtilTypes.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    const expected = new Set<string>(keys);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !expected.has(key))
    ) {
      return null;
    }
    const snapshot = Object.create(null) as Record<Keys[number], unknown>;
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
        return null;
      }
      snapshot[key as Keys[number]] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

const KIND_RANK: Readonly<Record<(typeof AFL_TRADE_PROJECTION_DOCUMENT_KINDS)[number], number>> =
  Object.freeze({
    trade_summary: 0,
    trade_detail: 1,
    methodology: 2,
    valuation_export_row: 3,
  });

function viewRank(view: AflTradeProjectionDocumentSetBinding['view']): number {
  return view === null ? -1 : AFL_TRADE_VALUATION_VIEWS.indexOf(view);
}

function compareBindings(
  left: AflTradeProjectionDocumentSetBinding,
  right: AflTradeProjectionDocumentSetBinding
): number {
  const kindDifference = KIND_RANK[left.kind] - KIND_RANK[right.kind];
  if (kindDifference !== 0) return kindDifference;
  const tradeDifference = compareCodeUnits(left.tradeId ?? '', right.tradeId ?? '');
  if (tradeDifference !== 0) return tradeDifference;
  const viewDifference = viewRank(left.view) - viewRank(right.view);
  if (viewDifference !== 0) return viewDifference;
  const rowDifference = (left.rowOrdinal ?? -1) - (right.rowOrdinal ?? -1);
  if (rowDifference !== 0) return rowDifference;
  return compareCodeUnits(left.projectionDocumentId, right.projectionDocumentId);
}

function bindingFor(input: ProjectionDocumentInput): AflTradeProjectionDocumentSetBinding {
  const document = input.projectionDocument;
  const content = document.content;
  if (content.kind === 'trade_summary') {
    return {
      projectionDocumentId: document.projectionDocumentId,
      artifactRef: input.projectionDocumentArtifactRef,
      kind: content.kind,
      tradeId: content.tradeId,
      view: content.view,
      rowOrdinal: null,
    };
  }
  if (content.kind === 'trade_detail') {
    return {
      projectionDocumentId: document.projectionDocumentId,
      artifactRef: input.projectionDocumentArtifactRef,
      kind: content.kind,
      tradeId: content.tradeId,
      view: null,
      rowOrdinal: null,
    };
  }
  if (content.kind === 'valuation_export_row') {
    return {
      projectionDocumentId: document.projectionDocumentId,
      artifactRef: input.projectionDocumentArtifactRef,
      kind: content.kind,
      tradeId: content.exportRow.tradeId,
      view: content.exportRow.view,
      rowOrdinal: content.exportRow.rowOrdinal,
    };
  }
  return {
    projectionDocumentId: document.projectionDocumentId,
    artifactRef: input.projectionDocumentArtifactRef,
    kind: content.kind,
    tradeId: null,
    view: null,
    rowOrdinal: null,
  };
}

function materializationBindingFor(
  result: AflTradeProjectionMaterializationResult
): AflTradeProjectionMaterializationBinding {
  const root = result.projectionMaterialization;
  const content = root.content;
  return aflTradeProjectionMaterializationBindingSchema.parse({
    schemaVersion: content.schemaVersion,
    projectionMaterializationId: root.projectionMaterializationId,
    artifactRef: result.projectionMaterializationArtifactRef,
    publicationId: content.publication.publicationId,
    valuationOutputInventoryIndexId:
      content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
    projectionPublicEvidenceIndexId:
      content.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId,
    projectionPresentationPolicyId:
      content.projectionPresentationPolicy.projectionPresentationPolicyId,
    projectionSchemaBundleId: content.projectionSchemaBundle.projectionSchemaBundleId,
    scopeKey: content.scopeKey,
    valueUnitId: content.valueUnitId,
    calculationAsOf: content.calculationAsOf,
    knowledgeCutoffAt: content.knowledgeCutoffAt,
    tradeCount: content.tradeCount,
    documentCount: content.documentCount,
    evidenceTradeSetSha256: content.evidenceTradeSetSha256,
    entrySetSha256: content.entrySetSha256,
    shardSetSha256: content.shardSetSha256,
  });
}

function assertProjectionMaterialization(
  unparsedVerification: unknown,
  publication: AflTradePublicationManifestV3 | AflTradePublicationManifestV4,
  index: AflTradeValuationOutputInventoryIndex,
  indexArtifactRef: AflTradeArtifactRef,
  documentSetMaterializedAt: string
): {
  binding: AflTradeProjectionMaterializationBinding;
  expectedDocuments: AflTradeProjectionDocumentSetBinding[];
} {
  if (!verifyAflTradeProjectionMaterialization(unparsedVerification)) {
    throw constructionError('INVALID_PROJECTION_MATERIALIZATION');
  }
  const verification = parseOrThrow(
    aflTradeProjectionMaterializationVerifyInputSchema,
    unparsedVerification,
    'INVALID_PROJECTION_MATERIALIZATION'
  );
  const result = verification.output;
  const content = result.projectionMaterialization.content;
  const expectedIndexBinding = {
    schemaVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_SCHEMA_VERSION,
    valuationOutputInventoryIndexId: index.valuationOutputInventoryIndexId,
    artifactRef: indexArtifactRef,
    entryCount: index.content.entryCount,
    inventorySetSha256: index.content.inventorySetSha256,
  };
  if (
    content.publication.publicationId !== publication.publicationId ||
    content.scopeKey !== publication.content.scopeKey ||
    content.valueUnitId !== publication.content.valueUnitId ||
    canonicalizeAflTradeJson(content.valuationOutputInventoryIndex) !==
      canonicalizeAflTradeJson(expectedIndexBinding) ||
    content.tradeCount !== index.content.entryCount ||
    content.publicAssetBoundary !== AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY ||
    Date.parse(result.projectionMaterializationArtifactRef.createdAt) >
      Date.parse(documentSetMaterializedAt)
  ) {
    throw constructionError('PROJECTION_MATERIALIZATION_MISMATCH');
  }
  const expectedDocuments = verification.projectionMaterializationShardVerifications
    .flatMap(
      (shardVerification) => shardVerification.output.projectionMaterializationShard.content.entries
    )
    .flatMap((entry) => entry.documents)
    .map((document) => aflTradeProjectionDocumentSetBindingSchema.parse(document));
  if (
    expectedDocuments.length !== content.documentCount ||
    new Set(expectedDocuments.map((document) => document.projectionDocumentId)).size !==
      expectedDocuments.length ||
    new Set(expectedDocuments.map((document) => document.artifactRef.artifactId)).size !==
      expectedDocuments.length
  ) {
    throw constructionError('PROJECTION_MATERIALIZATION_MISMATCH');
  }
  return {
    binding: materializationBindingFor(result),
    expectedDocuments,
  };
}

function assertIndexAndPublication(
  publication: AflTradePublicationManifestV3 | AflTradePublicationManifestV4,
  index: AflTradeValuationOutputInventoryIndex,
  indexArtifactRef: AflTradeArtifactRef,
  materializedAt: string
): void {
  const indexResult = aflTradeValuationOutputInventoryIndexResultSchema.safeParse({
    valuationOutputInventoryIndex: index,
    valuationOutputInventoryIndexArtifactRef: indexArtifactRef,
  });
  if (!indexResult.success) {
    throw constructionError('INVENTORY_INDEX_ARTIFACT_REFERENCE_MISMATCH');
  }
  if (!doesAflTradeArtifactRefMatchCanonicalJson(indexArtifactRef, index)) {
    throw constructionError('INVENTORY_INDEX_ARTIFACT_REFERENCE_MISMATCH');
  }
  const publicationIndex = publication.content.valuationOutputInventoryIndex;
  if (
    publicationIndex.valuationOutputInventoryIndexId !== index.valuationOutputInventoryIndexId ||
    canonicalizeAflTradeJson(publicationIndex.artifactRef) !==
      canonicalizeAflTradeJson(indexArtifactRef) ||
    publicationIndex.entryCount !== index.content.entryCount ||
    publicationIndex.inventorySetSha256 !== index.content.inventorySetSha256 ||
    publication.content.entryCount !== index.content.entryCount
  ) {
    throw constructionError('PUBLICATION_INDEX_BINDING_MISMATCH');
  }
  if (
    publication.content.scopeKey !== index.content.scopeKey ||
    publication.content.valueUnitId !== index.content.valueUnitId ||
    publication.content.valuationBundleId !== index.content.valuationBundle.valuationBundleId
  ) {
    throw constructionError('PUBLICATION_IDENTITY_MISMATCH');
  }
  if (
    publication.content.publicAssetBoundary !==
      AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY ||
    index.content.publicAssetBoundary !== AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY
  ) {
    throw constructionError('PUBLIC_ASSET_BOUNDARY_MISMATCH');
  }
  if (
    publication.content.supportedViews.length !== AFL_TRADE_VALUATION_VIEWS.length ||
    publication.content.supportedViews.some(
      (view, indexOfView) => view !== AFL_TRADE_VALUATION_VIEWS[indexOfView]
    )
  ) {
    throw constructionError('INCOMPLETE_PUBLICATION_VIEWS');
  }
  const materialized = Date.parse(materializedAt);
  if (
    Date.parse(indexArtifactRef.createdAt) > Date.parse(publication.content.createdAt) ||
    Date.parse(publication.content.createdAt) > materialized
  ) {
    throw constructionError('NON_MONOTONIC_ARTIFACT_TIME');
  }
}

function assertDocuments(
  publication: AflTradePublicationManifestV3 | AflTradePublicationManifestV4,
  index: AflTradeValuationOutputInventoryIndex,
  inputs: readonly ProjectionDocumentInput[],
  materialization: {
    binding: AflTradeProjectionMaterializationBinding;
    expectedDocuments: readonly AflTradeProjectionDocumentSetBinding[];
  },
  materializedAt: string
): {
  bindings: AflTradeProjectionDocumentSetBinding[];
  calculationAsOf: string;
  knowledgeCutoffAt: string;
} {
  const materialized = Date.parse(materializedAt);
  const expectedTradeIds = index.content.entries.map((entry) => entry.tradeId);
  const expectedTradeIdSet = new Set(expectedTradeIds);
  const documentIds = new Set<string>();
  const artifactIds = new Set<string>();
  let calculationAsOf: string | null = null;
  let knowledgeCutoffAt: string | null = null;

  for (const input of inputs) {
    if (
      !verifyAflTradeProjectionDocumentArtifact({
        projectionDocument: input.projectionDocument,
        projectionDocumentArtifactRef: input.projectionDocumentArtifactRef,
      })
    ) {
      throw constructionError('DOCUMENT_ARTIFACT_REFERENCE_MISMATCH');
    }
    const document = input.projectionDocument;
    const content = document.content;
    if (
      documentIds.has(document.projectionDocumentId) ||
      artifactIds.has(input.projectionDocumentArtifactRef.artifactId)
    ) {
      throw constructionError('DUPLICATE_DOCUMENT_ID');
    }
    documentIds.add(document.projectionDocumentId);
    artifactIds.add(input.projectionDocumentArtifactRef.artifactId);
    if (
      content.publicationId !== publication.publicationId ||
      content.valuationBundleId !== publication.content.valuationBundleId ||
      content.valuationOutputInventoryIndexId !== index.valuationOutputInventoryIndexId ||
      content.scopeKey !== publication.content.scopeKey ||
      content.valueUnitId !== publication.content.valueUnitId
    ) {
      throw constructionError('DOCUMENT_IDENTITY_MISMATCH');
    }
    if (content.publicAssetBoundary !== AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY) {
      throw constructionError('PUBLIC_ASSET_BOUNDARY_MISMATCH');
    }
    if (calculationAsOf === null) {
      calculationAsOf = content.calculationAsOf;
      knowledgeCutoffAt = content.knowledgeCutoffAt;
    } else if (
      calculationAsOf !== content.calculationAsOf ||
      knowledgeCutoffAt !== content.knowledgeCutoffAt
    ) {
      throw constructionError('DOCUMENT_TIME_MISMATCH');
    }
    if (
      Date.parse(input.projectionDocumentArtifactRef.createdAt) > materialized ||
      Date.parse(content.calculationAsOf) > Date.parse(publication.content.createdAt)
    ) {
      throw constructionError('NON_MONOTONIC_ARTIFACT_TIME');
    }
    if (content.kind !== 'methodology') {
      const tradeId =
        content.kind === 'valuation_export_row' ? content.exportRow.tradeId : content.tradeId;
      if (!expectedTradeIdSet.has(tradeId)) {
        throw constructionError('DOCUMENT_MEMBERSHIP_MISMATCH');
      }
    } else if (
      !doesAflTradeArtifactRefMatchCanonicalJson(
        publication.content.methodologyArtifact,
        content.methodology
      )
    ) {
      throw constructionError('METHODOLOGY_PUBLICATION_ARTIFACT_MISMATCH');
    }
  }
  if (calculationAsOf === null || knowledgeCutoffAt === null) {
    throw constructionError('INVALID_PROJECTION_DOCUMENT_BINDINGS');
  }

  assertCompleteMembership(inputs, expectedTradeIds);
  const bindings = inputs.map(bindingFor).sort(compareBindings);
  const tradeBindings = bindings.filter((binding) => binding.kind !== 'methodology');
  const expectedByDocumentId = new Map(
    materialization.expectedDocuments.map((binding) => [binding.projectionDocumentId, binding])
  );
  if (
    tradeBindings.length !== materialization.expectedDocuments.length ||
    tradeBindings.some((binding) => {
      const expected = expectedByDocumentId.get(binding.projectionDocumentId);
      return (
        expected === undefined ||
        canonicalizeAflTradeJson(binding) !== canonicalizeAflTradeJson(expected)
      );
    })
  ) {
    throw constructionError('PROJECTION_MATERIALIZATION_MISMATCH');
  }
  const methodology = inputs.find(
    (input) => input.projectionDocument.content.kind === 'methodology'
  )?.projectionDocument.content;
  if (
    methodology?.kind !== 'methodology' ||
    canonicalizeAflTradeJson(methodology.projectionMaterialization) !==
      canonicalizeAflTradeJson(materialization.binding)
  ) {
    throw constructionError('PROJECTION_MATERIALIZATION_MISMATCH');
  }
  return {
    bindings,
    calculationAsOf,
    knowledgeCutoffAt,
  };
}

function assertCompleteMembership(
  inputs: readonly ProjectionDocumentInput[],
  expectedTradeIds: readonly string[]
): void {
  interface TradeDocuments {
    summariesByView: Map<string, ProjectionDocumentInput[]>;
    details: ProjectionDocumentInput[];
    rowsByView: Map<string, ProjectionDocumentInput[]>;
  }
  const documentsByTrade = new Map<string, TradeDocuments>();
  let methodologyCount = 0;
  for (const input of inputs) {
    const content = input.projectionDocument.content;
    if (content.kind === 'methodology') {
      methodologyCount += 1;
      continue;
    }
    const tradeId =
      content.kind === 'valuation_export_row' ? content.exportRow.tradeId : content.tradeId;
    let trade = documentsByTrade.get(tradeId);
    if (trade === undefined) {
      trade = { summariesByView: new Map(), details: [], rowsByView: new Map() };
      documentsByTrade.set(tradeId, trade);
    }
    if (content.kind === 'trade_detail') {
      trade.details.push(input);
    } else if (content.kind === 'trade_summary') {
      const summaries = trade.summariesByView.get(content.view) ?? [];
      summaries.push(input);
      trade.summariesByView.set(content.view, summaries);
    } else {
      const rows = trade.rowsByView.get(content.exportRow.view) ?? [];
      rows.push(input);
      trade.rowsByView.set(content.exportRow.view, rows);
    }
  }
  if (methodologyCount !== 1) throw constructionError('METHODOLOGY_MEMBERSHIP_MISMATCH');
  if (documentsByTrade.size !== expectedTradeIds.length) {
    throw constructionError('DOCUMENT_MEMBERSHIP_MISMATCH');
  }

  for (const tradeId of expectedTradeIds) {
    const trade = documentsByTrade.get(tradeId);
    if (
      trade === undefined ||
      trade.details.length !== 1 ||
      trade.summariesByView.size !== AFL_TRADE_VALUATION_VIEWS.length ||
      trade.rowsByView.size !== AFL_TRADE_VALUATION_VIEWS.length
    ) {
      throw constructionError('INCOMPLETE_TRADE_DOCUMENT_SET');
    }
    for (const view of AFL_TRADE_VALUATION_VIEWS) {
      const summaries = trade.summariesByView.get(view);
      const rows = trade.rowsByView.get(view);
      if (summaries?.length !== 1 || rows === undefined) {
        throw constructionError('INCOMPLETE_TRADE_DOCUMENT_SET');
      }
      const summaryInput = summaries[0];
      const summary = summaryInput.projectionDocument.content;
      if (summary.kind !== 'trade_summary') {
        throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
      }
      const expectedRowCount =
        'clubValues' in summary.valuation ? summary.valuation.clubValues.length : 1;
      if (rows.length !== expectedRowCount)
        throw constructionError('INCOMPLETE_TRADE_DOCUMENT_SET');
      for (let ordinal = 0; ordinal < expectedRowCount; ordinal += 1) {
        const matches = rows.filter((input) => {
          const content = input.projectionDocument.content;
          return (
            content.kind === 'valuation_export_row' && content.exportRow.rowOrdinal === ordinal
          );
        });
        if (matches.length !== 1) throw constructionError('INCOMPLETE_TRADE_DOCUMENT_SET');
        const row = matches[0].projectionDocument.content;
        if (
          row.kind !== 'valuation_export_row' ||
          canonicalizeAflTradeJson(row.exportRow.valuation) !==
            canonicalizeAflTradeJson(summary.valuation) ||
          ('clubValues' in summary.valuation
            ? canonicalizeAflTradeJson(row.exportRow.clubValue) !==
              canonicalizeAflTradeJson(summary.valuation.clubValues[ordinal])
            : row.exportRow.clubValue !== null || row.exportRow.rowOrdinal !== 0)
        ) {
          throw constructionError('EXPORT_ROW_MISMATCH');
        }
      }
    }
  }
}

function createShardArtifact(
  bindings: readonly AflTradeProjectionDocumentSetBinding[],
  shardOrdinal: number,
  common: Omit<
    z.infer<typeof aflTradeProjectionDocumentSetShardContentSchema>,
    | 'schemaVersion'
    | 'publicAssetBoundary'
    | 'shardOrdinal'
    | 'documentCount'
    | 'kindCounts'
    | 'orderedMembershipSha256'
    | 'bindings'
  >
): AflTradeProjectionDocumentSetShardArtifact {
  const content = {
    schemaVersion: AFL_TRADE_PROJECTION_DOCUMENT_SET_SHARD_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY,
    ...common,
    shardOrdinal,
    documentCount: bindings.length,
    kindCounts: countKinds(bindings),
    orderedMembershipSha256: sha256AflTradeCanonicalJson(bindings),
    bindings,
  };
  const projectionDocumentSetShard = aflTradeProjectionDocumentSetShardSchema.parse({
    projectionDocumentSetShardId: createAflTradeContentAddress(
      'projection-document-set-shard',
      content
    ),
    content,
  });
  return {
    projectionDocumentSetShard,
    projectionDocumentSetShardArtifactRef: createAflTradeCanonicalJsonArtifactRef(
      projectionDocumentSetShard,
      common.materializedAt
    ),
  };
}

function createShards(
  bindings: readonly AflTradeProjectionDocumentSetBinding[],
  common: Parameters<typeof createShardArtifact>[2]
): AflTradeProjectionDocumentSetShardArtifact[] {
  const shards: AflTradeProjectionDocumentSetShardArtifact[] = [];
  let offset = 0;
  let aggregateShardBytes = 0;
  while (offset < bindings.length) {
    const maximumCount = Math.min(
      AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD,
      bindings.length - offset
    );
    let low = 1;
    let high = maximumCount;
    let accepted: AflTradeProjectionDocumentSetShardArtifact | null = null;
    let acceptedCount = 0;
    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      const candidate = createShardArtifact(
        bindings.slice(offset, offset + count),
        shards.length,
        common
      );
      if (
        candidate.projectionDocumentSetShardArtifactRef.byteLength <=
        AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_SHARD_BYTES
      ) {
        accepted = candidate;
        acceptedCount = count;
        low = count + 1;
      } else {
        high = count - 1;
      }
    }
    if (accepted === null) throw constructionError('SHARD_SIZE_LIMIT_EXCEEDED');
    if (
      accepted.projectionDocumentSetShardArtifactRef.byteLength >
      AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_AGGREGATE_SHARD_BYTES - aggregateShardBytes
    ) {
      throw constructionError('AGGREGATE_SHARD_SIZE_LIMIT_EXCEEDED');
    }
    aggregateShardBytes += accepted.projectionDocumentSetShardArtifactRef.byteLength;
    shards.push(accepted);
    offset += acceptedCount;
  }
  return shards;
}

function rootShardBinding(
  artifact: AflTradeProjectionDocumentSetShardArtifact
): AflTradeProjectionDocumentSetShardBinding {
  const shard = artifact.projectionDocumentSetShard;
  const bindings = shard.content.bindings;
  return {
    shardOrdinal: shard.content.shardOrdinal,
    projectionDocumentSetShardId: shard.projectionDocumentSetShardId,
    artifactRef: artifact.projectionDocumentSetShardArtifactRef,
    documentCount: shard.content.documentCount,
    kindCounts: shard.content.kindCounts,
    orderedMembershipSha256: shard.content.orderedMembershipSha256,
    firstProjectionDocumentId: bindings[0].projectionDocumentId,
    lastProjectionDocumentId: bindings[bindings.length - 1].projectionDocumentId,
  };
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

const CREATE_INPUT_KEYS = [
  'publicationManifest',
  'valuationOutputInventoryIndex',
  'valuationOutputInventoryIndexArtifactRef',
  'projectionMaterializationVerification',
  'projectionDocuments',
  'materializedAt',
] as const;

export function createAflTradeProjectionDocumentSet(
  unparsedInput: unknown
): AflTradeProjectionDocumentSetResult {
  try {
    const snapshot = snapshotExactEnvelope(unparsedInput, CREATE_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');
    const publication = parseOrThrow(
      z.union([aflTradePublicationManifestV3Schema, aflTradePublicationManifestV4Schema]),
      snapshot.publicationManifest,
      'INVALID_PUBLICATION_MANIFEST'
    );
    const index = parseOrThrow(
      aflTradeValuationOutputInventoryIndexSchema,
      snapshot.valuationOutputInventoryIndex,
      'INVALID_INVENTORY_INDEX'
    );
    const indexArtifactRef = parseOrThrow(
      canonicalJsonArtifactRefSchema,
      snapshot.valuationOutputInventoryIndexArtifactRef,
      'INVALID_INVENTORY_INDEX_ARTIFACT_REFERENCE'
    );
    const materializedAt = parseOrThrow(
      aflTradeIsoDateTimeSchema,
      snapshot.materializedAt,
      'INVALID_MATERIALIZED_AT'
    );

    assertIndexAndPublication(publication, index, indexArtifactRef, materializedAt);
    const materialization = assertProjectionMaterialization(
      snapshot.projectionMaterializationVerification,
      publication,
      index,
      indexArtifactRef,
      materializedAt
    );
    const documents = parseProjectionDocumentsWithBudget(
      snapshot.projectionDocuments,
      materialization.binding.documentCount + 1
    );
    const validated = assertDocuments(
      publication,
      index,
      documents,
      materialization,
      materializedAt
    );
    const common = {
      publicationId: publication.publicationId,
      valuationBundleId: publication.content.valuationBundleId,
      valuationOutputInventoryIndexId: index.valuationOutputInventoryIndexId,
      projectionMaterialization: materialization.binding,
      scopeKey: publication.content.scopeKey,
      valueUnitId: publication.content.valueUnitId,
      calculationAsOf: validated.calculationAsOf,
      knowledgeCutoffAt: validated.knowledgeCutoffAt,
      materializedAt,
    };
    const projectionDocumentShards = createShards(validated.bindings, common);
    const kindCounts = countKinds(validated.bindings);
    const content = {
      schemaVersion: AFL_TRADE_PROJECTION_DOCUMENT_SET_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLIC_ASSET_BOUNDARY,
      publicationId: publication.publicationId,
      valuationBundleId: publication.content.valuationBundleId,
      valuationOutputInventoryIndex: {
        schemaVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_SCHEMA_VERSION,
        valuationOutputInventoryIndexId: index.valuationOutputInventoryIndexId,
        artifactRef: indexArtifactRef,
        entryCount: index.content.entryCount,
        inventorySetSha256: index.content.inventorySetSha256,
      },
      projectionMaterialization: materialization.binding,
      scopeKey: publication.content.scopeKey,
      valueUnitId: publication.content.valueUnitId,
      calculationAsOf: validated.calculationAsOf,
      knowledgeCutoffAt: validated.knowledgeCutoffAt,
      materializedAt,
      ordering: AFL_TRADE_PROJECTION_DOCUMENT_SET_ORDERING,
      membershipDigestDefinition: AFL_TRADE_PROJECTION_DOCUMENT_SET_MEMBERSHIP_DIGEST,
      shardEntryLimit: AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_BINDINGS_PER_SHARD,
      shardCount: projectionDocumentShards.length,
      tradeCount: index.content.entryCount,
      documentCount: validated.bindings.length,
      kindCounts,
      orderedMembershipSha256: sha256AflTradeCanonicalJson(validated.bindings),
      shards: projectionDocumentShards.map(rootShardBinding),
      predecessorPolicy: {
        predecessorSchemaVersion: null,
        compatibility: AFL_TRADE_PROJECTION_DOCUMENT_SET_PREDECESSOR_COMPATIBILITY,
        latestAlias: 'prohibited' as const,
        runtimeFallback: AFL_TRADE_PROJECTION_DOCUMENT_SET_RUNTIME_FALLBACK,
        publicationAuthority: AFL_TRADE_PROJECTION_DOCUMENT_SET_PUBLICATION_AUTHORITY,
      },
      limitation: AFL_TRADE_PROJECTION_DOCUMENT_SET_LIMITATION,
    };
    const projectionDocumentSet = aflTradeProjectionDocumentSetSchema.parse({
      projectionDocumentSetId: createAflTradeContentAddress('projection-document-set', content),
      content,
    });
    const projectionDocumentSetArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      projectionDocumentSet,
      materializedAt
    );
    if (
      projectionDocumentSetArtifactRef.byteLength > AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_ROOT_BYTES
    ) {
      throw constructionError('ROOT_SIZE_LIMIT_EXCEEDED');
    }
    const result = aflTradeProjectionDocumentSetResultSchema.safeParse({
      projectionDocumentShards,
      projectionDocumentSet,
      projectionDocumentSetArtifactRef,
    });
    if (!result.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeProjectionDocumentSetConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

const VERIFY_INPUT_KEYS = [...CREATE_INPUT_KEYS, 'output'] as const;
const RESULT_KEYS = [
  'projectionDocumentShards',
  'projectionDocumentSet',
  'projectionDocumentSetArtifactRef',
] as const;

function parseProjectionDocumentSetResultWithBudget(
  value: unknown
): AflTradeProjectionDocumentSetResult {
  const snapshot = snapshotExactEnvelope(value, RESULT_KEYS);
  if (snapshot === null) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  const root = parseOrThrow(
    aflTradeProjectionDocumentSetSchema,
    snapshot.projectionDocumentSet,
    'INTERNAL_ARTIFACT_CONTRACT_VIOLATION'
  );
  const rootArtifactRef = parseOrThrow(
    canonicalJsonArtifactRefSchema,
    snapshot.projectionDocumentSetArtifactRef,
    'INTERNAL_ARTIFACT_CONTRACT_VIOLATION'
  );
  if (
    !doesAflTradeArtifactRefMatchCanonicalJson(rootArtifactRef, root) ||
    rootArtifactRef.createdAt !== root.content.materializedAt ||
    rootArtifactRef.byteLength < 1 ||
    rootArtifactRef.byteLength > AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_ROOT_BYTES
  ) {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  const shardValue = snapshot.projectionDocumentShards;
  if (!Array.isArray(shardValue) || nodeUtilTypes.isProxy(shardValue)) {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  const ownKeys = Reflect.ownKeys(shardValue);
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(shardValue, 'length');
  const rawLength = lengthDescriptor?.value;
  if (
    Object.getPrototypeOf(shardValue) !== Array.prototype ||
    lengthDescriptor === undefined ||
    'get' in lengthDescriptor ||
    !Number.isSafeInteger(rawLength) ||
    rawLength !== root.content.shardCount ||
    ownKeys.some((key) => typeof key !== 'string') ||
    ownKeys.length !== rawLength + 1
  ) {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  let aggregateShardBytes = 0;
  const shards: AflTradeProjectionDocumentSetShardArtifact[] = [];
  for (let index = 0; index < rawLength; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(shardValue, String(index));
    if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const shard = parseOrThrow(
      aflTradeProjectionDocumentSetShardArtifactSchema,
      descriptor.value,
      'INTERNAL_ARTIFACT_CONTRACT_VIOLATION'
    );
    if (
      shard.projectionDocumentSetShardArtifactRef.byteLength >
      AFL_TRADE_PROJECTION_DOCUMENT_SET_MAX_AGGREGATE_SHARD_BYTES - aggregateShardBytes
    ) {
      throw constructionError('AGGREGATE_SHARD_SIZE_LIMIT_EXCEEDED');
    }
    aggregateShardBytes += shard.projectionDocumentSetShardArtifactRef.byteLength;
    shards.push(shard);
  }
  return parseOrThrow(
    aflTradeProjectionDocumentSetResultSchema,
    {
      projectionDocumentShards: shards,
      projectionDocumentSet: root,
      projectionDocumentSetArtifactRef: rootArtifactRef,
    },
    'INTERNAL_ARTIFACT_CONTRACT_VIOLATION'
  );
}

export function verifyAflTradeProjectionDocumentSet(input: unknown): boolean {
  const snapshot = snapshotExactEnvelope(input, VERIFY_INPUT_KEYS);
  if (snapshot === null) return false;
  try {
    const output = parseProjectionDocumentSetResultWithBudget(snapshot.output);
    const replayed = createAflTradeProjectionDocumentSet({
      publicationManifest: snapshot.publicationManifest,
      valuationOutputInventoryIndex: snapshot.valuationOutputInventoryIndex,
      valuationOutputInventoryIndexArtifactRef: snapshot.valuationOutputInventoryIndexArtifactRef,
      projectionMaterializationVerification: snapshot.projectionMaterializationVerification,
      projectionDocuments: snapshot.projectionDocuments,
      materializedAt: snapshot.materializedAt,
    });
    return canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(output);
  } catch {
    return false;
  }
}
