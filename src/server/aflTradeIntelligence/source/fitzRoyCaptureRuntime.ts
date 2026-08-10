import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  type AflTradeImmutableArtifactRepository,
  verifyAflTradeArtifactReadback,
} from '../artifacts/immutableArtifactRepository';
import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import {
  createAflTradeCaptureAdmissionRequest,
  type AflTradeFitzRoyCaptureAdmission,
  type AflTradeFitzRoyCaptureLease,
} from './fitzRoyCaptureAdmission';
import {
  aflTradeFitzRoyCaptureDiagnosticsSchema,
  createAflTradeFitzRoyInvocation,
  createAflTradeFitzRoySchemaFingerprint,
  getAflTradeFitzRoyObservedScopeError,
  parseAflTradeFitzRoyCaptureRequest,
  type AflTradeFitzRoyCaptureDiagnostics,
  type AflTradeFitzRoyCaptureRequest,
  type AflTradeFitzRoyInvocation,
} from './fitzRoyCaptureContracts';
import {
  authenticateAflTradeFitzRoyEgressExecutionReceipt,
  type AflTradeFitzRoyEgressExecutionReceipt,
  type AflTradeFitzRoyEgressExecutionVerifier,
} from './fitzRoyEgressExecutionReceipt';
import {
  AFL_TRADE_FITZROY_CAPTURE_RECEIPT_SCHEMA_VERSION,
  AFL_TRADE_FITZROY_RDS_MEDIA_TYPE,
  createAflTradeFitzRoyCaptureReceipt,
  type AflTradeFitzRoyCaptureReceipt,
} from './fitzRoyCaptureReceipt';
import type { AflTradeGate0ARequest } from './gate0aEvaluation';
import { createAflTradeGate0AReceipt } from './gate0aReceipt';
import type { AflTradeSourceRightsProposal } from './sourceRights';

const execFileAsync = promisify(execFile);
const CAPTURE_AUTHORIZATION_MAX_AGE_MS = 15 * 60 * 1000;

export const AFL_TRADE_FITZROY_CAPTURE_ERROR_CODES = [
  'INVALID_REQUEST',
  'AUTHORIZATION_BLOCKED',
  'PRODUCTION_EXECUTION_DISABLED',
  'CAPTURE_DEFERRED',
  'RUNTIME_IDENTITY_MISMATCH',
  'PROCESS_FAILED',
  'OUTPUT_TOO_LARGE',
  'OUTPUT_INVALID',
  'SCHEMA_DRIFT',
] as const;

export type AflTradeFitzRoyCaptureErrorCode =
  (typeof AFL_TRADE_FITZROY_CAPTURE_ERROR_CODES)[number];

export class AflTradeFitzRoyCaptureError extends Error {
  constructor(
    public readonly code: AflTradeFitzRoyCaptureErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeFitzRoyCaptureError';
  }
}

export interface AflTradeFitzRoyProcessResult {
  sourceBytes: Uint8Array;
  diagnostics: unknown;
  egressExecutionReceipt?: unknown;
}

export interface AflTradeFitzRoyProcessExecutor {
  readonly executionBoundary:
    'fixture_no_network' | 'local_network_capable' | 'attested_rate_limited';
  readonly egressPolicyEvidenceIds?: readonly string[];
  execute(
    invocation: AflTradeFitzRoyInvocation,
    limits: { timeoutMs: number; maximumSourceBytes: number; maximumDiagnosticsBytes: number }
  ): Promise<AflTradeFitzRoyProcessResult>;
}

export interface AflTradeFitzRoyCaptureClock {
  now(): string;
}

export interface AflTradeFitzRoyRuntimeIdentity {
  rVersion: '4.5.1';
  dependencyLockSha256: string;
  imageDigest: `sha256:${string}`;
}

