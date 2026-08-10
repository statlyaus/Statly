import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
} from './contentAddress';

const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE = 'application/json' as const;

/**
 * Identifies immutable bytes through a content digest and a provider-neutral logical URI. The URI is
 * deliberately not a mutable HTTP/object-store location; storage resolution belongs to the eventual
 * approved artifact repository.
 */
export const aflTradeArtifactRefSchema = z
  .object({
    artifactId: aflTradeContentAddressedIdSchema('artifact'),
    contentSha256: aflTradeSha256Schema,
    storageUri: z.string().regex(/^artifact:\/\/sha256\/[a-f0-9]{64}$/),
    mediaType: z.string().trim().min(1).max(160),
    byteLength: z.number().int().nonnegative(),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    const expectedId = `artifact:${artifact.contentSha256}`;
    const expectedUri = `artifact://sha256/${artifact.contentSha256}`;
    if (artifact.artifactId !== expectedId) {
      context.addIssue({
        code: 'custom',
        path: ['artifactId'],
        message: 'The artifact identifier must match the immutable byte digest.',
      });
    }
    if (artifact.storageUri !== expectedUri) {
      context.addIssue({
        code: 'custom',
        path: ['storageUri'],
        message: 'The logical storage URI must match the immutable byte digest.',
      });
    }
  });

export type AflTradeArtifactRef = z.infer<typeof aflTradeArtifactRefSchema>;

export function doAflTradeArtifactRefsExactlyMatch(
  left: AflTradeArtifactRef,
  right: AflTradeArtifactRef
): boolean {
  return (
    left.artifactId === right.artifactId &&
    left.contentSha256 === right.contentSha256 &&
    left.storageUri === right.storageUri &&
    left.mediaType === right.mediaType &&
    left.byteLength === right.byteLength &&
    left.createdAt === right.createdAt
  );
}

function copyAflTradeArtifactBytes(bytes: Uint8Array): Uint8Array {
  if (
    !ArrayBuffer.isView(bytes) ||
    !('length' in bytes) ||
    typeof bytes.length !== 'number' ||
    bytes.byteLength !== bytes.length
  ) {
    throw new TypeError('Artifact bytes must be supplied as a Uint8Array.');
  }
  return Uint8Array.from(bytes);
}

export function createAflTradeByteArtifactRef(
  bytes: Uint8Array,
  mediaType: string,
  createdAt: string
): AflTradeArtifactRef {
  const immutableBytes = copyAflTradeArtifactBytes(bytes);
  const contentSha256 = createHash('sha256').update(immutableBytes).digest('hex');
  return aflTradeArtifactRefSchema.parse({
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType,
    byteLength: immutableBytes.byteLength,
    createdAt,
  });
}

export function doesAflTradeArtifactRefMatchBytes(
  reference: unknown,
  bytes: Uint8Array,
  expectedMediaType?: string
): reference is AflTradeArtifactRef {
  try {
    const parsed = aflTradeArtifactRefSchema.safeParse(reference);
    if (!parsed.success || (expectedMediaType && parsed.data.mediaType !== expectedMediaType)) {
      return false;
    }
    const expected = createAflTradeByteArtifactRef(
      bytes,
      parsed.data.mediaType,
      parsed.data.createdAt
    );
    return (
      parsed.data.artifactId === expected.artifactId &&
      parsed.data.contentSha256 === expected.contentSha256 &&
      parsed.data.storageUri === expected.storageUri &&
      parsed.data.byteLength === expected.byteLength
    );
  } catch {
    return false;
  }
}

export function createAflTradeCanonicalJsonArtifactRef(
  value: unknown,
  createdAt: string
): AflTradeArtifactRef {
  const canonicalJson = canonicalizeAflTradeJson(value);
  return createAflTradeByteArtifactRef(
    new TextEncoder().encode(canonicalJson),
    AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
    createdAt
  );
}

export function doesAflTradeArtifactRefMatchCanonicalJson(
  reference: unknown,
  value: unknown
): reference is AflTradeArtifactRef {
  try {
    const parsed = aflTradeArtifactRefSchema.safeParse(reference);
    if (!parsed.success || parsed.data.mediaType !== AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE) {
      return false;
    }
    const expected = createAflTradeCanonicalJsonArtifactRef(value, parsed.data.createdAt);
    return (
      parsed.data.artifactId === expected.artifactId &&
      parsed.data.contentSha256 === expected.contentSha256 &&
      parsed.data.storageUri === expected.storageUri &&
      parsed.data.byteLength === expected.byteLength
    );
  } catch {
    return false;
  }
}
