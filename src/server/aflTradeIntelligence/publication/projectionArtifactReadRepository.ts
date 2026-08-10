import { Buffer } from 'node:buffer';
import { types as nodeUtilTypes } from 'node:util';

import { z } from 'zod';

import type { AflTradeValuationView } from '@/types/aflTradeIntelligence';
import {
  AFL_TRADE_METHODOLOGY_HREF,
  AFL_TRADE_VALUATION_VIEWS,
  aflTradePublicationRefSchema,
  aflTradePublicIdSchema,
  aflTradeValuationViewSchema,
} from '@/types/aflTradeIntelligence';

import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import type {
  AflTradeProjectionDetailDocumentContent,
  AflTradeProjectionExportRowDocumentContent,
  AflTradeProjectionMethodologyDocumentContent,
  AflTradeProjectionSummaryDocumentContent,
} from './projectionDocumentContracts';
import {
  aflTradeFreshnessFailedCandidateSchema,
  evaluateAflTradePublicationFreshness,
  verifyAflTradeFreshnessPolicy,
  type AflTradeFreshnessClock,
  type AflTradeFreshnessFailedCandidate,
  type AflTradeFreshnessPolicyResult,
} from './freshnessPolicy';
import type {
  AflTradeMethodologyProjection,
  AflTradeMethodologyProjectionRepository,
} from './methodologyReadService';
import {
  AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_INPUT_BYTES,
  type AflTradeProjectionManifestV2,
  type AflTradeProjectionManifestV3,
} from './projectionManifestMaterialization';
import {
  authenticateAflTradeProjectionReleaseArtifact,
  type AflTradeProjectionReleaseVerification,
} from './projectionReleaseArtifact';
import type { AflTradePublicationReadSelection } from './publicationReadContracts';
import type {
  AflTradeProjectionDetail,
  AflTradeProjectionListPage,
  AflTradeProjectionReadMetadata,
  AflTradeValueProjectionRepository,
} from './valueReadService';

/**
 * The authenticated release repeats expected and stored document graphs inside independently
 * bounded verification envelopes. The source must enforce the same 128 MiB admission limit before
 * returning bytes, and the adapter checks it again before UTF-8 decoding and JSON parsing.
 */
export const AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES =
  AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_INPUT_BYTES;
export const AFL_TRADE_PROJECTION_ARTIFACT_READ_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;
export const AFL_TRADE_PROJECTION_ARTIFACT_READ_SELECTION =
  'exact_registry_captured_projection_only_no_latest_alias_v1' as const;
export const AFL_TRADE_PROJECTION_ARTIFACT_READ_RUNTIME_FALLBACK = 'prohibited' as const;
export const AFL_TRADE_PROJECTION_ARTIFACT_READ_CLOCK_POLICY =
  'monotonic_high_water_mark_no_expiry_reactivation_v1' as const;
export const AFL_TRADE_PROJECTION_ARTIFACT_READ_FAILED_CANDIDATE_BINDING =
  'provider_receives_exact_selection_candidate_must_start_after_active_publication_v1' as const;
export const AFL_TRADE_PROJECTION_ARTIFACT_READ_LIMITATION =
  'This immutable adapter reads one exact authenticated public projection release. It does not activate or select publications, resolve latest aliases, fall back to another projection, mutate durable state, authorize fantasy state, or establish user or fantasy ownership of source-native AFL assets.' as const;

export interface AflTradeProjectionArtifactReleaseSource {
  loadRelease(
    projectionId: string,
    limit: Readonly<{ maxBytes: typeof AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES }>
  ): Promise<string | Uint8Array | null>;
}

export interface AflTradeProjectionFailedCandidateProvider {
  capture(
    selection: AflTradePublicationReadSelection
  ): Promise<AflTradeFreshnessFailedCandidate | null>;
}

export interface AflTradeProjectionFreshnessHighWaterStore {
  advance(projectionId: string, evaluatedAt: string): Promise<void>;
}

export type AflTradeValuationProjectionExportRow =
  AflTradeProjectionExportRowDocumentContent['exportRow'];

export interface AflTradeValuationProjectionExportRequest {
  tradeIds: readonly string[];
  requestedViews: readonly AflTradeValuationView[];
}

export interface AflTradeValuationProjectionExport {
  metadata: AflTradeProjectionReadMetadata;
  rows: readonly AflTradeValuationProjectionExportRow[];
}

export interface AflTradeValuationProjectionExportRepository {
  exportRows(
    selection: AflTradePublicationReadSelection,
    request: AflTradeValuationProjectionExportRequest
  ): Promise<AflTradeValuationProjectionExport>;
}

export interface AflTradeProjectionArtifactReadRepository
  extends
    AflTradeValueProjectionRepository,
    AflTradeMethodologyProjectionRepository,
    AflTradeValuationProjectionExportRepository {}

