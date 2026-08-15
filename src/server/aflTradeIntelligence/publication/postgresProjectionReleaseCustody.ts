import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import {
  aflTradeArtifactReadbackReceiptSchema,
  verifyAflTradeArtifactReadback,
  type AflTradeArtifactReadbackReceipt,
} from '../artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_PROJECTION_RELEASE_ARTIFACT_MAX_BYTES,
  authenticateAflTradeProjectionReleaseArtifact,
  createAflTradeProjectionReleaseArtifact,
  type AflTradeProjectionReleaseArtifact,
} from './projectionReleaseArtifact';

interface TrustedTimeRow extends Record<string, unknown> {
  trusted_at: string | Date;
}

interface CustodyRow extends Record<string, unknown> {
  artifact_id: string;
  content_sha256: string;
  storage_uri: string;
  media_type: string;
  byte_length: string | number | bigint;
  artifact_class: string;
  environment: string;
  custody_profile_id: string | null;
  created_at: string | Date;
  verified_at: string | Date;
  custody_json: unknown;
}

export type AflTradeProjectionReleaseCustodyErrorCode =
  'INVALID_VERIFICATION' | 'INVALID_COMPOSITION' | 'CUSTODY_MISMATCH';

export class AflTradeProjectionReleaseCustodyError extends Error {
  constructor(
    public readonly code: AflTradeProjectionReleaseCustodyErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeProjectionReleaseCustodyError';
  }
}

export interface AflTradeProjectionReleaseCustodyResult {
  readonly releaseArtifact: AflTradeProjectionReleaseArtifact;
  readonly readback: AflTradeArtifactReadbackReceipt;
  readonly idempotentReplay: boolean;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function byteLength(value: string | number | bigint): number {
  const parsed = typeof value === 'bigint' ? value : BigInt(value);
  if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AflTradeProjectionReleaseCustodyError(
      'CUSTODY_MISMATCH',
      'Stored projection release has an invalid byte length.'
    );
  }
  return Number(parsed);
}

async function trustedNow(transaction: AflOutcomeSqlTransaction): Promise<string> {
  const result = await transaction.query<TrustedTimeRow>(
    `SELECT date_trunc('milliseconds',clock_timestamp()) AS trusted_at`
  );
  if (result.rows.length !== 1) {
    throw new AflTradeProjectionReleaseCustodyError(
      'CUSTODY_MISMATCH',
      'Projection custody could not resolve one trusted database time.'
    );
  }
  return toIso(result.rows[0].trusted_at);
}

async function loadCustodyRow(
  transaction: AflOutcomeSqlTransaction,
  artifactId: string
): Promise<CustodyRow | null> {
  const result = await transaction.query<CustodyRow>(
    `SELECT artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
            environment,custody_profile_id,created_at,verified_at,custody_json
       FROM outcome_artifact_custody
      WHERE artifact_id=$1
      FOR SHARE`,
    [artifactId]
  );
  if (result.rows.length > 1) {
    throw new AflTradeProjectionReleaseCustodyError(
      'CUSTODY_MISMATCH',
      'Projection custody lookup returned more than one immutable row.'
    );
  }
  return result.rows[0] ?? null;
}

async function authenticateStoredCustody(input: {
  row: CustodyRow;
  releaseArtifact: AflTradeProjectionReleaseArtifact;
  environment: string;
  repository: AflTradeImmutableArtifactRepository;
}): Promise<{
  reference: AflTradeArtifactRef;
  readback: AflTradeArtifactReadbackReceipt;
}> {
  const reference = aflTradeArtifactRefSchema.safeParse({
    artifactId: input.row.artifact_id,
    contentSha256: input.row.content_sha256,
    storageUri: input.row.storage_uri,
    mediaType: input.row.media_type,
    byteLength: byteLength(input.row.byte_length),
    createdAt: toIso(input.row.created_at),
  });
  const readback = aflTradeArtifactReadbackReceiptSchema.safeParse(input.row.custody_json);
  if (
    !reference.success ||
    !readback.success ||
    input.row.artifact_class !== 'public_projection' ||
    input.row.environment !== input.environment ||
    input.row.custody_profile_id !==
      (input.repository.custodyProfile === null
        ? null
        : input.repository.custodyProfile.profileId) ||
    !doAflTradeArtifactRefsExactlyMatch(reference.data, readback.data.content.artifact) ||
    readback.data.content.artifactClass !== 'public_projection' ||
    readback.data.content.custodyEnvironment !== input.environment ||
    readback.data.content.custodyProfileId !== input.row.custody_profile_id ||
    reference.data.artifactId !== input.releaseArtifact.artifactRef.artifactId ||
    reference.data.contentSha256 !== input.releaseArtifact.artifactRef.contentSha256
  ) {
    throw new AflTradeProjectionReleaseCustodyError(
      'CUSTODY_MISMATCH',
      'Stored public-projection custody does not match the authenticated release.'
    );
  }
  const loaded = await input.repository.loadExact(
    reference.data,
    AFL_TRADE_PROJECTION_RELEASE_ARTIFACT_MAX_BYTES
  );
  if (
    loaded === null ||
    !doAflTradeArtifactRefsExactlyMatch(loaded.reference, reference.data) ||
    !doesAflTradeArtifactRefMatchBytes(reference.data, loaded.bytes) ||
    !doesAflTradeArtifactRefMatchBytes(reference.data, input.releaseArtifact.bytes)
  ) {
    throw new AflTradeProjectionReleaseCustodyError(
      'CUSTODY_MISMATCH',
      'Stored public-projection bytes do not match their immutable custody row.'
    );
  }
  return { reference: reference.data, readback: readback.data };
}

