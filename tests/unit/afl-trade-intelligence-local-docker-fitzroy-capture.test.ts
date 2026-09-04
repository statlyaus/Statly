import { generateKeyPairSync } from 'node:crypto';
import { realpath, writeFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createLocalAflTradeDockerFitzRoyCaptureExecutor,
  type LocalAflTradeDockerCommand,
} from '@/server/aflTradeIntelligence/development/localDockerFitzRoyCaptureExecutor';
import { createAflTradeFitzRoyInvocation } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import { aflTradeFitzRoyEgressExecutionReceiptSchema } from '@/server/aflTradeIntelligence/source/fitzRoyEgressExecutionReceipt';
import { createAflTradeEd25519EgressExecutionVerifier } from '@/server/aflTradeIntelligence/source/fitzRoyHttpEgressExecutor';

const sha = (character: string) => character.repeat(64);
const imageDigest = `sha256:${sha('a')}` as const;
const dependencyLockSha256 = sha('b');
const egressPolicyEvidenceId = `artifact:${sha('c')}`;
const invocation = createAflTradeFitzRoyInvocation({
  schemaVersion: 'afl-trade-fitzroy-capture-request/v1',
  capabilityId: 'afl-tables-player-stats',
  competition: 'AFLM',
  authorizationSeason: 2026,
  parameters: { season: 2026, rescrape: true, rescrapeStartSeason: 2026 },
});

function localExecutorFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const baseTime = Date.parse('2026-08-14T00:00:00.000Z');
  const nowMs = vi
    .fn<() => number>()
    .mockReturnValueOnce(baseTime)
    .mockReturnValueOnce(baseTime)
    .mockReturnValueOnce(baseTime + 1_000)
    .mockReturnValueOnce(baseTime + 1_000)
    .mockReturnValueOnce(baseTime + 60_000)
    .mockReturnValueOnce(baseTime + 60_000)
    .mockReturnValueOnce(baseTime + 61_000);
  const runDocker = vi.fn(async (command: LocalAflTradeDockerCommand) => {
    expect(command.workingDirectory).toBe(await realpath(command.workingDirectory));
    await writeFile(command.sourceOutputPath, new TextEncoder().encode('RDS!'));
    await writeFile(
      command.diagnosticsOutputPath,
      canonicalizeAflTradeJson({ rowCount: 1, season: 2026 }),
      'utf8'
    );
    return { stdout: '', stderr: '' };
  });
  const sleep = vi.fn(async () => undefined);
  const executor = createLocalAflTradeDockerFitzRoyCaptureExecutor({
    dockerBinary: 'docker',
    imageReference: imageDigest,
    runtimeIdentity: {
      rVersion: '4.5.1',
      dependencyLockSha256,
      imageDigest,
    },
    admittedPolicy: {
      upstreamRate: { requests: 1, perSeconds: 60, burst: 1 },
      cacheSeconds: 86_400,
      egressPolicyEvidenceId,
    },
    signingKey: {
      keyId: 'local-rehearsal-2026-08-14',
      privateKey,
    },
    nowMs,
    sleep,
    runDocker,
  });
  return { executor, publicKey, runDocker, sleep };
}

describe('local non-production Docker fitzRoy capture', () => {
  it('runs the immutable image with a constrained process boundary and signs exact local evidence', async () => {
    const fixture = localExecutorFixture();

    const result = await fixture.executor.execute(invocation, {
      timeoutMs: 30_000,
      maximumSourceBytes: 1_024,
      maximumDiagnosticsBytes: 4_096,
    });

    expect(fixture.executor.executionBoundary).toBe('local_rate_limited_docker');
    expect(fixture.executor.egressPolicyEvidenceIds).toEqual([egressPolicyEvidenceId]);
    expect(new TextDecoder().decode(result.sourceBytes)).toBe('RDS!');
    expect(result.diagnostics).toEqual({ rowCount: 1, season: 2026 });
    expect(result.egressExecutionReceipt).toMatchObject({
      content: {
        executionBoundary: 'local_non_production_docker',
        provider: 'afl_tables',
        capabilityId: 'afl-tables-player-stats',
        directFunction: 'fetch_player_stats_afltables',
        runtime: { imageDigest, dependencyLockSha256 },
        enforcementScope: 'capture_admission_only',
        enforcedPolicy: {
          upstreamRate: { requests: 1, perSeconds: 60, burst: 1 },
          cacheSeconds: 86_400,
          egressPolicyEvidenceId,
        },
      },
    });
    const verifier = createAflTradeEd25519EgressExecutionVerifier({
      'local-rehearsal-2026-08-14': fixture.publicKey
        .export({ type: 'spki', format: 'pem' })
        .toString(),
    });
    const receipt = aflTradeFitzRoyEgressExecutionReceiptSchema.parse(
      result.egressExecutionReceipt
    );
    await expect(verifier.verify(receipt)).resolves.toBe(true);

    const command = fixture.runDocker.mock.calls[0]?.[0];
    expect(command?.binary).toBe('docker');
    expect(command?.args).toEqual(
      expect.arrayContaining([
        'run',
        '--rm',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--network=bridge',
        '--env=STATLY_CAPTURE_RENV_PROJECT=',
        imageDigest,
        '/statly/input/invocation.json',
        '/statly/output/source.rds',
        '/statly/output/diagnostics.json',
      ])
    );
    expect(command?.workingDirectory).toContain('/.statly-local/fitzroy-capture-');
  });

  it('waits between local capture admissions and rejects mutable or mismatched images', async () => {
    const fixture = localExecutorFixture();
    await fixture.executor.execute(invocation, {
      timeoutMs: 30_000,
      maximumSourceBytes: 1_024,
      maximumDiagnosticsBytes: 4_096,
    });
    await fixture.executor.execute(invocation, {
      timeoutMs: 30_000,
      maximumSourceBytes: 1_024,
      maximumDiagnosticsBytes: 4_096,
    });

    expect(fixture.sleep).toHaveBeenCalledExactlyOnceWith(59_000);

    expect(() =>
      createLocalAflTradeDockerFitzRoyCaptureExecutor({
        dockerBinary: 'docker',
        imageReference: 'statly-fitzroy-local:1.7.0',
        runtimeIdentity: {
          rVersion: '4.5.1',
          dependencyLockSha256,
          imageDigest,
        },
        admittedPolicy: {
          upstreamRate: { requests: 1, perSeconds: 60, burst: 1 },
          cacheSeconds: 86_400,
          egressPolicyEvidenceId,
        },
        signingKey: {
          keyId: 'local-rehearsal-2026-08-14',
          privateKey: generateKeyPairSync('ed25519').privateKey,
        },
      })
    ).toThrow('immutable SHA-256 image reference');
  });
});