export interface AflTradeFitzRoyCaptureDependencies {
  rawArtifactRepository: AflTradeImmutableArtifactRepository;
  metadataArtifactRepository: AflTradeImmutableArtifactRepository;
  executor: AflTradeFitzRoyProcessExecutor;
  clock: AflTradeFitzRoyCaptureClock;
  runtimeIdentity: AflTradeFitzRoyRuntimeIdentity;
  timeoutMs: number;
  maximumSourceBytes: number;
  maximumDiagnosticsBytes: number;
  captureAdmission?: AflTradeFitzRoyCaptureAdmission;
  egressExecutionVerifier?: AflTradeFitzRoyEgressExecutionVerifier;
  authorizationResolver?: AflTradeFitzRoyCaptureAuthorizationResolver;
}

export interface AflTradeFitzRoyCaptureAuthorizationResolver {
  resolveAuthorization(rightsArtifactId: string): Promise<{
    ledger: AflTradeGateDecisionLedger;
    sourceRights: AflTradeSourceRightsProposal;
  }>;
}

export interface AflTradeFitzRoyCaptureCommand {
  ledger: AflTradeGateDecisionLedger;
  sourceRights: AflTradeSourceRightsProposal;
  gateRequest: Omit<AflTradeGate0ARequest, 'evaluatedAt'>;
  captureRequest: unknown;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AflTradeFitzRoyCaptureError('INVALID_REQUEST', `${name} must be positive.`);
  }
  return value;
}

function validateCaptureAuthorizationScope(
  captureRequest: AflTradeFitzRoyCaptureRequest,
  gateRequest: Omit<AflTradeGate0ARequest, 'evaluatedAt'>
) {
  if (
    gateRequest.capabilityId !== captureRequest.capabilityId ||
    gateRequest.competition !== captureRequest.competition ||
    gateRequest.season !== captureRequest.authorizationSeason
  ) {
    throw new AflTradeFitzRoyCaptureError(
      'INVALID_REQUEST',
      'Capture capability, competition, and authorization season must match Gate 0A.'
    );
  }
}

function validateRuntimeResult(
  diagnostics: AflTradeFitzRoyCaptureDiagnostics,
  invocation: AflTradeFitzRoyInvocation,
  invocationSha256: string,
  gateRequest: Omit<AflTradeGate0ARequest, 'evaluatedAt'>,
  runtimeIdentity: AflTradeFitzRoyRuntimeIdentity
) {
  if (
    diagnostics.capabilityId !== invocation.capabilityId ||
    diagnostics.directFunction !== invocation.directFunction ||
    diagnostics.fitzRoyVersion !== invocation.fitzRoyVersion ||
    diagnostics.invocationSha256 !== invocationSha256
  ) {
    throw new AflTradeFitzRoyCaptureError(
      'OUTPUT_INVALID',
      'The fitzRoy process did not attest to the exact invocation.'
    );
  }
  if (
    diagnostics.runtime.rVersion !== runtimeIdentity.rVersion ||
    diagnostics.runtime.dependencyLockSha256 !== runtimeIdentity.dependencyLockSha256 ||
    diagnostics.runtime.imageDigest !== runtimeIdentity.imageDigest
  ) {
    throw new AflTradeFitzRoyCaptureError(
      'RUNTIME_IDENTITY_MISMATCH',
      'The fitzRoy process runtime does not match the approved R, lock, and image identity.'
    );
  }
  const observedScopeError = getAflTradeFitzRoyObservedScopeError(invocation, diagnostics);
  if (observedScopeError !== null) {
    throw new AflTradeFitzRoyCaptureError('OUTPUT_INVALID', observedScopeError);
  }
  if (diagnostics.rowCount === 0) {
    throw new AflTradeFitzRoyCaptureError(
      'OUTPUT_INVALID',
      'A zero-row fitzRoy result is explicit missing evidence, not a successful capture.'
    );
  }
  if (diagnostics.duplicateRowCount > 0) {
    throw new AflTradeFitzRoyCaptureError(
      'OUTPUT_INVALID',
      'Exact duplicate source rows require review before custody.'
    );
  }
  if (diagnostics.conditions.some(({ kind }) => kind === 'warning')) {
    throw new AflTradeFitzRoyCaptureError(
      'OUTPUT_INVALID',
      'fitzRoy warnings require review and cannot form a successful capture.'
    );
  }
  const returnedFields = [...diagnostics.fields.map(({ name }) => name)].sort();
  const authorizedFields = [
    ...new Set(gateRequest.fieldUses.map(({ sourceField }) => sourceField)),
  ].sort();
  if (
    returnedFields.length !== authorizedFields.length ||
    returnedFields.some((field, index) => field !== authorizedFields[index])
  ) {
    throw new AflTradeFitzRoyCaptureError(
      'SCHEMA_DRIFT',
      'The exact returned field set differs from the Gate 0A authorization.'
    );
  }
}

