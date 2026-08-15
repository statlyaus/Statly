import {
  createAflTradeByteArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  verifyAflTradeArtifactReadback,
  type AflTradeArtifactReadbackReceipt,
  type AflTradeImmutableArtifactRepository,
} from '../artifacts/immutableArtifactRepository';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  type AflTradeExternalEvidenceBatch,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import { requireAflTradeExternalEvidenceFieldAuthority } from './externalDraftTradeFieldManifest';
import { aflTradeGate0AReceiptSchema } from './gate0aReceipt';
import { aflTradeSourceRightsProposalSchema } from './sourceRights';
import { z } from 'zod';

type ExternalProvider = AflTradeExternalEvidenceContent['provider'];
export type AflTradeExternalDraftPathway =
  'national' | 'rookie' | 'pre_season' | 'mid_season' | null;

export const AFL_TRADE_EXTERNAL_CAPTURE_EXECUTION_SCHEMA_VERSION =
  'afl-trade-external-capture-execution/v2' as const;

const legacyExecutionReceiptContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-external-capture-execution/v1'),
    rightsArtifactId: aflTradeContentAddressedIdSchema('source-rights'),
    gateDecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    gateDecisionKey: z.string().trim().min(1).max(200),
    ledgerRevision: z.number().int().nonnegative(),
    evaluatedAt: z.iso.datetime({ offset: true }),
    provider: z.enum(['draftguru', 'footywire', 'official_afl']),
    capabilityId: z.string().trim().min(1).max(240),
    parserVersion: z.string().trim().min(1).max(160),
    fieldManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    upstreamRate: z
      .object({
        requests: z.number().int().positive(),
        perSeconds: z.number().int().positive(),
        burst: z.number().int().positive(),
      })
      .strict(),
    cacheSeconds: z.number().int().positive(),
    rawRetentionDays: z.number().int().positive(),
    egressPolicyEvidenceId: aflTradeContentAddressedIdSchema('artifact'),
  })
  .strict();

const localFixtureExecutionReceiptContentSchema = z
  .object({
    schemaVersion: z.literal('statly-local-fixture-execution/v1'),
    environment: z.literal('test_fixture'),
    fixtureOnly: z.literal(true),
    liveSourceAccessed: z.literal(false),
    providerRightsExpanded: z.literal(false),
    rightsArtifactId: aflTradeContentAddressedIdSchema('source-rights'),
    gateDecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    gateDecisionKey: z.string().trim().min(1).max(200),
    ledgerRevision: z.number().int().nonnegative(),
    provider: z.literal('statly_local_fixture'),
    capabilityId: z.literal('statly-local-generated-fixture'),
    parserVersion: z.string().trim().min(1).max(160),
    fieldManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    fixtureEvidenceId: aflTradeContentAddressedIdSchema('artifact'),
  })
  .strict();

const executionRequestSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    provider: z.enum(['draftguru', 'footywire', 'official_afl']),
    competition: z.string().trim().min(1).max(40),
    anchorSeasonYear: z.number().int().min(1897).max(2200),
    discoveryFromSeasonYear: z.number().int().min(1988).max(2200).nullable().optional(),
    draftPathway: z.enum(['national', 'rookie', 'pre_season', 'mid_season']).nullable(),
    dataset: z.string().trim().min(1).max(160),
    datasetVersion: z.string().trim().min(1).max(160),
    accessMechanism: z.string().trim().min(1).max(160),
    capabilityId: z.string().trim().min(1).max(240),
    sourceUrl: z.string().url().startsWith('https://').max(2_048),
    capturedAt: z.iso.datetime({ offset: true }),
    effectiveAt: z.iso.datetime({ offset: true }),
    parserVersion: z.string().trim().min(1).max(160),
    fieldManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    maximumBytes: z
      .number()
      .int()
      .positive()
      .max(128 * 1024 * 1024),
  })
  .strict();

const executionReceiptContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_CAPTURE_EXECUTION_SCHEMA_VERSION),
    sourceRights: aflTradeSourceRightsProposalSchema,
    gate0aReceipt: aflTradeGate0AReceiptSchema,
    ledgerRevision: z.number().int().nonnegative(),
    request: executionRequestSchema,
    requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    admission: z
      .object({
        leaseId: aflTradeContentAddressedIdSchema('external-capture-lease'),
        leaseTokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
        leaseExpiresAt: z.iso.datetime({ offset: true }),
        startedAt: z.iso.datetime({ offset: true }),
        upstreamRate: z
          .object({
            requests: z.number().int().positive(),
            perSeconds: z.number().int().positive(),
            burst: z.number().int().positive(),
          })
          .strict(),
        cacheSeconds: z.number().int().positive(),
        rawRetentionDays: z.number().int().positive(),
        egressPolicyEvidenceId: aflTradeContentAddressedIdSchema('artifact'),
      })
      .strict(),
    outcome: z
      .object({
        status: z.enum(['captured', 'not_modified']),
        completedAt: z.iso.datetime({ offset: true }),
        sourceUrl: z.string().url().startsWith('https://').max(2_048),
        contentSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        observedArtifactId: aflTradeContentAddressedIdSchema('artifact'),
        priorCaptureId: aflTradeContentAddressedIdSchema('source-capture').nullable(),
        eTag: z.string().max(1_000).nullable(),
        lastModified: z.string().max(1_000).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.requestSha256 !== sha256AflTradeCanonicalJson(content.request)) {
      context.addIssue({
        code: 'custom',
        path: ['requestSha256'],
        message: 'Request digest mismatch.',
      });
    }
    if (
      content.sourceRights.rightsArtifactId !==
        content.gate0aReceipt.content.request.rightsArtifactId ||
      content.gate0aReceipt.content.result.status !== 'mechanically_eligible' ||
      content.outcome.sourceUrl !== content.request.sourceUrl ||
      Date.parse(content.admission.startedAt) > Date.parse(content.outcome.completedAt) ||
      Date.parse(content.outcome.completedAt) > Date.parse(content.admission.leaseExpiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Execution authority, request, lease and outcome must agree.',
      });
    }
    if (
      (content.outcome.status === 'captured' &&
        (content.outcome.contentSha256 === null ||
          content.outcome.observedArtifactId !== `artifact:${content.outcome.contentSha256}`)) ||
      (content.outcome.status === 'not_modified' &&
        (content.outcome.contentSha256 !== null || content.outcome.priorCaptureId === null))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Capture outcome shape is invalid.',
      });
    }
  });

const executionReceiptSchema = z
  .object({
    receiptId: aflTradeContentAddressedIdSchema('external-capture-execution'),
    content: z.union([
      legacyExecutionReceiptContentSchema,
      localFixtureExecutionReceiptContentSchema,
      executionReceiptContentSchema,
    ]),
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'external-capture-execution',
      receipt.receiptId,
      receipt.content,
      context,
      ['receiptId']
    );
  });

export type AflTradeExternalCaptureExecutionReceipt = z.infer<typeof executionReceiptSchema>;

export function parseAflTradeExternalCaptureExecutionReceipt(
  input: unknown
): AflTradeExternalCaptureExecutionReceipt {
  return executionReceiptSchema.parse(input);
}

export function createAflTradeExternalCaptureExecutionReceipt(
  content:
    | z.input<typeof legacyExecutionReceiptContentSchema>
    | z.input<typeof executionReceiptContentSchema>
): AflTradeExternalCaptureExecutionReceipt {
  const parsed = z
    .union([legacyExecutionReceiptContentSchema, executionReceiptContentSchema])
    .parse(content);
  return executionReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('external-capture-execution', parsed),
    content: parsed,
  });
}

export function createAflTradeLocalFixtureExecutionReceipt(
  content: z.input<typeof localFixtureExecutionReceiptContentSchema>
): AflTradeExternalCaptureExecutionReceipt {
  const parsed = localFixtureExecutionReceiptContentSchema.parse(content);
  return executionReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('external-capture-execution', parsed),
    content: parsed,
  });
}

interface ExternalHttpValidators {
  eTag: string | null;
  lastModified: string | null;
}