export const AFL_TRADE_PROJECTION_ARTIFACT_MOUNT_ERROR_CODES = Object.freeze([
  'INVALID_PROJECTION_ID',
  'RELEASE_READ_FAILED',
  'RELEASE_NOT_FOUND',
  'INVALID_RELEASE_TYPE',
  'RELEASE_SIZE_LIMIT_EXCEEDED',
  'INVALID_RELEASE_ENCODING',
  'INVALID_RELEASE_JSON',
  'RELEASE_AUTHENTICATION_FAILED',
  'PROJECTION_ID_MISMATCH',
  'RELEASE_CHAIN_MISMATCH',
  'INCOMPLETE_DOCUMENT_INDEX',
] as const);

export type AflTradeProjectionArtifactMountErrorCode =
  (typeof AFL_TRADE_PROJECTION_ARTIFACT_MOUNT_ERROR_CODES)[number];

const MOUNT_ERROR_MESSAGES: Readonly<Record<AflTradeProjectionArtifactMountErrorCode, string>> =
  Object.freeze({
    INVALID_PROJECTION_ID: 'The requested AFL trade projection identifier is invalid.',
    RELEASE_READ_FAILED: 'The exact AFL trade projection release could not be read.',
    RELEASE_NOT_FOUND: 'The exact AFL trade projection release was not found.',
    INVALID_RELEASE_TYPE: 'The AFL trade projection release has an invalid runtime type.',
    RELEASE_SIZE_LIMIT_EXCEEDED: 'The AFL trade projection release exceeds its read byte limit.',
    INVALID_RELEASE_ENCODING: 'The AFL trade projection release is not valid UTF-8.',
    INVALID_RELEASE_JSON: 'The AFL trade projection release is not valid JSON.',
    RELEASE_AUTHENTICATION_FAILED:
      'The AFL trade projection release failed complete materialization authentication.',
    PROJECTION_ID_MISMATCH:
      'The authenticated AFL trade projection does not match the exact requested identifier.',
    RELEASE_CHAIN_MISMATCH:
      'The authenticated AFL trade projection release does not form one exact publication chain.',
    INCOMPLETE_DOCUMENT_INDEX:
      'The authenticated AFL trade projection release has an incomplete document lattice.',
  });

const TRUSTED_MOUNT_ERRORS = new WeakSet<object>();

export class AflTradeProjectionArtifactMountError extends Error {
  readonly code: AflTradeProjectionArtifactMountErrorCode;

  constructor(code: AflTradeProjectionArtifactMountErrorCode) {
    super(MOUNT_ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionArtifactMountError';
    this.code = code;
    TRUSTED_MOUNT_ERRORS.add(this);
    Object.freeze(this);
  }
}

export function isAflTradeProjectionArtifactMountError(
  value: unknown
): value is AflTradeProjectionArtifactMountError {
  return value !== null && typeof value === 'object' && TRUSTED_MOUNT_ERRORS.has(value);
}

export const AFL_TRADE_PROJECTION_ARTIFACT_READ_ERROR_CODES = Object.freeze([
  'INVALID_READ_REQUEST',
  'SELECTION_MISMATCH',
  'TRADE_NOT_IN_PROJECTION',
  'FAILED_CANDIDATE_READ_FAILED',
  'FRESHNESS_EVALUATION_FAILED',
  'PROJECTION_NOT_SERVABLE',
  'INTERNAL_CONTRACT_VIOLATION',
] as const);

export type AflTradeProjectionArtifactReadErrorCode =
  (typeof AFL_TRADE_PROJECTION_ARTIFACT_READ_ERROR_CODES)[number];

const READ_ERROR_MESSAGES: Readonly<Record<AflTradeProjectionArtifactReadErrorCode, string>> =
  Object.freeze({
    INVALID_READ_REQUEST: 'The AFL trade projection read request is invalid.',
    SELECTION_MISMATCH:
      'The captured publication selection does not match the mounted AFL trade projection.',
    TRADE_NOT_IN_PROJECTION:
      'A requested trade is not present in the mounted AFL trade projection.',
    FAILED_CANDIDATE_READ_FAILED: 'Freshness candidate-failure state could not be captured.',
    FRESHNESS_EVALUATION_FAILED:
      'The mounted AFL trade projection freshness could not be evaluated.',
    PROJECTION_NOT_SERVABLE: 'The mounted AFL trade projection is expired or unavailable.',
    INTERNAL_CONTRACT_VIOLATION: 'The mounted AFL trade projection violated its read contract.',
  });

const TRUSTED_READ_ERRORS = new WeakSet<object>();

export class AflTradeProjectionArtifactReadError extends Error {
  readonly code: AflTradeProjectionArtifactReadErrorCode;

