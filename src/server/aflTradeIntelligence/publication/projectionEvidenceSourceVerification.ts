import { createHash } from 'node:crypto';

import { z } from 'zod';

import { aflTradeIsoDateTimeSchema } from '@/types/aflTradeIntelligence';

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
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SOURCE_ROLES,
  aflTradeProjectionPublicEvidenceResultSchema,
  type AflTradeProjectionPublicEvidence,
  type AflTradeProjectionPublicEvidenceSourceBinding,
} from './projectionPublicEvidence';

export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_SCHEMA_VERSION =
  'afl-trade-projection-evidence-source-verification/v1' as const;
export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_DEFINITION =
  'exact_source_bytes_unique_record_locator_rfc6901_field_digest_verification_v1' as const;
export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_LIMITATION =
  'This report authenticates supplied source bytes and verifies declared record locators, field pointers, and claimed-value digests only. It does not validate each source against its owning schema, establish source rights or claim truth, approve a model or publication, authorize serving, or create user or fantasy ownership.' as const;
export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_REPORT_BYTES = 1024 * 1024;
export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_FAILURES = 1_000;
export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCES = 10_000;
export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_TOTAL_SOURCE_BYTES =
  64 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_DEPTH = 100;
export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_NODES = 250_000;
export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_SET_DIGEST_DEFINITION =
  'canonical_ordered_declared_source_identity_ref_and_observed_body_commitments_sha256_v1' as const;

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Evidence source verification requires canonical JSON artifact references.'
);
const sourceSchemaVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9-]*\/v[1-9][0-9]*$/);
const semanticArtifactIdSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
const sourceArtifactSchema = z.custom<Record<string, unknown>>(
  (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  'A source artifact must be a top-level JSON object.'
);

export const aflTradeProjectionEvidenceSourceArtifactSchema = z
  .object({
    sourceSchemaVersion: sourceSchemaVersionSchema,
    semanticArtifactId: semanticArtifactIdSchema,
    sourceArtifact: sourceArtifactSchema,
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

export type AflTradeProjectionEvidenceSourceArtifact = z.infer<
  typeof aflTradeProjectionEvidenceSourceArtifactSchema
>;

const sourceArtifactsSchema = z
  .array(aflTradeProjectionEvidenceSourceArtifactSchema)
  .max(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCES);

export const aflTradeProjectionEvidenceSourceVerificationCreateInputSchema = z
  .object({
    projectionPublicEvidenceResult: aflTradeProjectionPublicEvidenceResultSchema,
    sourceArtifacts: sourceArtifactsSchema,
    verifiedAt: aflTradeIsoDateTimeSchema,
  })
  .strict();

export type AflTradeProjectionEvidenceSourceVerificationCreateInput = z.infer<
  typeof aflTradeProjectionEvidenceSourceVerificationCreateInputSchema
>;

export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_ISSUE_CODES = [
  'EVIDENCE_AFTER_VERIFICATION',
  'DUPLICATE_SOURCE_IDENTITY',
  'DUPLICATE_SOURCE_ARTIFACT_REFERENCE',
  'SOURCE_MISSING',
  'SOURCE_UNUSED',
  'SOURCE_SCHEMA_VERSION_MISMATCH',
  'SOURCE_SEMANTIC_IDENTITY_MISMATCH',
  'SOURCE_ARTIFACT_REFERENCE_MISMATCH',
  'SOURCE_ARTIFACT_AFTER_VERIFICATION',
  'RECORD_LOCATOR_NOT_UNIQUE',
  'FIELD_PATH_UNRESOLVED',
  'CLAIMED_VALUE_DIGEST_MISMATCH',
] as const;

export type AflTradeProjectionEvidenceSourceVerificationIssueCode =
  (typeof AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_ISSUE_CODES)[number];

const ISSUE_MESSAGES: Readonly<
  Record<AflTradeProjectionEvidenceSourceVerificationIssueCode, string>
> = Object.freeze({
  EVIDENCE_AFTER_VERIFICATION: 'Projection public evidence cannot postdate source verification.',
  DUPLICATE_SOURCE_IDENTITY: 'Supplied source semantic identities must be unique.',
  DUPLICATE_SOURCE_ARTIFACT_REFERENCE:
    'Supplied source artifact-reference identities must be unique.',
  SOURCE_MISSING: 'A public-evidence source binding has no supplied source artifact.',
  SOURCE_UNUSED: 'A supplied source artifact is not used by any public-evidence binding.',
  SOURCE_SCHEMA_VERSION_MISMATCH:
    'The supplied source and its owning schema declaration do not match the evidence binding.',
  SOURCE_SEMANTIC_IDENTITY_MISMATCH:
    'The supplied source top level must contain its semantic identity exactly once.',
  SOURCE_ARTIFACT_REFERENCE_MISMATCH:
    'The supplied source bytes or artifact reference do not match the evidence binding.',
  SOURCE_ARTIFACT_AFTER_VERIFICATION:
    'A supplied source artifact cannot postdate source verification.',
  RECORD_LOCATOR_NOT_UNIQUE:
    'A record locator must identify exactly one object in its supplied source artifact.',
  FIELD_PATH_UNRESOLVED:
    'A source binding field path cannot be resolved relative to its located record.',
  CLAIMED_VALUE_DIGEST_MISMATCH:
    'The selected source value does not match the public-evidence claimed-value digest.',
});

const verificationIssueSchema = z
  .object({
    code: z.enum(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_ISSUE_CODES),
    sourceRole: z.enum(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SOURCE_ROLES).nullable(),
    semanticArtifactId: semanticArtifactIdSchema.nullable(),
    message: z.string().min(1).max(240),
  })
  .strict();

const roleCountsSchema = z
  .object({
    confidence: z.number().int().nonnegative(),
    coverage: z.number().int().nonnegative(),
    asset_identity: z.number().int().nonnegative(),
    lineage_frontier: z.number().int().nonnegative(),
    factor: z.number().int().nonnegative(),
  })
  .strict();

const evidenceBindingSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION),
    projectionPublicEvidenceId: aflTradeContentAddressedIdSchema('projection-public-evidence'),
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

export const aflTradeProjectionEvidenceSourceVerificationContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY),
    projectionPublicEvidence: evidenceBindingSchema,
    verificationDefinition: z.literal(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_DEFINITION),
    status: z.enum(['passed', 'failed']),
    sourceArtifactCount: z
      .number()
      .int()
      .min(0)
      .max(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCES),
    totalSourceArtifactByteLength: z
      .number()
      .int()
      .min(0)
      .max(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_TOTAL_SOURCE_BYTES),
    sourceArtifactSetDigestDefinition: z.literal(
      AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_SET_DIGEST_DEFINITION
    ),
    sourceArtifactSetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    bindingCount: z.number().int().positive(),
    roleBindingCounts: roleCountsSchema,
    checkCount: z.number().int().nonnegative(),
    observedFailureCount: z.number().int().nonnegative(),
    reportedFailureCount: z
      .number()
      .int()
      .min(0)
      .max(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_FAILURES),
    failuresTruncated: z.boolean(),
    failures: z
      .array(verificationIssueSchema)
      .max(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_FAILURES),
    verifiedAt: aflTradeIsoDateTimeSchema,
    limitation: z.literal(AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    const roleTotal = Object.values(content.roleBindingCounts).reduce(
      (sum, count) => sum + count,
      0
    );
    if (roleTotal !== content.bindingCount) {
      context.addIssue({
        code: 'custom',
        path: ['roleBindingCounts'],
        message: 'Role binding counts must reconcile to every evidence binding.',
      });
    }
    if (content.reportedFailureCount !== content.failures.length) {
      context.addIssue({
        code: 'custom',
        path: ['reportedFailureCount'],
        message: 'Reported failure count must equal the bounded failure list.',
      });
    }
    if (content.observedFailureCount > content.checkCount) {
      context.addIssue({
        code: 'custom',
        path: ['observedFailureCount'],
        message: 'Observed failures cannot exceed executed checks.',
      });
    }
    if (
      content.reportedFailureCount !==
      Math.min(
        content.observedFailureCount,
        AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_FAILURES
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reportedFailureCount'],
        message: 'Reported failures must be the exact bounded prefix of observed failures.',
      });
    }
    if ((content.status === 'passed') !== (content.observedFailureCount === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Verification passes exactly when no failures were observed.',
      });
    }
    if (content.failuresTruncated !== content.observedFailureCount > content.reportedFailureCount) {
      context.addIssue({
        code: 'custom',
        path: ['failuresTruncated'],
        message: 'Failure truncation must exactly reflect unreported observed failures.',
      });
    }
  });