interface ExternalPageValidators extends ExternalHttpValidators {
  priorCaptureId: string;
  priorArtifactId: string;
}

interface ExternalPageCaptureBase extends ExternalHttpValidators {
  sourceUrl: string;
}

export type AflTradeExternalPageCapture =
  | (ExternalPageCaptureBase & { status: 'not_modified' })
  | (ExternalPageCaptureBase & {
      status: 'captured';
      bytes: Uint8Array;
      contentSha256: string;
      mediaType: string;
    });

export interface IngestAflTradeExternalPageRequest {
  environment: 'test_fixture' | 'non_production' | 'production';
  provider: ExternalProvider;
  competition: string;
  anchorSeasonYear: number;
  discoveryFromSeasonYear?: number | null;
  draftPathway: AflTradeExternalDraftPathway;
  dataset: string;
  datasetVersion: string;
  accessMechanism: string;
  capabilityId: string;
  sourceUrl: string;
  capturedAt: string;
  effectiveAt: string;
  parserVersion: string;
  fieldManifestSha256: string;
  maximumBytes: number;
}

const ingestionRequestSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    provider: z.enum([
      'draftguru',
      'footywire',
      'official_afl',
      'fitzroy_official_afl_player_details',
    ]),
    competition: z.string().trim().min(1).max(40),
    anchorSeasonYear: z.number().int().min(1897).max(2200),
    discoveryFromSeasonYear: z.number().int().min(1988).max(2200).nullable().optional(),
    draftPathway: z.enum(['national', 'rookie', 'pre_season', 'mid_season']).nullable(),
    dataset: z.string().trim().min(1).max(160),
    datasetVersion: z.string().trim().min(1).max(160),
    accessMechanism: z.string().trim().min(1).max(160),
    capabilityId: z.string().trim().min(1).max(240),
    sourceUrl: z.string().url().startsWith('https://').max(2_048),
    capturedAt: z.iso.datetime({ offset: true }),
    effectiveAt: z.iso.datetime({ offset: true }),
    parserVersion: z.string().trim().min(1).max(160),
    fieldManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    maximumBytes: z
      .number()
      .int()
      .positive()
      .max(128 * 1024 * 1024),
  })
  .strict()
  .superRefine((request, context) => {
    if (Date.parse(request.effectiveAt) > Date.parse(request.capturedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveAt'],
        message: 'Source effective time cannot be after capture time.',
      });
    }
  });

export function parseIngestAflTradeExternalPageRequest(
  input: unknown
): IngestAflTradeExternalPageRequest {
  return ingestionRequestSchema.parse(input);
}

export interface PersistAflTradeExternalCaptureInput extends ExternalHttpValidators {
  environment: IngestAflTradeExternalPageRequest['environment'];
  provider: ExternalProvider;
  competition: string;
  anchorSeasonYear: number;
  draftPathway: AflTradeExternalDraftPathway;
  dataset: string;
  datasetVersion: string;
  accessMechanism: string;
  capabilityId: string;
  sourceUrl: string;
  artifact: AflTradeArtifactRef;
  artifactReadback: AflTradeArtifactReadbackReceipt;
  capturedAt: string;
  effectiveAt: string;
  parserVersion: string;
  fieldManifestSha256: string;
  executionReceipt: AflTradeExternalCaptureExecutionReceipt;
}

export interface PersistedAflTradeExternalCapture {
  captureId: string;
  artifactId: string;
  idempotentReplay: boolean;
}

export interface AflTradeExternalCaptureRegistry {
  loadValidators(input: {
    environment: IngestAflTradeExternalPageRequest['environment'];
    provider: ExternalProvider;
    competition: string;
    anchorSeasonYear: number;
    draftPathway: AflTradeExternalDraftPathway;
    dataset: string;
    datasetVersion: string;
    capabilityId: string;
    sourceUrl: string;
    parserVersion: string;
    fieldManifestSha256: string;
  }): Promise<ExternalPageValidators | null>;
  persistNotModified(input: {
    environment: IngestAflTradeExternalPageRequest['environment'];
    provider: ExternalProvider;
    dataset: string;
    capabilityId: string;
    sourceUrl: string;
    capturedAt: string;
    eTag: string | null;
    lastModified: string | null;
    priorCaptureId: string;
    priorArtifactId: string;
    executionReceipt: AflTradeExternalCaptureExecutionReceipt;
  }): Promise<{ attemptId: string; idempotentReplay: boolean }>;
  persistCapture(
    input: PersistAflTradeExternalCaptureInput
  ): Promise<PersistedAflTradeExternalCapture>;
}

