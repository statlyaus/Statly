import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import {
  aflTradeSourceSnapshotManifestSchema,
  type AflTradeSourceSnapshotManifest,
} from '../artifacts/sourceSnapshotManifest';
import {
  AflTradeFitzRoyDecodeError,
  decodeAflTradeFitzRoyCapture,
  type AflTradeFitzRoyDecoderExecutor,
} from './fitzRoyObservationDecodeRuntime';
import type { AflTradeFitzRoyFieldMap } from './fitzRoyObservationContracts';
import { normalizeAflTradeFitzRoyDecodedTable } from './fitzRoyObservationNormalizer';
import {
  authenticateAflTradeFitzRoyEgressExecutionReceipt,
  type AflTradeFitzRoyEgressExecutionVerifier,
} from './fitzRoyEgressExecutionReceipt';
import type {
  PersistedAflTradeProviderObservation,
  PostgresAflTradeProviderObservationRepository,
} from './postgresProviderObservationRepository';
import type {
  PersistedAflTradeSourceCapture,
  PostgresAflTradeSourceCaptureRepository,
} from './postgresSourceCaptureRepository';

export class AflTradeFitzRoyStagingError extends Error {
  constructor(
    readonly code:
      'INVALID_REQUEST' | 'AUTHORITY_INVALID' | 'CUSTODY_UNAVAILABLE' | 'STAGING_FAILED',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeFitzRoyStagingError';
  }
}

export interface AflTradeFitzRoyStagingClock {
  now(): string;
}

export interface AflTradeFitzRoyStagingDependencies {
  rawArtifactRepository: AflTradeImmutableArtifactRepository;
  sourceCaptureRepository: Pick<PostgresAflTradeSourceCaptureRepository, 'persist'>;
  providerObservationRepository: Pick<
    PostgresAflTradeProviderObservationRepository,
    'persist' | 'recordFailure'
  >;
  decoderExecutor: AflTradeFitzRoyDecoderExecutor;
  clock: AflTradeFitzRoyStagingClock;
  dependencyLockSha256: string;
  imageDigest: `sha256:${string}`;
  timeoutMs: number;
  maximumSourceBytes: number;
  maximumRows: number;
  maximumFields: number;
  maximumCells: number;
  maximumCellBytes: number;
  maximumOutputBytes: number;
  egressExecutionVerifier?: AflTradeFitzRoyEgressExecutionVerifier;
}

export interface AflTradeFitzRoyStagingCommand {
  snapshot: AflTradeSourceSnapshotManifest;
  fieldMapId: string;
  fieldMap: AflTradeFitzRoyFieldMap;
}

export interface AflTradeFitzRoyStagingResult {
  capture: PersistedAflTradeSourceCapture;
  normalization: PersistedAflTradeProviderObservation;
}

