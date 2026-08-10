import { types as nodeUtilTypes } from 'node:util';

import { z } from 'zod';

import { aflTradePublicIdSchema } from '@/types/aflTradeIntelligence';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from '../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeProjectionManifestV2Schema,
  aflTradeProjectionManifestV3Schema,
  type AflTradeProjectionManifestV2,
  type AflTradeProjectionManifestV3,
} from '../artifacts/publicationProjectionManifests';
import {
  aflTradeValuationOutputCustodyIndexVerificationSchema,
  verifyAflTradeValuationOutputCustodyIndex,
} from '../valuation/valuationOutputCustodyIndex';
import {
  aflTradeFreshnessPolicyResultSchema,
  verifyAflTradeFreshnessPolicy,
  type AflTradeFreshnessPolicyResult,
} from './freshnessPolicy';
import {
  aflTradeProjectionParityVerifyInputSchema,
  verifyAflTradeProjectionParityReport,
  type AflTradeProjectionParityVerifyInput,
} from './projectionParity';

export const AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_ARTIFACT_BYTES = 256 * 1024;
export const AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_INPUT_BYTES = 128 * 1024 * 1024;
export const AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_INPUT_NODES = 2_000_000;
export const AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_INPUT_DEPTH = 128;
export const AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_PREDECESSOR_POLICY =
  'no_predecessor_no_latest_alias_no_implicit_conversion_v1' as const;
export const AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_RUNTIME_FALLBACK = 'prohibited' as const;
export const AFL_TRADE_PROJECTION_MANIFEST_BUILD_JOB_ID_AUTHORITY =
  'operational_correlation_label_only_not_authenticated_provenance_v1' as const;
export const AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_LIMITATION =
  'This immutable boundary totally replays a passing projection-parity chain and authenticates one exact projection v2 manifest. The build-job identifier is an operational correlation label, not authenticated provenance, until a future upstream build receipt binds it. It does not fetch omitted artifact bytes, activate publication, authorize serving or fantasy state, establish source rights or model validity, or create user or fantasy ownership.' as const;

const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Projection manifests require canonical JSON artifact references.'
);

export const aflTradeProjectionManifestMaterializationCreateInputSchema = z
  .object({
    buildJobId: aflTradePublicIdSchema,
    freshnessPolicyResult: aflTradeFreshnessPolicyResultSchema,
    projectionParityVerification: aflTradeProjectionParityVerifyInputSchema,
  })
  .strict();

export type AflTradeProjectionManifestMaterializationCreateInput = z.infer<
  typeof aflTradeProjectionManifestMaterializationCreateInputSchema
>;

export const aflTradeProjectionManifestMaterializationResultSchema = z
  .object({
    projectionManifest: aflTradeProjectionManifestV2Schema,
    projectionManifestArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const reference = result.projectionManifestArtifactRef;
    if (!doesAflTradeArtifactRefMatchCanonicalJson(reference, result.projectionManifest)) {
      context.addIssue({
        code: 'custom',
        path: ['projectionManifestArtifactRef'],
        message: 'Projection-manifest artifact reference must authenticate the complete manifest.',
      });
    }
    if (reference.createdAt !== result.projectionManifest.content.createdAt) {
      context.addIssue({
        code: 'custom',
        path: ['projectionManifestArtifactRef', 'createdAt'],
        message: 'Projection-manifest artifact time must equal the manifest creation time.',
      });
    }
    if (
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_ARTIFACT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionManifestArtifactRef', 'byteLength'],
        message: 'Projection manifest exceeds its 256 KiB artifact limit.',
      });
    }
  });

export const aflTradeCustodiedProjectionManifestMaterializationResultSchema = z
  .object({
    projectionManifest: aflTradeProjectionManifestV3Schema,
    projectionManifestArtifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const reference = result.projectionManifestArtifactRef;
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(reference, result.projectionManifest) ||
      reference.createdAt !== result.projectionManifest.content.createdAt ||
      reference.byteLength < 1 ||
      reference.byteLength > AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_ARTIFACT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionManifestArtifactRef'],
        message: 'Custodied projection-manifest artifact must authenticate exact bounded bytes.',
      });
    }
  });

export type AflTradeProjectionManifestMaterializationResult = z.infer<
  typeof aflTradeProjectionManifestMaterializationResultSchema
>;
export type AflTradeCustodiedProjectionManifestMaterializationResult = z.infer<
  typeof aflTradeCustodiedProjectionManifestMaterializationResultSchema
>;