export interface AflTradeExternalPageIssue {
  code: string;
  sourceKey: string;
  detail: string;
}

export interface AflTradeExternalPageIngestionDependencies {
  rawArtifacts: AflTradeImmutableArtifactRepository;
  captureRegistry: AflTradeExternalCaptureRegistry;
  staging: {
    persist(input: {
      batch: AflTradeExternalEvidenceBatch;
      issues: readonly AflTradeExternalPageIssue[];
    }): Promise<{ batchId: string; idempotentReplay: boolean }>;
  };
  authorizeCapture(
    request: IngestAflTradeExternalPageRequest,
    observation: {
      capture: AflTradeExternalPageCapture;
      validators: ExternalPageValidators | null;
    }
  ): Promise<AflTradeExternalCaptureExecutionReceipt>;
  capturePage(input: {
    url: string;
    validators: ExternalPageValidators | null;
    maximumBytes: number;
  }): Promise<AflTradeExternalPageCapture>;
  parsePage(input: { html: string; capture: AflTradeExternalEvidenceContent['capture'] }): {
    evidence: readonly AflTradeExternalEvidenceEnvelope[];
    issues: readonly AflTradeExternalPageIssue[];
  };
}

export type IngestAflTradeExternalPageResult =
  | { status: 'not_modified'; attemptId: string }
  | {
      status: 'staged';
      captureId: string;
      artifactId: string;
      batchId: string;
      evidenceCount: number;
      issueCount: number;
      idempotentReplay: boolean;
    };

export class AflTradeExternalPageIngestionError extends Error {
  constructor(
    readonly code:
      | 'INVALID_DEPENDENCY'
      | 'CAPTURE_MISMATCH'
      | 'CAPTURE_TOO_LARGE'
      | 'INVALID_ENCODING'
      | 'EMPTY_EVIDENCE',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeExternalPageIngestionError';
  }
}

function requireCapturedPage(
  request: IngestAflTradeExternalPageRequest,
  capture: Extract<AflTradeExternalPageCapture, { status: 'captured' }>
): AflTradeArtifactRef {
  if (capture.sourceUrl !== request.sourceUrl) {
    throw new AflTradeExternalPageIngestionError(
      'CAPTURE_MISMATCH',
      'Captured page URL does not match the requested source URL.'
    );
  }
  if (capture.bytes.byteLength > request.maximumBytes) {
    throw new AflTradeExternalPageIngestionError(
      'CAPTURE_TOO_LARGE',
      'Captured page exceeds its bounded byte limit.'
    );
  }
  const artifact = createAflTradeByteArtifactRef(
    capture.bytes,
    capture.mediaType,
    request.capturedAt
  );
  if (artifact.contentSha256 !== capture.contentSha256) {
    throw new AflTradeExternalPageIngestionError(
      'CAPTURE_MISMATCH',
      'Captured page digest does not match the exact returned bytes.'
    );
  }
  return artifact;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AflTradeExternalPageIngestionError(
      'INVALID_ENCODING',
      'Captured page is not valid UTF-8 and cannot enter the HTML parser.'
    );
  }
}

