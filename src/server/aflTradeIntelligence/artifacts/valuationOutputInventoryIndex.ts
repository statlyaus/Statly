import { z } from 'zod';

import {
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
} from '@/types/aflTradeIntelligence/shared';

import { compareAflTradeCodeUnits } from '../valuation/deterministicProbabilityMeasure';
import {
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_DISTRIBUTION_COUNT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_ROOT_BYTES,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_COUNT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT,
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY,
  aflTradeValuationOutputInventorySchema,
  type AflTradeValuationOutputInventory,
} from '../valuation/valuationOutputInventory';
import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from './artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from './contentAddress';
import {
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION,
  aflTradeValuationBundleManifestV2Schema,
  type AflTradeValuationBundleManifestV2,
} from './valuationBundleManifest';

export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_SCHEMA_VERSION =
  'afl-trade-valuation-output-inventory-index/v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_ORDERING =
  'trade_id_utf16_code_unit_ascending_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_DIGEST_DEFINITION =
  'canonical_ordered_inventory_bindings_sha256_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_VERIFICATION_SCOPE =
  'bundle_to_detached_inventory_membership_and_complete_root_byte_authentication_only_descendant_derivation_requires_per_case_verification_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PREDECESSOR_POLICY_DEFINITION =
  'first_index_version_accepts_verified_detached_v1_inventories_only_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PREDECESSOR_COMPATIBILITY =
  'no_predecessor_no_implicit_conversion_or_runtime_fallback_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_LEGACY_TREATMENT =
  'legacy_snapshots_and_inline_descendants_are_audit_only_and_never_index_members_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_RUNTIME_FALLBACK = 'prohibited' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PUBLICATION_AUTHORITY =
  'complete_verified_index_of_detached_v1_inventories_required_before_publication_v1' as const;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_LIMITATION =
  'Immutable source-independent inventory membership index only; it does not prove descendant derivation, artifact-repository persistence, source approval, model calibration, Gate approval, projection parity, or publication readiness.' as const;

export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES = 10_000;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_CANONICAL_ENTRIES_BYTES =
  12 * 1024 * 1024;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_TOTAL_INVENTORY_BYTES =
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES *
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_ROOT_BYTES;

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Inventory-index bindings require canonical JSON artifact references.'
);

export const aflTradeValuationOutputInventoryIndexInventoryInputSchema = z
  .object({
    valuationOutputInventory: aflTradeValuationOutputInventorySchema,
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

export const aflTradeValuationOutputInventoryIndexCreateInputSchema = z
  .object({
    valuationBundleManifest: aflTradeValuationBundleManifestV2Schema,
    valuationBundleArtifactRef: canonicalJsonArtifactRefSchema,
    valuationOutputInventories: z
      .array(aflTradeValuationOutputInventoryIndexInventoryInputSchema)
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES),
    createdAt: aflTradeIsoDateTimeSchema,
  })
  .strict();

export type AflTradeValuationOutputInventoryIndexCreateInput = z.infer<
  typeof aflTradeValuationOutputInventoryIndexCreateInputSchema
>;

export const aflTradeValuationOutputInventoryIndexEntryOutputCountsSchema = z
  .object({
    valuationCalculationCount: z.literal(1),
    valuationDistributionCount: z
      .number()
      .int()
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_DISTRIBUTION_COUNT),
    valuationDistributionShardCount: z
      .number()
      .int()
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_COUNT),
    valuationComparisonCount: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT),
    structuredExplanationCount: z.literal(1),
    publicationOutputBindingCount: z
      .number()
      .int()
      .min(4)
      .max(
        2 +
          AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_COUNT +
          AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT
      ),
  })
  .strict()
  .superRefine((counts, context) => {
    const expected =
      counts.valuationCalculationCount +
      counts.valuationDistributionShardCount +
      counts.valuationComparisonCount +
      counts.structuredExplanationCount;
    if (counts.publicationOutputBindingCount !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['publicationOutputBindingCount'],
        message: 'Per-case output binding count must reconcile to current inventory roles.',
      });
    }
  });

export type AflTradeValuationOutputInventoryIndexEntryOutputCounts = z.infer<
  typeof aflTradeValuationOutputInventoryIndexEntryOutputCountsSchema
>;

