import { z } from 'zod';

import { aflTradeContentAddressedIdSchema, aflTradeSha256Schema } from './contentAddress';

const isoDateTimeSchema = z.iso.datetime({ offset: true });

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
