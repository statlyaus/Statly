import { z } from 'zod';

import { aflTradeIsoDateTimeSchema, aflTradePublicIdSchema } from '@/types/aflTradeIntelligence';

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
  aflTradeValuationOutputInventoryIndexBindingSchema,
  type AflTradePublicationManifestV3,
  type AflTradePublicationManifestV4,
} from '../artifacts/publicationProjectionManifests';
import {
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES,
  aflTradeValuationOutputInventoryIndexInventoryInputSchema,
  aflTradeValuationOutputInventoryIndexResultSchema,
  aflTradeValuationOutputInventoryIndexSchema,
  type AflTradeValuationOutputInventoryIndex,
} from '../artifacts/valuationOutputInventoryIndex';
import { compareAflTradeCodeUnits } from '../valuation/deterministicProbabilityMeasure';
import {
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_ROOT_BYTES,
  type AflTradeValuationOutputInventory,
} from '../valuation/valuationOutputInventory';
import {
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_MAX_ARTIFACT_BYTES,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
  aflTradeProjectionPublicEvidenceResultSchema,
  type AflTradeProjectionPublicEvidence,
} from './projectionPublicEvidence';

export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION =
  'afl-trade-projection-public-evidence-index/v1' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_ORDERING =
  'trade_id_utf16_code_unit_ascending_v1' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_DIGEST_DEFINITION =
  'canonical_ordered_inventory_evidence_pair_bindings_sha256_v1' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_VERIFICATION_SCOPE =
  'publication_inventory_index_inventory_root_and_public_evidence_byte_authentication_with_exact_identity_membership_only_v1' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_POLICY_DEFINITION =
  'first_index_version_accepts_detached_v1_public_evidence_only_v1' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_COMPATIBILITY =
  'no_predecessor_no_latest_alias_no_implicit_conversion_v1' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_RUNTIME_FALLBACK = 'prohibited' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PROJECTION_BINDING =
  'projection_manifest_only_publication_manifest_binding_prohibited_to_avoid_identity_cycle_v1' as const;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_LIMITATION =
  'Immutable detached public-evidence membership index only; it authenticates exact publication, inventory, and evidence bytes and identities, but does not prove source-binding claim truth, upstream derivation, source rights, model validity, publication approval, projection parity, serving authority, fantasy authorization, or user ownership.' as const;

export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ENTRIES =
  AFL_TRADE_VALUATION_OUTPUT_INVENTORY_INDEX_MAX_ENTRIES;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_CANONICAL_ENTRIES_BYTES =
  16 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_TOTAL_EVIDENCE_BYTES =
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ENTRIES *
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_MAX_ARTIFACT_BYTES;

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Projection public-evidence indexes require canonical JSON artifact references.'
);

export const aflTradeProjectionPublicEvidenceIndexEvidenceInputSchema =
  aflTradeProjectionPublicEvidenceResultSchema;

export type AflTradeProjectionPublicEvidenceIndexEvidenceInput = z.infer<
  typeof aflTradeProjectionPublicEvidenceIndexEvidenceInputSchema
>;

const inventoryInputsSchema = z
  .array(aflTradeValuationOutputInventoryIndexInventoryInputSchema)
  .min(1)
  .max(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ENTRIES);
const evidenceInputsSchema = z
  .array(aflTradeProjectionPublicEvidenceIndexEvidenceInputSchema)
  .min(1)
  .max(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ENTRIES);
const publicationManifestSchema = z.union([
  aflTradePublicationManifestV3Schema,
  aflTradePublicationManifestV4Schema,
]);
type PublicationManifest = AflTradePublicationManifestV3 | AflTradePublicationManifestV4;

export const aflTradeProjectionPublicEvidenceIndexCreateInputSchema = z
  .object({
    publicationManifest: publicationManifestSchema,
    publicationManifestArtifactRef: canonicalJsonArtifactRefSchema,
    valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexSchema,
    valuationOutputInventoryIndexArtifactRef: canonicalJsonArtifactRefSchema,
    valuationOutputInventories: inventoryInputsSchema,
    projectionPublicEvidences: evidenceInputsSchema,
    materializedAt: aflTradeIsoDateTimeSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const parentResult = aflTradeValuationOutputInventoryIndexResultSchema.safeParse({
      valuationOutputInventoryIndex: input.valuationOutputInventoryIndex,
      valuationOutputInventoryIndexArtifactRef: input.valuationOutputInventoryIndexArtifactRef,
    });
    if (!parentResult.success) {
      context.addIssue({
        code: 'custom',
        path: ['valuationOutputInventoryIndexArtifactRef'],
        message:
          'The parent inventory-index root and reference must satisfy its exact result contract.',
      });
    }
  });

export type AflTradeProjectionPublicEvidenceIndexCreateInput = z.infer<
  typeof aflTradeProjectionPublicEvidenceIndexCreateInputSchema
>;