export const aflTradeValuationOutputInventoryIndexAggregateOutputCountsSchema = z
  .object({
    valuationCalculationCount: z.number().int().positive().max(10_000),
    valuationDistributionCount: z
      .number()
      .int()
      .positive()
      .max(
        AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES *
          AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_DISTRIBUTION_COUNT
      ),
    valuationDistributionShardCount: z
      .number()
      .int()
      .positive()
      .max(
        AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES *
          AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_COUNT
      ),
    valuationComparisonCount: z
      .number()
      .int()
      .positive()
      .max(
        AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES *
          AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT
      ),
    structuredExplanationCount: z.number().int().positive().max(10_000),
    publicationOutputBindingCount: z
      .number()
      .int()
      .positive()
      .max(
        AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES *
          (2 +
            AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_SHARD_COUNT +
            AFL_TRADE_VALUATION_OUTPUT_INVENTORY_COMPARISON_COUNT)
      ),
  })
  .strict();

export type AflTradeValuationOutputInventoryIndexAggregateOutputCounts = z.infer<
  typeof aflTradeValuationOutputInventoryIndexAggregateOutputCountsSchema
>;

export const aflTradeValuationOutputInventoryIndexEntrySchema = z
  .object({
    tradeId: aflTradePublicIdSchema,
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationOutputInventoryId: aflTradeContentAddressedIdSchema('valuation-output-inventory'),
    inventoryArtifactRef: canonicalJsonArtifactRefSchema,
    outputCounts: aflTradeValuationOutputInventoryIndexEntryOutputCountsSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      entry.inventoryArtifactRef.byteLength < 1 ||
      entry.inventoryArtifactRef.byteLength > AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_ROOT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['inventoryArtifactRef', 'byteLength'],
        message: 'A detached inventory root must fit its 256 KiB canonical byte limit.',
      });
    }
  });

export type AflTradeValuationOutputInventoryIndexEntry = z.infer<
  typeof aflTradeValuationOutputInventoryIndexEntrySchema
>;

export const aflTradeValuationOutputInventoryIndexPredecessorPolicySchema = z
  .object({
    definitionVersion: z.literal(
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PREDECESSOR_POLICY_DEFINITION
    ),
    indexedInventorySchemaVersion: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION),
    predecessorSchemaVersion: z.null(),
    compatibility: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PREDECESSOR_COMPATIBILITY),
    legacyTreatment: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_LEGACY_TREATMENT),
    runtimeFallback: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_RUNTIME_FALLBACK),
    publicationAuthority: z.literal(
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PUBLICATION_AUTHORITY
    ),
  })
  .strict();

function canonicalByteLength(value: unknown): number {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value)).byteLength;
}

function entriesUseCanonicalOrder(
  entries: readonly AflTradeValuationOutputInventoryIndexEntry[]
): boolean {
  return entries.every(
    (entry, index) =>
      index === 0 || compareAflTradeCodeUnits(entries[index - 1].tradeId, entry.tradeId) < 0
  );
}

function sumEntryCounts(
  entries: readonly AflTradeValuationOutputInventoryIndexEntry[]
): z.infer<typeof aflTradeValuationOutputInventoryIndexAggregateOutputCountsSchema> {
  return entries.reduce(
    (aggregate, entry) => ({
      valuationCalculationCount:
        aggregate.valuationCalculationCount + entry.outputCounts.valuationCalculationCount,
      valuationDistributionCount:
        aggregate.valuationDistributionCount + entry.outputCounts.valuationDistributionCount,
      valuationDistributionShardCount:
        aggregate.valuationDistributionShardCount +
        entry.outputCounts.valuationDistributionShardCount,
      valuationComparisonCount:
        aggregate.valuationComparisonCount + entry.outputCounts.valuationComparisonCount,
      structuredExplanationCount:
        aggregate.structuredExplanationCount + entry.outputCounts.structuredExplanationCount,
      publicationOutputBindingCount:
        aggregate.publicationOutputBindingCount + entry.outputCounts.publicationOutputBindingCount,
    }),
    {
      valuationCalculationCount: 0,
      valuationDistributionCount: 0,
      valuationDistributionShardCount: 0,
      valuationComparisonCount: 0,
      structuredExplanationCount: 0,
      publicationOutputBindingCount: 0,
    }
  );
}

function sameAggregateCounts(
  left: z.infer<typeof aflTradeValuationOutputInventoryIndexAggregateOutputCountsSchema>,
  right: z.infer<typeof aflTradeValuationOutputInventoryIndexAggregateOutputCountsSchema>
): boolean {
  return Object.keys(left).every(
    (key) => left[key as keyof typeof left] === right[key as keyof typeof right]
  );
}

