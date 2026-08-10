export const AFL_TRADE_CONDITIONAL_OBJECT_STORE_ERROR_CODES = [
  'INVALID_REQUEST',
  'ALREADY_EXISTS',
  'NOT_FOUND',
  'PRECONDITION_FAILED',
  'INTEGRITY_MISMATCH',
  'OBJECT_TOO_LARGE',
  'TRANSPORT_FAILURE',
] as const;

export type AflTradeConditionalObjectStoreErrorCode =
  (typeof AFL_TRADE_CONDITIONAL_OBJECT_STORE_ERROR_CODES)[number];

export class AflTradeConditionalObjectStoreError extends Error {
  constructor(
    public readonly code: AflTradeConditionalObjectStoreErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeConditionalObjectStoreError';
  }
}

export interface AflTradeConditionalObjectIdentity {
  objectKey: string;
  versionId: string;
  eTag: string;
  byteLength: number;
  mediaType: string;
  checksumSha256: string;
  metadata: Readonly<Record<string, string>>;
  encryption:
    | {
        mode: 'provider_managed';
        keyReferenceSha256: null;
      }
    | {
        mode: 'provider_kms';
        keyReferenceSha256: string;
      };
  writeOnceRetention: {
    mode: 'governance' | 'compliance' | null;
    retainUntil: string | null;
    legalHold: 'on' | 'off' | null;
  } | null;
}

export interface AflTradeConditionalObjectCreateRequest {
  objectKey: string;
  bytes: Uint8Array;
  mediaType: string;
  checksumSha256: string;
  metadata: Readonly<Record<string, string>>;
}

export interface AflTradeConditionalObjectHeadRequest {
  objectKey: string;
  versionId?: string;
}

export interface AflTradeConditionalObjectReadRequest {
  objectKey: string;
  versionId: string;
  eTag: string;
  expectedByteLength: number;
  expectedMediaType: string;
  expectedChecksumSha256: string;
  expectedMetadata: Readonly<Record<string, string>>;
  maximumBytes: number;
}

export interface AflTradeConditionalObjectReadResult {
  identity: AflTradeConditionalObjectIdentity;
  bytes: Uint8Array;
}

/**
 * Minimal immutable-object transport. Authority, credentials, bucket lifecycle, retention, and
 * artifact-domain mapping belong to separately reviewed composition layers.
 */
export interface AflTradeConditionalObjectStore {
  createIfAbsent(
    request: AflTradeConditionalObjectCreateRequest
  ): Promise<AflTradeConditionalObjectIdentity>;
  headExact(
    request: AflTradeConditionalObjectHeadRequest
  ): Promise<AflTradeConditionalObjectIdentity | null>;
  readExactBounded(
    request: AflTradeConditionalObjectReadRequest
  ): Promise<AflTradeConditionalObjectReadResult>;
}
