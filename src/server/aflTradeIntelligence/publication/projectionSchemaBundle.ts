import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS, aflTradeIsoDateTimeSchema } from '@/types/aflTradeIntelligence';

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

export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_SCHEMA_VERSION =
  'afl-trade-projection-schema-bundle/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_SCHEMA_VERSION =
  'afl-trade-projection-schema-bundle/v2' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RESPONSE_CONTRACT_VERSION =
  'afl-trade-value/v2' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_EXPORT_CONTRACT_VERSION =
  'afl-trade-valuation-csv/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SCHEMA_VERSION =
  'afl-trade-projection-document/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SET_SHARD_SCHEMA_VERSION =
  'afl-trade-projection-document-set-shard/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SET_SCHEMA_VERSION =
  'afl-trade-projection-document-set/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PROJECTION_MANIFEST_SCHEMA_VERSION =
  'afl-trade-projection/v2' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLICATION_MANIFEST_SCHEMA_VERSION =
  'afl-trade-publication/v3' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PROJECTION_MANIFEST_SCHEMA_VERSION =
  'afl-trade-projection/v3' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PUBLICATION_MANIFEST_SCHEMA_VERSION =
  'afl-trade-publication/v4' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PRESENTATION_POLICY_SCHEMA_VERSION =
  'afl-trade-projection-presentation-policy/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLIC_EVIDENCE_SCHEMA_VERSION =
  'afl-trade-projection-public-evidence/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION =
  'afl-trade-projection-public-evidence-index/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_EVIDENCE_SOURCE_VERIFICATION_SCHEMA_VERSION =
  'afl-trade-projection-evidence-source-verification/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_TRADE_MATERIALIZATION_SCHEMA_VERSION =
  'afl-trade-projection-trade-materialization/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MATERIALIZATION_SHARD_SCHEMA_VERSION =
  'afl-trade-projection-materialization-shard/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MATERIALIZATION_SCHEMA_VERSION =
  'afl-trade-projection-materialization/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PARITY_REPORT_SCHEMA_VERSION =
  'afl-trade-projection-parity-report/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_INVENTORY_INDEX_SCHEMA_VERSION =
  'afl-trade-valuation-output-inventory-index/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_FRESHNESS_POLICY_SCHEMA_VERSION =
  'afl-trade-publication-freshness-policy/v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY =
  'exact_version_required_no_implicit_conversion_v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_ORDERING =
  'public_responses_then_export_then_dependency_ordered_projection_artifacts_v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_DIGEST_DEFINITION =
  'canonical_ordered_declarative_descriptors_sha256_v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PREDECESSOR_COMPATIBILITY =
  'no_predecessor_no_implicit_conversion_v1' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RUNTIME_FALLBACK = 'prohibited' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_LIMITATION =
  'Immutable dependency-ordered declarative contract-version registry only; it neither resolves artifacts nor executes schemas, and does not authenticate derivations, validate materialization or stored bytes, prove parity, source rights, or model validity, approve or activate publication, authorize serving or fantasy state, or establish user or fantasy ownership.' as const;
export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MAX_BYTES = 64 * 1024;

export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_ROLES = Object.freeze([
  'public_trade_value_list_response',
  'public_trade_value_detail_response',
  'public_trade_methodology_response',
  'valuation_export',
  'valuation_output_inventory_index',
  'publication_freshness_policy',
  'projection_presentation_policy',
  'publication_manifest',
  'projection_public_evidence',
  'projection_public_evidence_index',
  'projection_evidence_source_verification',
  'projection_document',
  'projection_trade_materialization',
  'projection_materialization_shard',
  'projection_materialization',
  'projection_document_set_shard',
  'projection_document_set',
  'projection_parity_report',
  'projection_manifest',
] as const);