  constructor(code: AflTradeProjectionArtifactReadErrorCode) {
    super(READ_ERROR_MESSAGES[code]);
    this.name = 'AflTradeProjectionArtifactReadError';
    this.code = code;
    TRUSTED_READ_ERRORS.add(this);
    Object.freeze(this);
  }
}

export function isAflTradeProjectionArtifactReadError(
  value: unknown
): value is AflTradeProjectionArtifactReadError {
  return value !== null && typeof value === 'object' && TRUSTED_READ_ERRORS.has(value);
}

const selectionSchema = z
  .object({
    publication: aflTradePublicationRefSchema,
    projectionBuildId: aflTradeContentAddressedIdSchema('projection'),
    registryRevision: z.number().int().positive(),
    scopeKey: aflTradePublicIdSchema,
    supportedViews: z.array(aflTradeValuationViewSchema).min(1),
    supportedCohorts: z.array(aflTradePublicIdSchema),
    excludedCohorts: z.array(aflTradePublicIdSchema),
  })
  .strict();

const listRequestSchema = z
  .object({
    scopeKey: aflTradePublicIdSchema,
    requestedView: aflTradeValuationViewSchema,
    tradeIds: z.array(aflTradePublicIdSchema).min(1).max(100),
    limit: z.number().int().min(1).max(100),
    cursor: z.string().trim().min(1).max(1000).nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      new Set(request.tradeIds).size !== request.tradeIds.length ||
      request.tradeIds.length > request.limit ||
      request.cursor !== null
    ) {
      context.addIssue({ code: 'custom', path: ['tradeIds'], message: 'Invalid explicit page.' });
    }
  });

const detailRequestSchema = z
  .object({
    scopeKey: aflTradePublicIdSchema,
    tradeId: aflTradePublicIdSchema,
    requestedViews: z
      .array(aflTradeValuationViewSchema)
      .min(1)
      .max(AFL_TRADE_VALUATION_VIEWS.length),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.requestedViews).size !== request.requestedViews.length) {
      context.addIssue({
        code: 'custom',
        path: ['requestedViews'],
        message: 'Requested views must be unique.',
      });
    }
  });

const exportRequestSchema = z
  .object({
    tradeIds: z.array(aflTradePublicIdSchema).min(1).max(100),
    requestedViews: z
      .array(aflTradeValuationViewSchema)
      .min(1)
      .max(AFL_TRADE_VALUATION_VIEWS.length),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.tradeIds).size !== request.tradeIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['tradeIds'],
        message: 'Trade IDs must be unique.',
      });
    }
    if (new Set(request.requestedViews).size !== request.requestedViews.length) {
      context.addIssue({
        code: 'custom',
        path: ['requestedViews'],
        message: 'Requested views must be unique.',
      });
    }
  });

type SummaryByView = ReadonlyMap<AflTradeValuationView, AflTradeProjectionSummaryDocumentContent>;
type ExportRowsByView = ReadonlyMap<
  AflTradeValuationView,
  readonly AflTradeValuationProjectionExportRow[]
>;

interface MountedProjection {
  projectionManifest: AflTradeProjectionManifestV2 | AflTradeProjectionManifestV3;
  publicationManifest: AflTradeProjectionReleaseVerification['projectionParityVerification']['projectionDocumentSetVerification']['publicationManifest'];
  freshnessPolicyResult: AflTradeFreshnessPolicyResult;
  calculationAsOf: string;
  knowledgeCutoffAt: string;
  tradeIds: readonly string[];
  summariesByTrade: ReadonlyMap<string, SummaryByView>;
  detailsByTrade: ReadonlyMap<string, AflTradeProjectionDetailDocumentContent>;
  exportRowsByTrade: ReadonlyMap<string, ExportRowsByView>;
  methodology: AflTradeProjectionMethodologyDocumentContent;
}

function mountError(code: AflTradeProjectionArtifactMountErrorCode) {
  return new AflTradeProjectionArtifactMountError(code);
}

function readError(code: AflTradeProjectionArtifactReadErrorCode) {
  return new AflTradeProjectionArtifactReadError(code);
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const member of Reflect.ownKeys(value)) {
    deepFreeze(Reflect.get(value, member, value));
  }
  return Object.freeze(value);
}

function decodeRelease(raw: string | Uint8Array): string {
  const byteLength = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.byteLength;
  if (byteLength > AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES) {
    throw mountError('RELEASE_SIZE_LIMIT_EXCEEDED');
  }
  if (typeof raw === 'string') return raw;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw mountError('INVALID_RELEASE_ENCODING');
  }
}

function parseReleaseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw mountError('INVALID_RELEASE_JSON');
  }
}