function requireProductionCaptureBoundary(
  command: AflTradeFitzRoyCaptureCommand,
  dependencies: AflTradeFitzRoyCaptureDependencies
) {
  if (
    dependencies.captureAdmission === undefined ||
    dependencies.egressExecutionVerifier === undefined ||
    dependencies.executor.executionBoundary !== 'attested_rate_limited' ||
    dependencies.rawArtifactRepository.assurance !== 'durable_object_storage' ||
    dependencies.metadataArtifactRepository.assurance !== 'durable_object_storage' ||
    dependencies.rawArtifactRepository.artifactClass !== 'raw_source' ||
    dependencies.metadataArtifactRepository.artifactClass !== 'capture_metadata' ||
    dependencies.rawArtifactRepository.custodyProfile?.content.environment !==
      command.gateRequest.environment ||
    dependencies.metadataArtifactRepository.custodyProfile?.content.environment !==
      command.gateRequest.environment ||
    (dependencies.rawArtifactRepository.custodyProfile?.content.maximumObjectBytes ?? 0) <
      dependencies.maximumSourceBytes ||
    (dependencies.metadataArtifactRepository.custodyProfile?.content.maximumObjectBytes ?? 0) <
      dependencies.maximumDiagnosticsBytes
  ) {
    throw new AflTradeFitzRoyCaptureError(
      'PRODUCTION_EXECUTION_DISABLED',
      'Non-fixture capture requires durable scoped custody, distributed admission, and an attested rate-limited egress executor.'
    );
  }
}

async function requireAuthenticatedEgressExecution(input: {
  unparsedReceipt: unknown;
  verifier: AflTradeFitzRoyEgressExecutionVerifier;
  invocation: AflTradeFitzRoyInvocation;
  invocationSha256: string;
  sourceSha256: string;
  sourceByteLength: number;
  diagnosticsSha256: string;
  diagnosticsByteLength: number;
  runtimeIdentity: AflTradeFitzRoyRuntimeIdentity;
  sourceRights: AflTradeSourceRightsProposal;
  cacheSeconds: number | null;
  authorizationRecordedAt: string;
  egressPolicyEvidenceId: string;
}): Promise<AflTradeFitzRoyEgressExecutionReceipt> {
  let receipt: AflTradeFitzRoyEgressExecutionReceipt;
  try {
    receipt = await authenticateAflTradeFitzRoyEgressExecutionReceipt(
      input.unparsedReceipt,
      input.verifier
    );
  } catch {
    throw new AflTradeFitzRoyCaptureError(
      'RUNTIME_IDENTITY_MISMATCH',
      'The provider-egress execution evidence is invalid or untrusted.'
    );
  }
  const content = receipt.content;
  const upstreamRate = input.sourceRights.content.automatedAccess.rateLimit;
  if (
    upstreamRate === null ||
    input.cacheSeconds === null ||
    content.provider !== input.invocation.provider ||
    content.capabilityId !== input.invocation.capabilityId ||
    content.directFunction !== input.invocation.directFunction ||
    content.fitzRoyVersion !== input.invocation.fitzRoyVersion ||
    content.invocationSha256 !== input.invocationSha256 ||
    content.sourceOutput.contentSha256 !== input.sourceSha256 ||
    content.sourceOutput.byteLength !== input.sourceByteLength ||
    content.diagnosticsOutput.contentSha256 !== input.diagnosticsSha256 ||
    content.diagnosticsOutput.byteLength !== input.diagnosticsByteLength ||
    content.runtime.rVersion !== input.runtimeIdentity.rVersion ||
    content.runtime.dependencyLockSha256 !== input.runtimeIdentity.dependencyLockSha256 ||
    content.runtime.imageDigest !== input.runtimeIdentity.imageDigest ||
    content.enforcedPolicy.upstreamRate.requests !== upstreamRate.requests ||
    content.enforcedPolicy.upstreamRate.perSeconds !== upstreamRate.perSeconds ||
    content.enforcedPolicy.upstreamRate.burst !== upstreamRate.burst ||
    content.enforcedPolicy.cacheSeconds !== input.cacheSeconds ||
    content.enforcedPolicy.egressPolicyEvidenceId !== input.egressPolicyEvidenceId ||
    Date.parse(content.startedAt) < Date.parse(input.authorizationRecordedAt)
  ) {
    throw new AflTradeFitzRoyCaptureError(
      'RUNTIME_IDENTITY_MISMATCH',
      'The provider-egress execution evidence does not bind the exact authorized capture.'
    );
  }
  return receipt;
}

