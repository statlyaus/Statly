import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  AflTradeFitzRoyDecodeError,
  type AflTradeFitzRoyDecoderExecutor,
} from '../source/fitzRoyObservationDecodeRuntime';

const execFileAsync = promisify(execFile);
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/;

export interface LocalAflTradeDockerDecodeCommand {
  binary: string;
  args: readonly string[];
  timeoutMs: number;
  maximumOutputBytes: number;
  workingDirectory: string;
  decodedOutputPath: string;
}

export interface LocalAflTradeDockerDecodeCommandResult {
  stdout: string;
  stderr: string;
}

export interface LocalAflTradeDockerFitzRoyDecodeExecutorOptions {
  dockerBinary?: string;
  imageReference: string;
  runDocker?: (
    command: LocalAflTradeDockerDecodeCommand
  ) => Promise<LocalAflTradeDockerDecodeCommandResult>;
}

async function runDockerCommand(
  command: LocalAflTradeDockerDecodeCommand
): Promise<LocalAflTradeDockerDecodeCommandResult> {
  const result = await execFileAsync(command.binary, [...command.args], {
    timeout: command.timeoutMs,
    maxBuffer: command.maximumOutputBytes,
    windowsHide: true,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

export function createLocalAflTradeDockerFitzRoyDecodeExecutor(
  options: LocalAflTradeDockerFitzRoyDecodeExecutorOptions
): AflTradeFitzRoyDecoderExecutor {
  if (!imageDigestPattern.test(options.imageReference)) {
    throw new TypeError('Local fitzRoy decoding requires one immutable SHA-256 image reference.');
  }
  const dockerBinary = options.dockerBinary?.trim() || 'docker';
  const executeDocker = options.runDocker ?? runDockerCommand;

  return {
    executionBoundary: 'offline_container_no_network',
    async decode(input): Promise<Uint8Array> {
      if (
        input.context.imageDigest !== options.imageReference ||
        !Number.isSafeInteger(input.timeoutMs) ||
        input.timeoutMs <= 0 ||
        input.sourceRdsBytes.byteLength <= 0
      ) {
        throw new AflTradeFitzRoyDecodeError(
          'INVALID_REQUEST',
          'The local decoder image identity, timeout, or exact RDS input is invalid.'
        );
      }

      const temporaryRoot = join(process.cwd(), '.statly-local');
      await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
      const directory = await realpath(await mkdtemp(join(temporaryRoot, 'fitzroy-decode-')));
      const inputDirectory = join(directory, 'input');
      const outputDirectory = join(directory, 'output');
      const sourcePath = join(inputDirectory, 'source.rds');
      const contextPath = join(inputDirectory, 'context.json');
      const decodedOutputPath = join(outputDirectory, 'decoded.json');
      try {
        await mkdir(inputDirectory, { mode: 0o700 });
        await mkdir(outputDirectory, { mode: 0o700 });
        await writeFile(sourcePath, input.sourceRdsBytes, { flag: 'wx', mode: 0o400 });
        await writeFile(contextPath, canonicalizeAflTradeJson(input.context), {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o400,
        });
        await chmod(outputDirectory, 0o777);
        const args = [
          'run',
          '--rm',
          '--read-only',
          '--network=none',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--pids-limit=128',
          '--memory=1g',
          '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m',
          `--mount=type=bind,src=${sourcePath},dst=/statly/input/source.rds,readonly`,
          `--mount=type=bind,src=${contextPath},dst=/statly/input/context.json,readonly`,
          `--mount=type=bind,src=${outputDirectory},dst=/statly/output`,
          `--env=STATLY_R_LOCK_SHA256=${input.context.dependencyLockSha256}`,
          `--env=STATLY_CAPTURE_IMAGE_DIGEST=${input.context.imageDigest}`,
          '--entrypoint=Rscript',
          options.imageReference,
          '--vanilla',
          '/opt/statly/capture/decode_fitzroy_capture.R',
          '/statly/input/source.rds',
          '/statly/input/context.json',
          '/statly/output/decoded.json',
        ] as const;
        const result = await executeDocker({
          binary: dockerBinary,
          args,
          timeoutMs: input.timeoutMs,
          maximumOutputBytes: input.context.maximumOutputBytes,
          workingDirectory: directory,
          decodedOutputPath,
        });
        if (result.stdout.trim() !== '' || result.stderr.trim() !== '') {
          throw new Error('The offline decoder emitted output outside its decoded artifact.');
        }
        const metadata = await stat(decodedOutputPath);
        if (
          metadata.size <= 0 ||
          metadata.size > input.context.maximumOutputBytes
        ) {
          throw new Error('The offline decoder output violated its approved byte bound.');
        }
        return Uint8Array.from(await readFile(decodedOutputPath));
      } catch (cause) {
        if (cause instanceof AflTradeFitzRoyDecodeError) throw cause;
        throw new AflTradeFitzRoyDecodeError(
          'DECODER_FAILED',
          cause instanceof Error ? cause.message : 'The offline Docker decoder failed.'
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