function assertExactReleaseChain(
  release: AflTradeProjectionReleaseVerification,
  projectionManifest: AflTradeProjectionManifestV2 | AflTradeProjectionManifestV3
): void {
  const documentSetVerification =
    release.projectionParityVerification.projectionDocumentSetVerification;
  const publication = documentSetVerification.publicationManifest;
  const publicationContent = publication.content;
  const projection = projectionManifest.content;
  const root = documentSetVerification.output.projectionDocumentSet.content;
  const inventory = documentSetVerification.valuationOutputInventoryIndex.content;
  const freshness = release.freshnessPolicyResult;
  const freshnessContent = freshness.freshnessPolicy.content;

  if (
    publicationContent.publicAssetBoundary !==
      AFL_TRADE_PROJECTION_ARTIFACT_READ_PUBLIC_ASSET_BOUNDARY ||
    projection.publicAssetBoundary !== AFL_TRADE_PROJECTION_ARTIFACT_READ_PUBLIC_ASSET_BOUNDARY ||
    root.publicAssetBoundary !== AFL_TRADE_PROJECTION_ARTIFACT_READ_PUBLIC_ASSET_BOUNDARY ||
    inventory.publicAssetBoundary !== AFL_TRADE_PROJECTION_ARTIFACT_READ_PUBLIC_ASSET_BOUNDARY ||
    freshnessContent.publicAssetBoundary !==
      AFL_TRADE_PROJECTION_ARTIFACT_READ_PUBLIC_ASSET_BOUNDARY ||
    publication.publicationId !== projection.publicationId ||
    publication.publicationId !== root.publicationId ||
    publicationContent.valuationBundleId !== root.valuationBundleId ||
    publicationContent.valuationBundleId !== inventory.valuationBundle.valuationBundleId ||
    publicationContent.scopeKey !== projection.scopeKey ||
    publicationContent.scopeKey !== root.scopeKey ||
    publicationContent.scopeKey !== inventory.scopeKey ||
    publicationContent.scopeKey !== freshnessContent.scopeKey ||
    publicationContent.valueUnitId !== projection.valueUnitId ||
    publicationContent.valueUnitId !== root.valueUnitId ||
    publicationContent.valueUnitId !== inventory.valueUnitId ||
    publicationContent.valueUnitId !== freshnessContent.valueUnitId ||
    !sameOrderedValues(publicationContent.supportedViews, projection.supportedViews) ||
    !sameCanonicalJson(publicationContent.freshnessPolicy, projection.freshnessPolicy) ||
    !sameCanonicalJson(publicationContent.freshnessPolicy, {
      schemaVersion: freshnessContent.schemaVersion,
      freshnessPolicyId: freshness.freshnessPolicy.freshnessPolicyId,
      artifactRef: freshness.freshnessPolicyArtifactRef,
    }) ||
    !sameCanonicalJson(root.projectionMaterialization, projection.projectionMaterialization) ||
    !sameCanonicalJson(
      root.valuationOutputInventoryIndex,
      projection.valuationOutputInventoryIndex
    ) ||
    root.documentCount !== projection.documentCount ||
    root.tradeCount !== inventory.entryCount
  ) {
    throw mountError('RELEASE_CHAIN_MISMATCH');
  }

  if (
    !verifyAflTradeFreshnessPolicy({
      scopeKey: freshnessContent.scopeKey,
      valueUnitId: freshnessContent.valueUnitId,
      currentDurationSeconds: freshnessContent.currentDurationSeconds,
      staleServeDurationSeconds: freshnessContent.staleServeDurationSeconds,
      createdAt: freshnessContent.createdAt,
      result: freshness,
    })
  ) {
    throw mountError('RELEASE_CHAIN_MISMATCH');
  }
}

function assertDocumentCoordinates(
  document:
    | AflTradeProjectionSummaryDocumentContent
    | AflTradeProjectionDetailDocumentContent
    | AflTradeProjectionMethodologyDocumentContent
    | AflTradeProjectionExportRowDocumentContent,
  mounted: Pick<
    MountedProjection,
    'projectionManifest' | 'publicationManifest' | 'calculationAsOf' | 'knowledgeCutoffAt'
  >
): void {
  const projection = mounted.projectionManifest.content;
  const publication = mounted.publicationManifest;
  if (
    document.publicAssetBoundary !== AFL_TRADE_PROJECTION_ARTIFACT_READ_PUBLIC_ASSET_BOUNDARY ||
    document.publicationId !== publication.publicationId ||
    document.valuationBundleId !== publication.content.valuationBundleId ||
    document.valuationOutputInventoryIndexId !==
      projection.valuationOutputInventoryIndex.valuationOutputInventoryIndexId ||
    document.scopeKey !== projection.scopeKey ||
    document.valueUnitId !== projection.valueUnitId ||
    document.calculationAsOf !== mounted.calculationAsOf ||
    document.knowledgeCutoffAt !== mounted.knowledgeCutoffAt
  ) {
    throw mountError('RELEASE_CHAIN_MISMATCH');
  }
}