export const aflTradeProjectionEvidenceSourceVerificationSchema = z
  .object({
    projectionEvidenceSourceVerificationId: aflTradeContentAddressedIdSchema(
      'projection-evidence-source-verification'
    ),
    content: aflTradeProjectionEvidenceSourceVerificationContentSchema,
  })
  .strict()
  .superRefine((verification, context) => {
    addAflTradeContentAddressIssue(
      'projection-evidence-source-verification',
      verification.projectionEvidenceSourceVerificationId,
      verification.content,
      context,
      ['projectionEvidenceSourceVerificationId']
    );
  });

export type AflTradeProjectionEvidenceSourceVerification = z.infer<
  typeof aflTradeProjectionEvidenceSourceVerificationSchema
>;

export const aflTradeProjectionEvidenceSourceVerificationResultSchema = z
  .object({
    projectionEvidenceSourceVerification: aflTradeProjectionEvidenceSourceVerificationSchema,
    projectionEvidenceSourceVerificationArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const reference = result.projectionEvidenceSourceVerificationArtifactRef;
    const verification = result.projectionEvidenceSourceVerification;
    if (!doesAflTradeArtifactRefMatchCanonicalJson(reference, verification)) {
      context.addIssue({
        code: 'custom',
        path: ['projectionEvidenceSourceVerificationArtifactRef'],
        message: 'The artifact reference must authenticate the complete verification report.',
      });
    }
    if (reference.createdAt !== verification.content.verifiedAt) {
      context.addIssue({
        code: 'custom',
        path: ['projectionEvidenceSourceVerificationArtifactRef', 'createdAt'],
        message: 'The report artifact time must equal its verification time.',
      });
    }
    if (
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_REPORT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionEvidenceSourceVerificationArtifactRef', 'byteLength'],
        message: 'The canonical verification report exceeds its one MiB limit.',
      });
    }
  });