function exactInstant(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function failureCode(phase: 'custody' | 'decode' | 'normalize' | 'persistence', error: unknown) {
  if (phase === 'custody') {
    return 'custody_mismatch' as const;
  }
  if (phase === 'decode' && error instanceof AflTradeFitzRoyDecodeError) {
    return error.code === 'CUSTODY_MISMATCH'
      ? ('custody_mismatch' as const)
      : error.code === 'OUTPUT_INVALID' || error.code === 'OUTPUT_TOO_LARGE'
        ? ('output_invalid' as const)
        : ('decoder_failed' as const);
  }
  return phase === 'persistence' ? ('persistence_failed' as const) : ('output_invalid' as const);
}

export async function stageAflTradeFitzRoySourceSnapshot(
  command: AflTradeFitzRoyStagingCommand,
  dependencies: AflTradeFitzRoyStagingDependencies
): Promise<AflTradeFitzRoyStagingResult> {
  const parsed = aflTradeSourceSnapshotManifestSchema.safeParse(command.snapshot);
  const startedAt = dependencies.clock.now();
  if (
    !parsed.success ||
    parsed.data.content.capture.kind !== 'fitzroy' ||
    parsed.data.content.fitzRoyCaptureReceipt === null ||
    command.fieldMapId.trim().length === 0 ||
    !exactInstant(startedAt)
  ) {
    throw new AflTradeFitzRoyStagingError(
      'INVALID_REQUEST',
      'Provider staging requires one exact fitzRoy snapshot, field map, and UTC clock.'
    );
  }
  const snapshot = parsed.data;
  const captureReceipt = snapshot.content.fitzRoyCaptureReceipt;
  if (captureReceipt === null) {
    throw new AflTradeFitzRoyStagingError(
      'INVALID_REQUEST',
      'Provider staging requires the exact non-null fitzRoy capture receipt.'
    );
  }
  const fixtureCapture =
    captureReceipt.content.authorizationReceipt.content.request.environment === 'test_fixture';
  if (!fixtureCapture) {
    if (
      dependencies.egressExecutionVerifier === undefined ||
      captureReceipt.content.egressExecutionReceipt === null
    ) {
      throw new AflTradeFitzRoyStagingError(
        'AUTHORITY_INVALID',
        'Non-fixture staging requires the trusted provider-egress verifier.'
      );
    }
    try {
      await authenticateAflTradeFitzRoyEgressExecutionReceipt(
        captureReceipt.content.egressExecutionReceipt,
        dependencies.egressExecutionVerifier
      );
    } catch (cause) {
      throw new AflTradeFitzRoyStagingError(
        'AUTHORITY_INVALID',
        'Provider-egress execution evidence failed signature authentication.',
        { cause }
      );
    }
  }
  const capture = await dependencies.sourceCaptureRepository.persist(snapshot);
  const captureReceiptSha256 = sha256AflTradeCanonicalJson(captureReceipt);
  let phase: 'custody' | 'decode' | 'normalize' | 'persistence' = 'custody';
  try {
    const loaded = await dependencies.rawArtifactRepository.loadExact(
      snapshot.content.sourceArtifact,
      dependencies.maximumSourceBytes
    );
    if (loaded === null) {
      throw new AflTradeFitzRoyStagingError(
        'CUSTODY_UNAVAILABLE',
        'The exact retained provider RDS artifact is unavailable.'
      );
    }
    phase = 'decode';
    const decoded = await decodeAflTradeFitzRoyCapture({
      captureReceipt,
      sourceRdsBytes: loaded.bytes,
      executor: dependencies.decoderExecutor,
      dependencyLockSha256: dependencies.dependencyLockSha256,
      imageDigest: dependencies.imageDigest,
      maximumRows: dependencies.maximumRows,
      maximumFields: dependencies.maximumFields,
      maximumCells: dependencies.maximumCells,
      maximumCellBytes: dependencies.maximumCellBytes,
      maximumOutputBytes: dependencies.maximumOutputBytes,
      timeoutMs: dependencies.timeoutMs,
    });
    phase = 'normalize';
    const batch = normalizeAflTradeFitzRoyDecodedTable({
      table: decoded.table,
      fieldMap: command.fieldMap,
      decodedSha256: decoded.decodedSha256,
    });
    const completedAt = dependencies.clock.now();
    if (!exactInstant(completedAt) || Date.parse(completedAt) < Date.parse(startedAt)) {
      throw new AflTradeFitzRoyStagingError(
        'INVALID_REQUEST',
        'Provider staging completion time is invalid.'
      );
    }
    phase = 'persistence';
    const normalization = await dependencies.providerObservationRepository.persist({
      captureId: capture.captureId,
      fieldMapId: command.fieldMapId,
      fieldMap: command.fieldMap,
      decodedSha256: decoded.decodedSha256,
      batch,
      startedAt,
      completedAt,
    });
    return { capture, normalization };
  } catch (cause) {
    const completedAt = dependencies.clock.now();
    await dependencies.providerObservationRepository.recordFailure({
      captureId: capture.captureId,
      fieldMapId: command.fieldMapId,
      failureCode: failureCode(phase, cause),
      publicSafeReason: 'The provider capture could not be admitted to normalized staging.',
      captureReceiptSha256,
      startedAt,
      completedAt,
    });
    throw new AflTradeFitzRoyStagingError(
      cause instanceof AflTradeFitzRoyStagingError ? cause.code : 'STAGING_FAILED',
      'The provider capture was retained but normalized staging failed closed.',
      { cause }
    );
  }
}
