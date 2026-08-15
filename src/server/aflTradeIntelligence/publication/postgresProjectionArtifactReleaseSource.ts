import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
} from '../artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
  type AflTradeProjectionArtifactReleaseSource,
} from './projectionArtifactReadRepository';

interface ProjectionCustodyRow extends Record<string, unknown> {
  projection_id: string;
  artifact_id: string;
  content_sha256: string;
  storage_uri: string;
  media_type: string;
  byte_length: string | number | bigint;
  created_at: string | Date;
  artifact_class: string;
  environment: string;
  custody_profile_id: string | null;
}

export type AflTradeProjectionReleaseSourceErrorCode =
  | 'INVALID_COMPOSITION'
  | 'INVALID_REQUEST'
  | 'INVALID_CUSTODY'
  | 'ARTIFACT_TOO_LARGE'
  | 'READBACK_MISMATCH';

export class AflTradeProjectionReleaseSourceError extends Error {
  constructor(
    public readonly code: AflTradeProjectionReleaseSourceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeProjectionReleaseSourceError';
  }
}

function byteLength(value: string | number | bigint): number {
  const numeric = typeof value === 'bigint' ? value : BigInt(value);
  if (numeric < 0n || numeric > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AflTradeProjectionReleaseSourceError(
      'INVALID_CUSTODY',
      'Projection custody byte length is outside the safe bounded-read range.'
    );
  }
  return Number(numeric);
}

export function createPostgresAflTradeProjectionArtifactReleaseSource(input: {
  client: AflOutcomeSqlClient;
  artifactRepository: AflTradeImmutableArtifactRepository;
}): AflTradeProjectionArtifactReleaseSource {
  const profile = input.artifactRepository.custodyProfile;
  const fixtureFilesystem =
    input.artifactRepository.assurance === 'fixture_filesystem' && profile === null;
  const exactDurableStorage =
    input.artifactRepository.assurance === 'durable_object_storage' &&
    profile !== null &&
    profile.content.artifactClass === 'public_projection';
  if (
    input.artifactRepository.artifactClass !== 'public_projection' ||
    (!fixtureFilesystem && !exactDurableStorage)
  ) {
    throw new AflTradeProjectionReleaseSourceError(
      'INVALID_COMPOSITION',
      'Public valuation serving requires exact fixture-filesystem or durable public-projection custody.'
    );
  }

  return {
    async loadRelease(projectionId, limit) {
      const parsedProjectionId =
        aflTradeContentAddressedIdSchema('projection').safeParse(projectionId);
      if (
        !parsedProjectionId.success ||
        limit.maxBytes !== AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES
      ) {
        throw new AflTradeProjectionReleaseSourceError(
          'INVALID_REQUEST',
          'Projection release reads require an exact projection ID and the fixed public bound.'
        );
      }
      const result = await input.client.query<ProjectionCustodyRow>(
        `SELECT p.projection_id, a.artifact_id, a.content_sha256, a.storage_uri,
                a.media_type, a.byte_length, a.created_at, a.artifact_class,
                a.environment, a.custody_profile_id
           FROM outcome_valuation_projection_manifest p
           JOIN outcome_artifact_custody a ON a.artifact_id = p.artifact_id
          WHERE p.projection_id = $1`,
        [parsedProjectionId.data]
      );
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) {
        throw new AflTradeProjectionReleaseSourceError(
          'INVALID_CUSTODY',
          'Projection custody lookup did not resolve exactly one immutable binding.'
        );
      }
      const row = result.rows[0];
      if (
        row.projection_id !== parsedProjectionId.data ||
        row.artifact_class !== 'public_projection' ||
        (fixtureFilesystem
          ? row.environment !== 'test_fixture' || row.custody_profile_id !== null
          : row.environment !== profile?.content.environment ||
            row.custody_profile_id !== profile?.profileId)
      ) {
        throw new AflTradeProjectionReleaseSourceError(
          'INVALID_CUSTODY',
          'Projection custody metadata does not match the requested public projection.'
        );
      }
      let reference;
      try {
        reference = aflTradeArtifactRefSchema.parse({
          artifactId: row.artifact_id,
          contentSha256: row.content_sha256,
          storageUri: row.storage_uri,
          mediaType: row.media_type,
          byteLength: byteLength(row.byte_length),
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        });
      } catch (cause) {
        if (cause instanceof AflTradeProjectionReleaseSourceError) throw cause;
        throw new AflTradeProjectionReleaseSourceError(
          'INVALID_CUSTODY',
          'Projection custody metadata does not form an exact artifact reference.',
          { cause }
        );
      }
      if (reference.byteLength > limit.maxBytes) {
        throw new AflTradeProjectionReleaseSourceError(
          'ARTIFACT_TOO_LARGE',
          'Projection artifact exceeds the public release maximum.'
        );
      }
      const loaded = await input.artifactRepository.loadExact(reference, limit.maxBytes);
      if (loaded === null) return null;
      if (
        !doAflTradeArtifactRefsExactlyMatch(loaded.reference, reference) ||
        !doesAflTradeArtifactRefMatchBytes(reference, loaded.bytes)
      ) {
        throw new AflTradeProjectionReleaseSourceError(
          'READBACK_MISMATCH',
          'Projection artifact read-back does not match its exact custody reference.'
        );
      }
      return Uint8Array.from(loaded.bytes);
    },
  };
}