const publicationBindingSchema = z
  .object({
    schemaVersion: z.enum(['afl-trade-publication/v3', 'afl-trade-publication/v4']),
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

export const aflTradeProjectionPublicEvidenceIndexEntrySchema = z
  .object({
    tradeId: aflTradePublicIdSchema,
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    valuationOutputInventoryId: aflTradeContentAddressedIdSchema('valuation-output-inventory'),
    inventoryArtifactRef: canonicalJsonArtifactRefSchema,
    projectionPublicEvidenceId: aflTradeContentAddressedIdSchema('projection-public-evidence'),
    evidenceArtifactRef: canonicalJsonArtifactRefSchema,
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
        message: 'An indexed inventory root must fit its 256 KiB canonical byte limit.',
      });
    }
    if (
      entry.evidenceArtifactRef.byteLength < 1 ||
      entry.evidenceArtifactRef.byteLength > AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_MAX_ARTIFACT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceArtifactRef', 'byteLength'],
        message: 'An indexed public-evidence artifact must fit its one MiB byte limit.',
      });
    }
  });

export type AflTradeProjectionPublicEvidenceIndexEntry = z.infer<
  typeof aflTradeProjectionPublicEvidenceIndexEntrySchema
>;

export const aflTradeProjectionPublicEvidenceIndexPredecessorPolicySchema = z
  .object({
    definitionVersion: z.literal(
      AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_POLICY_DEFINITION
    ),
    indexedEvidenceSchemaVersion: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION),
    predecessorSchemaVersion: z.null(),
    compatibility: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_COMPATIBILITY),
    latestAlias: z.literal('prohibited'),
    runtimeFallback: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_RUNTIME_FALLBACK),
    bindingAuthority: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PROJECTION_BINDING),
  })
  .strict();

function canonicalByteLength(value: unknown): number {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value)).byteLength;
}

function entriesUseCanonicalOrder(
  entries: readonly AflTradeProjectionPublicEvidenceIndexEntry[]
): boolean {
  return entries.every(
    (entry, index) =>
      index === 0 || compareAflTradeCodeUnits(entries[index - 1].tradeId, entry.tradeId) < 0
  );
}

function addUniqueIdentityIssue(
  values: readonly string[],
  context: z.RefinementCtx,
  label: string
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: 'custom',
      path: ['entries'],
      message: `Public-evidence index ${label} identities must be unique.`,
    });
  }
}

export const aflTradeProjectionPublicEvidenceIndexContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY),
    publication: publicationBindingSchema,
    valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexBindingSchema,
    scopeKey: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    indexedEvidenceSchemaVersion: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION),
    ordering: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_ORDERING),
    digestDefinition: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_DIGEST_DEFINITION),
    entryCount: z.number().int().min(1).max(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ENTRIES),
    totalEvidenceArtifactByteLength: z
      .number()
      .int()
      .min(1)
      .max(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_TOTAL_EVIDENCE_BYTES),
    canonicalEntriesByteLength: z
      .number()
      .int()
      .min(1)
      .max(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_CANONICAL_ENTRIES_BYTES),
    evidenceBindingSetSha256: aflTradeSha256Schema,
    entries: z
      .array(aflTradeProjectionPublicEvidenceIndexEntrySchema)
      .min(1)
      .max(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ENTRIES),
    verificationScope: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_VERIFICATION_SCOPE),
    predecessorPolicy: aflTradeProjectionPublicEvidenceIndexPredecessorPolicySchema,
    materializedAt: aflTradeIsoDateTimeSchema,
    limitation: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (
      content.entryCount !== content.entries.length ||
      content.entryCount !== content.valuationOutputInventoryIndex.entryCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['entryCount'],
        message: 'Evidence and parent inventory-index entry counts must match.',
      });
    }
    if (!entriesUseCanonicalOrder(content.entries)) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Evidence-index entries require unique trade IDs in canonical code-unit order.',
      });
    }
    for (const [label, identities] of [
      ['valuation-case', content.entries.map((entry) => entry.valuationCaseId)],
      ['valuation-calculation', content.entries.map((entry) => entry.valuationCalculationId)],
      [
        'valuation-output-inventory',
        content.entries.map((entry) => entry.valuationOutputInventoryId),
      ],
      ['inventory-artifact', content.entries.map((entry) => entry.inventoryArtifactRef.artifactId)],
      [
        'projection-public-evidence',
        content.entries.map((entry) => entry.projectionPublicEvidenceId),
      ],
      ['evidence-artifact', content.entries.map((entry) => entry.evidenceArtifactRef.artifactId)],
    ] as const) {
      addUniqueIdentityIssue(identities, context, label);
    }
    const totalEvidenceBytes = content.entries.reduce(
      (sum, entry) => sum + entry.evidenceArtifactRef.byteLength,
      0
    );
    if (content.totalEvidenceArtifactByteLength !== totalEvidenceBytes) {
      context.addIssue({
        code: 'custom',
        path: ['totalEvidenceArtifactByteLength'],
        message: 'Evidence artifact bytes must reconcile to every indexed evidence reference.',
      });
    }
    if (content.canonicalEntriesByteLength !== canonicalByteLength(content.entries)) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalEntriesByteLength'],
        message: 'Canonical entry bytes must match the ordered evidence bindings.',
      });
    }
    if (content.evidenceBindingSetSha256 !== sha256AflTradeCanonicalJson(content.entries)) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceBindingSetSha256'],
        message: 'The evidence-binding digest must authenticate the ordered entries.',
      });
    }

    const publicationCreatedAt = Date.parse(content.publication.artifactRef.createdAt);
    const inventoryIndexCreatedAt = Date.parse(
      content.valuationOutputInventoryIndex.artifactRef.createdAt
    );
    const materializedAt = Date.parse(content.materializedAt);
    if (
      content.publication.artifactRef.byteLength < 1 ||
      content.valuationOutputInventoryIndex.artifactRef.byteLength < 1 ||
      publicationCreatedAt > materializedAt ||
      inventoryIndexCreatedAt > materializedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializedAt'],
        message: 'The evidence index cannot predate its publication or inventory index.',
      });
    }
    for (const [entryIndex, entry] of content.entries.entries()) {
      const inventoryCreatedAt = Date.parse(entry.inventoryArtifactRef.createdAt);
      const evidenceCreatedAt = Date.parse(entry.evidenceArtifactRef.createdAt);
      if (
        publicationCreatedAt > evidenceCreatedAt ||
        inventoryIndexCreatedAt > evidenceCreatedAt ||
        inventoryCreatedAt > evidenceCreatedAt ||
        evidenceCreatedAt > materializedAt
      ) {
        context.addIssue({
          code: 'custom',
          path: ['entries', entryIndex, 'evidenceArtifactRef', 'createdAt'],
          message:
            'Evidence must follow its publication, inventory index, and inventory root and cannot postdate the evidence index.',
        });
      }
    }
  });