function buildMountedProjection(
  release: AflTradeProjectionReleaseVerification,
  projectionManifest: AflTradeProjectionManifestV2 | AflTradeProjectionManifestV3
): MountedProjection {
  assertExactReleaseChain(release, projectionManifest);
  const documentSetVerification =
    release.projectionParityVerification.projectionDocumentSetVerification;
  const publicationManifest = documentSetVerification.publicationManifest;
  const root = documentSetVerification.output.projectionDocumentSet.content;
  const materialization = root.projectionMaterialization;
  const tradeIds = documentSetVerification.valuationOutputInventoryIndex.content.entries.map(
    ({ tradeId }) => tradeId
  );
  const expectedTradeIds = new Set(tradeIds);
  const storedDocuments = release.projectionParityVerification.storedDocuments;
  const summariesByTrade = new Map<
    string,
    Map<AflTradeValuationView, AflTradeProjectionSummaryDocumentContent>
  >();
  const detailsByTrade = new Map<string, AflTradeProjectionDetailDocumentContent>();
  const exportRowsByTrade = new Map<
    string,
    Map<AflTradeValuationView, AflTradeValuationProjectionExportRow[]>
  >();
  let methodology: AflTradeProjectionMethodologyDocumentContent | null = null;
  const actualCounts = {
    tradeSummary: 0,
    tradeDetail: 0,
    methodology: 0,
    valuationExportRow: 0,
  };
  const partialMounted = {
    projectionManifest,
    publicationManifest,
    calculationAsOf: materialization.calculationAsOf,
    knowledgeCutoffAt: materialization.knowledgeCutoffAt,
  };

  if (
    storedDocuments.length !== root.documentCount ||
    storedDocuments.length !== projectionManifest.content.documentCount ||
    tradeIds.length !== root.tradeCount ||
    new Set(tradeIds).size !== tradeIds.length
  ) {
    throw mountError('INCOMPLETE_DOCUMENT_INDEX');
  }

  for (const artifact of storedDocuments) {
    const document = artifact.projectionDocument.content;
    assertDocumentCoordinates(document, partialMounted);
    if (document.kind === 'methodology') {
      actualCounts.methodology += 1;
      if (
        methodology !== null ||
        !sameCanonicalJson(document.projectionMaterialization, materialization)
      ) {
        throw mountError('INCOMPLETE_DOCUMENT_INDEX');
      }
      methodology = document;
      continue;
    }
    const tradeId =
      document.kind === 'valuation_export_row' ? document.exportRow.tradeId : document.tradeId;
    if (!expectedTradeIds.has(tradeId)) throw mountError('INCOMPLETE_DOCUMENT_INDEX');
    if (document.kind === 'trade_summary') {
      actualCounts.tradeSummary += 1;
      const byView = summariesByTrade.get(tradeId) ?? new Map();
      if (byView.has(document.view)) throw mountError('INCOMPLETE_DOCUMENT_INDEX');
      byView.set(document.view, document);
      summariesByTrade.set(tradeId, byView);
    } else if (document.kind === 'trade_detail') {
      actualCounts.tradeDetail += 1;
      if (detailsByTrade.has(tradeId)) throw mountError('INCOMPLETE_DOCUMENT_INDEX');
      detailsByTrade.set(tradeId, document);
    } else {
      actualCounts.valuationExportRow += 1;
      const byView =
        exportRowsByTrade.get(tradeId) ??
        new Map<AflTradeValuationView, AflTradeValuationProjectionExportRow[]>();
      const rows: AflTradeValuationProjectionExportRow[] =
        byView.get(document.exportRow.view) ?? [];
      if (rows.some((row) => row.rowOrdinal === document.exportRow.rowOrdinal)) {
        throw mountError('INCOMPLETE_DOCUMENT_INDEX');
      }
      rows.push(document.exportRow);
      byView.set(document.exportRow.view, rows);
      exportRowsByTrade.set(tradeId, byView);
    }
  }

  if (
    methodology === null ||
    !sameCanonicalJson(actualCounts, root.kindCounts) ||
    actualCounts.tradeSummary !== tradeIds.length * AFL_TRADE_VALUATION_VIEWS.length ||
    actualCounts.tradeDetail !== tradeIds.length ||
    actualCounts.methodology !== 1
  ) {
    throw mountError('INCOMPLETE_DOCUMENT_INDEX');
  }

  for (const tradeId of tradeIds) {
    const summaries = summariesByTrade.get(tradeId);
    const detail = detailsByTrade.get(tradeId);
    const exports = exportRowsByTrade.get(tradeId);
    if (summaries === undefined || detail === undefined || exports === undefined) {
      throw mountError('INCOMPLETE_DOCUMENT_INDEX');
    }
    for (const view of AFL_TRADE_VALUATION_VIEWS) {
      const summary = summaries.get(view);
      const rows = exports.get(view);
      const valuation = detail.valuations.find((candidate) => candidate.view === view);
      if (summary === undefined || rows === undefined || valuation === undefined) {
        throw mountError('INCOMPLETE_DOCUMENT_INDEX');
      }
      rows.sort((left, right) => left.rowOrdinal - right.rowOrdinal);
      const expectedRowCount = 'clubValues' in valuation ? valuation.clubValues.length : 1;
      if (
        rows.length !== expectedRowCount ||
        rows.some((row, ordinal) => row.rowOrdinal !== ordinal || row.view !== view) ||
        rows.some((row) => !sameCanonicalJson(row.valuation, summary.valuation))
      ) {
        throw mountError('INCOMPLETE_DOCUMENT_INDEX');
      }
    }
  }

  return deepFreeze({
    projectionManifest,
    publicationManifest,
    freshnessPolicyResult: release.freshnessPolicyResult,
    calculationAsOf: materialization.calculationAsOf,
    knowledgeCutoffAt: materialization.knowledgeCutoffAt,
    tradeIds,
    summariesByTrade,
    detailsByTrade,
    exportRowsByTrade,
    methodology,
  });
}