function requireExecutionReceipt(
  request: IngestAflTradeExternalPageRequest,
  captured: AflTradeExternalPageCapture,
  validators: ExternalPageValidators | null,
  unparsedReceipt: unknown
): AflTradeExternalCaptureExecutionReceipt {
  const receipt = executionReceiptSchema.parse(unparsedReceipt);
  if (receipt.content.schemaVersion === 'statly-local-fixture-execution/v1') {
    throw new AflTradeExternalPageIngestionError(
      'CAPTURE_MISMATCH',
      'A local fixture receipt cannot authorize live provider capture.'
    );
  }
  if (receipt.content.schemaVersion === 'afl-trade-external-capture-execution/v1') {
    if (request.environment !== 'test_fixture') {
      throw new AflTradeExternalPageIngestionError(
        'CAPTURE_MISMATCH',
        'Non-fixture capture requires a request- and lease-bound execution receipt.'
      );
    }
    if (
      receipt.content.provider !== request.provider ||
      receipt.content.capabilityId !== request.capabilityId ||
      receipt.content.parserVersion !== request.parserVersion ||
      receipt.content.fieldManifestSha256 !== request.fieldManifestSha256 ||
      Date.parse(receipt.content.evaluatedAt) < Date.parse(request.capturedAt)
    ) {
      throw new AflTradeExternalPageIngestionError(
        'CAPTURE_MISMATCH',
        'Fixture execution receipt does not bind the requested parser and field manifest.'
      );
    }
    return receipt;
  }
  if (
    sha256AflTradeCanonicalJson(receipt.content.request) !== sha256AflTradeCanonicalJson(request) ||
    receipt.content.requestSha256 !== sha256AflTradeCanonicalJson(request) ||
    receipt.content.outcome.status !== captured.status ||
    receipt.content.outcome.sourceUrl !== captured.sourceUrl ||
    receipt.content.outcome.eTag !== captured.eTag ||
    receipt.content.outcome.lastModified !== captured.lastModified ||
    receipt.content.outcome.contentSha256 !==
      (captured.status === 'captured' ? captured.contentSha256 : null) ||
    receipt.content.outcome.observedArtifactId !==
      (captured.status === 'captured'
        ? `artifact:${captured.contentSha256}`
        : validators?.priorArtifactId) ||
    receipt.content.outcome.priorCaptureId !== (validators?.priorCaptureId ?? null) ||
    receipt.content.gate0aReceipt.content.request.evaluatedAt < request.capturedAt
  ) {
    throw new AflTradeExternalPageIngestionError(
      'CAPTURE_MISMATCH',
      'Capture execution receipt does not bind the exact post-fetch request and controls.'
    );
  }
  return receipt;
}