export type AflTradeProjectionEvidenceSourceVerificationResult = z.infer<
  typeof aflTradeProjectionEvidenceSourceVerificationResultSchema
>;

export const aflTradeProjectionEvidenceSourceVerificationVerifyInputSchema =
  aflTradeProjectionEvidenceSourceVerificationCreateInputSchema.safeExtend({
    output: aflTradeProjectionEvidenceSourceVerificationResultSchema,
  });

export const AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_CONSTRUCTION_ERROR_CODES = [
  'INVALID_INPUT_ENVELOPE',
  'INVALID_EVIDENCE_RESULT',
  'INVALID_SOURCE_ARTIFACTS',
  'INVALID_VERIFIED_AT',
  'SOURCE_ARTIFACT_SIZE_LIMIT_EXCEEDED',
  'TOTAL_SOURCE_ARTIFACT_SIZE_LIMIT_EXCEEDED',
  'SOURCE_ARTIFACT_DEPTH_LIMIT_EXCEEDED',
  'SOURCE_ARTIFACT_NODE_LIMIT_EXCEEDED',
  'REPORT_SIZE_LIMIT_EXCEEDED',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const;

export type AflTradeProjectionEvidenceSourceVerificationConstructionErrorCode =
  (typeof AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_CONSTRUCTION_ERROR_CODES)[number];

const CONSTRUCTION_ERROR_MESSAGES: Readonly<
  Record<AflTradeProjectionEvidenceSourceVerificationConstructionErrorCode, string>
> = Object.freeze({
  INVALID_INPUT_ENVELOPE: 'The evidence-source-verification input envelope is invalid.',
  INVALID_EVIDENCE_RESULT: 'The projection public-evidence result is invalid.',
  INVALID_SOURCE_ARTIFACTS: 'The supplied source-artifact collection is invalid.',
  INVALID_VERIFIED_AT: 'The evidence source-verification time is invalid.',
  SOURCE_ARTIFACT_SIZE_LIMIT_EXCEEDED:
    'A supplied canonical source artifact exceeds the eight MiB limit.',
  TOTAL_SOURCE_ARTIFACT_SIZE_LIMIT_EXCEEDED:
    'The supplied canonical source-artifact set exceeds the 64 MiB aggregate limit.',
  SOURCE_ARTIFACT_DEPTH_LIMIT_EXCEEDED:
    'A supplied source artifact exceeds the maximum JSON nesting depth.',
  SOURCE_ARTIFACT_NODE_LIMIT_EXCEEDED:
    'A supplied source artifact exceeds the maximum JSON node count.',
  REPORT_SIZE_LIMIT_EXCEEDED: 'The canonical evidence source-verification report exceeds one MiB.',
  INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
    'The evidence source-verification report failed its internal artifact contract.',
});

const issuedConstructionErrors = new WeakSet<object>();

export class AflTradeProjectionEvidenceSourceVerificationConstructionError extends Error {
  readonly code: AflTradeProjectionEvidenceSourceVerificationConstructionErrorCode;

  constructor(code: AflTradeProjectionEvidenceSourceVerificationConstructionErrorCode) {
    super(CONSTRUCTION_ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionEvidenceSourceVerificationConstructionError';
    this.code = code;
    issuedConstructionErrors.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeProjectionEvidenceSourceVerificationConstructionError';
    code: AflTradeProjectionEvidenceSourceVerificationConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeProjectionEvidenceSourceVerificationConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeProjectionEvidenceSourceVerificationConstructionError(
  value: unknown
): value is AflTradeProjectionEvidenceSourceVerificationConstructionError {
  return value !== null && typeof value === 'object' && issuedConstructionErrors.has(value);
}

function constructionError(
  code: AflTradeProjectionEvidenceSourceVerificationConstructionErrorCode
): AflTradeProjectionEvidenceSourceVerificationConstructionError {
  return new AflTradeProjectionEvidenceSourceVerificationConstructionError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeProjectionEvidenceSourceVerificationConstructionErrorCode
): T {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // Hostile values are replaced with stable construction errors.
  }
  throw constructionError(code);
}

const CREATE_INPUT_KEYS = [
  'projectionPublicEvidenceResult',
  'sourceArtifacts',
  'verifiedAt',
] as const;
const VERIFY_INPUT_KEYS = [...CREATE_INPUT_KEYS, 'output'] as const;

function snapshotExactEnvelope(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const keySet = new Set(expectedKeys);
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !keySet.has(key))
    ) {
      return null;
    }
    const snapshot: Record<string, unknown> = {};
    for (const key of expectedKeys) snapshot[key] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(Reflect.get(value, key, value), seen);
  }
  return Object.freeze(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function collectSourceBindings(
  evidence: AflTradeProjectionPublicEvidence
): AflTradeProjectionPublicEvidenceSourceBinding[] {
  return [
    ...evidence.content.confidenceByView.flatMap((view) =>
      view.dimensions.flatMap((dimension) => dimension.sourceBindings)
    ),
    ...evidence.content.coverageByView.flatMap((view) => [
      ...view.sourceBindings,
      ...view.excludedRoots.flatMap((root) => root.sourceBindings),
    ]),
    ...evidence.content.assets.flatMap((asset) => [
      ...asset.identitySourceBindings,
      ...asset.lineage.sourceBindings,
    ]),
    ...evidence.content.factorsByView.flatMap((view) =>
      view.factors.flatMap((factor) => factor.sourceBindings)
    ),
  ];
}

interface NormalizedSourceArtifact extends AflTradeProjectionEvidenceSourceArtifact {
  sourceArtifact: Record<string, unknown>;
  observedCanonicalBodySha256: string;
  observedCanonicalBodyByteLength: number;
  canonicalCommitment: string;
}

interface SourceArtifactCommitment {
  sourceSchemaVersion: string;
  semanticArtifactId: string;
  artifactRef: AflTradeArtifactRef;
  observedCanonicalBodySha256: string;
  observedCanonicalBodyByteLength: number;
}

interface SourceArtifactAnalysis {
  canonicalBody: string;
  byteLength: number;
  nodeCount: number;
  maximumDepth: number;
}

function utf8CodePointByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function canonicalJsonStringByteLength(value: string): number {
  let byteLength = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit === 0x22 ||
      codeUnit === 0x5c ||
      codeUnit === 0x08 ||
      codeUnit === 0x09 ||
      codeUnit === 0x0a ||
      codeUnit === 0x0c ||
      codeUnit === 0x0d
    ) {
      byteLength += 2;
      continue;
    }
    if (codeUnit < 0x20) {
      byteLength += 6;
      continue;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        byteLength += 4;
        index += 1;
      } else {
        byteLength += 6;
      }
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      byteLength += 6;
      continue;
    }
    byteLength += utf8CodePointByteLength(codeUnit);
  }
  return byteLength;
}

