import { realpath, writeFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createLocalAflTradeDockerFitzRoyDecodeExecutor,
  type LocalAflTradeDockerDecodeCommand,
} from '@/server/aflTradeIntelligence/development/localDockerFitzRoyDecodeExecutor';
import type { AflTradeFitzRoyDecodeContext } from '@/server/aflTradeIntelligence/source/fitzRoyObservationDecodeRuntime';

const sha = (character: string) => character.repeat(64);
const imageDigest = `sha256:${sha('a')}` as const;
const context: AflTradeFitzRoyDecodeContext = {
  captureReceiptSha256: sha('b'),
  capabilityId: 'afl-tables-player-stats',
  fitzRoyVersion: '1.7.0',
  authorizationCompetition: 'AFLM',
  authorizationSeason: 2026,
  invocationSha256: sha('c'),
  invocationArgumentsSha256: sha('d'),
  diagnosticsSha256: sha('e'),
  sourceRdsSha256: sha('f'),
  sourceSchemaSha256: sha('1'),
  expectedRowCount: 1,
  dependencyLockSha256: sha('2'),
  imageDigest,
  maximumRows: 10,
  maximumFields: 100,
  maximumCells: 1_000,
  maximumCellBytes: 1_024,
  maximumOutputBytes: 16_384,
};

describe('local offline Docker fitzRoy decoder', () => {
  it('uses the immutable capture image without networking or a shell and returns bounded output', async () => {
    const decoded = canonicalizeAflTradeJson({ schemaVersion: 'decoded-test/v1' });
    const runDocker = vi.fn(async (command: LocalAflTradeDockerDecodeCommand) => {
      expect(command.workingDirectory).toBe(await realpath(command.workingDirectory));
      await writeFile(command.decodedOutputPath, decoded, 'utf8');
      return { stdout: '', stderr: '' };
    });
    const executor = createLocalAflTradeDockerFitzRoyDecodeExecutor({
      dockerBinary: 'docker',
      imageReference: imageDigest,
      runDocker,
    });

    const output = await executor.decode({
      sourceRdsBytes: Uint8Array.from([82, 68, 83]),
      context,
      timeoutMs: 30_000,
    });

    expect(executor.executionBoundary).toBe('offline_container_no_network');
    expect(new TextDecoder().decode(output)).toBe(decoded);
    const command = runDocker.mock.calls[0]?.[0];
    expect(command?.binary).toBe('docker');
    expect(command?.args).toEqual(
      expect.arrayContaining([
        'run',
        '--rm',
        '--read-only',
        '--network=none',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--entrypoint=Rscript',
        imageDigest,
        '--vanilla',
        '/opt/statly/capture/decode_fitzroy_capture.R',
        '/statly/input/source.rds',
        '/statly/input/context.json',
        '/statly/output/decoded.json',
      ])
    );
    expect(command?.workingDirectory).toContain('/.statly-local/fitzroy-decode-');
  });

  it('rejects mutable image references and mismatched per-capture image identities', async () => {
    expect(() =>
      createLocalAflTradeDockerFitzRoyDecodeExecutor({
        imageReference: 'statly-fitzroy-local:1.7.0',
      })
    ).toThrow('immutable SHA-256 image reference');

    const executor = createLocalAflTradeDockerFitzRoyDecodeExecutor({
      imageReference: imageDigest,
      runDocker: vi.fn(),
    });
    await expect(
      executor.decode({
        sourceRdsBytes: Uint8Array.from([82, 68, 83]),
        context: { ...context, imageDigest: `sha256:${sha('9')}` },
        timeoutMs: 30_000,
      })
    ).rejects.toThrow('image identity');
  });
});