function requireEgressPolicyEvidence(sourceRights: AflTradeSourceRightsProposal): string {
  const evidenceIds = [
    ...new Set(
      sourceRights.content.conditions
        .filter(({ conditionId }) => conditionId === 'provider-egress-control')
        .flatMap(({ verificationEvidenceIds }) => verificationEvidenceIds)
    ),
  ];
  if (
    evidenceIds.length !== 1 ||
    !sourceRights.content.automatedAccess.permitted ||
    !sourceRights.content.automatedAccess.cache.permitted
  ) {
    throw new AflTradeFitzRoyCaptureError(
      'AUTHORIZATION_BLOCKED',
      'Production capture requires one exact reviewed egress policy and approved caching.'
    );
  }
  return evidenceIds[0];
}

async function acquireProductionLease(input: {
  command: AflTradeFitzRoyCaptureCommand;
  dependencies: AflTradeFitzRoyCaptureDependencies;
  invocation: AflTradeFitzRoyInvocation;
  invocationSha256: string;
  evaluatedAt: string;
}): Promise<AflTradeFitzRoyCaptureLease> {
  const evidenceId = requireEgressPolicyEvidence(input.command.sourceRights);
  if (!input.dependencies.executor.egressPolicyEvidenceIds?.includes(evidenceId)) {
    throw new AflTradeFitzRoyCaptureError(
      'PRODUCTION_EXECUTION_DISABLED',
      'The production executor does not attest to the exact reviewed provider egress policy.'
    );
  }
  const cacheSeconds = input.command.gateRequest.cacheSeconds;
  const upstreamRate = input.command.sourceRights.content.automatedAccess.rateLimit;
  if (
    !Number.isSafeInteger(cacheSeconds) ||
    cacheSeconds === null ||
    cacheSeconds <= 0 ||
    upstreamRate === null
  ) {
    throw new AflTradeFitzRoyCaptureError(
      'AUTHORIZATION_BLOCKED',
      'Production capture requires a positive Gate-authorized cache interval.'
    );
  }
  const admission = await input.dependencies.captureAdmission!.acquire(
    createAflTradeCaptureAdmissionRequest({
      invocation: input.invocation,
      invocationSha256: input.invocationSha256,
      policy: {
        upstreamRate,
        cacheSeconds,
        maximumLeaseMs: input.dependencies.timeoutMs,
        egressPolicyEvidenceId: evidenceId,
      },
      nowMs: Date.parse(input.evaluatedAt),
    })
  );
  if (admission.status === 'deferred') {
    throw new AflTradeFitzRoyCaptureError(
      'CAPTURE_DEFERRED',
      `Provider capture is deferred until ${new Date(admission.retryAtMs).toISOString()}.`
    );
  }
  return admission.lease;
}