function utf8StringByteLength(value: string): number {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        byteLength += 4;
        index += 1;
      } else {
        byteLength += 3;
      }
      continue;
    }
    byteLength += utf8CodePointByteLength(codeUnit);
  }
  return byteLength;
}

function analyzeSourceArtifact(sourceArtifact: Record<string, unknown>): SourceArtifactAnalysis {
  type SnapshotContainer = Record<string, unknown> | unknown[];
  type Frame =
    | {
        kind: 'value';
        value: unknown;
        depth: number;
        parent: SnapshotContainer;
        key: string | number;
      }
    | {
        kind: 'array-children';
        snapshot: unknown[];
        index: number;
        depth: number;
      }
    | {
        kind: 'object-children';
        snapshot: Record<string, unknown>;
        keys: readonly string[];
        index: number;
        depth: number;
      }
    | { kind: 'exit'; value: object };
  const root: { value?: unknown } = {};
  const stack: Frame[] = [
    { kind: 'value', value: sourceArtifact, depth: 0, parent: root, key: 'value' },
  ];
  const activeAncestors = new WeakSet<object>();
  let byteLength = 0;
  let nodeCount = 0;
  let maximumDepth = 0;
  const addBytes = (count: number): void => {
    byteLength += count;
    if (byteLength > AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_BYTES) {
      throw constructionError('SOURCE_ARTIFACT_SIZE_LIMIT_EXCEEDED');
    }
  };
  const assignSnapshotValue = (
    parent: SnapshotContainer,
    key: string | number,
    value: unknown
  ): void => {
    if (Array.isArray(parent)) {
      if (typeof key !== 'number') {
        throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
      }
      parent[key] = value;
      return;
    }
    if (typeof key !== 'string') {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    parent[key] = value;
  };

  try {
    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame === undefined) break;
      if (frame.kind === 'exit') {
        activeAncestors.delete(frame.value);
        continue;
      }
      if (frame.kind === 'array-children') {
        if (frame.index >= frame.snapshot.length) continue;
        const value = frame.snapshot[frame.index];
        stack.push({ ...frame, index: frame.index + 1 });
        stack.push({
          kind: 'value',
          value,
          depth: frame.depth + 1,
          parent: frame.snapshot,
          key: frame.index,
        });
        continue;
      }
      if (frame.kind === 'object-children') {
        const key = frame.keys[frame.index];
        if (key === undefined) continue;
        const value = frame.snapshot[key];
        stack.push({ ...frame, index: frame.index + 1 });
        stack.push({
          kind: 'value',
          value,
          depth: frame.depth + 1,
          parent: frame.snapshot,
          key,
        });
        continue;
      }
      nodeCount += 1;
      if (nodeCount > AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_NODES) {
        throw constructionError('SOURCE_ARTIFACT_NODE_LIMIT_EXCEEDED');
      }
      if (frame.depth > AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_DEPTH) {
        throw constructionError('SOURCE_ARTIFACT_DEPTH_LIMIT_EXCEEDED');
      }
      maximumDepth = Math.max(maximumDepth, frame.depth);
      const value = frame.value;
      if (value === null) {
        addBytes(4);
        assignSnapshotValue(frame.parent, frame.key, null);
        continue;
      }
      if (typeof value === 'string') {
        addBytes(canonicalJsonStringByteLength(value));
        assignSnapshotValue(frame.parent, frame.key, value);
        continue;
      }
      if (typeof value === 'boolean') {
        addBytes(value ? 4 : 5);
        assignSnapshotValue(frame.parent, frame.key, value);
        continue;
      }
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw constructionError('INVALID_SOURCE_ARTIFACTS');
        addBytes(String(Object.is(value, -0) ? 0 : value).length);
        assignSnapshotValue(frame.parent, frame.key, Object.is(value, -0) ? 0 : value);
        continue;
      }
      if (typeof value !== 'object') throw constructionError('INVALID_SOURCE_ARTIFACTS');
      if (activeAncestors.has(value)) throw constructionError('INVALID_SOURCE_ARTIFACTS');
      activeAncestors.add(value);
      stack.push({ kind: 'exit', value });

      if (Array.isArray(value)) {
        if (Reflect.getPrototypeOf(value) !== Array.prototype) {
          throw constructionError('INVALID_SOURCE_ARTIFACTS');
        }
        const keys = Reflect.ownKeys(value);
        const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
        const declaredLength =
          lengthDescriptor !== undefined && 'value' in lengthDescriptor
            ? lengthDescriptor.value
            : undefined;
        if (
          typeof declaredLength !== 'number' ||
          !Number.isSafeInteger(declaredLength) ||
          declaredLength < 0 ||
          keys.length !== declaredLength + 1 ||
          keys.some(
            (key) =>
              key !== 'length' &&
              (typeof key !== 'string' ||
                !/^(?:0|[1-9][0-9]*)$/.test(key) ||
                Number(key) >= declaredLength)
          )
        ) {
          throw constructionError('INVALID_SOURCE_ARTIFACTS');
        }
        const length = declaredLength;
        if (
          nodeCount + length >
          AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_NODES
        ) {
          throw constructionError('SOURCE_ARTIFACT_NODE_LIMIT_EXCEEDED');
        }
        addBytes(2 + Math.max(0, length - 1));
        const snapshot = new Array<unknown>(length);
        for (let index = 0; index < length; index += 1) {
          const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !('value' in descriptor)) {
            throw constructionError('INVALID_SOURCE_ARTIFACTS');
          }
          snapshot[index] = descriptor.value;
        }
        assignSnapshotValue(frame.parent, frame.key, snapshot);
        stack.push({
          kind: 'array-children',
          snapshot,
          index: 0,
          depth: frame.depth,
        });
        continue;
      }

      const prototype = Reflect.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw constructionError('INVALID_SOURCE_ARTIFACTS');
      }
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== 'string')) {
        throw constructionError('INVALID_SOURCE_ARTIFACTS');
      }
      const stringKeys = (keys as string[]).sort(compareCodeUnits);
      if (
        nodeCount + stringKeys.length >
        AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_SOURCE_NODES
      ) {
        throw constructionError('SOURCE_ARTIFACT_NODE_LIMIT_EXCEEDED');
      }
      addBytes(2 + Math.max(0, stringKeys.length - 1));
      const snapshot = Object.create(null) as Record<string, unknown>;
      for (const key of stringKeys) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
          throw constructionError('INVALID_SOURCE_ARTIFACTS');
        }
        addBytes(canonicalJsonStringByteLength(key) + 1);
        snapshot[key] = descriptor.value;
      }
      assignSnapshotValue(frame.parent, frame.key, snapshot);
      stack.push({
        kind: 'object-children',
        snapshot,
        keys: stringKeys,
        index: 0,
        depth: frame.depth,
      });
    }
  } catch (error) {
    if (isAflTradeProjectionEvidenceSourceVerificationConstructionError(error)) throw error;
    throw constructionError('INVALID_SOURCE_ARTIFACTS');
  }
  const snapshot = root.value;
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  const canonicalBody = canonicalizeAflTradeJson(snapshot);
  if (utf8StringByteLength(canonicalBody) !== byteLength) {
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  return { canonicalBody, byteLength, nodeCount, maximumDepth };
}