function snapshotSmallJson(
  value: unknown,
  code: AflTradeProjectionArtifactReadErrorCode,
  activeAncestors = new WeakSet<object>(),
  budget = { nodeCount: 0 },
  depth = 0
): unknown {
  budget.nodeCount += 1;
  if (budget.nodeCount > 512 || depth > 8) throw readError(code);
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== 'object' || nodeUtilTypes.isProxy(value) || activeAncestors.has(value)) {
    throw readError(code);
  }
  activeAncestors.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
      const length = lengthDescriptor?.value;
      const keys = Reflect.ownKeys(value);
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        lengthDescriptor === undefined ||
        'get' in lengthDescriptor ||
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        keys.length !== length + 1 ||
        keys.some((key) => typeof key !== 'string')
      ) {
        throw readError(code);
      }
      const clone: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
          throw readError(code);
        }
        clone.push(snapshotSmallJson(descriptor.value, code, activeAncestors, budget, depth + 1));
      }
      return clone;
    }
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      keys.some((key) => typeof key !== 'string')
    ) {
      throw readError(code);
    }
    const clone = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
        throw readError(code);
      }
      clone[key] = snapshotSmallJson(descriptor.value, code, activeAncestors, budget, depth + 1);
    }
    return clone;
  } finally {
    activeAncestors.delete(value);
  }
}

function parseReadRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    const parsed = schema.safeParse(snapshotSmallJson(value, 'INVALID_READ_REQUEST'));
    if (parsed.success) return parsed.data;
  } catch {
    // Admission and schema failures share the stable public read error below.
  }
  throw readError('INVALID_READ_REQUEST');
}

function validateSelection(
  mounted: MountedProjection,
  selection: AflTradePublicationReadSelection
): AflTradePublicationReadSelection {
  const publication = mounted.publicationManifest;
  const publicationContent = publication.content;
  const projection = mounted.projectionManifest;
  let parsedSelection: ReturnType<typeof selectionSchema.safeParse>;
  try {
    parsedSelection = selectionSchema.safeParse(snapshotSmallJson(selection, 'SELECTION_MISMATCH'));
  } catch {
    throw readError('SELECTION_MISMATCH');
  }
  if (!parsedSelection.success) {
    throw readError('SELECTION_MISMATCH');
  }
  const admitted = parsedSelection.data;
  if (
    admitted.publication.state !== 'published' ||
    admitted.projectionBuildId !== projection.projectionId ||
    admitted.publication.publicationId !== publication.publicationId ||
    admitted.publication.valuationBundleId !== publicationContent.valuationBundleId ||
    admitted.publication.valueUnitId !== publicationContent.valueUnitId ||
    admitted.scopeKey !== publicationContent.scopeKey ||
    !sameOrderedValues(admitted.supportedViews, publicationContent.supportedViews) ||
    !sameOrderedValues(admitted.supportedViews, projection.content.supportedViews) ||
    !sameOrderedValues(admitted.supportedCohorts, publicationContent.supportedCohorts) ||
    !sameOrderedValues(admitted.excludedCohorts, publicationContent.excludedCohorts) ||
    Date.parse(admitted.publication.publishedAt) < Date.parse(projection.content.createdAt)
  ) {
    throw readError('SELECTION_MISMATCH');
  }
  return deepFreeze(admitted);
}