const parentBundleBindingSchema = z
  .object({
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

export const aflTradeValuationOutputInventoryIndexContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY),
    valuationBundle: parentBundleBindingSchema,
    scopeKey: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    inventorySchemaVersion: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION),
    ordering: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_ORDERING),
    digestDefinition: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_DIGEST_DEFINITION),
    entryCount: z.number().int().min(1).max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES),
    totalInventoryArtifactByteLength: z
      .number()
      .int()
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_TOTAL_INVENTORY_BYTES),
    canonicalEntriesByteLength: z
      .number()
      .int()
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_CANONICAL_ENTRIES_BYTES),
    inventorySetSha256: aflTradeSha256Schema,
    aggregateOutputCounts: aflTradeValuationOutputInventoryIndexAggregateOutputCountsSchema,
    entries: z
      .array(aflTradeValuationOutputInventoryIndexEntrySchema)
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES),
    verificationScope: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_VERIFICATION_SCOPE),
    predecessorPolicy: aflTradeValuationOutputInventoryIndexPredecessorPolicySchema,
    limitation: z.literal(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.entryCount !== content.entries.length) {
      context.addIssue({
        code: 'custom',
        path: ['entryCount'],
        message: 'Index entry count must match its canonical inventory bindings.',
      });
    }
    if (!entriesUseCanonicalOrder(content.entries)) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Index entries require unique trade IDs in canonical code-unit order.',
      });
    }
    for (const [path, identities] of [
      ['valuationCaseId', content.entries.map((entry) => entry.valuationCaseId)],
      [
        'valuationOutputInventoryId',
        content.entries.map((entry) => entry.valuationOutputInventoryId),
      ],
      [
        'inventoryArtifactRef',
        content.entries.map((entry) => entry.inventoryArtifactRef.artifactId),
      ],
    ] as const) {
      if (new Set(identities).size !== identities.length) {
        context.addIssue({
          code: 'custom',
          path: ['entries'],
          message: `Index ${path} identities must be unique.`,
        });
      }
    }
    const totalInventoryArtifactByteLength = content.entries.reduce(
      (sum, entry) => sum + entry.inventoryArtifactRef.byteLength,
      0
    );
    if (content.totalInventoryArtifactByteLength !== totalInventoryArtifactByteLength) {
      context.addIssue({
        code: 'custom',
        path: ['totalInventoryArtifactByteLength'],
        message: 'Index inventory byte total must reconcile to every root artifact reference.',
      });
    }
    if (content.canonicalEntriesByteLength !== canonicalByteLength(content.entries)) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalEntriesByteLength'],
        message: 'Index canonical entry byte count must match the ordered bindings.',
      });
    }
    if (content.inventorySetSha256 !== sha256AflTradeCanonicalJson(content.entries)) {
      context.addIssue({
        code: 'custom',
        path: ['inventorySetSha256'],
        message: 'Index inventory-set digest must authenticate the ordered bindings.',
      });
    }
    if (!sameAggregateCounts(content.aggregateOutputCounts, sumEntryCounts(content.entries))) {
      context.addIssue({
        code: 'custom',
        path: ['aggregateOutputCounts'],
        message: 'Index aggregate output counts must reconcile to every per-case inventory.',
      });
    }
  });

export const aflTradeValuationOutputInventoryIndexSchema = z
  .object({
    valuationOutputInventoryIndexId: aflTradeContentAddressedIdSchema(
      'valuation-output-inventory-index'
    ),
    content: aflTradeValuationOutputInventoryIndexContentSchema,
  })
  .strict()
  .superRefine((index, context) => {
    addAflTradeContentAddressIssue(
      'valuation-output-inventory-index',
      index.valuationOutputInventoryIndexId,
      index.content,
      context,
      ['valuationOutputInventoryIndexId']
    );
  });

export type AflTradeValuationOutputInventoryIndexContent = z.infer<
  typeof aflTradeValuationOutputInventoryIndexContentSchema
>;
export type AflTradeValuationOutputInventoryIndex = z.infer<
  typeof aflTradeValuationOutputInventoryIndexSchema
>;