export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTORS = Object.freeze([
  Object.freeze({
    role: 'public_trade_value_list_response' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RESPONSE_CONTRACT_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'public_trade_value_detail_response' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RESPONSE_CONTRACT_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'public_trade_methodology_response' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RESPONSE_CONTRACT_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'valuation_export' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_EXPORT_CONTRACT_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'valuation_output_inventory_index' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_INVENTORY_INDEX_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'publication_freshness_policy' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_FRESHNESS_POLICY_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_presentation_policy' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PRESENTATION_POLICY_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'publication_manifest' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLICATION_MANIFEST_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_public_evidence' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLIC_EVIDENCE_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_public_evidence_index' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_evidence_source_verification' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_EVIDENCE_SOURCE_VERIFICATION_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_document' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_trade_materialization' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_TRADE_MATERIALIZATION_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_materialization_shard' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MATERIALIZATION_SHARD_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_materialization' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MATERIALIZATION_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_document_set_shard' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SET_SHARD_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_document_set' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SET_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_parity_report' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PARITY_REPORT_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
  Object.freeze({
    role: 'projection_manifest' as const,
    version: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PROJECTION_MANIFEST_SCHEMA_VERSION,
    compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  }),
] as const);

export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_DESCRIPTORS = Object.freeze(
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTORS.map((descriptor) =>
    Object.freeze({
      ...descriptor,
      version:
        descriptor.role === 'publication_manifest'
          ? AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PUBLICATION_MANIFEST_SCHEMA_VERSION
          : descriptor.role === 'projection_manifest'
            ? AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PROJECTION_MANIFEST_SCHEMA_VERSION
            : descriptor.version,
    })
  )
);

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Projection schema bundles require canonical JSON artifact references.'
);

export const aflTradeProjectionSchemaBundleDescriptorSchema = z
  .object({
    role: z.enum(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_ROLES),
    version: z.string().trim().min(1).max(160),
    compatibility: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY),
  })
  .strict();

function descriptorsMatchGovernedDefinition(
  descriptors: readonly z.infer<typeof aflTradeProjectionSchemaBundleDescriptorSchema>[],
  governedDescriptors: readonly z.infer<
    typeof aflTradeProjectionSchemaBundleDescriptorSchema
  >[] = AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTORS
): boolean {
  return canonicalizeAflTradeJson(descriptors) === canonicalizeAflTradeJson(governedDescriptors);
}

export const aflTradeProjectionSchemaBundleContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLIC_ASSET_BOUNDARY),
    responseContractVersion: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RESPONSE_CONTRACT_VERSION
    ),
    valuationExportContractVersion: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_EXPORT_CONTRACT_VERSION
    ),
    projectionDocumentSchemaVersion: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SCHEMA_VERSION
    ),
    projectionDocumentSetSchemaVersion: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SET_SCHEMA_VERSION
    ),
    projectionManifestSchemaVersion: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PROJECTION_MANIFEST_SCHEMA_VERSION
    ),
    supportedViews: z.tuple([
      z.literal('at_trade'),
      z.literal('realized'),
      z.literal('remaining'),
      z.literal('current'),
    ]),
    descriptorOrdering: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_ORDERING),
    descriptorDigestDefinition: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_DIGEST_DEFINITION
    ),
    descriptorCount: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTORS.length),
    descriptorSetSha256: aflTradeSha256Schema,
    descriptors: z
      .array(aflTradeProjectionSchemaBundleDescriptorSchema)
      .length(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTORS.length),
    predecessorPolicy: z
      .object({
        predecessorSchemaVersion: z.null(),
        compatibility: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PREDECESSOR_COMPATIBILITY),
        runtimeFallback: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RUNTIME_FALLBACK),
      })
      .strict(),
    createdAt: aflTradeIsoDateTimeSchema,
    limitation: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.supportedViews.some((view, index) => view !== AFL_TRADE_VALUATION_VIEWS[index])) {
      context.addIssue({
        code: 'custom',
        path: ['supportedViews'],
        message: 'Projection schema-bundle views must use the complete canonical order.',
      });
    }
    if (!descriptorsMatchGovernedDefinition(content.descriptors)) {
      context.addIssue({
        code: 'custom',
        path: ['descriptors'],
        message: 'Projection schema-bundle descriptors must match the governed declaration.',
      });
    }
    if (content.descriptorSetSha256 !== sha256AflTradeCanonicalJson(content.descriptors)) {
      context.addIssue({
        code: 'custom',
        path: ['descriptorSetSha256'],
        message: 'Descriptor digest must authenticate the ordered declarative descriptors.',
      });
    }
  });