async function storeAndVerify(
  repository: AflTradeImmutableArtifactRepository,
  reference: ReturnType<typeof createAflTradeByteArtifactRef>,
  bytes: Uint8Array,
  verifiedAt: string,
  maximumBytes: number
) {
  const stored = await repository.putIfAbsent(reference, bytes);
  const readback = await verifyAflTradeArtifactReadback(
    repository,
    stored.reference,
    verifiedAt,
    maximumBytes
  );
  return { artifact: stored.reference, readback };
}

export async function captureAuthorizedAflTradeFitzRoyEvidence(
  command: AflTradeFitzRoyCaptureCommand,
  dependencies: AflTradeFitzRoyCaptureDependencies
): Promise<AflTradeFitzRoyCaptureReceipt> {
  requirePositiveInteger(dependencies.timeoutMs, 'timeoutMs');
  requirePositiveInteger(dependencies.maximumSourceBytes, 'maximumSourceBytes');
  requirePositiveInteger(dependencies.maximumDiagnosticsBytes, 'maximumDiagnosticsBytes');
  if (
    !/^[a-f0-9]{64}$/.test(dependencies.runtimeIdentity.dependencyLockSha256) ||
    !/^sha256:[a-f0-9]{64}$/.test(dependencies.runtimeIdentity.imageDigest)
  ) {
    throw new AflTradeFitzRoyCaptureError(
      'INVALID_REQUEST',
      'The expected dependency-lock and image identities must be exact SHA-256 digests.'
    );
  }
  let request: AflTradeFitzRoyCaptureRequest;
  try {
    request = parseAflTradeFitzRoyCaptureRequest(command.captureRequest);
  } catch (error) {
    throw new AflTradeFitzRoyCaptureError(
      'INVALID_REQUEST',
      error instanceof Error ? error.message : 'Invalid fitzRoy capture request.'
    );
  }
  const fixtureCapture = command.gateRequest.environment === 'test_fixture';
  let authorizedCommand = command;
  if (fixtureCapture) {
    if (dependencies.executor.executionBoundary !== 'fixture_no_network') {
      throw new AflTradeFitzRoyCaptureError(
        'AUTHORIZATION_BLOCKED',
        'Fixture authority can execute only an explicitly no-network fixture executor.'
      );
    }
    if (
      dependencies.rawArtifactRepository.assurance !== 'fixture_memory' ||
      dependencies.metadataArtifactRepository.assurance !== 'fixture_memory' ||
      dependencies.rawArtifactRepository.artifactClass !== 'raw_source' ||
      dependencies.metadataArtifactRepository.artifactClass !== 'capture_metadata'
    ) {
      throw new AflTradeFitzRoyCaptureError(
        'AUTHORIZATION_BLOCKED',
        'Fixture capture requires separate fixture-memory raw-source and capture-metadata custody boundaries.'
      );
    }
  } else {
    if (dependencies.authorizationResolver === undefined) {
      throw new AflTradeFitzRoyCaptureError(
        'PRODUCTION_EXECUTION_DISABLED',
        'Non-fixture capture must resolve source authority from the durable Gate ledger.'
      );
    }
    try {
      const resolved = await dependencies.authorizationResolver.resolveAuthorization(
        command.gateRequest.rightsArtifactId
      );
      if (resolved.sourceRights.rightsArtifactId !== command.gateRequest.rightsArtifactId) {
        throw new TypeError('Resolved source-rights identity mismatch.');
      }
      authorizedCommand = {
        ...command,
        ledger: resolved.ledger,
        sourceRights: resolved.sourceRights,
      };
    } catch (cause) {
      if (cause instanceof AflTradeFitzRoyCaptureError) throw cause;
      throw new AflTradeFitzRoyCaptureError(
        'AUTHORIZATION_BLOCKED',
        'The exact current source authority could not be resolved from durable state.'
      );
    }
    requireProductionCaptureBoundary(authorizedCommand, dependencies);
  }
  validateCaptureAuthorizationScope(request, authorizedCommand.gateRequest);
  const invocation = createAflTradeFitzRoyInvocation(request);
  const invocationCreatedAt = dependencies.clock.now();
  const invocationBytes = new TextEncoder().encode(canonicalizeAflTradeJson(invocation));
  const invocationReference = createAflTradeCanonicalJsonArtifactRef(
    invocation,
    invocationCreatedAt
  );
  const evaluatedAt = dependencies.clock.now();
  const authorizationReceipt = createAflTradeGate0AReceipt(
    authorizedCommand.ledger,
    authorizedCommand.sourceRights,
    { ...authorizedCommand.gateRequest, evaluatedAt },
    dependencies.clock.now()
  );
  if (authorizationReceipt.content.result.status !== 'mechanically_eligible') {
    throw new AflTradeFitzRoyCaptureError(
      'AUTHORIZATION_BLOCKED',
      'Gate 0A did not authorize this fitzRoy capture.'
    );
  }
  const captureLease = fixtureCapture
    ? null
    : await acquireProductionLease({
        command: authorizedCommand,
        dependencies,
        invocation,
        invocationSha256: invocationReference.contentSha256,
        evaluatedAt,
      });
  let completed = false;
  try {
    const invocationCustody = await storeAndVerify(
      dependencies.metadataArtifactRepository,
      invocationReference,
      invocationBytes,
      dependencies.clock.now(),
      dependencies.maximumDiagnosticsBytes
    );
    const processResult = await dependencies.executor.execute(invocation, {
      timeoutMs: dependencies.timeoutMs,
      maximumSourceBytes: dependencies.maximumSourceBytes,
      maximumDiagnosticsBytes: dependencies.maximumDiagnosticsBytes,
    });
    if (processResult.sourceBytes.byteLength === 0) {
      throw new AflTradeFitzRoyCaptureError(
        'OUTPUT_INVALID',
        'fitzRoy returned an empty RDS artifact.'
      );
    }
    if (processResult.sourceBytes.byteLength > dependencies.maximumSourceBytes) {
      throw new AflTradeFitzRoyCaptureError(
        'OUTPUT_TOO_LARGE',
        'fitzRoy output exceeded the configured source-byte bound.'
      );
    }
    const diagnosticsResult = aflTradeFitzRoyCaptureDiagnosticsSchema.safeParse(
      processResult.diagnostics
    );
    if (!diagnosticsResult.success) {
      throw new AflTradeFitzRoyCaptureError(
        'OUTPUT_INVALID',
        'The fitzRoy process diagnostics did not match the closed capture contract.'
      );
    }
    const diagnostics = diagnosticsResult.data;
    validateRuntimeResult(
      diagnostics,
      invocation,
      invocationCustody.artifact.contentSha256,
      authorizedCommand.gateRequest,
      dependencies.runtimeIdentity
    );
    const sourceDigestReference = createAflTradeByteArtifactRef(
      processResult.sourceBytes,
      AFL_TRADE_FITZROY_RDS_MEDIA_TYPE,
      authorizationReceipt.content.recordedAt
    );
    const diagnosticsBytes = new TextEncoder().encode(canonicalizeAflTradeJson(diagnostics));
    if (diagnosticsBytes.byteLength > dependencies.maximumDiagnosticsBytes) {
      throw new AflTradeFitzRoyCaptureError(
        'OUTPUT_TOO_LARGE',
        'fitzRoy diagnostics exceeded the configured byte bound.'
      );
    }
    const diagnosticsDigestReference = createAflTradeCanonicalJsonArtifactRef(
      diagnostics,
      authorizationReceipt.content.recordedAt
    );
    const egressPolicyEvidenceId = fixtureCapture
      ? null
      : requireEgressPolicyEvidence(authorizedCommand.sourceRights);
    const egressExecutionReceipt = fixtureCapture
      ? null
      : await requireAuthenticatedEgressExecution({
          unparsedReceipt: processResult.egressExecutionReceipt,
          verifier: dependencies.egressExecutionVerifier!,
          invocation,
          invocationSha256: invocationCustody.artifact.contentSha256,
          sourceSha256: sourceDigestReference.contentSha256,
          sourceByteLength: sourceDigestReference.byteLength,
          diagnosticsSha256: diagnosticsDigestReference.contentSha256,
          diagnosticsByteLength: diagnosticsDigestReference.byteLength,
          runtimeIdentity: dependencies.runtimeIdentity,
          sourceRights: authorizedCommand.sourceRights,
          cacheSeconds: authorizedCommand.gateRequest.cacheSeconds,
          authorizationRecordedAt: authorizationReceipt.content.recordedAt,
          egressPolicyEvidenceId: egressPolicyEvidenceId!,
        });
    const capturedAt = dependencies.clock.now();
    const authorizationAgeMs = Date.parse(capturedAt) - Date.parse(evaluatedAt);
    if (
      !Number.isFinite(authorizationAgeMs) ||
      authorizationAgeMs < 0 ||
      authorizationAgeMs > CAPTURE_AUTHORIZATION_MAX_AGE_MS
    ) {
      throw new AflTradeFitzRoyCaptureError(
        'AUTHORIZATION_BLOCKED',
        'The Gate 0A capture authorization expired before retrieval completed.'
      );
    }
    const sourceReference = createAflTradeByteArtifactRef(
      processResult.sourceBytes,
      AFL_TRADE_FITZROY_RDS_MEDIA_TYPE,
      capturedAt
    );
    const diagnosticsReference = createAflTradeCanonicalJsonArtifactRef(diagnostics, capturedAt);
    const egressExecutionBytes =
      egressExecutionReceipt === null
        ? null
        : new TextEncoder().encode(canonicalizeAflTradeJson(egressExecutionReceipt));
    if (
      egressExecutionBytes !== null &&
      egressExecutionBytes.byteLength > dependencies.maximumDiagnosticsBytes
    ) {
      throw new AflTradeFitzRoyCaptureError(
        'OUTPUT_TOO_LARGE',
        'Provider-egress execution evidence exceeded the configured metadata bound.'
      );
    }
    const egressExecutionReference =
      egressExecutionReceipt === null
        ? null
        : createAflTradeCanonicalJsonArtifactRef(egressExecutionReceipt, capturedAt);
    const sourceCustody = await storeAndVerify(
      dependencies.rawArtifactRepository,
      sourceReference,
      processResult.sourceBytes,
      capturedAt,
      dependencies.maximumSourceBytes
    );
    const diagnosticsCustody = await storeAndVerify(
      dependencies.metadataArtifactRepository,
      diagnosticsReference,
      diagnosticsBytes,
      capturedAt,
      dependencies.maximumDiagnosticsBytes
    );
    const egressExecutionCustody =
      egressExecutionReference === null || egressExecutionBytes === null
        ? null
        : await storeAndVerify(
            dependencies.metadataArtifactRepository,
            egressExecutionReference,
            egressExecutionBytes,
            capturedAt,
            dependencies.maximumDiagnosticsBytes
          );
    const receipt = createAflTradeFitzRoyCaptureReceipt({
      schemaVersion: AFL_TRADE_FITZROY_CAPTURE_RECEIPT_SCHEMA_VERSION,
      invocation,
      authorizationReceipt,
      invocationCustody,
      sourceCustody,
      diagnosticsCustody,
      egressExecutionCustody,
      egressExecutionReceipt,
      diagnostics,
      schemaFingerprint: createAflTradeFitzRoySchemaFingerprint(diagnostics),
      capturedAt,
      status: 'captured',
    });
    completed = true;
    return receipt;
  } finally {
    if (captureLease !== null) {
      await dependencies.captureAdmission!.complete(captureLease, {
        outcome: completed ? 'succeeded' : 'failed',
        completedAtMs: Date.parse(dependencies.clock.now()),
      });
    }
  }
}