export const aflTradeValuationOutputInventoryIndexResultSchema = z
  .object({
    valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexSchema,
    valuationOutputInventoryIndexArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const reference = result.valuationOutputInventoryIndexArtifactRef;
    const index = result.valuationOutputInventoryIndex;
    if (!doesAflTradeArtifactRefMatchCanonicalJson(reference, index)) {
      context.addIssue({
        code: 'custom',
        path: ['valuationOutputInventoryIndexArtifactRef'],
        message: 'Index artifact reference must authenticate the complete semantic index.',
      });
    }
    if (reference.byteLength > AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ARTIFACT_BYTES) {
      context.addIssue({
        code: 'custom',
        path: ['valuationOutputInventoryIndexArtifactRef', 'byteLength'],
        message: 'Canonical index artifact exceeds its byte limit.',
      });
    }
    const createdAt = Date.parse(reference.createdAt);
    const sourceReferences = [
      index.content.valuationBundle.artifactRef,
      ...index.content.entries.map((entry) => entry.inventoryArtifactRef),
    ];
    if (sourceReferences.some((source) => Date.parse(source.createdAt) > createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['valuationOutputInventoryIndexArtifactRef', 'createdAt'],
        message: 'Index artifact cannot predate its bundle or inventory roots.',
      });
    }
  });

export type AflTradeValuationOutputInventoryIndexResult = z.infer<
  typeof aflTradeValuationOutputInventoryIndexResultSchema
>;

export const aflTradeValuationOutputInventoryIndexVerifyInputSchema = z
  .object({
    valuationBundleManifest: aflTradeValuationBundleManifestV2Schema,
    valuationBundleArtifactRef: canonicalJsonArtifactRefSchema,
    valuationOutputInventories: z
      .array(aflTradeValuationOutputInventoryIndexInventoryInputSchema)
      .min(1)
      .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES),
    output: aflTradeValuationOutputInventoryIndexResultSchema,
  })
  .strict();

export type AflTradeValuationOutputInventoryIndexVerifyInput = z.infer<
  typeof aflTradeValuationOutputInventoryIndexVerifyInputSchema
>;