export const aflTradeProjectionPublicEvidenceIndexSchema = z
  .object({
    projectionPublicEvidenceIndexId: aflTradeContentAddressedIdSchema(
      'projection-public-evidence-index'
    ),
    content: aflTradeProjectionPublicEvidenceIndexContentSchema,
  })
  .strict()
  .superRefine((index, context) => {
    addAflTradeContentAddressIssue(
      'projection-public-evidence-index',
      index.projectionPublicEvidenceIndexId,
      index.content,
      context,
      ['projectionPublicEvidenceIndexId']
    );
  });

export type AflTradeProjectionPublicEvidenceIndexContent = z.infer<
  typeof aflTradeProjectionPublicEvidenceIndexContentSchema
>;
export type AflTradeProjectionPublicEvidenceIndex = z.infer<
  typeof aflTradeProjectionPublicEvidenceIndexSchema
>;

export const aflTradeProjectionPublicEvidenceIndexResultSchema = z
  .object({
    projectionPublicEvidenceIndex: aflTradeProjectionPublicEvidenceIndexSchema,
    projectionPublicEvidenceIndexArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const index = result.projectionPublicEvidenceIndex;
    const reference = result.projectionPublicEvidenceIndexArtifactRef;
    if (!doesAflTradeArtifactRefMatchCanonicalJson(reference, index)) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPublicEvidenceIndexArtifactRef'],
        message: 'The index artifact reference must authenticate the complete index.',
      });
    }
    if (reference.createdAt !== index.content.materializedAt) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPublicEvidenceIndexArtifactRef', 'createdAt'],
        message: 'The index artifact time must equal its content materialization time.',
      });
    }
    if (
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ARTIFACT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPublicEvidenceIndexArtifactRef', 'byteLength'],
        message: 'The canonical public-evidence index exceeds its 20 MiB limit.',
      });
    }
  });

export type AflTradeProjectionPublicEvidenceIndexResult = z.infer<
  typeof aflTradeProjectionPublicEvidenceIndexResultSchema
>;

export const aflTradeProjectionPublicEvidenceIndexVerifyInputSchema = z
  .object({
    publicationManifest: publicationManifestSchema,
    publicationManifestArtifactRef: canonicalJsonArtifactRefSchema,
    valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexSchema,
    valuationOutputInventoryIndexArtifactRef: canonicalJsonArtifactRefSchema,
    valuationOutputInventories: inventoryInputsSchema,
    projectionPublicEvidences: evidenceInputsSchema,
    output: aflTradeProjectionPublicEvidenceIndexResultSchema,
  })
  .strict();

export type AflTradeProjectionPublicEvidenceIndexVerifyInput = z.infer<
  typeof aflTradeProjectionPublicEvidenceIndexVerifyInputSchema
>;

