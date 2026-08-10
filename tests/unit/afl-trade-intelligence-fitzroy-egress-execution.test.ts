import { describe, expect, it, vi } from 'vitest';

import {
  AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION,
  aflTradeFitzRoyEgressExecutionReceiptSchema,
  authenticateAflTradeFitzRoyEgressExecutionReceipt,
  createAflTradeFitzRoyEgressExecutionReceipt,
} from '@/server/aflTradeIntelligence/source/fitzRoyEgressExecutionReceipt';

const sha = (character: string) => character.repeat(64);

function validReceipt() {
  return createAflTradeFitzRoyEgressExecutionReceipt({
    content: {
      schemaVersion: AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION,
      executionBoundary: 'attested_provider_egress',
      provider: 'footywire',
      capabilityId: 'footywire-player-stats',
      directFunction: 'fetch_player_stats_footywire',
      fitzRoyVersion: '1.7.0',
      invocationSha256: sha('1'),
      sourceOutput: { contentSha256: sha('2'), byteLength: 128 },
      diagnosticsOutput: { contentSha256: sha('3'), byteLength: 256 },
      runtime: {
        rVersion: '4.5.1',
        dependencyLockSha256: sha('4'),
        imageDigest: `sha256:${sha('5')}`,
      },
      enforcedPolicy: {
        upstreamRate: { requests: 1, perSeconds: 2, burst: 1 },
        cacheSeconds: 3600,
        egressPolicyEvidenceId: `artifact:${sha('6')}`,
      },
      startedAt: '2026-08-08T00:00:00.000Z',
      completedAt: '2026-08-08T00:00:02.000Z',
      status: 'succeeded',
    },
    signature: {
      algorithm: 'Ed25519',
      keyId: 'statly-capture-egress-2026-01',
      valueBase64Url: 'A'.repeat(86),
    },
  });
}

describe('fitzRoy egress execution evidence', () => {
  it('authenticates one exact content-addressed execution through the injected verifier', async () => {
    const receipt = validReceipt();
    const verify = vi.fn().mockResolvedValue(true);

    await expect(
      authenticateAflTradeFitzRoyEgressExecutionReceipt(receipt, { verify })
    ).resolves.toEqual(receipt);
    expect(verify).toHaveBeenCalledWith(receipt);
    expect(receipt.executionReceiptId).toMatch(/^fitzroy-egress-execution:[a-f0-9]{64}$/);
  });

  it('rejects untrusted, cross-provider, malformed-policy, and tampered evidence', async () => {
    const receipt = validReceipt();
    await expect(
      authenticateAflTradeFitzRoyEgressExecutionReceipt(receipt, {
        verify: vi.fn().mockResolvedValue(false),
      })
    ).rejects.toThrow('not trusted');

    expect(() =>
      createAflTradeFitzRoyEgressExecutionReceipt({
        content: { ...receipt.content, provider: 'afl_tables' },
        signature: receipt.signature,
      })
    ).toThrow();
    expect(() =>
      createAflTradeFitzRoyEgressExecutionReceipt({
        content: {
          ...receipt.content,
          enforcedPolicy: {
            ...receipt.content.enforcedPolicy,
            upstreamRate: { requests: 2, perSeconds: 1, burst: 1 },
          },
        },
        signature: receipt.signature,
      })
    ).toThrow();
    expect(
      aflTradeFitzRoyEgressExecutionReceiptSchema.safeParse({
        ...receipt,
        executionReceiptId: `fitzroy-egress-execution:${sha('f')}`,
      }).success
    ).toBe(false);
  });

  it('rejects reversed or unbounded execution chronology', () => {
    const receipt = validReceipt();
    for (const completedAt of ['2026-08-07T23:59:59.000Z', '2026-08-09T00:00:00.001Z']) {
      expect(() =>
        createAflTradeFitzRoyEgressExecutionReceipt({
          content: { ...receipt.content, completedAt },
          signature: receipt.signature,
        })
      ).toThrow();
    }
  });
});