export const AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_CONSTRUCTION_ERROR_CODES = [
  'INVALID_INPUT_ENVELOPE',
  'INVALID_CREATED_AT',
  'INVALID_VALUATION_BUNDLE_MANIFEST',
  'INVALID_VALUATION_BUNDLE_ARTIFACT_REFERENCE',
  'INVALID_INVENTORY_BINDINGS',
  'INVENTORY_ARTIFACT_REFERENCE_MISMATCH',
  'INVENTORY_ROOT_SIZE_LIMIT_EXCEEDED',
  'BUNDLE_BINDING_MISMATCH',
  'VALUE_UNIT_MISMATCH',
  'PUBLIC_ASSET_BOUNDARY_MISMATCH',
  'DUPLICATE_TRADE_ID',
  'DUPLICATE_VALUATION_CASE_ID',
  'DUPLICATE_INVENTORY_ID',
  'DUPLICATE_INVENTORY_ARTIFACT_ID',
  'NON_MONOTONIC_ARTIFACT_TIME',
  'INDEX_SIZE_LIMIT_EXCEEDED',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const;

export type AflTradeValuationOutputInventoryIndexConstructionErrorCode =
  (typeof AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_CONSTRUCTION_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<
  Record<AflTradeValuationOutputInventoryIndexConstructionErrorCode, string>
> = Object.freeze({
  INVALID_INPUT_ENVELOPE: 'The valuation-output-inventory-index input envelope is invalid.',
  INVALID_CREATED_AT: 'The inventory-index artifact creation time is invalid.',
  INVALID_VALUATION_BUNDLE_MANIFEST: 'The inventory-index valuation bundle is invalid.',
  INVALID_VALUATION_BUNDLE_ARTIFACT_REFERENCE:
    'The valuation-bundle artifact reference does not authenticate the complete bundle.',
  INVALID_INVENTORY_BINDINGS: 'The detached valuation-output-inventory bindings are invalid.',
  INVENTORY_ARTIFACT_REFERENCE_MISMATCH:
    'A detached inventory artifact reference does not authenticate its complete root envelope.',
  INVENTORY_ROOT_SIZE_LIMIT_EXCEEDED:
    'A detached valuation-output-inventory root exceeds its 256 KiB byte limit.',
  BUNDLE_BINDING_MISMATCH:
    'Every detached inventory must bind the exact indexed valuation bundle identity and bytes.',
  VALUE_UNIT_MISMATCH: 'Every detached inventory must use the indexed valuation bundle value unit.',
  PUBLIC_ASSET_BOUNDARY_MISMATCH:
    'The inventory index cannot cross the public source-native AFL asset boundary.',
  DUPLICATE_TRADE_ID: 'Inventory-index trade identities must be unique.',
  DUPLICATE_VALUATION_CASE_ID: 'Inventory-index valuation-case identities must be unique.',
  DUPLICATE_INVENTORY_ID: 'Inventory-index semantic inventory identities must be unique.',
  DUPLICATE_INVENTORY_ARTIFACT_ID: 'Inventory-index root artifact identities must be unique.',
  NON_MONOTONIC_ARTIFACT_TIME:
    'The inventory-index artifact cannot predate its bundle or detached inventory roots.',
  INDEX_SIZE_LIMIT_EXCEEDED: 'The canonical inventory index exceeds its byte limit.',
  INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
    'The valuation output inventory index failed its internal artifact contract.',
});

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeValuationOutputInventoryIndexConstructionError extends Error {
  readonly code: AflTradeValuationOutputInventoryIndexConstructionErrorCode;

  constructor(code: AflTradeValuationOutputInventoryIndexConstructionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeValuationOutputInventoryIndexConstructionError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeValuationOutputInventoryIndexConstructionError';
    code: AflTradeValuationOutputInventoryIndexConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeValuationOutputInventoryIndexConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeValuationOutputInventoryIndexConstructionError(
  value: unknown
): value is AflTradeValuationOutputInventoryIndexConstructionError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function constructionError(
  code: AflTradeValuationOutputInventoryIndexConstructionErrorCode
): AflTradeValuationOutputInventoryIndexConstructionError {
  return new AflTradeValuationOutputInventoryIndexConstructionError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeValuationOutputInventoryIndexConstructionErrorCode
): T {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // Hostile inputs are replaced with stable, non-reflective construction errors.
  }
  throw constructionError(code);
}

const CREATE_INPUT_KEYS = [
  'valuationBundleManifest',
  'valuationBundleArtifactRef',
  'valuationOutputInventories',
  'createdAt',
] as const;
type CreateInputKey = (typeof CREATE_INPUT_KEYS)[number];
type CreateInputSnapshot = Record<CreateInputKey, unknown>;
const CREATE_INPUT_KEY_SET = new Set<string>(CREATE_INPUT_KEYS);

function snapshotCreateEnvelope(value: unknown): CreateInputSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== CREATE_INPUT_KEYS.length ||
      keys.some((key) => typeof key !== 'string' || !CREATE_INPUT_KEY_SET.has(key))
    ) {
      return null;
    }
    const snapshot = {} as CreateInputSnapshot;
    for (const key of CREATE_INPUT_KEYS) snapshot[key] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function outputCounts(
  inventory: AflTradeValuationOutputInventory
): AflTradeValuationOutputInventoryIndexEntryOutputCounts {
  const content = inventory.content;
  return {
    valuationCalculationCount: 1,
    valuationDistributionCount: content.distributionCount,
    valuationDistributionShardCount: content.distributionShardCount,
    valuationComparisonCount: content.valuationComparisonCount,
    structuredExplanationCount: 1,
    publicationOutputBindingCount:
      1 + content.distributionShardCount + content.valuationComparisonCount + 1,
  };
}

function assertBundleArtifactReference(
  bundle: AflTradeValuationBundleManifestV2,
  reference: AflTradeArtifactRef
): void {
  if (!doesAflTradeArtifactRefMatchCanonicalJson(reference, bundle)) {
    throw constructionError('INVALID_VALUATION_BUNDLE_ARTIFACT_REFERENCE');
  }
}

function assertInventoryBinding(
  bundle: AflTradeValuationBundleManifestV2,
  bundleReference: AflTradeArtifactRef,
  inventory: AflTradeValuationOutputInventory,
  reference: AflTradeArtifactRef,
  createdAt: string
): void {
  if (!doesAflTradeArtifactRefMatchCanonicalJson(reference, inventory)) {
    throw constructionError('INVENTORY_ARTIFACT_REFERENCE_MISMATCH');
  }
  if (
    reference.byteLength < 1 ||
    reference.byteLength > AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_ROOT_BYTES
  ) {
    throw constructionError('INVENTORY_ROOT_SIZE_LIMIT_EXCEEDED');
  }
  if (reference.createdAt !== inventory.content.materializedAt) {
    throw constructionError('INVENTORY_ARTIFACT_REFERENCE_MISMATCH');
  }
  if (
    inventory.content.valuationBundle.valuationBundleId !== bundle.valuationBundleId ||
    !sameCanonicalJson(inventory.content.valuationBundle.artifactRef, bundleReference)
  ) {
    throw constructionError('BUNDLE_BINDING_MISMATCH');
  }
  if (
    inventory.content.valueUnitId !== bundle.content.valueUnitId ||
    inventory.content.valueUnitId.trim().length === 0
  ) {
    throw constructionError('VALUE_UNIT_MISMATCH');
  }
  if (
    bundle.content.publicAssetBoundary !==
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY ||
    inventory.content.publicAssetBoundary !==
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY
  ) {
    throw constructionError('PUBLIC_ASSET_BOUNDARY_MISMATCH');
  }
  if (Date.parse(reference.createdAt) > Date.parse(createdAt)) {
    throw constructionError('NON_MONOTONIC_ARTIFACT_TIME');
  }
}

function requireUnique(
  values: readonly string[],
  code: AflTradeValuationOutputInventoryIndexConstructionErrorCode
): void {
  if (new Set(values).size !== values.length) throw constructionError(code);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

export function createAflTradeValuationOutputInventoryIndex(
  unparsedInput: unknown
): AflTradeValuationOutputInventoryIndexResult {
  try {
    const snapshot = snapshotCreateEnvelope(unparsedInput);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');
    const createdAt = parseOrThrow(
      aflTradeIsoDateTimeSchema,
      snapshot.createdAt,
      'INVALID_CREATED_AT'
    );
    const bundle = parseOrThrow(
      aflTradeValuationBundleManifestV2Schema,
      snapshot.valuationBundleManifest,
      'INVALID_VALUATION_BUNDLE_MANIFEST'
    );
    const bundleReference = parseOrThrow(
      canonicalJsonArtifactRefSchema,
      snapshot.valuationBundleArtifactRef,
      'INVALID_VALUATION_BUNDLE_ARTIFACT_REFERENCE'
    );
    const inventoryBindings = parseOrThrow(
      z
        .array(aflTradeValuationOutputInventoryIndexInventoryInputSchema)
        .min(1)
        .max(AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES),
      snapshot.valuationOutputInventories,
      'INVALID_INVENTORY_BINDINGS'
    );

    assertBundleArtifactReference(bundle, bundleReference);
    if (
      Date.parse(bundleReference.createdAt) < Date.parse(bundle.content.createdAt) ||
      Date.parse(createdAt) < Date.parse(bundle.content.createdAt) ||
      Date.parse(bundleReference.createdAt) > Date.parse(createdAt)
    ) {
      throw constructionError('NON_MONOTONIC_ARTIFACT_TIME');
    }
    for (const binding of inventoryBindings) {
      assertInventoryBinding(
        bundle,
        bundleReference,
        binding.valuationOutputInventory,
        binding.artifactRef,
        createdAt
      );
    }

    requireUnique(
      inventoryBindings.map((binding) => binding.valuationOutputInventory.content.tradeId),
      'DUPLICATE_TRADE_ID'
    );
    requireUnique(
      inventoryBindings.map(
        (binding) => binding.valuationOutputInventory.content.valuationCase.valuationCaseId
      ),
      'DUPLICATE_VALUATION_CASE_ID'
    );
    requireUnique(
      inventoryBindings.map(
        (binding) => binding.valuationOutputInventory.valuationOutputInventoryId
      ),
      'DUPLICATE_INVENTORY_ID'
    );
    requireUnique(
      inventoryBindings.map((binding) => binding.artifactRef.artifactId),
      'DUPLICATE_INVENTORY_ARTIFACT_ID'
    );

    const entries = inventoryBindings
      .map((binding): AflTradeValuationOutputInventoryIndexEntry => {
        const inventory = binding.valuationOutputInventory;
        return {
          tradeId: inventory.content.tradeId,
          valuationCaseId: inventory.content.valuationCase.valuationCaseId,
          valuationOutputInventoryId: inventory.valuationOutputInventoryId,
          inventoryArtifactRef: binding.artifactRef,
          outputCounts: outputCounts(inventory),
        };
      })
      .sort((left, right) => compareAflTradeCodeUnits(left.tradeId, right.tradeId));
    const canonicalEntriesByteLength = canonicalByteLength(entries);
    if (
      canonicalEntriesByteLength >
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_CANONICAL_ENTRIES_BYTES
    ) {
      throw constructionError('INDEX_SIZE_LIMIT_EXCEEDED');
    }
    const totalInventoryArtifactByteLength = entries.reduce(
      (sum, entry) => sum + entry.inventoryArtifactRef.byteLength,
      0
    );
    if (
      totalInventoryArtifactByteLength >
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_TOTAL_INVENTORY_BYTES
    ) {
      throw constructionError('INDEX_SIZE_LIMIT_EXCEEDED');
    }

    const content = {
      schemaVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_PUBLIC_ASSET_BOUNDARY,
      valuationBundle: {
        valuationBundleId: bundle.valuationBundleId,
        artifactRef: bundleReference,
      },
      scopeKey: bundle.content.scopeKey,
      valueUnitId: bundle.content.valueUnitId,
      inventorySchemaVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION,
      ordering: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_ORDERING,
      digestDefinition: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_DIGEST_DEFINITION,
      entryCount: entries.length,
      totalInventoryArtifactByteLength,
      canonicalEntriesByteLength,
      inventorySetSha256: sha256AflTradeCanonicalJson(entries),
      aggregateOutputCounts: sumEntryCounts(entries),
      entries,
      verificationScope: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_VERIFICATION_SCOPE,
      predecessorPolicy: {
        definitionVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PREDECESSOR_POLICY_DEFINITION,
        indexedInventorySchemaVersion: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_SCHEMA_VERSION,
        predecessorSchemaVersion: null,
        compatibility: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PREDECESSOR_COMPATIBILITY,
        legacyTreatment: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_LEGACY_TREATMENT,
        runtimeFallback: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_RUNTIME_FALLBACK,
        publicationAuthority: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_PUBLICATION_AUTHORITY,
      },
      limitation: AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_LIMITATION,
    };
    const parsedIndex = aflTradeValuationOutputInventoryIndexSchema.safeParse({
      valuationOutputInventoryIndexId: createAflTradeContentAddress(
        'valuation-output-inventory-index',
        content
      ),
      content,
    });
    if (!parsedIndex.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const valuationOutputInventoryIndexArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      parsedIndex.data,
      createdAt
    );
    if (
      valuationOutputInventoryIndexArtifactRef.byteLength >
      AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ARTIFACT_BYTES
    ) {
      throw constructionError('INDEX_SIZE_LIMIT_EXCEEDED');
    }
    const parsedResult = aflTradeValuationOutputInventoryIndexResultSchema.safeParse({
      valuationOutputInventoryIndex: parsedIndex.data,
      valuationOutputInventoryIndexArtifactRef,
    });
    if (!parsedResult.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    return deepFreeze(parsedResult.data);
  } catch (error) {
    if (isAflTradeValuationOutputInventoryIndexConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

const VERIFY_INPUT_KEYS = [
  'valuationBundleManifest',
  'valuationBundleArtifactRef',
  'valuationOutputInventories',
  'output',
] as const;
type VerifyInputKey = (typeof VERIFY_INPUT_KEYS)[number];
type VerifyInputSnapshot = Record<VerifyInputKey, unknown>;
const VERIFY_INPUT_KEY_SET = new Set<string>(VERIFY_INPUT_KEYS);

function snapshotVerifyEnvelope(value: unknown): VerifyInputSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== VERIFY_INPUT_KEYS.length ||
      keys.some((key) => typeof key !== 'string' || !VERIFY_INPUT_KEY_SET.has(key))
    ) {
      return null;
    }
    const snapshot = {} as VerifyInputSnapshot;
    for (const key of VERIFY_INPUT_KEYS) snapshot[key] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

export function verifyAflTradeValuationOutputInventoryIndex(input: unknown): boolean {
  try {
    const snapshot = snapshotVerifyEnvelope(input);
    if (snapshot === null) return false;
    const output = aflTradeValuationOutputInventoryIndexResultSchema.safeParse(snapshot.output);
    if (!output.success) return false;
    const replayed = createAflTradeValuationOutputInventoryIndex({
      valuationBundleManifest: snapshot.valuationBundleManifest,
      valuationBundleArtifactRef: snapshot.valuationBundleArtifactRef,
      valuationOutputInventories: snapshot.valuationOutputInventories,
      createdAt: output.data.valuationOutputInventoryIndexArtifactRef.createdAt,
    });
    return canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(output.data);
  } catch {
    return false;
  }
}