export async function persistPostgresAflTradeProjectionRelease(
  input: { verification: unknown },
  dependencies: {
    client: AflOutcomeSqlClient;
    artifactRepository: AflTradeImmutableArtifactRepository;
  }
): Promise<AflTradeProjectionReleaseCustodyResult> {
  const authenticated = authenticateAflTradeProjectionReleaseArtifact(input.verification);
  if (authenticated === null) {
    throw new AflTradeProjectionReleaseCustodyError(
      'INVALID_VERIFICATION',
      'Projection custody requires one exactly replayable materialization verification.'
    );
  }
  const environment = authenticated.output.projectionManifest.content.environment;
  const profile = dependencies.artifactRepository.custodyProfile;
  const exactFixtureFilesystem =
    environment === 'test_fixture' &&
    dependencies.artifactRepository.assurance === 'fixture_filesystem' &&
    profile === null;
  const exactDurableStorage =
    dependencies.artifactRepository.assurance === 'durable_object_storage' &&
    profile !== null &&
    profile.content.environment === environment &&
    profile.content.artifactClass === 'public_projection';
  const custodyProfileId = profile === null ? null : profile.profileId;
  if (
    dependencies.artifactRepository.artifactClass !== 'public_projection' ||
    (!exactFixtureFilesystem && !exactDurableStorage)
  ) {
    throw new AflTradeProjectionReleaseCustodyError(
      'INVALID_COMPOSITION',
      'Projection custody requires exact test-fixture filesystem or durable public-projection storage in the release environment.'
    );
  }

  return dependencies.client.transaction(async (transaction) => {
    const createdAt = await trustedNow(transaction);
    const releaseArtifact = createAflTradeProjectionReleaseArtifact({
      verification: authenticated.verification,
      createdAt,
    });
    await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `outcome-valuation-projection-custody:${authenticated.output.projectionManifest.projectionId}`,
    ]);
    const existing = await loadCustodyRow(transaction, releaseArtifact.artifactRef.artifactId);
    if (existing !== null) {
      const stored = await authenticateStoredCustody({
        row: existing,
        releaseArtifact,
        environment,
        repository: dependencies.artifactRepository,
      });
      return Object.freeze({
        releaseArtifact: Object.freeze({ ...releaseArtifact, artifactRef: stored.reference }),
        readback: stored.readback,
        idempotentReplay: true,
      });
    }

    const persisted = await dependencies.artifactRepository.putIfAbsent(
      releaseArtifact.artifactRef,
      releaseArtifact.bytes
    );
    if (!doAflTradeArtifactRefsExactlyMatch(persisted.reference, releaseArtifact.artifactRef)) {
      throw new AflTradeProjectionReleaseCustodyError(
        'CUSTODY_MISMATCH',
        'Immutable storage returned a different projection release reference.'
      );
    }
    const verifiedAt = await trustedNow(transaction);
    const readback = await verifyAflTradeArtifactReadback(
      dependencies.artifactRepository,
      releaseArtifact.artifactRef,
      verifiedAt,
      AFL_TRADE_PROJECTION_RELEASE_ARTIFACT_MAX_BYTES
    );
    await transaction.query(
      `INSERT INTO outcome_artifact_custody
        (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
         environment,custody_profile_id,created_at,verified_at,custody_json)
       VALUES ($1,$2,$3,$4,$5,$6::"OutcomeArtifactClass",$7::"OutcomeEnvironment",$8,$9,$10,$11::jsonb)
       ON CONFLICT (artifact_id) DO NOTHING`,
      [
        releaseArtifact.artifactRef.artifactId,
        releaseArtifact.artifactRef.contentSha256,
        releaseArtifact.artifactRef.storageUri,
        releaseArtifact.artifactRef.mediaType,
        releaseArtifact.artifactRef.byteLength,
        'public_projection',
        environment,
        custodyProfileId,
        releaseArtifact.artifactRef.createdAt,
        verifiedAt,
        canonicalizeAflTradeJson(readback),
      ]
    );
    const storedRow = await loadCustodyRow(transaction, releaseArtifact.artifactRef.artifactId);
    if (storedRow === null) {
      throw new AflTradeProjectionReleaseCustodyError(
        'CUSTODY_MISMATCH',
        'Projection custody insert did not produce one immutable row.'
      );
    }
    const stored = await authenticateStoredCustody({
      row: storedRow,
      releaseArtifact,
      environment,
      repository: dependencies.artifactRepository,
    });
    return Object.freeze({
      releaseArtifact: Object.freeze({ ...releaseArtifact, artifactRef: stored.reference }),
      readback: stored.readback,
      idempotentReplay: false,
    });
  });
}