export const AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_CONSTRUCTION_ERROR_CODES = Object.freeze([
  'INVALID_INPUT_ENVELOPE',
  'INVALID_MATERIALIZED_AT',
  'INVALID_PUBLICATION_MANIFEST',
  'INVALID_PUBLICATION_ARTIFACT_REFERENCE',
  'INVALID_INVENTORY_INDEX',
  'INVALID_INVENTORY_INDEX_ARTIFACT_REFERENCE',
  'INVALID_INVENTORY_BINDINGS',
  'INVALID_EVIDENCE_BINDINGS',
  'PUBLICATION_INDEX_BINDING_MISMATCH',
  'INVENTORY_MEMBERSHIP_MISMATCH',
  'EVIDENCE_MEMBERSHIP_MISMATCH',
  'ARTIFACT_REFERENCE_MISMATCH',
  'IDENTITY_MISMATCH',
  'PUBLIC_ASSET_BOUNDARY_MISMATCH',
  'SCOPE_MISMATCH',
  'VALUE_UNIT_MISMATCH',
  'DUPLICATE_IDENTITY',
  'NON_MONOTONIC_ARTIFACT_TIME',
  'EVIDENCE_ARTIFACT_SIZE_LIMIT_EXCEEDED',
  'TOTAL_EVIDENCE_SIZE_LIMIT_EXCEEDED',
  'CANONICAL_ENTRIES_SIZE_LIMIT_EXCEEDED',
  'INDEX_ARTIFACT_SIZE_LIMIT_EXCEEDED',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const);

export type AflTradeProjectionPublicEvidenceIndexConstructionErrorCode =
  (typeof AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_CONSTRUCTION_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<
  Record<AflTradeProjectionPublicEvidenceIndexConstructionErrorCode, string>
> = Object.freeze({
  INVALID_INPUT_ENVELOPE: 'The projection-public-evidence-index input envelope is invalid.',
  INVALID_MATERIALIZED_AT: 'The evidence-index materialization time is invalid.',
  INVALID_PUBLICATION_MANIFEST: 'The evidence-index publication manifest is invalid.',
  INVALID_PUBLICATION_ARTIFACT_REFERENCE:
    'The publication artifact reference does not authenticate the complete publication manifest.',
  INVALID_INVENTORY_INDEX: 'The parent valuation-output-inventory index is invalid.',
  INVALID_INVENTORY_INDEX_ARTIFACT_REFERENCE:
    'The inventory-index artifact reference does not authenticate the complete index.',
  INVALID_INVENTORY_BINDINGS: 'The detached inventory-root bindings are invalid.',
  INVALID_EVIDENCE_BINDINGS: 'The detached public-evidence bindings are invalid.',
  PUBLICATION_INDEX_BINDING_MISMATCH:
    'The publication must bind the exact supplied valuation-output-inventory index.',
  INVENTORY_MEMBERSHIP_MISMATCH:
    'Inventory roots must form an exact bijection with the parent inventory-index entries.',
  EVIDENCE_MEMBERSHIP_MISMATCH:
    'Public evidence must form an exact bijection with the parent inventory-index entries.',
  ARTIFACT_REFERENCE_MISMATCH:
    'A detached artifact reference does not authenticate its complete semantic artifact.',
  IDENTITY_MISMATCH: 'A public-evidence identity does not match its authenticated parents.',
  PUBLIC_ASSET_BOUNDARY_MISMATCH:
    'The evidence index cannot cross the public source-native AFL asset boundary.',
  SCOPE_MISMATCH: 'Evidence-index scope identities must match.',
  VALUE_UNIT_MISMATCH: 'Evidence-index value-unit identities must match.',
  DUPLICATE_IDENTITY: 'Evidence-index semantic and byte identities must be unique.',
  NON_MONOTONIC_ARTIFACT_TIME:
    'Publication, inventory, evidence, and index artifact times must be monotonic.',
  EVIDENCE_ARTIFACT_SIZE_LIMIT_EXCEEDED: 'An indexed public-evidence artifact exceeds one MiB.',
  TOTAL_EVIDENCE_SIZE_LIMIT_EXCEEDED:
    'The aggregate indexed public-evidence byte length exceeds its safe bound.',
  CANONICAL_ENTRIES_SIZE_LIMIT_EXCEEDED: 'Canonical evidence-index entries exceed 16 MiB.',
  INDEX_ARTIFACT_SIZE_LIMIT_EXCEEDED: 'The canonical evidence index exceeds 20 MiB.',
  INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
    'The projection public-evidence index failed its internal artifact contract.',
});

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeProjectionPublicEvidenceIndexConstructionError extends Error {
  readonly code: AflTradeProjectionPublicEvidenceIndexConstructionErrorCode;

  constructor(code: AflTradeProjectionPublicEvidenceIndexConstructionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionPublicEvidenceIndexConstructionError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeProjectionPublicEvidenceIndexConstructionError';
    code: AflTradeProjectionPublicEvidenceIndexConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeProjectionPublicEvidenceIndexConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeProjectionPublicEvidenceIndexConstructionError(
  value: unknown
): value is AflTradeProjectionPublicEvidenceIndexConstructionError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function constructionError(
  code: AflTradeProjectionPublicEvidenceIndexConstructionErrorCode
): AflTradeProjectionPublicEvidenceIndexConstructionError {
  return new AflTradeProjectionPublicEvidenceIndexConstructionError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeProjectionPublicEvidenceIndexConstructionErrorCode
): T {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // Hostile values are replaced with stable construction errors.
  }
  throw constructionError(code);
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function requireUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw constructionError('DUPLICATE_IDENTITY');
}

const CREATE_INPUT_KEYS = [
  'publicationManifest',
  'publicationManifestArtifactRef',
  'valuationOutputInventoryIndex',
  'valuationOutputInventoryIndexArtifactRef',
  'valuationOutputInventories',
  'projectionPublicEvidences',
  'materializedAt',
] as const;
const VERIFY_INPUT_KEYS = [
  'publicationManifest',
  'publicationManifestArtifactRef',
  'valuationOutputInventoryIndex',
  'valuationOutputInventoryIndexArtifactRef',
  'valuationOutputInventories',
  'projectionPublicEvidences',
  'output',
] as const;

function snapshotExactEnvelope<const Key extends string>(
  value: unknown,
  keys: readonly Key[]
): Record<Key, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const expected = new Set<string>(keys);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !expected.has(key))
    ) {
      return null;
    }
    const snapshot = {} as Record<Key, unknown>;
    for (const key of keys) snapshot[key] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

function expectedInventoryIndexBinding(
  index: AflTradeValuationOutputInventoryIndex,
  artifactRef: AflTradeArtifactRef
) {
  return {
    schemaVersion: index.content.schemaVersion,
    valuationOutputInventoryIndexId: index.valuationOutputInventoryIndexId,
    artifactRef,
    entryCount: index.content.entryCount,
    inventorySetSha256: index.content.inventorySetSha256,
  };
}

function assertParentBindings(
  publication: PublicationManifest,
  publicationRef: AflTradeArtifactRef,
  inventoryIndex: AflTradeValuationOutputInventoryIndex,
  inventoryIndexRef: AflTradeArtifactRef,
  materializedAt: string
): void {
  if (!doesAflTradeArtifactRefMatchCanonicalJson(publicationRef, publication)) {
    throw constructionError('INVALID_PUBLICATION_ARTIFACT_REFERENCE');
  }
  if (!doesAflTradeArtifactRefMatchCanonicalJson(inventoryIndexRef, inventoryIndex)) {
    throw constructionError('INVALID_INVENTORY_INDEX_ARTIFACT_REFERENCE');
  }
  const expectedIndexBinding = expectedInventoryIndexBinding(inventoryIndex, inventoryIndexRef);
  if (!sameCanonicalJson(publication.content.valuationOutputInventoryIndex, expectedIndexBinding)) {
    throw constructionError('PUBLICATION_INDEX_BINDING_MISMATCH');
  }
  if (
    publication.content.valuationBundleId !==
    inventoryIndex.content.valuationBundle.valuationBundleId
  ) {
    throw constructionError('IDENTITY_MISMATCH');
  }
  if (
    publication.content.publicAssetBoundary !==
      AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY ||
    inventoryIndex.content.publicAssetBoundary !==
      AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY
  ) {
    throw constructionError('PUBLIC_ASSET_BOUNDARY_MISMATCH');
  }
  if (publication.content.scopeKey !== inventoryIndex.content.scopeKey) {
    throw constructionError('SCOPE_MISMATCH');
  }
  if (publication.content.valueUnitId !== inventoryIndex.content.valueUnitId) {
    throw constructionError('VALUE_UNIT_MISMATCH');
  }
  if (
    publication.content.entryCount !== inventoryIndex.content.entryCount ||
    publication.content.entryCount !== publication.content.valuationOutputInventoryIndex.entryCount
  ) {
    throw constructionError('PUBLICATION_INDEX_BINDING_MISMATCH');
  }
  const publicationSemanticTime = Date.parse(publication.content.createdAt);
  const publicationArtifactTime = Date.parse(publicationRef.createdAt);
  const inventoryIndexTime = Date.parse(inventoryIndexRef.createdAt);
  const indexMaterializedAt = Date.parse(materializedAt);
  if (
    publicationSemanticTime > publicationArtifactTime ||
    inventoryIndexTime > publicationSemanticTime ||
    publicationArtifactTime > indexMaterializedAt ||
    inventoryIndexTime > indexMaterializedAt
  ) {
    throw constructionError('NON_MONOTONIC_ARTIFACT_TIME');
  }
}

interface InventoryBinding {
  valuationOutputInventory: AflTradeValuationOutputInventory;
  artifactRef: AflTradeArtifactRef;
}

function assertInventoryBindings(
  publication: PublicationManifest,
  inventoryIndex: AflTradeValuationOutputInventoryIndex,
  inventoryBindings: readonly InventoryBinding[]
): Map<string, InventoryBinding> {
  if (inventoryBindings.length !== inventoryIndex.content.entries.length) {
    throw constructionError('INVENTORY_MEMBERSHIP_MISMATCH');
  }
  requireUnique(
    inventoryBindings.map((binding) => binding.valuationOutputInventory.content.tradeId)
  );
  requireUnique(
    inventoryBindings.map((binding) => binding.valuationOutputInventory.valuationOutputInventoryId)
  );
  requireUnique(inventoryBindings.map((binding) => binding.artifactRef.artifactId));

  const byTradeId = new Map(
    inventoryBindings.map((binding) => [binding.valuationOutputInventory.content.tradeId, binding])
  );
  for (const parentEntry of inventoryIndex.content.entries) {
    const binding = byTradeId.get(parentEntry.tradeId);
    if (binding === undefined) throw constructionError('INVENTORY_MEMBERSHIP_MISMATCH');
    const inventory = binding.valuationOutputInventory;
    if (!doesAflTradeArtifactRefMatchCanonicalJson(binding.artifactRef, inventory)) {
      throw constructionError('ARTIFACT_REFERENCE_MISMATCH');
    }
    if (
      binding.artifactRef.byteLength < 1 ||
      binding.artifactRef.byteLength > AFL_TRADE_VALUATION_OUTPUT_INVENTORY_MAX_ROOT_BYTES ||
      binding.artifactRef.createdAt !== inventory.content.materializedAt
    ) {
      throw constructionError('ARTIFACT_REFERENCE_MISMATCH');
    }
    if (
      inventory.valuationOutputInventoryId !== parentEntry.valuationOutputInventoryId ||
      inventory.content.valuationCase.valuationCaseId !== parentEntry.valuationCaseId ||
      !sameCanonicalJson(binding.artifactRef, parentEntry.inventoryArtifactRef)
    ) {
      throw constructionError('INVENTORY_MEMBERSHIP_MISMATCH');
    }
    if (
      inventory.content.valuationBundle.valuationBundleId !==
        inventoryIndex.content.valuationBundle.valuationBundleId ||
      inventory.content.valuationBundle.valuationBundleId !==
        publication.content.valuationBundleId ||
      !sameCanonicalJson(
        inventory.content.valuationBundle.artifactRef,
        inventoryIndex.content.valuationBundle.artifactRef
      )
    ) {
      throw constructionError('IDENTITY_MISMATCH');
    }
    if (
      inventory.content.publicAssetBoundary !==
      AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY
    ) {
      throw constructionError('PUBLIC_ASSET_BOUNDARY_MISMATCH');
    }
    if (inventory.content.valueUnitId !== inventoryIndex.content.valueUnitId) {
      throw constructionError('VALUE_UNIT_MISMATCH');
    }
  }
  return byTradeId;
}

function assertEvidenceBinding(
  evidence: AflTradeProjectionPublicEvidence,
  evidenceRef: AflTradeArtifactRef,
  publication: PublicationManifest,
  publicationRef: AflTradeArtifactRef,
  inventoryIndex: AflTradeValuationOutputInventoryIndex,
  inventoryIndexRef: AflTradeArtifactRef,
  inventory: AflTradeValuationOutputInventory,
  inventoryRef: AflTradeArtifactRef,
  materializedAt: string
): void {
  if (!doesAflTradeArtifactRefMatchCanonicalJson(evidenceRef, evidence)) {
    throw constructionError('ARTIFACT_REFERENCE_MISMATCH');
  }
  if (
    evidenceRef.byteLength < 1 ||
    evidenceRef.byteLength > AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_MAX_ARTIFACT_BYTES
  ) {
    throw constructionError('EVIDENCE_ARTIFACT_SIZE_LIMIT_EXCEEDED');
  }
  if (evidenceRef.createdAt !== evidence.content.materializedAt) {
    throw constructionError('ARTIFACT_REFERENCE_MISMATCH');
  }
  if (
    evidence.content.publicationId !== publication.publicationId ||
    evidence.content.valuationBundleId !== publication.content.valuationBundleId ||
    evidence.content.valuationOutputInventoryIndexId !==
      inventoryIndex.valuationOutputInventoryIndexId ||
    evidence.content.valuationOutputInventoryId !== inventory.valuationOutputInventoryId ||
    evidence.content.valuationCaseId !== inventory.content.valuationCase.valuationCaseId ||
    evidence.content.valuationCalculationId !==
      inventory.content.valuationCalculation.valuationCalculationId ||
    evidence.content.tradeId !== inventory.content.tradeId
  ) {
    throw constructionError('IDENTITY_MISMATCH');
  }
  if (
    evidence.content.publicAssetBoundary !==
    AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY
  ) {
    throw constructionError('PUBLIC_ASSET_BOUNDARY_MISMATCH');
  }
  if (
    evidence.content.scopeKey !== publication.content.scopeKey ||
    evidence.content.scopeKey !== inventoryIndex.content.scopeKey
  ) {
    throw constructionError('SCOPE_MISMATCH');
  }
  if (
    evidence.content.valueUnitId !== publication.content.valueUnitId ||
    evidence.content.valueUnitId !== inventoryIndex.content.valueUnitId ||
    evidence.content.valueUnitId !== inventory.content.valueUnitId
  ) {
    throw constructionError('VALUE_UNIT_MISMATCH');
  }
  const evidenceTime = Date.parse(evidenceRef.createdAt);
  if (
    Date.parse(publication.content.createdAt) > evidenceTime ||
    Date.parse(publicationRef.createdAt) > evidenceTime ||
    Date.parse(inventoryIndexRef.createdAt) > evidenceTime ||
    Date.parse(inventoryRef.createdAt) > evidenceTime ||
    evidenceTime > Date.parse(materializedAt)
  ) {
    throw constructionError('NON_MONOTONIC_ARTIFACT_TIME');
  }
}

function createEntries(
  publication: PublicationManifest,
  publicationRef: AflTradeArtifactRef,
  inventoryIndex: AflTradeValuationOutputInventoryIndex,
  inventoryIndexRef: AflTradeArtifactRef,
  inventoriesByTradeId: ReadonlyMap<string, InventoryBinding>,
  evidenceBindings: readonly AflTradeProjectionPublicEvidenceIndexEvidenceInput[],
  materializedAt: string
): AflTradeProjectionPublicEvidenceIndexEntry[] {
  if (evidenceBindings.length !== inventoryIndex.content.entries.length) {
    throw constructionError('EVIDENCE_MEMBERSHIP_MISMATCH');
  }
  requireUnique(
    evidenceBindings.map((binding) => binding.projectionPublicEvidence.content.tradeId)
  );
  requireUnique(
    evidenceBindings.map((binding) => binding.projectionPublicEvidence.projectionPublicEvidenceId)
  );
  requireUnique(
    evidenceBindings.map((binding) => binding.projectionPublicEvidenceArtifactRef.artifactId)
  );
  const evidenceByTradeId = new Map(
    evidenceBindings.map((binding) => [binding.projectionPublicEvidence.content.tradeId, binding])
  );

  const entries = inventoryIndex.content.entries.map((parentEntry) => {
    const inventoryBinding = inventoriesByTradeId.get(parentEntry.tradeId);
    const evidenceBinding = evidenceByTradeId.get(parentEntry.tradeId);
    if (inventoryBinding === undefined || evidenceBinding === undefined) {
      throw constructionError('EVIDENCE_MEMBERSHIP_MISMATCH');
    }
    const inventory = inventoryBinding.valuationOutputInventory;
    const evidence = evidenceBinding.projectionPublicEvidence;
    assertEvidenceBinding(
      evidence,
      evidenceBinding.projectionPublicEvidenceArtifactRef,
      publication,
      publicationRef,
      inventoryIndex,
      inventoryIndexRef,
      inventory,
      inventoryBinding.artifactRef,
      materializedAt
    );
    return {
      tradeId: parentEntry.tradeId,
      valuationCaseId: parentEntry.valuationCaseId,
      valuationCalculationId: inventory.content.valuationCalculation.valuationCalculationId,
      valuationOutputInventoryId: parentEntry.valuationOutputInventoryId,
      inventoryArtifactRef: parentEntry.inventoryArtifactRef,
      projectionPublicEvidenceId: evidence.projectionPublicEvidenceId,
      evidenceArtifactRef: evidenceBinding.projectionPublicEvidenceArtifactRef,
    };
  });
  if (!entriesUseCanonicalOrder(entries)) {
    throw constructionError('INVENTORY_MEMBERSHIP_MISMATCH');
  }
  requireUnique(entries.map((entry) => entry.valuationCaseId));
  requireUnique(entries.map((entry) => entry.valuationCalculationId));
  return entries;
}

export function createAflTradeProjectionPublicEvidenceIndex(
  unparsedInput: unknown
): AflTradeProjectionPublicEvidenceIndexResult {
  try {
    const snapshot = snapshotExactEnvelope(unparsedInput, CREATE_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');
    const materializedAt = parseOrThrow(
      aflTradeIsoDateTimeSchema,
      snapshot.materializedAt,
      'INVALID_MATERIALIZED_AT'
    );
    const publication = parseOrThrow(
      publicationManifestSchema,
      snapshot.publicationManifest,
      'INVALID_PUBLICATION_MANIFEST'
    );
    const publicationRef = parseOrThrow(
      canonicalJsonArtifactRefSchema,
      snapshot.publicationManifestArtifactRef,
      'INVALID_PUBLICATION_ARTIFACT_REFERENCE'
    );
    const parsedInventoryIndex = parseOrThrow(
      aflTradeValuationOutputInventoryIndexSchema,
      snapshot.valuationOutputInventoryIndex,
      'INVALID_INVENTORY_INDEX'
    );
    const parsedInventoryIndexRef = parseOrThrow(
      canonicalJsonArtifactRefSchema,
      snapshot.valuationOutputInventoryIndexArtifactRef,
      'INVALID_INVENTORY_INDEX_ARTIFACT_REFERENCE'
    );
    const parentInventoryIndexResult = parseOrThrow(
      aflTradeValuationOutputInventoryIndexResultSchema,
      {
        valuationOutputInventoryIndex: parsedInventoryIndex,
        valuationOutputInventoryIndexArtifactRef: parsedInventoryIndexRef,
      },
      'INVALID_INVENTORY_INDEX_ARTIFACT_REFERENCE'
    );
    const inventoryIndex = parentInventoryIndexResult.valuationOutputInventoryIndex;
    const inventoryIndexRef = parentInventoryIndexResult.valuationOutputInventoryIndexArtifactRef;
    const inventoryBindings = parseOrThrow(
      inventoryInputsSchema,
      snapshot.valuationOutputInventories,
      'INVALID_INVENTORY_BINDINGS'
    );
    const evidenceBindings = parseOrThrow(
      evidenceInputsSchema,
      snapshot.projectionPublicEvidences,
      'INVALID_EVIDENCE_BINDINGS'
    );

    assertParentBindings(
      publication,
      publicationRef,
      inventoryIndex,
      inventoryIndexRef,
      materializedAt
    );
    const inventoriesByTradeId = assertInventoryBindings(
      publication,
      inventoryIndex,
      inventoryBindings
    );
    const entries = createEntries(
      publication,
      publicationRef,
      inventoryIndex,
      inventoryIndexRef,
      inventoriesByTradeId,
      evidenceBindings,
      materializedAt
    );
    const canonicalEntriesByteLength = canonicalByteLength(entries);
    if (
      canonicalEntriesByteLength >
      AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_CANONICAL_ENTRIES_BYTES
    ) {
      throw constructionError('CANONICAL_ENTRIES_SIZE_LIMIT_EXCEEDED');
    }
    const totalEvidenceArtifactByteLength = entries.reduce(
      (sum, entry) => sum + entry.evidenceArtifactRef.byteLength,
      0
    );
    if (
      !Number.isSafeInteger(totalEvidenceArtifactByteLength) ||
      totalEvidenceArtifactByteLength >
        AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_TOTAL_EVIDENCE_BYTES
    ) {
      throw constructionError('TOTAL_EVIDENCE_SIZE_LIMIT_EXCEEDED');
    }

    const content = {
      schemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
      publication: {
        schemaVersion: publication.content.schemaVersion,
        publicationId: publication.publicationId,
        artifactRef: publicationRef,
      },
      valuationOutputInventoryIndex: expectedInventoryIndexBinding(
        inventoryIndex,
        inventoryIndexRef
      ),
      scopeKey: publication.content.scopeKey,
      valueUnitId: publication.content.valueUnitId,
      indexedEvidenceSchemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
      ordering: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_ORDERING,
      digestDefinition: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_DIGEST_DEFINITION,
      entryCount: entries.length,
      totalEvidenceArtifactByteLength,
      canonicalEntriesByteLength,
      evidenceBindingSetSha256: sha256AflTradeCanonicalJson(entries),
      entries,
      verificationScope: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_VERIFICATION_SCOPE,
      predecessorPolicy: {
        definitionVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_POLICY_DEFINITION,
        indexedEvidenceSchemaVersion: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
        predecessorSchemaVersion: null,
        compatibility: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PREDECESSOR_COMPATIBILITY,
        latestAlias: 'prohibited' as const,
        runtimeFallback: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_RUNTIME_FALLBACK,
        bindingAuthority: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_PROJECTION_BINDING,
      },
      materializedAt,
      limitation: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_LIMITATION,
    };
    const parsedIndex = aflTradeProjectionPublicEvidenceIndexSchema.safeParse({
      projectionPublicEvidenceIndexId: createAflTradeContentAddress(
        'projection-public-evidence-index',
        content
      ),
      content,
    });
    if (!parsedIndex.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const projectionPublicEvidenceIndexArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      parsedIndex.data,
      materializedAt
    );
    if (
      projectionPublicEvidenceIndexArtifactRef.byteLength < 1 ||
      projectionPublicEvidenceIndexArtifactRef.byteLength >
        AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_INDEX_MAX_ARTIFACT_BYTES
    ) {
      throw constructionError('INDEX_ARTIFACT_SIZE_LIMIT_EXCEEDED');
    }
    const result = aflTradeProjectionPublicEvidenceIndexResultSchema.safeParse({
      projectionPublicEvidenceIndex: parsedIndex.data,
      projectionPublicEvidenceIndexArtifactRef,
    });
    if (!result.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeProjectionPublicEvidenceIndexConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

export function verifyAflTradeProjectionPublicEvidenceIndex(input: unknown): boolean {
  try {
    const snapshot = snapshotExactEnvelope(input, VERIFY_INPUT_KEYS);
    if (snapshot === null) return false;
    const output = aflTradeProjectionPublicEvidenceIndexResultSchema.safeParse(snapshot.output);
    if (!output.success) return false;
    const replayed = createAflTradeProjectionPublicEvidenceIndex({
      publicationManifest: snapshot.publicationManifest,
      publicationManifestArtifactRef: snapshot.publicationManifestArtifactRef,
      valuationOutputInventoryIndex: snapshot.valuationOutputInventoryIndex,
      valuationOutputInventoryIndexArtifactRef: snapshot.valuationOutputInventoryIndexArtifactRef,
      valuationOutputInventories: snapshot.valuationOutputInventories,
      projectionPublicEvidences: snapshot.projectionPublicEvidences,
      materializedAt: output.data.projectionPublicEvidenceIndexArtifactRef.createdAt,
    });
    return canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(output.data);
  } catch {
    return false;
  }
}
