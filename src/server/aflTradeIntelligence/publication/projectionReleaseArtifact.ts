import { z } from 'zod';

import {
  createAflTradeByteArtifactRef,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  aflTradeCustodiedProjectionManifestMaterializationVerifyInputSchema,
  aflTradeProjectionManifestMaterializationVerifyInputSchema,
  authenticateAflTradeCustodiedProjectionManifestMaterialization,
  authenticateAflTradeProjectionManifestMaterializationVerification,
  verifyAflTradeCustodiedProjectionManifestMaterialization,
  verifyAflTradeProjectionManifestMaterialization,
} from './projectionManifestMaterialization';

export const AFL_TRADE_PROJECTION_RELEASE_ARTIFACT_MAX_BYTES = 128 * 1024 * 1024;

const verificationSchema = z.union([
  aflTradeProjectionManifestMaterializationVerifyInputSchema,
  aflTradeCustodiedProjectionManifestMaterializationVerifyInputSchema,
]);

const createInputSchema = z
  .object({
    verification: verificationSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AflTradeProjectionReleaseVerification = z.infer<typeof verificationSchema>;

export interface AflTradeProjectionReleaseArtifact {
  readonly verification: AflTradeProjectionReleaseVerification;
  readonly bytes: Uint8Array;
  readonly artifactRef: AflTradeArtifactRef;
}

export interface AflTradeProjectionReleaseAuthentication {
  readonly verification: AflTradeProjectionReleaseVerification;
  readonly output: AflTradeProjectionReleaseVerification['output'];
}

function isCustodied(
  verification: AflTradeProjectionReleaseVerification
): verification is z.infer<
  typeof aflTradeCustodiedProjectionManifestMaterializationVerifyInputSchema
> {
  return Object.prototype.hasOwnProperty.call(verification, 'custodyIndexVerification');
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (
    value === null ||
    typeof value !== 'object' ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  ) {
    return value;
  }
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

export function authenticateAflTradeProjectionReleaseArtifact(
  unparsedVerification: unknown
): AflTradeProjectionReleaseAuthentication | null {
  try {
    const parsed = verificationSchema.safeParse(structuredClone(unparsedVerification));
    if (!parsed.success) return null;
    if (isCustodied(parsed.data)) {
      const output = authenticateAflTradeCustodiedProjectionManifestMaterialization(parsed.data);
      return output === null
        ? null
        : deepFreeze({ verification: parsed.data, output });
    }
    const authenticated =
      authenticateAflTradeProjectionManifestMaterializationVerification(parsed.data);
    return authenticated === null
      ? null
      : deepFreeze({
          verification: authenticated.verification,
          output: authenticated.output,
        });
  } catch {
    return null;
  }
}

export function createAflTradeProjectionReleaseArtifact(
  unparsedInput: unknown
): AflTradeProjectionReleaseArtifact {
  const input = createInputSchema.parse(structuredClone(unparsedInput));
  const verified = isCustodied(input.verification)
    ? verifyAflTradeCustodiedProjectionManifestMaterialization(input.verification)
    : verifyAflTradeProjectionManifestMaterialization(input.verification);
  if (!verified) {
    throw new TypeError('Projection release requires one exact replayable verification envelope.');
  }

  const manifestCreatedAt = input.verification.output.projectionManifest.content.createdAt;
  const manifestArtifactCreatedAt =
    input.verification.output.projectionManifestArtifactRef.createdAt;
  if (
    Date.parse(input.createdAt) < Date.parse(manifestCreatedAt) ||
    Date.parse(input.createdAt) < Date.parse(manifestArtifactCreatedAt)
  ) {
    throw new TypeError('Projection release custody cannot predate its exact manifest evidence.');
  }

  const canonicalJson = canonicalizeAflTradeJson(input.verification);
  const bytes = new TextEncoder().encode(canonicalJson);
  if (bytes.byteLength > AFL_TRADE_PROJECTION_RELEASE_ARTIFACT_MAX_BYTES) {
    throw new TypeError('Projection release exceeds the fixed public artifact byte limit.');
  }

  return Object.freeze({
    verification: deepFreeze(input.verification),
    bytes,
    artifactRef: createAflTradeByteArtifactRef(bytes, 'application/json', input.createdAt),
  });
}
