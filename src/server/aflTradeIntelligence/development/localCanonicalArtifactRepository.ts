import { z } from 'zod';
import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchBytes,
  doAflTradeArtifactRefsExactlyMatch,
} from '../artifacts/artifactReference';
import {
  AflTradeArtifactCustodyError,
  aflTradeArtifactReadbackReceiptSchema,
  type AflTradeImmutableArtifactRepository,
} from '../artifacts/immutableArtifactRepository';

const retainedCustodySchema = z
  .object({
    artifact: aflTradeArtifactRefSchema,
    artifactClass: z.enum(['raw_source', 'capture_metadata']),
    environment: z.literal('non_production'),
    custodyProfileId: z.null(),
    readback: aflTradeArtifactReadbackReceiptSchema,
  })
  .strict();

/** Reuses an existing canonical reference, never replacing custody or granting capture authority. */
export function createLocalAflTradeCanonicalArtifactRepository(input: {
  repository: AflTradeImmutableArtifactRepository;
  /** Read-only lookup from the retained custody owner, not caller-supplied source metadata. */
  lookup: (artifactId: string) => Promise<unknown | null>;
}): AflTradeImmutableArtifactRepository {
  const repository = input.repository;
  if (
    repository.assurance !== 'local_non_production_filesystem' ||
    repository.custodyProfile !== null ||
    !['raw_source', 'capture_metadata'].includes(repository.artifactClass)
  ) {
    throw new AflTradeArtifactCustodyError(
      'STORAGE_POLICY_MISMATCH',
      'Canonical reuse requires private local source or metadata custody.'
    );
  }
  return {
    assurance: repository.assurance,
    artifactClass: repository.artifactClass,
    custodyProfile: repository.custodyProfile,
    loadExact: (reference, maximumBytes) => repository.loadExact(reference, maximumBytes),
    async putIfAbsent(unparsedReference, bytes) {
      const proposed = aflTradeArtifactRefSchema.parse(unparsedReference);
      if (!doesAflTradeArtifactRefMatchBytes(proposed, bytes, proposed.mediaType)) {
        throw new AflTradeArtifactCustodyError(
          'INVALID_BYTES',
          'Incoming bytes do not match the proposed immutable reference.'
        );
      }
      const retained = await input.lookup(proposed.artifactId);
      if (retained === null) return repository.putIfAbsent(proposed, bytes);
      const parsed = retainedCustodySchema.safeParse(retained);
      if (!parsed.success)
        throw new AflTradeArtifactCustodyError(
          'IMMUTABLE_CONFLICT',
          'Retained canonical custody is malformed or outside the private capture boundary.'
        );
      const custody = parsed.data;
      const readback = custody.readback.content;
      if (
        custody.artifactClass !== repository.artifactClass ||
        readback.artifactClass !== custody.artifactClass ||
        readback.custodyEnvironment !== custody.environment ||
        readback.custodyProfileId !== custody.custodyProfileId ||
        readback.custodyProfile !== null ||
        readback.repositoryAssurance !== repository.assurance ||
        !doAflTradeArtifactRefsExactlyMatch(custody.artifact, readback.artifact) ||
        !doAflTradeArtifactRefsExactlyMatch(
          { ...proposed, createdAt: custody.artifact.createdAt },
          custody.artifact
        ) ||
        !doesAflTradeArtifactRefMatchBytes(custody.artifact, bytes, proposed.mediaType)
      ) {
        throw new AflTradeArtifactCustodyError(
          'IMMUTABLE_CONFLICT',
          'Retained canonical reference does not bind these exact bytes and custody.'
        );
      }
      const stored = await repository.putIfAbsent(custody.artifact, bytes);
      if (!doAflTradeArtifactRefsExactlyMatch(stored.reference, custody.artifact)) {
        throw new AflTradeArtifactCustodyError(
          'IMMUTABLE_CONFLICT',
          'Local storage already binds a different immutable reference.'
        );
      }
      return stored;
    },
  };
}