export const aflTradeCustodiedProjectionManifestMaterializationCreateInputSchema =
  aflTradeProjectionManifestMaterializationCreateInputSchema.safeExtend({
    custodyIndexVerification: aflTradeValuationOutputCustodyIndexVerificationSchema,
  });

export const aflTradeCustodiedProjectionManifestMaterializationVerifyInputSchema =
  aflTradeCustodiedProjectionManifestMaterializationCreateInputSchema.safeExtend({
    output: aflTradeCustodiedProjectionManifestMaterializationResultSchema,
  });

export const aflTradeProjectionManifestMaterializationVerifyInputSchema =
  aflTradeProjectionManifestMaterializationCreateInputSchema.safeExtend({
    output: aflTradeProjectionManifestMaterializationResultSchema,
  });

export type AflTradeProjectionManifestMaterializationVerifyInput = z.infer<
  typeof aflTradeProjectionManifestMaterializationVerifyInputSchema
>;
export type AflTradeCustodiedProjectionManifestMaterializationVerifyInput = z.infer<
  typeof aflTradeCustodiedProjectionManifestMaterializationVerifyInputSchema
>;

export const AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_ERROR_CODES = Object.freeze([
  'INVALID_INPUT_ENVELOPE',
  'INVALID_BUILD_JOB_ID',
  'INVALID_FRESHNESS_POLICY_RESULT',
  'INVALID_PROJECTION_PARITY_VERIFICATION',
  'PARITY_NOT_PASSED',
  'FRESHNESS_BINDING_MISMATCH',
  'INVALID_CUSTODY_INDEX_VERIFICATION',
  'PROJECTION_CHAIN_MISMATCH',
  'ARTIFACT_SIZE_LIMIT_EXCEEDED',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const);

export type AflTradeProjectionManifestMaterializationErrorCode =
  (typeof AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<AflTradeProjectionManifestMaterializationErrorCode, string>> =
  Object.freeze({
    INVALID_INPUT_ENVELOPE: 'The projection-manifest materialization input envelope is invalid.',
    INVALID_BUILD_JOB_ID: 'The projection-manifest build-job identifier is invalid.',
    INVALID_FRESHNESS_POLICY_RESULT:
      'The projection-manifest freshness-policy result is invalid or fails deterministic replay.',
    INVALID_PROJECTION_PARITY_VERIFICATION:
      'The projection-parity verification envelope is invalid or fails total replay.',
    PARITY_NOT_PASSED:
      'Projection-manifest materialization requires complete passing document parity.',
    FRESHNESS_BINDING_MISMATCH:
      'The freshness-policy result does not equal the publication freshness binding.',
    INVALID_CUSTODY_INDEX_VERIFICATION:
      'The valuation-output custody index is invalid or does not replay exactly.',
    PROJECTION_CHAIN_MISMATCH:
      'The verified projection artifacts do not form one exact publication chain.',
    ARTIFACT_SIZE_LIMIT_EXCEEDED: 'The projection manifest exceeds its 256 KiB artifact limit.',
    INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
      'The projection manifest failed its internal artifact contract.',
  });

const TRUSTED_ERRORS = new WeakSet<object>();

export class AflTradeProjectionManifestMaterializationError extends Error {
  readonly code: AflTradeProjectionManifestMaterializationErrorCode;

  constructor(code: AflTradeProjectionManifestMaterializationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionManifestMaterializationError';
    this.code = code;
    TRUSTED_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeProjectionManifestMaterializationError';
    code: AflTradeProjectionManifestMaterializationErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeProjectionManifestMaterializationError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeProjectionManifestMaterializationError(
  value: unknown
): value is AflTradeProjectionManifestMaterializationError {
  return value !== null && typeof value === 'object' && TRUSTED_ERRORS.has(value);
}

function materializationError(
  code: AflTradeProjectionManifestMaterializationErrorCode
): AflTradeProjectionManifestMaterializationError {
  return new AflTradeProjectionManifestMaterializationError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeProjectionManifestMaterializationErrorCode
): T {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // Hostile values are replaced with the stable contract error below.
  }
  throw materializationError(code);
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function authenticateFreshnessPolicy(value: unknown): AflTradeFreshnessPolicyResult {
  const freshness = parseOrThrow(
    aflTradeFreshnessPolicyResultSchema,
    value,
    'INVALID_FRESHNESS_POLICY_RESULT'
  );
  const content = freshness.freshnessPolicy.content;
  if (
    !verifyAflTradeFreshnessPolicy({
      scopeKey: content.scopeKey,
      valueUnitId: content.valueUnitId,
      currentDurationSeconds: content.currentDurationSeconds,
      staleServeDurationSeconds: content.staleServeDurationSeconds,
      createdAt: content.createdAt,
      result: freshness,
    })
  ) {
    throw materializationError('INVALID_FRESHNESS_POLICY_RESULT');
  }
  return freshness;
}

type CustodyIndexVerification = z.infer<
  typeof aflTradeValuationOutputCustodyIndexVerificationSchema
>;

function authenticateCustodyIndex(value: unknown): CustodyIndexVerification {
  const custody = parseOrThrow(
    aflTradeValuationOutputCustodyIndexVerificationSchema,
    value,
    'INVALID_CUSTODY_INDEX_VERIFICATION'
  );
  if (!verifyAflTradeValuationOutputCustodyIndex(custody)) {
    throw materializationError('INVALID_CUSTODY_INDEX_VERIFICATION');
  }
  return custody;
}

function assertPassingExactChain(
  parityVerification: AflTradeProjectionParityVerifyInput,
  freshness: AflTradeFreshnessPolicyResult,
  generation: 'legacy' | 'custodied',
  custodyVerification?: CustodyIndexVerification
): void {
  const report = parityVerification.output.projectionParityReport.content;
  const documentSetResult = parityVerification.projectionDocumentSetVerification.output;
  const documentSet = documentSetResult.projectionDocumentSet.content;
  const publication = parityVerification.projectionDocumentSetVerification.publicationManifest;
  const policy = parityVerification.projectionPresentationPolicy;
  const policyContent = policy.projectionPresentationPolicy.content;
  const evidence = parityVerification.projectionPublicEvidenceIndex;
  const evidenceContent = evidence.projectionPublicEvidenceIndex.content;
  const schemaBundle = parityVerification.projectionSchemaBundle;
  const schemaContent = schemaBundle.projectionSchemaBundle.content;

  if (
    report.status !== 'passed' ||
    report.failureCount !== 0 ||
    report.failureDetails.length !== 0 ||
    report.failureDetailsTruncated ||
    report.checkedDocumentCount !== documentSet.documentCount ||
    report.expectedDocumentCount !== documentSet.documentCount ||
    report.storedDocumentCount !== documentSet.documentCount
  ) {
    throw materializationError('PARITY_NOT_PASSED');
  }

  const freshnessBinding = {
    schemaVersion: freshness.freshnessPolicy.content.schemaVersion,
    freshnessPolicyId: freshness.freshnessPolicy.freshnessPolicyId,
    artifactRef: freshness.freshnessPolicyArtifactRef,
  };
  if (!sameCanonicalJson(freshnessBinding, publication.content.freshnessPolicy)) {
    throw materializationError('FRESHNESS_BINDING_MISMATCH');
  }
  if (
    freshness.freshnessPolicy.content.scopeKey !== publication.content.scopeKey ||
    freshness.freshnessPolicy.content.valueUnitId !== publication.content.valueUnitId
  ) {
    throw materializationError('FRESHNESS_BINDING_MISMATCH');
  }

  const policyBinding = {
    schemaVersion: policyContent.schemaVersion,
    projectionPresentationPolicyId:
      policy.projectionPresentationPolicy.projectionPresentationPolicyId,
    artifactRef: policy.projectionPresentationPolicyArtifactRef,
    valueUnitId: policyContent.valueUnit.id,
    universalLayer: policyContent.universalLayer,
    supportedViews: policyContent.supportedViews,
  };
  const evidenceBinding = {
    schemaVersion: evidenceContent.schemaVersion,
    projectionPublicEvidenceIndexId:
      evidence.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId,
    artifactRef: evidence.projectionPublicEvidenceIndexArtifactRef,
    publicationId: evidenceContent.publication.publicationId,
    valuationOutputInventoryIndexId:
      evidenceContent.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
    scopeKey: evidenceContent.scopeKey,
    valueUnitId: evidenceContent.valueUnitId,
    indexedEvidenceSchemaVersion: evidenceContent.indexedEvidenceSchemaVersion,
    entryCount: evidenceContent.entryCount,
    evidenceBindingSetSha256: evidenceContent.evidenceBindingSetSha256,
  };
  const documentSetBinding = {
    schemaVersion: documentSet.schemaVersion,
    projectionDocumentSetId: documentSetResult.projectionDocumentSet.projectionDocumentSetId,
    artifactRef: documentSetResult.projectionDocumentSetArtifactRef,
    tradeCount: documentSet.tradeCount,
    documentCount: documentSet.documentCount,
  };

  if (
    (generation === 'legacy' &&
      (publication.content.schemaVersion !== 'afl-trade-publication/v3' ||
        schemaContent.schemaVersion !== 'afl-trade-projection-schema-bundle/v1')) ||
    (generation === 'custodied' &&
      (publication.content.schemaVersion !== 'afl-trade-publication/v4' ||
        schemaContent.schemaVersion !== 'afl-trade-projection-schema-bundle/v2')) ||
    !sameCanonicalJson(policyBinding, publication.content.projectionPresentationPolicy) ||
    !sameCanonicalJson(report.presentationPolicy, {
      schemaVersion: policyContent.schemaVersion,
      projectionPresentationPolicyId:
        policy.projectionPresentationPolicy.projectionPresentationPolicyId,
      artifactRef: policy.projectionPresentationPolicyArtifactRef,
    }) ||
    !sameCanonicalJson(report.publicEvidenceIndex, {
      schemaVersion: evidenceContent.schemaVersion,
      projectionPublicEvidenceIndexId:
        evidence.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId,
      artifactRef: evidence.projectionPublicEvidenceIndexArtifactRef,
    }) ||
    !sameCanonicalJson(report.schemaBundle, {
      schemaVersion: schemaContent.schemaVersion,
      projectionSchemaBundleId: schemaBundle.projectionSchemaBundle.projectionSchemaBundleId,
      artifactRef: schemaBundle.projectionSchemaBundleArtifactRef,
    }) ||
    !sameCanonicalJson(report.materialization, documentSet.projectionMaterialization) ||
    !sameCanonicalJson(report.documentSet, {
      schemaVersion: documentSet.schemaVersion,
      projectionDocumentSetId: documentSetResult.projectionDocumentSet.projectionDocumentSetId,
      artifactRef: documentSetResult.projectionDocumentSetArtifactRef,
      documentCount: documentSet.documentCount,
    }) ||
    report.publicationId !== publication.publicationId ||
    report.valuationOutputInventoryIndexId !==
      publication.content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId ||
    report.scopeKey !== publication.content.scopeKey ||
    report.valueUnitId !== publication.content.valueUnitId ||
    !sameCanonicalJson(evidenceBinding, {
      ...evidenceBinding,
      publicationId: publication.publicationId,
      valuationOutputInventoryIndexId:
        publication.content.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      scopeKey: publication.content.scopeKey,
      valueUnitId: publication.content.valueUnitId,
      entryCount: publication.content.entryCount,
    }) ||
    !sameCanonicalJson(documentSet.valuationOutputInventoryIndex, {
      ...publication.content.valuationOutputInventoryIndex,
    }) ||
    !sameCanonicalJson(schemaContent.supportedViews, publication.content.supportedViews) ||
    !sameCanonicalJson(documentSetBinding, {
      ...documentSetBinding,
      tradeCount: publication.content.entryCount,
      documentCount: report.checkedDocumentCount,
    })
  ) {
    throw materializationError('PROJECTION_CHAIN_MISMATCH');
  }
  if (generation === 'custodied') {
    if (custodyVerification === undefined) {
      throw materializationError('INVALID_CUSTODY_INDEX_VERIFICATION');
    }
    const custodyResult = custodyVerification.output;
    const custody = custodyResult.valuationOutputCustodyIndex.content;
    const binding = {
      schemaVersion: custody.schemaVersion,
      valuationOutputCustodyIndexId:
        custodyResult.valuationOutputCustodyIndex.valuationOutputCustodyIndexId,
      artifactRef: custodyResult.artifactRef,
      environment: custody.environment,
      valuationBundleId: custody.valuationBundleId,
      valuationOutputInventoryIndexId:
        custody.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      inventorySetSha256: custody.valuationOutputInventoryIndex.inventorySetSha256,
      scopeKey: custody.scopeKey,
      valueUnitId: custody.valueUnitId,
      entryCount: custody.entryCount,
      custodyReceiptSetSha256: custody.custodyReceiptSetSha256,
    };
    if (
      publication.content.schemaVersion !== 'afl-trade-publication/v4' ||
      !sameCanonicalJson(binding, publication.content.valuationOutputCustodyIndex)
    ) {
      throw materializationError('PROJECTION_CHAIN_MISMATCH');
    }
  }
}

function createManifestContent(
  buildJobId: string,
  freshness: AflTradeFreshnessPolicyResult,
  parityVerification: AflTradeProjectionParityVerifyInput,
  generation: 'legacy' | 'custodied'
) {
  const publication = parityVerification.projectionDocumentSetVerification.publicationManifest;
  const publicationContent = publication.content;
  const policy = parityVerification.projectionPresentationPolicy;
  const policyContent = policy.projectionPresentationPolicy.content;
  const evidence = parityVerification.projectionPublicEvidenceIndex;
  const evidenceContent = evidence.projectionPublicEvidenceIndex.content;
  const schemaBundle = parityVerification.projectionSchemaBundle;
  const schemaContent = schemaBundle.projectionSchemaBundle.content;
  const documentSetResult = parityVerification.projectionDocumentSetVerification.output;
  const documentSetContent = documentSetResult.projectionDocumentSet.content;
  const parityResult = parityVerification.output;
  const parityContent = parityResult.projectionParityReport.content;

  const common = {
    environment: publicationContent.environment,
    scopeKey: publicationContent.scopeKey,
    createdAt: parityContent.checkedAt,
    publicationId: publication.publicationId,
    buildJobId,
    publicAssetBoundary: publicationContent.publicAssetBoundary,
    responseContractVersion: schemaContent.responseContractVersion,
    valuationExportContractVersion: schemaContent.valuationExportContractVersion,
    valueUnitId: publicationContent.valueUnitId,
    supportedViews: publicationContent.supportedViews,
    documentCount: documentSetContent.documentCount,
    valuationOutputInventoryIndex: publicationContent.valuationOutputInventoryIndex,
    freshnessPolicy: {
      schemaVersion: freshness.freshnessPolicy.content.schemaVersion,
      freshnessPolicyId: freshness.freshnessPolicy.freshnessPolicyId,
      artifactRef: freshness.freshnessPolicyArtifactRef,
    },
    projectionPresentationPolicy: {
      schemaVersion: policyContent.schemaVersion,
      projectionPresentationPolicyId:
        policy.projectionPresentationPolicy.projectionPresentationPolicyId,
      artifactRef: policy.projectionPresentationPolicyArtifactRef,
      valueUnitId: policyContent.valueUnit.id,
      universalLayer: policyContent.universalLayer,
      supportedViews: policyContent.supportedViews,
    },
    projectionPublicEvidenceIndex: {
      schemaVersion: evidenceContent.schemaVersion,
      projectionPublicEvidenceIndexId:
        evidence.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId,
      artifactRef: evidence.projectionPublicEvidenceIndexArtifactRef,
      publicationId: evidenceContent.publication.publicationId,
      valuationOutputInventoryIndexId:
        evidenceContent.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      scopeKey: evidenceContent.scopeKey,
      valueUnitId: evidenceContent.valueUnitId,
      indexedEvidenceSchemaVersion: evidenceContent.indexedEvidenceSchemaVersion,
      entryCount: evidenceContent.entryCount,
      evidenceBindingSetSha256: evidenceContent.evidenceBindingSetSha256,
    },
    projectionMaterialization: documentSetContent.projectionMaterialization,
    projectionDocumentSet: {
      schemaVersion: documentSetContent.schemaVersion,
      projectionDocumentSetId: documentSetResult.projectionDocumentSet.projectionDocumentSetId,
      artifactRef: documentSetResult.projectionDocumentSetArtifactRef,
      tradeCount: documentSetContent.tradeCount,
      documentCount: documentSetContent.documentCount,
    },
    projectionSchemaBundle: {
      schemaVersion: schemaContent.schemaVersion,
      projectionSchemaBundleId: schemaBundle.projectionSchemaBundle.projectionSchemaBundleId,
      artifactRef: schemaBundle.projectionSchemaBundleArtifactRef,
      responseContractVersion: schemaContent.responseContractVersion,
      valuationExportContractVersion: schemaContent.valuationExportContractVersion,
      ...(schemaContent.schemaVersion === 'afl-trade-projection-schema-bundle/v2'
        ? {
            publicationManifestSchemaVersion: schemaContent.publicationManifestSchemaVersion,
            projectionManifestSchemaVersion: schemaContent.projectionManifestSchemaVersion,
          }
        : {}),
    },
    parityReport: {
      schemaVersion: parityContent.schemaVersion,
      projectionParityReportId: parityResult.projectionParityReport.projectionParityReportId,
      artifactRef: parityResult.projectionParityReportArtifactRef,
      status: parityContent.status,
      checkCount: parityContent.checkCount,
      failureCount: parityContent.failureCount,
      checkedDocumentCount: parityContent.checkedDocumentCount,
    },
  };
  if (generation === 'custodied') {
    if (publicationContent.schemaVersion !== 'afl-trade-publication/v4') {
      throw materializationError('PROJECTION_CHAIN_MISMATCH');
    }
    return {
      ...common,
      schemaVersion: 'afl-trade-projection/v3' as const,
      valuationOutputCustodyIndex: publicationContent.valuationOutputCustodyIndex,
    };
  }
  return { ...common, schemaVersion: 'afl-trade-projection/v2' as const };
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

interface AdmissionBudget {
  byteLength: number;
  nodeCount: number;
}

function chargeAdmissionBytes(
  budget: AdmissionBudget,
  byteLength: number,
  code: AflTradeProjectionManifestMaterializationErrorCode
): void {
  budget.byteLength += byteLength;
  if (
    !Number.isSafeInteger(budget.byteLength) ||
    budget.byteLength > AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_INPUT_BYTES
  ) {
    throw materializationError(code);
  }
}

function chargeJsonString(
  budget: AdmissionBudget,
  value: string,
  code: AflTradeProjectionManifestMaterializationErrorCode
): void {
  if (value.length > AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_INPUT_BYTES) {
    throw materializationError(code);
  }
  chargeAdmissionBytes(budget, Buffer.byteLength(JSON.stringify(value), 'utf8'), code);
}

function admitJsonValue(
  value: unknown,
  budget: AdmissionBudget,
  activeAncestors: WeakSet<object>,
  depth: number,
  code: AflTradeProjectionManifestMaterializationErrorCode
): unknown {
  budget.nodeCount += 1;
  if (
    !Number.isSafeInteger(budget.nodeCount) ||
    budget.nodeCount > AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_INPUT_NODES ||
    depth > AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_INPUT_DEPTH
  ) {
    throw materializationError(code);
  }
  if (value === null) {
    chargeAdmissionBytes(budget, 4, code);
    return null;
  }
  if (typeof value === 'boolean') {
    chargeAdmissionBytes(budget, value ? 4 : 5, code);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw materializationError(code);
    }
    chargeAdmissionBytes(budget, Buffer.byteLength(JSON.stringify(value), 'utf8'), code);
    return value;
  }
  if (typeof value === 'string') {
    chargeJsonString(budget, value, code);
    return value;
  }
  if (typeof value !== 'object' || nodeUtilTypes.isProxy(value)) {
    throw materializationError(code);
  }
  if (activeAncestors.has(value)) {
    throw materializationError(code);
  }

  activeAncestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw materializationError(code);
      }
      const keys = Reflect.ownKeys(value);
      const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
      const length = lengthDescriptor?.value;
      if (
        lengthDescriptor === undefined ||
        'get' in lengthDescriptor ||
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        keys.length !== length + 1 ||
        keys.some((key) => typeof key !== 'string')
      ) {
        throw materializationError(code);
      }
      chargeAdmissionBytes(budget, Math.max(2, length + 1), code);
      const clone: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
          throw materializationError(code);
        }
        clone.push(admitJsonValue(descriptor.value, budget, activeAncestors, depth + 1, code));
      }
      return clone;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw materializationError(code);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) {
      throw materializationError(code);
    }
    chargeAdmissionBytes(budget, Math.max(2, keys.length * 2 + 1), code);
    const clone = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
        throw materializationError(code);
      }
      chargeJsonString(budget, key, code);
      clone[key] = admitJsonValue(descriptor.value, budget, activeAncestors, depth + 1, code);
    }
    return clone;
  } finally {
    activeAncestors.delete(value);
  }
}