function sourceCommitment(source: NormalizedSourceArtifact): SourceArtifactCommitment {
  return {
    sourceSchemaVersion: source.sourceSchemaVersion,
    semanticArtifactId: source.semanticArtifactId,
    artifactRef: source.artifactRef,
    observedCanonicalBodySha256: source.observedCanonicalBodySha256,
    observedCanonicalBodyByteLength: source.observedCanonicalBodyByteLength,
  };
}

function sourceSetCommitment(sources: readonly NormalizedSourceArtifact[]): {
  totalSourceArtifactByteLength: number;
  sourceArtifactSetSha256: string;
} {
  const commitments = sources.map(sourceCommitment);
  return {
    totalSourceArtifactByteLength: commitments.reduce(
      (sum, commitment) => sum + commitment.observedCanonicalBodyByteLength,
      0
    ),
    sourceArtifactSetSha256: sha256AflTradeCanonicalJson(commitments),
  };
}

function normalizeSourceArtifacts(
  sourceArtifacts: readonly AflTradeProjectionEvidenceSourceArtifact[]
): NormalizedSourceArtifact[] {
  let totalByteLength = 0;
  const normalized = sourceArtifacts.map((source): NormalizedSourceArtifact => {
    const analysis = analyzeSourceArtifact(source.sourceArtifact);
    totalByteLength += analysis.byteLength;
    if (
      totalByteLength > AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_TOTAL_SOURCE_BYTES
    ) {
      throw constructionError('TOTAL_SOURCE_ARTIFACT_SIZE_LIMIT_EXCEEDED');
    }
    try {
      const sourceArtifact = JSON.parse(analysis.canonicalBody) as Record<string, unknown>;
      const partiallyNormalized = {
        ...source,
        sourceArtifact,
        observedCanonicalBodySha256: createHash('sha256')
          .update(analysis.canonicalBody, 'utf8')
          .digest('hex'),
        observedCanonicalBodyByteLength: analysis.byteLength,
        canonicalCommitment: '',
      };
      return {
        ...partiallyNormalized,
        canonicalCommitment: canonicalizeAflTradeJson(sourceCommitment(partiallyNormalized)),
      };
    } catch (error) {
      if (isAflTradeProjectionEvidenceSourceVerificationConstructionError(error)) throw error;
      throw constructionError('INVALID_SOURCE_ARTIFACTS');
    }
  });
  return normalized.sort((left, right) =>
    compareCodeUnits(left.canonicalCommitment, right.canonicalCommitment)
  );
}