export interface AflTradeLocalRscriptExecutorOptions {
  rscriptPath?: string;
  scriptPath?: string;
  dependencyLockSha256: string;
  imageDigest: `sha256:${string}`;
}

async function readBoundedFile(path: string, maximumBytes: number): Promise<Uint8Array> {
  const metadata = await stat(path);
  if (metadata.size > maximumBytes) {
    throw new AflTradeFitzRoyCaptureError(
      'OUTPUT_TOO_LARGE',
      'The fitzRoy process wrote an artifact beyond its configured byte bound.'
    );
  }
  return Uint8Array.from(await readFile(path));
}

/**
 * Explicit non-production adapter for local contract probes. Production must inject an executor for
 * the reviewed immutable container/job digest; this helper never becomes a host-R fallback. It never
 * uses a shell, imports Firebase or fantasy persistence, or leaves its private working directory.
 */
export function createAflTradeLocalRscriptCaptureExecutor(
  options: AflTradeLocalRscriptExecutorOptions
): AflTradeFitzRoyProcessExecutor {
  const rscriptPath = options.rscriptPath ?? 'Rscript';
  const scriptPath = resolve(
    options.scriptPath ?? join(process.cwd(), 'etl/afl-trade-intelligence/capture_fitzroy.R')
  );
  return {
    executionBoundary: 'local_network_capable',
    async execute(invocation, limits) {
      const directory = await mkdtemp(join(tmpdir(), 'statly-afl-trade-capture-'));
      const invocationPath = join(directory, 'invocation.json');
      const outputPath = join(directory, 'source.rds');
      const diagnosticsPath = join(directory, 'diagnostics.json');
      try {
        await writeFile(invocationPath, canonicalizeAflTradeJson(invocation), {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        const { stdout, stderr } = await execFileAsync(
          rscriptPath,
          ['--vanilla', scriptPath, invocationPath, outputPath, diagnosticsPath],
          {
            timeout: limits.timeoutMs,
            maxBuffer: limits.maximumDiagnosticsBytes,
            windowsHide: true,
            env: {
              STATLY_R_LOCK_SHA256: options.dependencyLockSha256,
              STATLY_CAPTURE_IMAGE_DIGEST: options.imageDigest,
              STATLY_CAPTURE_RENV_PROJECT: dirname(scriptPath),
              NODE_ENV: 'production',
              PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
              HOME: directory,
              TMPDIR: directory,
              LANG: 'C.UTF-8',
              TZ: 'UTC',
            },
          }
        );
        if (stdout.trim() !== '' || stderr.trim() !== '') {
          throw new AflTradeFitzRoyCaptureError(
            'OUTPUT_INVALID',
            'The fitzRoy process emitted unstructured output outside its diagnostics artifact.'
          );
        }
        const sourceBytes = await readBoundedFile(outputPath, limits.maximumSourceBytes);
        const diagnosticsBytes = await readBoundedFile(
          diagnosticsPath,
          limits.maximumDiagnosticsBytes
        );
        let diagnostics: unknown;
        try {
          diagnostics = JSON.parse(new TextDecoder().decode(diagnosticsBytes));
        } catch {
          throw new AflTradeFitzRoyCaptureError(
            'OUTPUT_INVALID',
            'The fitzRoy process emitted invalid diagnostics JSON.'
          );
        }
        return { sourceBytes, diagnostics };
      } catch (error) {
        if (error instanceof AflTradeFitzRoyCaptureError) throw error;
        throw new AflTradeFitzRoyCaptureError(
          'PROCESS_FAILED',
          error instanceof Error
            ? `The fitzRoy process failed: ${error.message}`
            : 'The fitzRoy process failed.'
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
