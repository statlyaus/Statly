import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createAflTradeFitzRoyInvocation } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import { createAflTradeFitzRoyEgressExecutionReceipt } from '@/server/aflTradeIntelligence/source/fitzRoyEgressExecutionReceipt';
import {
  canonicalAflTradeFitzRoyEgressSignaturePayload,
  createAflTradeEd25519EgressExecutionVerifier,
  createAflTradeHttpFitzRoyProcessExecutor,
} from '@/server/aflTradeIntelligence/source/fitzRoyHttpEgressExecutor';

const sha = (value: string) => value.repeat(64);
const evidenceId = `artifact:${sha('a')}`;
const invocation = createAflTradeFitzRoyInvocation({
  schemaVersion: 'afl-trade-fitzroy-capture-request/v1',
  capabilityId: 'footywire-player-stats',
  competition: 'AFLM',
  authorizationSeason: 2026,
  parameters: { season: 2026, checkExisting: true },
});

function signedReceipt() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const unsigned = createAflTradeFitzRoyEgressExecutionReceipt({
    content: {
      schemaVersion: 'afl-trade-fitzroy-egress-execution/v1',
      executionBoundary: 'attested_provider_egress',
      provider: 'footywire',
      capabilityId: 'footywire-player-stats',
      directFunction: 'fetch_player_stats_footywire',
      fitzRoyVersion: '1.7.0',
      invocationSha256: sha('b'),
      sourceOutput: { contentSha256: sha('c'), byteLength: 4 },
      diagnosticsOutput: { contentSha256: sha('d'), byteLength: 20 },
      runtime: {
        rVersion: '4.5.1',
        dependencyLockSha256: sha('e'),
        imageDigest: `sha256:${sha('f')}`,
      },
      enforcedPolicy: {
        upstreamRate: { requests: 1, perSeconds: 60, burst: 1 },
        cacheSeconds: 86_400,
        egressPolicyEvidenceId: evidenceId,
      },
      startedAt: '2026-08-08T00:00:00.000Z',
      completedAt: '2026-08-08T00:00:01.000Z',
      status: 'succeeded',
    },
    signature: {
      algorithm: 'Ed25519',
      keyId: 'worker-2026',
      valueBase64Url: 'A'.repeat(86),
    },
  });
  const signature = sign(
    null,
    Buffer.from(canonicalAflTradeFitzRoyEgressSignaturePayload(unsigned), 'utf8'),
    privateKey
  ).toString('base64url');
  return {
    receipt: createAflTradeFitzRoyEgressExecutionReceipt({
      content: unsigned.content,
      signature: { ...unsigned.signature, valueBase64Url: signature },
    }),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('fitzRoy HTTPS egress execution', () => {
  it('authenticates canonical receipts with the configured Ed25519 keyring', async () => {
    const fixture = signedReceipt();
    const verifier = createAflTradeEd25519EgressExecutionVerifier({
      'worker-2026': fixture.publicKeyPem,
    });

    await expect(verifier.verify(fixture.receipt)).resolves.toBe(true);
    await expect(
      createAflTradeEd25519EgressExecutionVerifier({ other: fixture.publicKeyPem }).verify(
        fixture.receipt
      )
    ).resolves.toBe(false);
  });

  it('returns exact bounded source, diagnostics, and signed execution evidence', async () => {
    const fixture = signedReceipt();
    const fetch = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            sourceBase64: Buffer.from('RDS!').toString('base64'),
            diagnostics: { rowCount: 1 },
            egressExecutionReceipt: fixture.receipt,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    );
    const executor = createAflTradeHttpFitzRoyProcessExecutor({
      endpoint: 'https://egress.example.test/v1/capture',
      bearerToken: 'task-scoped-bearer-token-value',
      egressPolicyEvidenceIds: [evidenceId],
      fetch,
    });

    const result = await executor.execute(invocation, {
      timeoutMs: 1_000,
      maximumSourceBytes: 100,
      maximumDiagnosticsBytes: 1_000,
    });

    expect(new TextDecoder().decode(result.sourceBytes)).toBe('RDS!');
    expect(result.diagnostics).toEqual({ rowCount: 1 });
    expect(result.egressExecutionReceipt).toEqual(fixture.receipt);
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://egress.example.test/v1/capture'),
      expect.objectContaining({ method: 'POST', redirect: 'error' })
    );
  });

  it('rejects unsafe endpoints and oversized worker responses', async () => {
    expect(() =>
      createAflTradeHttpFitzRoyProcessExecutor({
        endpoint: 'http://egress.example.test/v1/capture',
        bearerToken: 'task-scoped-bearer-token-value',
        egressPolicyEvidenceIds: [evidenceId],
      })
    ).toThrow('Production egress requires HTTPS');

    const executor = createAflTradeHttpFitzRoyProcessExecutor({
      endpoint: 'https://egress.example.test/v1/capture',
      bearerToken: 'task-scoped-bearer-token-value',
      egressPolicyEvidenceIds: [evidenceId],
      fetch: async () =>
        new Response('x', {
          status: 200,
          headers: { 'content-type': 'application/json', 'content-length': '999999' },
        }),
    });
    await expect(
      executor.execute(invocation, {
        timeoutMs: 1_000,
        maximumSourceBytes: 10,
        maximumDiagnosticsBytes: 10,
      })
    ).rejects.toThrow('exceeded its configured byte bound');
  });
});