function owningSchemaVersion(sourceArtifact: Record<string, unknown>): unknown {
  const content = sourceArtifact.content;
  if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
    const contentVersion = Reflect.get(content, 'schemaVersion', content);
    if (contentVersion !== undefined) return contentVersion;
  }
  return sourceArtifact.schemaVersion;
}

function topLevelSemanticIdentityCount(
  sourceArtifact: Record<string, unknown>,
  semanticArtifactId: string
): number {
  return Object.values(sourceArtifact).filter(
    (value) =>
      (value === null || ['string', 'number', 'boolean'].includes(typeof value)) &&
      value === semanticArtifactId
  ).length;
}

function indexRecordLocators(
  sourceArtifact: Record<string, unknown>,
  requestedLocators: ReadonlySet<string>
): ReadonlyMap<string, readonly Record<string, unknown>[]> {
  const recordsByLocator = new Map<string, Record<string, unknown>[]>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const counts = new Map<string, number>();
    for (const child of Object.values(record)) {
      if (typeof child === 'string' && requestedLocators.has(child)) {
        counts.set(child, (counts.get(child) ?? 0) + 1);
      }
    }
    for (const [locator, count] of counts) {
      if (count === 1) {
        const records = recordsByLocator.get(locator) ?? [];
        records.push(record);
        recordsByLocator.set(locator, records);
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(sourceArtifact);
  return recordsByLocator;
}

function decodePointerToken(token: string): string | null {
  if (/(?:~[^01])|(?:~$)/.test(token)) return null;
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolveJsonPointer(record: Record<string, unknown>, pointer: string): unknown {
  const tokens = pointer.slice(1).split('/').map(decodePointerToken);
  if (tokens.some((token) => token === null)) return undefined;
  let selected: unknown = record;
  for (const token of tokens as string[]) {
    if (Array.isArray(selected)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token)) return undefined;
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= selected.length) return undefined;
      selected = selected[index];
      continue;
    }
    if (selected === null || typeof selected !== 'object') return undefined;
    if (!Object.hasOwn(selected, token)) return undefined;
    selected = Reflect.get(selected, token, selected);
  }
  return selected;
}

interface IssueCollector {
  checkCount: number;
  observedFailureCount: number;
  failures: z.infer<typeof verificationIssueSchema>[];
}

function runCheck(
  collector: IssueCollector,
  passes: boolean,
  code: AflTradeProjectionEvidenceSourceVerificationIssueCode,
  sourceRole: AflTradeProjectionPublicEvidenceSourceBinding['sourceRole'] | null,
  semanticArtifactId: string | null
): boolean {
  collector.checkCount += 1;
  if (passes) return true;
  collector.observedFailureCount += 1;
  if (collector.failures.length < AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_FAILURES) {
    collector.failures.push({
      code,
      sourceRole,
      semanticArtifactId,
      message: ISSUE_MESSAGES[code],
    });
  }
  return false;
}

function roleBindingCounts(
  bindings: readonly AflTradeProjectionPublicEvidenceSourceBinding[]
): z.infer<typeof roleCountsSchema> {
  const counts = {
    confidence: 0,
    coverage: 0,
    asset_identity: 0,
    lineage_frontier: 0,
    factor: 0,
  };
  for (const binding of bindings) counts[binding.sourceRole] += 1;
  return counts;
}

