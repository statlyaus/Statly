import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from './artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from './contentAddress';
import {
  aflTradeArtifactCustodyProfileSchema,
  type AflTradeArtifactCustodyClass,
  type AflTradeArtifactCustodyEnvironment,
  type AflTradeArtifactCustodyProfile,
} from './artifactCustodyProfile';

export const AFL_TRADE_ARTIFACT_CUSTODY_ERROR_CODES = [
  'INVALID_REFERENCE',
  'INVALID_BYTES',
  'ARTIFACT_TOO_LARGE',
  'IMMUTABLE_CONFLICT',
  'READBACK_MISMATCH',
  'STORAGE_POLICY_MISMATCH',
  'STORAGE_UNAVAILABLE',
] as const;

export type AflTradeArtifactCustodyErrorCode =
  (typeof AFL_TRADE_ARTIFACT_CUSTODY_ERROR_CODES)[number];

export class AflTradeArtifactCustodyError extends Error {
  constructor(
    public readonly code: AflTradeArtifactCustodyErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeArtifactCustodyError';
  }
}

export interface AflTradeImmutableArtifactRepository {
  readonly assurance: 'fixture_memory' | 'durable_object_storage';
  readonly artifactClass: AflTradeArtifactCustodyClass;
  readonly custodyProfile: AflTradeArtifactCustodyProfile | null;
  putIfAbsent(
    reference: AflTradeArtifactRef,
    bytes: Uint8Array
  ): Promise<{
    status: 'stored' | 'already_present';
    reference: AflTradeArtifactRef;
  }>;
  loadExact(
    reference: AflTradeArtifactRef,
    maximumBytes: number
  ): Promise<{ reference: AflTradeArtifactRef; bytes: Uint8Array } | null>;
}

export const aflTradeArtifactReadbackReceiptContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-artifact-readback/v4'),
    artifact: aflTradeArtifactRefSchema,
    repositoryAssurance: z.enum(['fixture_memory', 'durable_object_storage']),
    artifactClass: z.enum([
      'raw_source',
      'capture_metadata',
      'derived_private',
      'public_projection',
    ]),
    custodyProfileId: aflTradeContentAddressedIdSchema('artifact-custody-profile').nullable(),
    custodyProfile: aflTradeArtifactCustodyProfileSchema.nullable(),
    custodyEnvironment: z.enum(['test_fixture', 'non_production', 'production']),
    verifiedAt: z.iso.datetime({ offset: true }),
    verification: z.literal('exact_reference_and_sha256_bytes'),
    status: z.literal('passed'),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (Date.parse(receipt.verifiedAt) < Date.parse(receipt.artifact.createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['verifiedAt'],
        message: 'Read-back verification cannot predate artifact creation.',
      });
    }
    if (
      (receipt.repositoryAssurance === 'fixture_memory' &&
        (receipt.custodyProfileId !== null ||
          receipt.custodyProfile !== null ||
          receipt.custodyEnvironment !== 'test_fixture')) ||
      (receipt.repositoryAssurance === 'durable_object_storage' &&
        (receipt.custodyProfileId === null ||
          receipt.custodyProfile === null ||
          receipt.custodyProfile.profileId !== receipt.custodyProfileId ||
          receipt.custodyProfile.content.environment !== receipt.custodyEnvironment ||
          receipt.custodyProfile.content.artifactClass !== receipt.artifactClass))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['custodyProfileId'],
        message:
          'Fixture custody must remain test-only; durable custody must bind its complete content-addressed profile, class, and environment.',
      });
    }
  });

export const aflTradeArtifactReadbackReceiptSchema = z
  .object({
    receiptId: aflTradeContentAddressedIdSchema('artifact-readback'),
    content: aflTradeArtifactReadbackReceiptContentSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'artifact-readback',
      receipt.receiptId,
      receipt.content,
      context,
      ['receiptId']
    );
  });

export type AflTradeArtifactReadbackReceipt = z.infer<typeof aflTradeArtifactReadbackReceiptSchema>;

function requireMaximumBytes(maximumBytes: number) {
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) {
    throw new AflTradeArtifactCustodyError(
      'ARTIFACT_TOO_LARGE',
      'Artifact reads require a positive integer byte bound.'
    );
  }
}

