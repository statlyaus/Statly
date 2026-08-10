import { Buffer } from 'node:buffer';
import { createPublicKey, verify, type KeyObject } from 'node:crypto';

import { z } from 'zod';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflTradeFitzRoyProcessExecutor,
  AflTradeFitzRoyProcessResult,
} from './fitzRoyCaptureRuntime';
import {
  aflTradeFitzRoyEgressExecutionReceiptSchema,
  type AflTradeFitzRoyEgressExecutionReceipt,
  type AflTradeFitzRoyEgressExecutionVerifier,
} from './fitzRoyEgressExecutionReceipt';

const responseSchema = z
  .object({
    sourceBase64: z.string().min(1),
    diagnostics: z.unknown(),
    egressExecutionReceipt: aflTradeFitzRoyEgressExecutionReceiptSchema,
  })
  .strict();

export class AflTradeFitzRoyHttpEgressError extends Error {
  constructor(
    readonly code: 'INVALID_CONFIG' | 'TRANSPORT_FAILED' | 'OUTPUT_TOO_LARGE' | 'OUTPUT_INVALID',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeFitzRoyHttpEgressError';
  }
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximumBytes) {
      throw new AflTradeFitzRoyHttpEgressError(
        'OUTPUT_TOO_LARGE',
        'The egress worker response exceeded its configured byte bound.'
      );
    }
  }
  if (response.body === null) {
    throw new AflTradeFitzRoyHttpEgressError(
      'OUTPUT_INVALID',
      'The egress worker returned no response body.'
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel('response byte bound exceeded');
        throw new AflTradeFitzRoyHttpEgressError(
          'OUTPUT_TOO_LARGE',
          'The egress worker response exceeded its configured byte bound.'
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength === 0) {
    throw new AflTradeFitzRoyHttpEgressError(
      'OUTPUT_INVALID',
      'The egress worker returned an empty response.'
    );
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createAflTradeEd25519EgressExecutionVerifier(
  publicKeysById: Readonly<Record<string, string>>
): AflTradeFitzRoyEgressExecutionVerifier {
  const entries = Object.entries(publicKeysById);
  if (entries.length === 0) {
    throw new AflTradeFitzRoyHttpEgressError(
      'INVALID_CONFIG',
      'At least one trusted egress signing key is required.'
    );
  }
  const keys = new Map<string, KeyObject>();
  for (const [keyId, publicKey] of entries) {
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(keyId)) {
      throw new AflTradeFitzRoyHttpEgressError(
        'INVALID_CONFIG',
        'An egress signing key identifier is invalid.'
      );
    }
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new AflTradeFitzRoyHttpEgressError(
        'INVALID_CONFIG',
        'Every egress signing key must be Ed25519.'
      );
    }
    keys.set(keyId, key);
  }
  return {
    async verify(receipt) {
      const key = keys.get(receipt.signature.keyId);
      if (key === undefined) return false;
      return verify(
        null,
        Buffer.from(canonicalizeAflTradeJson(receipt.content), 'utf8'),
        key,
        Buffer.from(receipt.signature.valueBase64Url, 'base64url')
      );
    },
  };
}

export function createAflTradeHttpFitzRoyProcessExecutor(options: {
  endpoint: string;
  bearerToken: string;
  egressPolicyEvidenceIds: readonly string[];
  fetch?: typeof globalThis.fetch;
}): AflTradeFitzRoyProcessExecutor {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch (cause) {
    throw new AflTradeFitzRoyHttpEgressError(
      'INVALID_CONFIG',
      'The provider-egress endpoint is invalid.',
      { cause }
    );
  }
  if (
    endpoint.protocol !== 'https:' ||
    options.bearerToken.trim().length < 20 ||
    options.egressPolicyEvidenceIds.length === 0 ||
    options.egressPolicyEvidenceIds.some((id) => !/^artifact:[a-f0-9]{64}$/.test(id))
  ) {
    throw new AflTradeFitzRoyHttpEgressError(
      'INVALID_CONFIG',
      'Production egress requires HTTPS, a bearer credential, and exact policy evidence.'
    );
  }
  const request = options.fetch ?? globalThis.fetch;
  return {
    executionBoundary: 'attested_rate_limited',
    egressPolicyEvidenceIds: [...options.egressPolicyEvidenceIds],
    async execute(invocation, limits): Promise<AflTradeFitzRoyProcessResult> {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), limits.timeoutMs);
      try {
        const response = await request(endpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${options.bearerToken}`,
            'content-type': 'application/json',
          },
          body: canonicalizeAflTradeJson({ invocation, limits }),
          redirect: 'error',
          signal: abort.signal,
        });
        if (
          !response.ok ||
          response.headers.get('content-type')?.split(';')[0] !== 'application/json'
        ) {
          throw new AflTradeFitzRoyHttpEgressError(
            'TRANSPORT_FAILED',
            'The provider-egress worker returned an invalid status or media type.'
          );
        }
        const maximumEnvelopeBytes =
          Math.ceil((limits.maximumSourceBytes * 4) / 3) +
          limits.maximumDiagnosticsBytes * 2 +
          128 * 1024;
        const body = await readBoundedResponse(response, maximumEnvelopeBytes);
        const decoded = responseSchema.parse(JSON.parse(new TextDecoder().decode(body)));
        const sourceBytes = new Uint8Array(Buffer.from(decoded.sourceBase64, 'base64'));
        if (sourceBytes.byteLength === 0 || sourceBytes.byteLength > limits.maximumSourceBytes) {
          throw new AflTradeFitzRoyHttpEgressError(
            'OUTPUT_TOO_LARGE',
            'The decoded provider source exceeded its configured byte bound.'
          );
        }
        return {
          sourceBytes,
          diagnostics: decoded.diagnostics,
          egressExecutionReceipt: decoded.egressExecutionReceipt,
        };
      } catch (cause) {
        if (cause instanceof AflTradeFitzRoyHttpEgressError) throw cause;
        throw new AflTradeFitzRoyHttpEgressError(
          'TRANSPORT_FAILED',
          'The provider-egress worker request failed.',
          { cause }
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function canonicalAflTradeFitzRoyEgressSignaturePayload(
  receipt: AflTradeFitzRoyEgressExecutionReceipt
): string {
  return canonicalizeAflTradeJson(receipt.content);
}