function verifySources(
  evidence: AflTradeProjectionPublicEvidence,
  evidenceReference: AflTradeArtifactRef,
  sources: readonly NormalizedSourceArtifact[],
  verifiedAt: string
): {
  checkCount: number;
  observedFailureCount: number;
  failures: z.infer<typeof verificationIssueSchema>[];
  failuresTruncated: boolean;
  bindings: AflTradeProjectionPublicEvidenceSourceBinding[];
} {
  const bindings = collectSourceBindings(evidence);
  const collector: IssueCollector = { checkCount: 0, observedFailureCount: 0, failures: [] };
  runCheck(
    collector,
    Date.parse(evidenceReference.createdAt) <= Date.parse(verifiedAt),
    'EVIDENCE_AFTER_VERIFICATION',
    null,
    null
  );

  const identityCounts = new Map<string, number>();
  const referenceCounts = new Map<string, number>();
  for (const source of sources) {
    identityCounts.set(
      source.semanticArtifactId,
      (identityCounts.get(source.semanticArtifactId) ?? 0) + 1
    );
    referenceCounts.set(
      source.artifactRef.artifactId,
      (referenceCounts.get(source.artifactRef.artifactId) ?? 0) + 1
    );
  }
  for (const source of sources) {
    runCheck(
      collector,
      identityCounts.get(source.semanticArtifactId) === 1,
      'DUPLICATE_SOURCE_IDENTITY',
      null,
      source.semanticArtifactId
    );
    runCheck(
      collector,
      referenceCounts.get(source.artifactRef.artifactId) === 1,
      'DUPLICATE_SOURCE_ARTIFACT_REFERENCE',
      null,
      source.semanticArtifactId
    );
    runCheck(
      collector,
      topLevelSemanticIdentityCount(source.sourceArtifact, source.semanticArtifactId) === 1,
      'SOURCE_SEMANTIC_IDENTITY_MISMATCH',
      null,
      source.semanticArtifactId
    );
    runCheck(
      collector,
      owningSchemaVersion(source.sourceArtifact) === source.sourceSchemaVersion,
      'SOURCE_SCHEMA_VERSION_MISMATCH',
      null,
      source.semanticArtifactId
    );
    runCheck(
      collector,
      doesAflTradeArtifactRefMatchCanonicalJson(source.artifactRef, source.sourceArtifact),
      'SOURCE_ARTIFACT_REFERENCE_MISMATCH',
      null,
      source.semanticArtifactId
    );
    runCheck(
      collector,
      Date.parse(source.artifactRef.createdAt) <= Date.parse(verifiedAt),
      'SOURCE_ARTIFACT_AFTER_VERIFICATION',
      null,
      source.semanticArtifactId
    );
  }

  const uniqueSources = new Map(
    sources
      .filter((source) => identityCounts.get(source.semanticArtifactId) === 1)
      .map((source) => [source.semanticArtifactId, source] as const)
  );
  const requestedLocatorsBySource = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const locators = requestedLocatorsBySource.get(binding.semanticArtifactId) ?? new Set();
    locators.add(binding.recordLocator);
    requestedLocatorsBySource.set(binding.semanticArtifactId, locators);
  }
  const locatorIndexes = new Map<string, ReadonlyMap<string, readonly Record<string, unknown>[]>>();
  for (const [semanticArtifactId, source] of uniqueSources) {
    locatorIndexes.set(
      semanticArtifactId,
      indexRecordLocators(
        source.sourceArtifact,
        requestedLocatorsBySource.get(semanticArtifactId) ?? new Set()
      )
    );
  }

  const usedSourceIds = new Set<string>();
  for (const binding of bindings) {
    const source = uniqueSources.get(binding.semanticArtifactId);
    const sourceExists = runCheck(
      collector,
      source !== undefined,
      'SOURCE_MISSING',
      binding.sourceRole,
      binding.semanticArtifactId
    );
    if (!sourceExists || source === undefined) continue;
    usedSourceIds.add(source.semanticArtifactId);
    runCheck(
      collector,
      source.sourceSchemaVersion === binding.sourceSchemaVersion &&
        owningSchemaVersion(source.sourceArtifact) === binding.sourceSchemaVersion,
      'SOURCE_SCHEMA_VERSION_MISMATCH',
      binding.sourceRole,
      binding.semanticArtifactId
    );
    runCheck(
      collector,
      sameCanonicalJson(source.artifactRef, binding.artifactRef),
      'SOURCE_ARTIFACT_REFERENCE_MISMATCH',
      binding.sourceRole,
      binding.semanticArtifactId
    );
    const records = locatorIndexes.get(binding.semanticArtifactId)?.get(binding.recordLocator);
    const uniqueRecord = records !== undefined && records.length === 1;
    runCheck(
      collector,
      uniqueRecord,
      'RECORD_LOCATOR_NOT_UNIQUE',
      binding.sourceRole,
      binding.semanticArtifactId
    );
    if (!uniqueRecord || records === undefined) continue;
    const selected = resolveJsonPointer(records[0], binding.fieldPath);
    const fieldResolved = selected !== undefined;
    runCheck(
      collector,
      fieldResolved,
      'FIELD_PATH_UNRESOLVED',
      binding.sourceRole,
      binding.semanticArtifactId
    );
    if (!fieldResolved) continue;
    runCheck(
      collector,
      sha256AflTradeCanonicalJson(selected) === binding.claimedValueSha256,
      'CLAIMED_VALUE_DIGEST_MISMATCH',
      binding.sourceRole,
      binding.semanticArtifactId
    );
  }
  for (const source of sources) {
    runCheck(
      collector,
      usedSourceIds.has(source.semanticArtifactId),
      'SOURCE_UNUSED',
      null,
      source.semanticArtifactId
    );
  }
  return {
    checkCount: collector.checkCount,
    observedFailureCount: collector.observedFailureCount,
    failures: collector.failures,
    failuresTruncated: collector.observedFailureCount > collector.failures.length,
    bindings,
  };
}