async function evaluateMetadata(
  mounted: MountedProjection,
  selection: AflTradePublicationReadSelection,
  runtime: {
    clock: AflTradeFreshnessClock;
    failedCandidateProvider: AflTradeProjectionFailedCandidateProvider | undefined;
    highWaterStore: AflTradeProjectionFreshnessHighWaterStore | undefined;
    projectionId: string;
    lastEvaluatedAtMs: number | null;
  }
): Promise<AflTradeProjectionReadMetadata> {
  const admittedSelection = validateSelection(mounted, selection);
  let failedCandidate: AflTradeFreshnessFailedCandidate | null = null;
  if (runtime.failedCandidateProvider) {
    try {
      failedCandidate = await runtime.failedCandidateProvider.capture(admittedSelection);
    } catch {
      throw readError('FAILED_CANDIDATE_READ_FAILED');
    }
  }
  if (failedCandidate !== null) {
    try {
      const parsedCandidate = aflTradeFreshnessFailedCandidateSchema.safeParse(
        snapshotSmallJson(failedCandidate, 'FRESHNESS_EVALUATION_FAILED')
      );
      if (!parsedCandidate.success) throw readError('FRESHNESS_EVALUATION_FAILED');
      failedCandidate = deepFreeze(parsedCandidate.data);
    } catch (error) {
      if (isAflTradeProjectionArtifactReadError(error)) throw error;
      throw readError('FRESHNESS_EVALUATION_FAILED');
    }
  }
  if (
    failedCandidate !== null &&
    Date.parse(failedCandidate.startedAt) < Date.parse(admittedSelection.publication.publishedAt)
  ) {
    throw readError('FRESHNESS_EVALUATION_FAILED');
  }
  let evaluatedAt: string;
  try {
    evaluatedAt = runtime.clock();
  } catch {
    throw readError('FRESHNESS_EVALUATION_FAILED');
  }
  const evaluatedAtMs = Date.parse(evaluatedAt);
  if (
    !Number.isFinite(evaluatedAtMs) ||
    (runtime.lastEvaluatedAtMs !== null && evaluatedAtMs < runtime.lastEvaluatedAtMs)
  ) {
    throw readError('FRESHNESS_EVALUATION_FAILED');
  }
  if (runtime.highWaterStore !== undefined) {
    try {
      await runtime.highWaterStore.advance(runtime.projectionId, evaluatedAt);
    } catch {
      throw readError('FRESHNESS_EVALUATION_FAILED');
    }
  }
  runtime.lastEvaluatedAtMs = evaluatedAtMs;
  try {
    const evaluation = evaluateAflTradePublicationFreshness({
      policyBinding: mounted.freshnessPolicyResult,
      activePriorPublication: {
        publication: admittedSelection.publication,
        projectionBuildId: admittedSelection.projectionBuildId,
        registryRevision: admittedSelection.registryRevision,
        scopeKey: admittedSelection.scopeKey,
        calculationAsOf: mounted.calculationAsOf,
      },
      failedCandidate,
      clock: () => evaluatedAt,
    });
    if (
      evaluation.servingDecision !== 'serve_active_prior' ||
      (evaluation.freshness !== 'current' && evaluation.freshness !== 'stale')
    ) {
      throw readError('PROJECTION_NOT_SERVABLE');
    }
    if (
      evaluation.activePublicationId !== admittedSelection.publication.publicationId ||
      evaluation.projectionBuildId !== admittedSelection.projectionBuildId ||
      evaluation.registryRevision !== admittedSelection.registryRevision ||
      evaluation.scopeKey !== admittedSelection.scopeKey ||
      evaluation.valueUnitId !== admittedSelection.publication.valueUnitId ||
      evaluation.calculationAsOf !== mounted.calculationAsOf
    ) {
      throw readError('INTERNAL_CONTRACT_VIOLATION');
    }
    return deepFreeze({
      publicationId: admittedSelection.publication.publicationId,
      projectionBuildId: admittedSelection.projectionBuildId,
      scopeKey: admittedSelection.scopeKey,
      calculationAsOf: mounted.calculationAsOf,
      knowledgeCutoffAt: mounted.knowledgeCutoffAt,
      freshness: evaluation.freshness,
      warnings: [...evaluation.warnings],
    });
  } catch (error) {
    if (isAflTradeProjectionArtifactReadError(error)) throw error;
    throw readError('FRESHNESS_EVALUATION_FAILED');
  }
}

function requireTrade<T>(map: ReadonlyMap<string, T>, tradeId: string): T {
  const value = map.get(tradeId);
  if (value === undefined) throw readError('TRADE_NOT_IN_PROJECTION');
  return value;
}