export const aflTradeProjectionSchemaBundleV2ContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLIC_ASSET_BOUNDARY),
    responseContractVersion: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RESPONSE_CONTRACT_VERSION
    ),
    valuationExportContractVersion: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_EXPORT_CONTRACT_VERSION
    ),
    projectionDocumentSchemaVersion: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SCHEMA_VERSION
    ),
    projectionDocumentSetSchemaVersion: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SET_SCHEMA_VERSION
    ),
    publicationManifestSchemaVersion: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PUBLICATION_MANIFEST_SCHEMA_VERSION
    ),
    projectionManifestSchemaVersion: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PROJECTION_MANIFEST_SCHEMA_VERSION
    ),
    supportedViews: z.tuple([
      z.literal('at_trade'),
      z.literal('realized'),
      z.literal('remaining'),
      z.literal('current'),
    ]),
    descriptorOrdering: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_ORDERING),
    descriptorDigestDefinition: z.literal(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_DIGEST_DEFINITION
    ),
    descriptorCount: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_DESCRIPTORS.length),
    descriptorSetSha256: aflTradeSha256Schema,
    descriptors: z
      .array(aflTradeProjectionSchemaBundleDescriptorSchema)
      .length(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_DESCRIPTORS.length),
    predecessorPolicy: z
      .object({
        predecessorSchemaVersion: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_SCHEMA_VERSION),
        compatibility: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PREDECESSOR_COMPATIBILITY),
        runtimeFallback: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RUNTIME_FALLBACK),
      })
      .strict(),
    createdAt: aflTradeIsoDateTimeSchema,
    limitation: z.literal(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.supportedViews.some((view, index) => view !== AFL_TRADE_VALUATION_VIEWS[index])) {
      context.addIssue({
        code: 'custom',
        path: ['supportedViews'],
        message: 'Projection schema-bundle views must use the complete canonical order.',
      });
    }
    if (
      !descriptorsMatchGovernedDefinition(
        content.descriptors,
        AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_DESCRIPTORS
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['descriptors'],
        message: 'Projection schema-bundle descriptors must match the governed declaration.',
      });
    }
    if (content.descriptorSetSha256 !== sha256AflTradeCanonicalJson(content.descriptors)) {
      context.addIssue({
        code: 'custom',
        path: ['descriptorSetSha256'],
        message: 'Descriptor digest must authenticate the ordered declarative descriptors.',
      });
    }
  });

export const aflTradeProjectionSchemaBundleSchema = z
  .object({
    projectionSchemaBundleId: aflTradeContentAddressedIdSchema('projection-schema-bundle'),
    content: aflTradeProjectionSchemaBundleContentSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    addAflTradeContentAddressIssue(
      'projection-schema-bundle',
      bundle.projectionSchemaBundleId,
      bundle.content,
      context,
      ['projectionSchemaBundleId']
    );
  });

export const aflTradeProjectionSchemaBundleV2Schema = z
  .object({
    projectionSchemaBundleId: aflTradeContentAddressedIdSchema('projection-schema-bundle'),
    content: aflTradeProjectionSchemaBundleV2ContentSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    addAflTradeContentAddressIssue(
      'projection-schema-bundle',
      bundle.projectionSchemaBundleId,
      bundle.content,
      context,
      ['projectionSchemaBundleId']
    );
  });