export function createAflTradeProjectionEvidenceSourceVerification(
  unparsedInput: unknown
): AflTradeProjectionEvidenceSourceVerificationResult {
  try {
    const snapshot = snapshotExactEnvelope(unparsedInput, CREATE_INPUT_KEYS);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');
    const evidenceResult = parseOrThrow(
      aflTradeProjectionPublicEvidenceResultSchema,
      snapshot.projectionPublicEvidenceResult,
      'INVALID_EVIDENCE_RESULT'
    );
    const sourceArtifacts = parseOrThrow(
      sourceArtifactsSchema,
      snapshot.sourceArtifacts,
      'INVALID_SOURCE_ARTIFACTS'
    );
    const verifiedAt = parseOrThrow(
      aflTradeIsoDateTimeSchema,
      snapshot.verifiedAt,
      'INVALID_VERIFIED_AT'
    );

    const normalizedSources = normalizeSourceArtifacts(sourceArtifacts);
    const evidence = evidenceResult.projectionPublicEvidence;
    const evidenceReference = evidenceResult.projectionPublicEvidenceArtifactRef;
    const verification = verifySources(evidence, evidenceReference, normalizedSources, verifiedAt);
    const sourceSet = sourceSetCommitment(normalizedSources);
    const content = {
      schemaVersion: AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_PUBLIC_ASSET_BOUNDARY,
      projectionPublicEvidence: {
        schemaVersion: evidence.content.schemaVersion,
        projectionPublicEvidenceId: evidence.projectionPublicEvidenceId,
        artifactRef: evidenceReference,
      },
      verificationDefinition: AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_DEFINITION,
      status: verification.observedFailureCount === 0 ? ('passed' as const) : ('failed' as const),
      sourceArtifactCount: normalizedSources.length,
      totalSourceArtifactByteLength: sourceSet.totalSourceArtifactByteLength,
      sourceArtifactSetDigestDefinition: AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_SET_DIGEST_DEFINITION,
      sourceArtifactSetSha256: sourceSet.sourceArtifactSetSha256,
      bindingCount: verification.bindings.length,
      roleBindingCounts: roleBindingCounts(verification.bindings),
      checkCount: verification.checkCount,
      observedFailureCount: verification.observedFailureCount,
      reportedFailureCount: verification.failures.length,
      failuresTruncated: verification.failuresTruncated,
      failures: verification.failures,
      verifiedAt,
      limitation: AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_LIMITATION,
    };
    const parsedVerification = aflTradeProjectionEvidenceSourceVerificationSchema.safeParse({
      projectionEvidenceSourceVerificationId: createAflTradeContentAddress(
        'projection-evidence-source-verification',
        content
      ),
      content,
    });
    if (!parsedVerification.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    const projectionEvidenceSourceVerificationArtifactRef = createAflTradeCanonicalJsonArtifactRef(
      parsedVerification.data,
      verifiedAt
    );
    if (
      projectionEvidenceSourceVerificationArtifactRef.byteLength < 1 ||
      projectionEvidenceSourceVerificationArtifactRef.byteLength >
        AFL_TRADE_PROJECTION_EVIDENCE_SOURCE_VERIFICATION_MAX_REPORT_BYTES
    ) {
      throw constructionError('REPORT_SIZE_LIMIT_EXCEEDED');
    }
    const result = aflTradeProjectionEvidenceSourceVerificationResultSchema.safeParse({
      projectionEvidenceSourceVerification: parsedVerification.data,
      projectionEvidenceSourceVerificationArtifactRef,
    });
    if (!result.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    return deepFreeze(result.data);
  } catch (error) {
    if (isAflTradeProjectionEvidenceSourceVerificationConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

export function verifyAflTradeProjectionEvidenceSourceVerification(input: unknown): boolean {
  try {
    const snapshot = snapshotExactEnvelope(input, VERIFY_INPUT_KEYS);
    if (snapshot === null) return false;
    const output = aflTradeProjectionEvidenceSourceVerificationResultSchema.safeParse(
      snapshot.output
    );
    if (!output.success) return false;
    const replayed = createAflTradeProjectionEvidenceSourceVerification({
      projectionPublicEvidenceResult: snapshot.projectionPublicEvidenceResult,
      sourceArtifacts: snapshot.sourceArtifacts,
      verifiedAt: snapshot.verifiedAt,
    });
    return sameCanonicalJson(replayed, output.data);
  } catch {
    return false;
  }
}