export async function createAflTradeProjectionArtifactReadRepository(input: {
  projectionId: unknown;
  releaseSource: AflTradeProjectionArtifactReleaseSource;
  failedCandidateProvider?: AflTradeProjectionFailedCandidateProvider;
  freshnessHighWaterStore?: AflTradeProjectionFreshnessHighWaterStore;
  clock?: AflTradeFreshnessClock;
}): Promise<AflTradeProjectionArtifactReadRepository> {
  const releaseSource = input.releaseSource;
  const failedCandidateProvider = input.failedCandidateProvider;
  const clock = input.clock ?? (() => new Date().toISOString());
  const projectionId = aflTradeContentAddressedIdSchema('projection').safeParse(input.projectionId);
  if (!projectionId.success) throw mountError('INVALID_PROJECTION_ID');
  let rawRelease: string | Uint8Array | null;
  try {
    rawRelease = await releaseSource.loadRelease(projectionId.data, {
      maxBytes: AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
    });
  } catch {
    throw mountError('RELEASE_READ_FAILED');
  }
  if (rawRelease === null) throw mountError('RELEASE_NOT_FOUND');
  if (typeof rawRelease !== 'string' && !(rawRelease instanceof Uint8Array)) {
    throw mountError('INVALID_RELEASE_TYPE');
  }
  const decodedRelease = parseReleaseJson(decodeRelease(rawRelease));
  const authenticated = authenticateAflTradeProjectionReleaseArtifact(decodedRelease);
  if (authenticated === null) throw mountError('RELEASE_AUTHENTICATION_FAILED');
  if (authenticated.output.projectionManifest.projectionId !== projectionId.data) {
    throw mountError('PROJECTION_ID_MISMATCH');
  }
  const mounted = buildMountedProjection(
    authenticated.verification,
    authenticated.output.projectionManifest
  );
  const freshnessRuntime = {
    clock,
    failedCandidateProvider,
    highWaterStore: input.freshnessHighWaterStore,
    projectionId: projectionId.data,
    lastEvaluatedAtMs: null as number | null,
  };

  const repository: AflTradeProjectionArtifactReadRepository = {
    async list(selection, request): Promise<AflTradeProjectionListPage> {
      const parsedRequest = parseReadRequest(listRequestSchema, request);
      if (parsedRequest.scopeKey !== mounted.projectionManifest.content.scopeKey) {
        throw readError('INVALID_READ_REQUEST');
      }
      const metadata = await evaluateMetadata(mounted, selection, freshnessRuntime);
      const items = parsedRequest.tradeIds.map((tradeId) => {
        const summary = requireTrade(mounted.summariesByTrade, tradeId).get(
          parsedRequest.requestedView
        );
        if (summary === undefined) throw readError('INTERNAL_CONTRACT_VIOLATION');
        return { tradeId, valuation: summary.valuation };
      });
      return deepFreeze({
        metadata,
        items,
        nextCursor: null,
        total: parsedRequest.tradeIds.length,
      });
    },

    async detail(selection, request): Promise<AflTradeProjectionDetail> {
      const parsedRequest = parseReadRequest(detailRequestSchema, request);
      if (parsedRequest.scopeKey !== mounted.projectionManifest.content.scopeKey) {
        throw readError('INVALID_READ_REQUEST');
      }
      const metadata = await evaluateMetadata(mounted, selection, freshnessRuntime);
      const detail = requireTrade(mounted.detailsByTrade, parsedRequest.tradeId);
      const byView = new Map(detail.valuations.map((valuation) => [valuation.view, valuation]));
      const valuations = parsedRequest.requestedViews.map((view) => {
        const valuation = byView.get(view);
        if (valuation === undefined) throw readError('INTERNAL_CONTRACT_VIOLATION');
        return valuation;
      });
      return deepFreeze({
        metadata,
        tradeId: parsedRequest.tradeId,
        valuations,
        assets: detail.assets,
        lineageSummary: detail.lineageSummary,
      });
    },

    async read(selection): Promise<AflTradeMethodologyProjection> {
      const metadata = await evaluateMetadata(mounted, selection, freshnessRuntime);
      return deepFreeze({
        metadata,
        methodologyHref: AFL_TRADE_METHODOLOGY_HREF,
        methodology: mounted.methodology.methodology,
      });
    },

    async exportRows(selection, request): Promise<AflTradeValuationProjectionExport> {
      const parsedRequest = parseReadRequest(exportRequestSchema, request);
      const metadata = await evaluateMetadata(mounted, selection, freshnessRuntime);
      const rows = parsedRequest.tradeIds.flatMap((tradeId) => {
        const byView = requireTrade(mounted.exportRowsByTrade, tradeId);
        return parsedRequest.requestedViews.flatMap((view) => {
          const viewRows = byView.get(view);
          if (viewRows === undefined) throw readError('INTERNAL_CONTRACT_VIOLATION');
          return viewRows;
        });
      });
      return deepFreeze({ metadata, rows });
    },
  };
  return Object.freeze(repository);
}
