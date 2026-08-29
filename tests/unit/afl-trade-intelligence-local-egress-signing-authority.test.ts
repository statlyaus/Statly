import { Buffer } from 'node:buffer';
import { sign } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeEgressSigningAuthority } from '@/server/aflTradeIntelligence/development/localEgressSigningAuthority';
import {
  AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION,
  createAflTradeFitzRoyEgressExecutionReceipt,
} from '@/server/aflTradeIntelligence/source/fitzRoyEgressExecutionReceipt';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local current-valuation egress signing authority', () => {
  it('reopens the same private key so a restarted verifier authenticates retained receipts', async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'statly-local-egress-signing-'));
    roots.push(artifactRoot);
    const first = createLocalAflTradeEgressSigningAuthority({ artifactRoot });
    const content = {
      schemaVersion: AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION,
      executionBoundary: 'local_non_production_docker' as const,
      enforcementScope: 'capture_admission_only' as const,
      provider: 'afl_tables' as const,
      capabilityId: 'afl-tables-player-stats',
      directFunction: 'fetch_player_stats_afltables',
      fitzRoyVersion: '1.7.0' as const,
      invocationSha256: '1'.repeat(64),
      sourceOutput: { contentSha256: '2'.repeat(64), byteLength: 1 },
      diagnosticsOutput: { contentSha256: '3'.repeat(64), byteLength: 1 },
      runtime: {
        rVersion: '4.5.1' as const,
        dependencyLockSha256: '4'.repeat(64),
        imageDigest: `sha256:${'5'.repeat(64)}` as const,
      },
      enforcedPolicy: {
        upstreamRate: { requests: 1, perSeconds: 30, burst: 1 },
        cacheSeconds: 86_400,
        egressPolicyEvidenceId: `artifact:${'6'.repeat(64)}`,
      },
      startedAt: '2026-08-29T12:00:00.000Z',
      completedAt: '2026-08-29T12:00:01.000Z',
      status: 'succeeded' as const,
    };
    const signature = sign(
      null,
      Buffer.from(canonicalizeAflTradeJson(content), 'utf8'),
      first.signingKey.privateKey
    ).toString('base64url');
    const receipt = createAflTradeFitzRoyEgressExecutionReceipt({
      content,
      signature: {
        algorithm: 'Ed25519',
        keyId: first.signingKey.keyId,
        valueBase64Url: signature,
      },
    });

    const restarted = createLocalAflTradeEgressSigningAuthority({ artifactRoot });

    await expect(restarted.verifier.verify(receipt)).resolves.toBe(true);
    expect(restarted.signingKey.keyId).toBe(first.signingKey.keyId);
    const keyPath = join(artifactRoot, 'current-valuation-evidence', 'egress-signing-key.pem');
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
  });

  it('rejects relative roots and insecure retained key custody before reading it', async () => {
    expect(() =>
      createLocalAflTradeEgressSigningAuthority({ artifactRoot: 'relative-artifact-root' })
    ).toThrow('absolute');

    const widenedRoot = await mkdtemp(join(tmpdir(), 'statly-local-egress-widened-'));
    roots.push(widenedRoot);
    createLocalAflTradeEgressSigningAuthority({ artifactRoot: widenedRoot });
    const widenedKeyPath = join(
      widenedRoot,
      'current-valuation-evidence',
      'egress-signing-key.pem'
    );
    await chmod(widenedKeyPath, 0o644);
    expect(() => createLocalAflTradeEgressSigningAuthority({ artifactRoot: widenedRoot })).toThrow(
      'mode 0600'
    );

    const symlinkRoot = await mkdtemp(join(tmpdir(), 'statly-local-egress-symlink-'));
    roots.push(symlinkRoot);
    const symlinkDirectory = join(symlinkRoot, 'current-valuation-evidence');
    await mkdir(symlinkDirectory, { mode: 0o700 });
    await symlink(widenedKeyPath, join(symlinkDirectory, 'egress-signing-key.pem'));
    expect(() => createLocalAflTradeEgressSigningAuthority({ artifactRoot: symlinkRoot })).toThrow(
      'regular file'
    );
  });
});