function admitEnvelope(
  value: unknown,
  code: AflTradeProjectionManifestMaterializationErrorCode
): unknown {
  const admitted = admitJsonValue(
    value,
    { byteLength: 0, nodeCount: 0 },
    new WeakSet<object>(),
    0,
    code
  );
  return deepFreeze(admitted);
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

const CREATE_INPUT_KEYS = [
  'buildJobId',
  'freshnessPolicyResult',
  'projectionParityVerification',
] as const;
const VERIFY_INPUT_KEYS = [...CREATE_INPUT_KEYS, 'output'] as const;
const CUSTODIED_CREATE_INPUT_KEYS = [...CREATE_INPUT_KEYS, 'custodyIndexVerification'] as const;
const CUSTODIED_VERIFY_INPUT_KEYS = [...CUSTODIED_CREATE_INPUT_KEYS, 'output'] as const;

type AdmittedCreateInput = Record<(typeof CREATE_INPUT_KEYS)[number], unknown>;
type AdmittedVerifyInput = Record<(typeof VERIFY_INPUT_KEYS)[number], unknown>;
type AdmittedCustodiedCreateInput = Record<(typeof CUSTODIED_CREATE_INPUT_KEYS)[number], unknown>;
type AdmittedCustodiedVerifyInput = Record<(typeof CUSTODIED_VERIFY_INPUT_KEYS)[number], unknown>;

function createFromAdmittedInput(
  snapshot: AdmittedCreateInput
): AflTradeProjectionManifestMaterializationResult {
  const buildJobId = parseOrThrow(
    aflTradePublicIdSchema,
    snapshot.buildJobId,
    'INVALID_BUILD_JOB_ID'
  );
  const freshness = authenticateFreshnessPolicy(snapshot.freshnessPolicyResult);
  if (!verifyAflTradeProjectionParityReport(snapshot.projectionParityVerification)) {
    throw materializationError('INVALID_PROJECTION_PARITY_VERIFICATION');
  }
  const parityVerification = parseOrThrow(
    aflTradeProjectionParityVerifyInputSchema,
    snapshot.projectionParityVerification,
    'INVALID_PROJECTION_PARITY_VERIFICATION'
  );
  assertPassingExactChain(parityVerification, freshness, 'legacy');

  const content = createManifestContent(buildJobId, freshness, parityVerification, 'legacy');
  const projectionManifest = aflTradeProjectionManifestV2Schema.safeParse({
    projectionId: createAflTradeContentAddress('projection', content),
    content,
  });
  if (!projectionManifest.success) {
    throw materializationError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  const projectionManifestArtifactRef = createAflTradeCanonicalJsonArtifactRef(
    projectionManifest.data,
    parityVerification.output.projectionParityReport.content.checkedAt
  );
  if (
    projectionManifestArtifactRef.byteLength < 1 ||
    projectionManifestArtifactRef.byteLength >
      AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_ARTIFACT_BYTES
  ) {
    throw materializationError('ARTIFACT_SIZE_LIMIT_EXCEEDED');
  }
  const result = aflTradeProjectionManifestMaterializationResultSchema.safeParse({
    projectionManifest: projectionManifest.data,
    projectionManifestArtifactRef,
  });
  if (!result.success) {
    throw materializationError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  return deepFreeze(result.data);
}

function createCustodiedFromAdmittedInput(
  snapshot: AdmittedCustodiedCreateInput
): AflTradeCustodiedProjectionManifestMaterializationResult {
  const buildJobId = parseOrThrow(
    aflTradePublicIdSchema,
    snapshot.buildJobId,
    'INVALID_BUILD_JOB_ID'
  );
  const freshness = authenticateFreshnessPolicy(snapshot.freshnessPolicyResult);
  const custody = authenticateCustodyIndex(snapshot.custodyIndexVerification);
  if (!verifyAflTradeProjectionParityReport(snapshot.projectionParityVerification)) {
    throw materializationError('INVALID_PROJECTION_PARITY_VERIFICATION');
  }
  const parityVerification = parseOrThrow(
    aflTradeProjectionParityVerifyInputSchema,
    snapshot.projectionParityVerification,
    'INVALID_PROJECTION_PARITY_VERIFICATION'
  );
  assertPassingExactChain(parityVerification, freshness, 'custodied', custody);
  const content = createManifestContent(buildJobId, freshness, parityVerification, 'custodied');
  const projectionManifest = aflTradeProjectionManifestV3Schema.safeParse({
    projectionId: createAflTradeContentAddress('projection', content),
    content,
  });
  if (!projectionManifest.success) {
    throw materializationError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  const projectionManifestArtifactRef = createAflTradeCanonicalJsonArtifactRef(
    projectionManifest.data,
    parityVerification.output.projectionParityReport.content.checkedAt
  );
  if (
    projectionManifestArtifactRef.byteLength < 1 ||
    projectionManifestArtifactRef.byteLength >
      AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_ARTIFACT_BYTES
  ) {
    throw materializationError('ARTIFACT_SIZE_LIMIT_EXCEEDED');
  }
  const result = aflTradeCustodiedProjectionManifestMaterializationResultSchema.safeParse({
    projectionManifest: projectionManifest.data,
    projectionManifestArtifactRef,
  });
  if (!result.success) {
    throw materializationError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
  return deepFreeze(result.data);
}

export function createAflTradeProjectionManifestMaterialization(
  unparsedInput: unknown
): AflTradeProjectionManifestMaterializationResult {
  try {
    const shallowSnapshot = snapshotExactEnvelope(unparsedInput, CREATE_INPUT_KEYS);
    if (shallowSnapshot === null) throw materializationError('INVALID_INPUT_ENVELOPE');
    parseOrThrow(aflTradePublicIdSchema, shallowSnapshot.buildJobId, 'INVALID_BUILD_JOB_ID');
    const admitted = admitEnvelope(
      shallowSnapshot,
      'INVALID_INPUT_ENVELOPE'
    ) as AdmittedCreateInput;
    return createFromAdmittedInput(admitted);
  } catch (error) {
    if (isAflTradeProjectionManifestMaterializationError(error)) throw error;
    throw materializationError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

export function createAflTradeCustodiedProjectionManifestMaterialization(
  unparsedInput: unknown
): AflTradeCustodiedProjectionManifestMaterializationResult {
  try {
    const shallowSnapshot = snapshotExactEnvelope(unparsedInput, CUSTODIED_CREATE_INPUT_KEYS);
    if (shallowSnapshot === null) throw materializationError('INVALID_INPUT_ENVELOPE');
    parseOrThrow(aflTradePublicIdSchema, shallowSnapshot.buildJobId, 'INVALID_BUILD_JOB_ID');
    const admitted = admitEnvelope(
      shallowSnapshot,
      'INVALID_INPUT_ENVELOPE'
    ) as AdmittedCustodiedCreateInput;
    return createCustodiedFromAdmittedInput(admitted);
  } catch (error) {
    if (isAflTradeProjectionManifestMaterializationError(error)) throw error;
    throw materializationError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

export function authenticateAflTradeProjectionManifestMaterialization(
  input: unknown
): AflTradeProjectionManifestMaterializationResult | null {
  return authenticateAflTradeProjectionManifestMaterializationVerification(input)?.output ?? null;
}

export interface AflTradeProjectionManifestMaterializationAuthentication {
  verification: AflTradeProjectionManifestMaterializationVerifyInput;
  output: AflTradeProjectionManifestMaterializationResult;
}

export function authenticateAflTradeProjectionManifestMaterializationVerification(
  input: unknown
): AflTradeProjectionManifestMaterializationAuthentication | null {
  try {
    const shallowSnapshot = snapshotExactEnvelope(input, VERIFY_INPUT_KEYS);
    if (shallowSnapshot === null) return null;
    const snapshot = admitEnvelope(
      shallowSnapshot,
      'INVALID_INPUT_ENVELOPE'
    ) as AdmittedVerifyInput;
    const verification =
      aflTradeProjectionManifestMaterializationVerifyInputSchema.safeParse(snapshot);
    if (!verification.success) return null;
    const replayed = createFromAdmittedInput({
      buildJobId: verification.data.buildJobId,
      freshnessPolicyResult: verification.data.freshnessPolicyResult,
      projectionParityVerification: verification.data.projectionParityVerification,
    });
    if (!sameCanonicalJson(replayed, verification.data.output)) return null;
    return deepFreeze({ verification: verification.data, output: replayed });
  } catch {
    return null;
  }
}

export function verifyAflTradeProjectionManifestMaterialization(input: unknown): boolean {
  return authenticateAflTradeProjectionManifestMaterialization(input) !== null;
}

export function authenticateAflTradeCustodiedProjectionManifestMaterialization(
  input: unknown
): AflTradeCustodiedProjectionManifestMaterializationResult | null {
  try {
    const shallowSnapshot = snapshotExactEnvelope(input, CUSTODIED_VERIFY_INPUT_KEYS);
    if (shallowSnapshot === null) return null;
    const snapshot = admitEnvelope(
      shallowSnapshot,
      'INVALID_INPUT_ENVELOPE'
    ) as AdmittedCustodiedVerifyInput;
    const verification =
      aflTradeCustodiedProjectionManifestMaterializationVerifyInputSchema.safeParse(snapshot);
    if (!verification.success) return null;
    const replayed = createCustodiedFromAdmittedInput({
      buildJobId: verification.data.buildJobId,
      freshnessPolicyResult: verification.data.freshnessPolicyResult,
      projectionParityVerification: verification.data.projectionParityVerification,
      custodyIndexVerification: verification.data.custodyIndexVerification,
    });
    return sameCanonicalJson(replayed, verification.data.output) ? replayed : null;
  } catch {
    return null;
  }
}

export function verifyAflTradeCustodiedProjectionManifestMaterialization(input: unknown): boolean {
  return authenticateAflTradeCustodiedProjectionManifestMaterialization(input) !== null;
}

export type { AflTradeProjectionManifestV2, AflTradeProjectionManifestV3 };
