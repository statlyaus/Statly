import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

function localExecutorFixture(dockerBinary?: string) {
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
    sleep,
    ...(dockerBinary === undefined ? { nowMs, runDocker } : { dockerBinary }),
  });
  return { executor, publicKey, runDocker, sleep };
}

describe('local non-production Docker fitzRoy capture', () => {
  it('rejects a timed-out CLI that ignores termination and cleans only its owned container', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'statly-docker-timeout-test-'));
    const binary = join(directory, 'docker');
    try {
      // Fake only the external Docker CLI; exercise the real executor and process deadline.
      await writeFile(
        binary,
        `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(__filename + '.calls', JSON.stringify(args) + '\\n');
if (args[0] === 'run') {
  process.on('SIGTERM', () => {});
  const mount = args.find(value => value.endsWith(',dst=/statly/output'));
  const output = mount.split('src=')[1].split(',dst=')[0];
  setTimeout(() => {
    fs.writeFileSync(output + '/source.rds', 'RDS!');
    fs.writeFileSync(output + '/diagnostics.json', '{"rowCount":1}');
  }, 2500);
}
`,
        { mode: 0o700 }
      );
      const fixture = localExecutorFixture(binary);
      await expect(
        fixture.executor.execute(invocation, {
          timeoutMs: 1000,
          maximumSourceBytes: 1024,
          maximumDiagnosticsBytes: 4096,
        })
      ).rejects.toThrow(/timeout|timed out|deadline/i);
      const calls = (await readFile(`${binary}.calls`, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[]);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain('--init');
      expect(calls[0]).not.toContain('--rm');
      const name = calls[0]?.find((arg) => arg.startsWith('--name='))?.slice(7);
      expect(name).toMatch(/^statly-fitzroy-capture-[a-f0-9-]{36}$/);
      expect(calls[1]).toEqual(['rm', '--force', name]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([0, 1])(
    'returns valid output only after confirmed cleanup (cleanup exit %i)',
    async (cleanupExitCode) => {
      const directory = await mkdtemp(join(tmpdir(), 'statly-docker-cleanup-test-'));
      const binary = join(directory, 'docker');
      try {
        await writeFile(
          binary,
          `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'rm') process.exit(${cleanupExitCode});
const mount = args.find(value => value.endsWith(',dst=/statly/output'));
const output = mount.split('src=')[1].split(',dst=')[0];
fs.writeFileSync(output + '/source.rds', 'RDS!');
fs.writeFileSync(output + '/diagnostics.json', '{"rowCount":1}');
`,
          { mode: 0o700 }
        );
        const result = localExecutorFixture(binary).executor.execute(invocation, {
          timeoutMs: 3000,
          maximumSourceBytes: 1024,
          maximumDiagnosticsBytes: 4096,
        });
        if (cleanupExitCode === 0) {
          await expect(result).resolves.toMatchObject({
            diagnostics: { rowCount: 1 },
            egressExecutionReceipt: { content: { status: 'succeeded' } },
          });
        } else {
          await expect(result).rejects.toThrow(
            /cleanup failed.*statly-fitzroy-capture-.*termination is unconfirmed/
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

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
        '--init',
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