export type AflTradeProjectionSchemaBundleDescriptor = z.infer<
  typeof aflTradeProjectionSchemaBundleDescriptorSchema
>;
export type AflTradeProjectionSchemaBundleContent = z.infer<
  typeof aflTradeProjectionSchemaBundleContentSchema
>;
export type AflTradeProjectionSchemaBundle = z.infer<typeof aflTradeProjectionSchemaBundleSchema>;
export type AflTradeProjectionSchemaBundleV2Content = z.infer<
  typeof aflTradeProjectionSchemaBundleV2ContentSchema
>;
export type AflTradeProjectionSchemaBundleV2 = z.infer<
  typeof aflTradeProjectionSchemaBundleV2Schema
>;

export const aflTradeProjectionSchemaBundleResultSchema = z
  .object({
    projectionSchemaBundle: aflTradeProjectionSchemaBundleSchema,
    projectionSchemaBundleArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const reference = result.projectionSchemaBundleArtifactRef;
    if (!doesAflTradeArtifactRefMatchCanonicalJson(reference, result.projectionSchemaBundle)) {
      context.addIssue({
        code: 'custom',
        path: ['projectionSchemaBundleArtifactRef'],
        message: 'Schema-bundle artifact reference must authenticate the complete artifact.',
      });
    }
    if (reference.createdAt !== result.projectionSchemaBundle.content.createdAt) {
      context.addIssue({
        code: 'custom',
        path: ['projectionSchemaBundleArtifactRef', 'createdAt'],
        message: 'Schema-bundle artifact time must match its declared creation time.',
      });
    }
    if (
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MAX_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionSchemaBundleArtifactRef', 'byteLength'],
        message: 'Projection schema-bundle canonical bytes exceed the 64 KiB limit.',
      });
    }
  });

export const aflTradeProjectionSchemaBundleV2ResultSchema = z
  .object({
    projectionSchemaBundle: aflTradeProjectionSchemaBundleV2Schema,
    projectionSchemaBundleArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const reference = result.projectionSchemaBundleArtifactRef;
    if (!doesAflTradeArtifactRefMatchCanonicalJson(reference, result.projectionSchemaBundle)) {
      context.addIssue({
        code: 'custom',
        path: ['projectionSchemaBundleArtifactRef'],
        message: 'Schema-bundle artifact reference must authenticate the complete artifact.',
      });
    }
    if (reference.createdAt !== result.projectionSchemaBundle.content.createdAt) {
      context.addIssue({
        code: 'custom',
        path: ['projectionSchemaBundleArtifactRef', 'createdAt'],
        message: 'Schema-bundle artifact time must match its declared creation time.',
      });
    }
    if (
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MAX_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionSchemaBundleArtifactRef', 'byteLength'],
        message: 'Projection schema-bundle canonical bytes exceed the 64 KiB limit.',
      });
    }
  });

export const aflTradeAnyProjectionSchemaBundleResultSchema = z.union([
  aflTradeProjectionSchemaBundleResultSchema,
  aflTradeProjectionSchemaBundleV2ResultSchema,
]);

export type AflTradeProjectionSchemaBundleResult = z.infer<
  typeof aflTradeProjectionSchemaBundleResultSchema
>;
export type AflTradeProjectionSchemaBundleV2Result = z.infer<
  typeof aflTradeProjectionSchemaBundleV2ResultSchema
>;
export type AflTradeAnyProjectionSchemaBundleResult = z.infer<
  typeof aflTradeAnyProjectionSchemaBundleResultSchema
>;