export async function ingestAflTradeExternalPage(
  unparsedRequest: IngestAflTradeExternalPageRequest,
  dependencies: AflTradeExternalPageIngestionDependencies
): Promise<IngestAflTradeExternalPageResult> {
  const request = parseIngestAflTradeExternalPageRequest(unparsedRequest);
  if (dependencies.rawArtifacts.artifactClass !== 'raw_source') {
    throw new AflTradeExternalPageIngestionError(
      'INVALID_DEPENDENCY',
      'External page ingestion requires raw-source artifact custody.'
    );
  }

  const validators = await dependencies.captureRegistry.loadValidators({
    environment: request.environment,
    provider: request.provider,
    competition: request.competition,
    anchorSeasonYear: request.anchorSeasonYear,
    draftPathway: request.draftPathway,
    dataset: request.dataset,
    datasetVersion: request.datasetVersion,
    capabilityId: request.capabilityId,
    sourceUrl: request.sourceUrl,
    parserVersion: request.parserVersion,
    fieldManifestSha256: request.fieldManifestSha256,
  });
  const captured = await dependencies.capturePage({
    url: request.sourceUrl,
    validators,
    maximumBytes: request.maximumBytes,
  });
  if (captured.sourceUrl !== request.sourceUrl) {
    throw new AflTradeExternalPageIngestionError(
      'CAPTURE_MISMATCH',
      'Capture response URL does not match the requested source URL.'
    );
  }
  const executionReceipt = requireExecutionReceipt(
    request,
    captured,
    validators,
    await dependencies.authorizeCapture(request, { capture: captured, validators })
  );
  if (captured.status === 'not_modified') {
    if (validators === null) {
      throw new AflTradeExternalPageIngestionError(
        'CAPTURE_MISMATCH',
        'A not-modified response requires one exact prior capture and artifact.'
      );
    }
    const persistedObservation = await dependencies.captureRegistry.persistNotModified({
      environment: request.environment,
      provider: request.provider,
      dataset: request.dataset,
      capabilityId: request.capabilityId,
      sourceUrl: request.sourceUrl,
      capturedAt: request.capturedAt,
      eTag: captured.eTag,
      lastModified: captured.lastModified,
      priorCaptureId: validators.priorCaptureId,
      priorArtifactId: validators.priorArtifactId,
      executionReceipt,
    });
    return { status: 'not_modified', attemptId: persistedObservation.attemptId };
  }

  const artifact = requireCapturedPage(request, captured);
  const stored = await dependencies.rawArtifacts.putIfAbsent(artifact, captured.bytes);
  if (
    stored.reference.artifactId !== artifact.artifactId ||
    !doesAflTradeArtifactRefMatchBytes(stored.reference, captured.bytes, captured.mediaType)
  ) {
    throw new AflTradeExternalPageIngestionError(
      'CAPTURE_MISMATCH',
      'Artifact custody returned a different immutable reference.'
    );
  }
  const artifactReadback = await verifyAflTradeArtifactReadback(
    dependencies.rawArtifacts,
    stored.reference,
    request.capturedAt,
    request.maximumBytes
  );
  const persistedCapture = await dependencies.captureRegistry.persistCapture({
    environment: request.environment,
    provider: request.provider,
    competition: request.competition,
    anchorSeasonYear: request.anchorSeasonYear,
    draftPathway: request.draftPathway,
    dataset: request.dataset,
    datasetVersion: request.datasetVersion,
    accessMechanism: request.accessMechanism,
    capabilityId: request.capabilityId,
    sourceUrl: request.sourceUrl,
    artifact: stored.reference,
    artifactReadback,
    capturedAt: request.capturedAt,
    effectiveAt: request.effectiveAt,
    parserVersion: request.parserVersion,
    fieldManifestSha256: request.fieldManifestSha256,
    executionReceipt,
    eTag: captured.eTag,
    lastModified: captured.lastModified,
  });
  if (persistedCapture.artifactId !== stored.reference.artifactId) {
    throw new AflTradeExternalPageIngestionError(
      'CAPTURE_MISMATCH',
      'Capture registry did not bind the exact raw artifact.'
    );
  }

  const capture: AflTradeExternalEvidenceContent['capture'] = {
    captureId: persistedCapture.captureId,
    artifactId: stored.reference.artifactId,
    contentSha256: stored.reference.contentSha256,
    mediaType: stored.reference.mediaType,
    sourceUrl: request.sourceUrl,
    capturedAt: request.capturedAt,
    effectiveAt: request.effectiveAt,
    parserVersion: request.parserVersion,
    fieldManifestSha256: request.fieldManifestSha256,
  };
  const parsed = dependencies.parsePage({ html: decodeUtf8(captured.bytes), capture });
  if (parsed.evidence.length === 0) {
    throw new AflTradeExternalPageIngestionError(
      'EMPTY_EVIDENCE',
      'A captured evidence page cannot finalize an empty factual batch.'
    );
  }
  if (
    executionReceipt.content.schemaVersion === AFL_TRADE_EXTERNAL_CAPTURE_EXECUTION_SCHEMA_VERSION
  ) {
    requireAflTradeExternalEvidenceFieldAuthority({
      evidence: parsed.evidence,
      sourceRights: executionReceipt.content.sourceRights,
      gate0aReceipt: executionReceipt.content.gate0aReceipt,
    });
  }
  const batch = createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider: request.provider,
    captureId: persistedCapture.captureId,
    evidence: [...parsed.evidence],
    finalizedAt: request.capturedAt,
    publicationEligible: false,
  });
  const staged = await dependencies.staging.persist({ batch, issues: parsed.issues });

  return {
    status: 'staged',
    captureId: persistedCapture.captureId,
    artifactId: stored.reference.artifactId,
    batchId: staged.batchId,
    evidenceCount: batch.content.rowCount,
    issueCount: parsed.issues.length,
    idempotentReplay: staged.idempotentReplay,
  };
}