export async function verifyAflTradeArtifactReadback(
  repository: AflTradeImmutableArtifactRepository,
  reference: AflTradeArtifactRef,
  verifiedAt: string,
  maximumBytes: number
): Promise<AflTradeArtifactReadbackReceipt> {
  const parsedReference = aflTradeArtifactRefSchema.safeParse(reference);
  if (!parsedReference.success) {
    throw new AflTradeArtifactCustodyError(
      'INVALID_REFERENCE',
      'Read-back verification requires one valid immutable artifact reference.'
    );
  }
  requireMaximumBytes(maximumBytes);
  if (parsedReference.data.byteLength > maximumBytes) {
    throw new AflTradeArtifactCustodyError(
      'ARTIFACT_TOO_LARGE',
      'The declared artifact exceeds the permitted read bound.'
    );
  }
  const stored = await repository.loadExact(parsedReference.data, maximumBytes);
  if (
    stored === null ||
    !doAflTradeArtifactRefsExactlyMatch(parsedReference.data, stored.reference) ||
    !doesAflTradeArtifactRefMatchBytes(
      stored.reference,
      stored.bytes,
      parsedReference.data.mediaType
    )
  ) {
    throw new AflTradeArtifactCustodyError(
      'READBACK_MISMATCH',
      'Stored artifact bytes do not match their immutable reference.'
    );
  }
  const content = aflTradeArtifactReadbackReceiptContentSchema.parse({
    schemaVersion: 'afl-trade-artifact-readback/v4',
    artifact: parsedReference.data,
    repositoryAssurance: repository.assurance,
    artifactClass: repository.artifactClass,
    custodyProfileId: repository.custodyProfile?.profileId ?? null,
    custodyProfile: repository.custodyProfile,
    custodyEnvironment: (repository.custodyProfile?.content.environment ??
      'test_fixture') satisfies AflTradeArtifactCustodyEnvironment,
    verifiedAt,
    verification: 'exact_reference_and_sha256_bytes',
    status: 'passed',
  });
  return aflTradeArtifactReadbackReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('artifact-readback', content),
    content,
  });
}

/** Test-only reference implementation. It is never a production fallback or public data source. */
export function createAflTradeFixtureArtifactRepository(options?: {
  artifactClass?: AflTradeArtifactCustodyClass;
}): AflTradeImmutableArtifactRepository {
  const stored = new Map<string, { reference: AflTradeArtifactRef; bytes: Uint8Array }>();
  return {
    assurance: 'fixture_memory',
    artifactClass: options?.artifactClass ?? 'capture_metadata',
    custodyProfile: null,
    async putIfAbsent(reference, bytes) {
      const parsedReference = aflTradeArtifactRefSchema.safeParse(reference);
      if (!parsedReference.success) {
        throw new AflTradeArtifactCustodyError(
          'INVALID_REFERENCE',
          'Artifact custody requires one valid immutable reference.'
        );
      }
      if (
        !doesAflTradeArtifactRefMatchBytes(
          parsedReference.data,
          bytes,
          parsedReference.data.mediaType
        )
      ) {
        throw new AflTradeArtifactCustodyError(
          'INVALID_BYTES',
          'Artifact bytes do not match their immutable reference.'
        );
      }
      const existing = stored.get(parsedReference.data.artifactId);
      if (existing) {
        if (
          existing.reference.mediaType !== parsedReference.data.mediaType ||
          !doesAflTradeArtifactRefMatchBytes(
            existing.reference,
            bytes,
            parsedReference.data.mediaType
          )
        ) {
          throw new AflTradeArtifactCustodyError(
            'IMMUTABLE_CONFLICT',
            'An immutable artifact identifier cannot be overwritten.'
          );
        }
        return { status: 'already_present', reference: { ...existing.reference } };
      }
      stored.set(parsedReference.data.artifactId, {
        reference: parsedReference.data,
        bytes: Uint8Array.from(bytes),
      });
      return { status: 'stored', reference: { ...parsedReference.data } };
    },
    async loadExact(reference, maximumBytes) {
      const parsedReference = aflTradeArtifactRefSchema.safeParse(reference);
      if (!parsedReference.success) {
        throw new AflTradeArtifactCustodyError(
          'INVALID_REFERENCE',
          'Exact artifact reads require one valid immutable reference.'
        );
      }
      requireMaximumBytes(maximumBytes);
      if (parsedReference.data.byteLength > maximumBytes) {
        throw new AflTradeArtifactCustodyError(
          'ARTIFACT_TOO_LARGE',
          'The declared artifact exceeds the permitted read bound.'
        );
      }
      const existing = stored.get(parsedReference.data.artifactId);
      if (!existing) return null;
      if (existing.bytes.byteLength > maximumBytes) {
        throw new AflTradeArtifactCustodyError(
          'ARTIFACT_TOO_LARGE',
          'Stored artifact bytes exceed the permitted read bound.'
        );
      }
      return {
        reference: { ...existing.reference },
        bytes: Uint8Array.from(existing.bytes),
      };
    },
  };
}