export const AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_CONSTRUCTION_ERROR_CODES = [
  'INVALID_INPUT_ENVELOPE',
  'INVALID_CREATED_AT',
  'ARTIFACT_SIZE_LIMIT_EXCEEDED',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const;

export type AflTradeProjectionSchemaBundleConstructionErrorCode =
  (typeof AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_CONSTRUCTION_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<
  Record<AflTradeProjectionSchemaBundleConstructionErrorCode, string>
> = Object.freeze({
  INVALID_INPUT_ENVELOPE: 'The projection schema-bundle input envelope is invalid.',
  INVALID_CREATED_AT: 'The projection schema-bundle creation time is invalid.',
  ARTIFACT_SIZE_LIMIT_EXCEEDED: 'The projection schema-bundle exceeds its canonical byte limit.',
  INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
    'The projection schema-bundle failed its internal artifact contract.',
});

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeProjectionSchemaBundleConstructionError extends Error {
  readonly code: AflTradeProjectionSchemaBundleConstructionErrorCode;

  constructor(code: AflTradeProjectionSchemaBundleConstructionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionSchemaBundleConstructionError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeProjectionSchemaBundleConstructionError';
    code: AflTradeProjectionSchemaBundleConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeProjectionSchemaBundleConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeProjectionSchemaBundleConstructionError(
  value: unknown
): value is AflTradeProjectionSchemaBundleConstructionError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function constructionError(
  code: AflTradeProjectionSchemaBundleConstructionErrorCode
): AflTradeProjectionSchemaBundleConstructionError {
  return new AflTradeProjectionSchemaBundleConstructionError(code);
}

const CREATE_INPUT_KEYS = ['createdAt'] as const;
const VERIFY_INPUT_KEYS = [...CREATE_INPUT_KEYS, 'output'] as const;

function snapshotExactInput<const Key extends string>(
  value: unknown,
  keys: readonly Key[]
): Record<Key, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const expectedKeys = new Set<string>(keys);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
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

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

export function createAflTradeProjectionSchemaBundle(
  unparsedInput: unknown
): AflTradeProjectionSchemaBundleResult {
  try {
    const snapshot = snapshotExactInput(unparsedInput, CREATE_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');
    const createdAt = aflTradeIsoDateTimeSchema.safeParse(snapshot.createdAt);
    if (!createdAt.success) throw constructionError('INVALID_CREATED_AT');

    const descriptors = structuredClone(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTORS);
    const content = {
      schemaVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLIC_ASSET_BOUNDARY,
      responseContractVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RESPONSE_CONTRACT_VERSION,
      valuationExportContractVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_EXPORT_CONTRACT_VERSION,
      projectionDocumentSchemaVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SCHEMA_VERSION,
      projectionDocumentSetSchemaVersion:
        AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SET_SCHEMA_VERSION,
      projectionManifestSchemaVersion:
        AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PROJECTION_MANIFEST_SCHEMA_VERSION,
      supportedViews: [...AFL_TRADE_VALUATION_VIEWS],
      descriptorOrdering: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_ORDERING,
      descriptorDigestDefinition: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_DIGEST_DEFINITION,
      descriptorCount: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTORS.length,
      descriptorSetSha256: sha256AflTradeCanonicalJson(descriptors),
      descriptors,
      predecessorPolicy: {
        predecessorSchemaVersion: null,
        compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PREDECESSOR_COMPATIBILITY,
        runtimeFallback: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RUNTIME_FALLBACK,
      },
      createdAt: createdAt.data,
      limitation: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_LIMITATION,
    };
    const projectionSchemaBundle = aflTradeProjectionSchemaBundleSchema.safeParse({
      projectionSchemaBundleId: createAflTradeContentAddress('projection-schema-bundle', content),
      content,
    });
    if (!projectionSchemaBundle.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const projectionSchemaBundleArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      projectionSchemaBundle.data,
      createdAt.data
    );
    if (
      projectionSchemaBundleArtifactRef.byteLength < 1 ||
      projectionSchemaBundleArtifactRef.byteLength > AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MAX_BYTES
    ) {
      throw constructionError('ARTIFACT_SIZE_LIMIT_EXCEEDED');
    }
    const result = aflTradeProjectionSchemaBundleResultSchema.safeParse({
      projectionSchemaBundle: projectionSchemaBundle.data,
      projectionSchemaBundleArtifactRef,
    });
    if (!result.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeProjectionSchemaBundleConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

export function createAflTradeProjectionSchemaBundleV2(
  unparsedInput: unknown
): AflTradeProjectionSchemaBundleV2Result {
  try {
    const snapshot = snapshotExactInput(unparsedInput, CREATE_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');
    const createdAt = aflTradeIsoDateTimeSchema.safeParse(snapshot.createdAt);
    if (!createdAt.success) throw constructionError('INVALID_CREATED_AT');

    const descriptors = structuredClone(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_DESCRIPTORS);
    const content = {
      schemaVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLIC_ASSET_BOUNDARY,
      responseContractVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RESPONSE_CONTRACT_VERSION,
      valuationExportContractVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_EXPORT_CONTRACT_VERSION,
      projectionDocumentSchemaVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SCHEMA_VERSION,
      projectionDocumentSetSchemaVersion:
        AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SET_SCHEMA_VERSION,
      publicationManifestSchemaVersion:
        AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PUBLICATION_MANIFEST_SCHEMA_VERSION,
      projectionManifestSchemaVersion:
        AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PROJECTION_MANIFEST_SCHEMA_VERSION,
      supportedViews: [...AFL_TRADE_VALUATION_VIEWS],
      descriptorOrdering: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_ORDERING,
      descriptorDigestDefinition: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_DIGEST_DEFINITION,
      descriptorCount: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_DESCRIPTORS.length,
      descriptorSetSha256: sha256AflTradeCanonicalJson(descriptors),
      descriptors,
      predecessorPolicy: {
        predecessorSchemaVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_SCHEMA_VERSION,
        compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PREDECESSOR_COMPATIBILITY,
        runtimeFallback: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RUNTIME_FALLBACK,
      },
      createdAt: createdAt.data,
      limitation: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_LIMITATION,
    };
    const projectionSchemaBundle = aflTradeProjectionSchemaBundleV2Schema.safeParse({
      projectionSchemaBundleId: createAflTradeContentAddress('projection-schema-bundle', content),
      content,
    });
    if (!projectionSchemaBundle.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const projectionSchemaBundleArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      projectionSchemaBundle.data,
      createdAt.data
    );
    if (
      projectionSchemaBundleArtifactRef.byteLength < 1 ||
      projectionSchemaBundleArtifactRef.byteLength > AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MAX_BYTES
    ) {
      throw constructionError('ARTIFACT_SIZE_LIMIT_EXCEEDED');
    }
    const result = aflTradeProjectionSchemaBundleV2ResultSchema.safeParse({
      projectionSchemaBundle: projectionSchemaBundle.data,
      projectionSchemaBundleArtifactRef,
    });
    if (!result.success) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeProjectionSchemaBundleConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

export function verifyAflTradeProjectionSchemaBundleDerivation(input: unknown): boolean {
  try {
    const snapshot = snapshotExactInput(input, VERIFY_INPUT_KEYS);
    if (snapshot === null) return false;
    const output = aflTradeProjectionSchemaBundleResultSchema.safeParse(snapshot.output);
    if (!output.success) return false;
    const replayed = createAflTradeProjectionSchemaBundle({ createdAt: snapshot.createdAt });
    return canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(output.data);
  } catch {
    return false;
  }
}

export function verifyAflTradeProjectionSchemaBundleV2Derivation(input: unknown): boolean {
  try {
    const snapshot = snapshotExactInput(input, VERIFY_INPUT_KEYS);
    if (snapshot === null) return false;
    const output = aflTradeProjectionSchemaBundleV2ResultSchema.safeParse(snapshot.output);
    if (!output.success) return false;
    const replayed = createAflTradeProjectionSchemaBundleV2({ createdAt: snapshot.createdAt });
    return canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(output.data);
  } catch {
    return false;
  }
}
