import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash, sign, type KeyObject } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflTradeFitzRoyProcessExecutor,
  AflTradeFitzRoyProcessResult,
  AflTradeFitzRoyRuntimeIdentity,
} from '../source/fitzRoyCaptureRuntime';
import { createAflTradeFitzRoyEgressExecutionReceipt } from '../source/fitzRoyEgressExecutionReceipt';

const execFileAsync = promisify(execFile);
const sha256Pattern = /^[a-f0-9]{64}$/;
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/;
const evidenceIdPattern = /^artifact:[a-f0-9]{64}$/;

export interface LocalAflTradeDockerCommand {
  binary: string;
  args: readonly string[];
  timeoutMs: number;
  maximumOutputBytes: number;
  workingDirectory: string;
  sourceOutputPath: string;
  diagnosticsOutputPath: string;
}

export interface LocalAflTradeDockerCommandResult {
  stdout: string;
  stderr: string;
}

interface LocalAflTradeAdmittedPolicy {
  upstreamRate: {
    requests: number;
    perSeconds: number;
    burst: number;
  };
  cacheSeconds: number;
  egressPolicyEvidenceId: string;
}

export interface LocalAflTradeDockerFitzRoyCaptureExecutorOptions {
  dockerBinary?: string;
  imageReference: string;
  runtimeIdentity: AflTradeFitzRoyRuntimeIdentity;
  admittedPolicy: LocalAflTradeAdmittedPolicy;
  signingKey: {
    keyId: string;
    privateKey: KeyObject;
  };
  nowMs?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  runDocker?: (command: LocalAflTradeDockerCommand) => Promise<LocalAflTradeDockerCommandResult>;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readBoundedLocalOutput(
  path: string,
  maximumBytes: number,
  label: string
): Promise<Uint8Array> {
  const metadata = await stat(path);
  if (metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new Error(`The local fitzRoy ${label} output violated its configured byte bound.`);
  }
  return Uint8Array.from(await readFile(path));
}

async function runDockerCommand(
  command: LocalAflTradeDockerCommand
): Promise<LocalAflTradeDockerCommandResult> {
  const result = await execFileAsync(command.binary, [...command.args], {
    timeout: command.timeoutMs,
    maxBuffer: command.maximumOutputBytes,
    windowsHide: true,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function isoDateTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError('The local capture clock must return a finite timestamp.');
  }
  return new Date(milliseconds).toISOString();
}

/**
 * Local-only fitzRoy adapter for factual-release rehearsal. It rate-limits capture admission, runs
 * one immutable Docker image without a shell, and signs exact execution bindings. Its receipt says
 * `capture_admission_only`; it is not evidence of deployed provider-egress enforcement.
 */
export function createLocalAflTradeDockerFitzRoyCaptureExecutor(
  options: LocalAflTradeDockerFitzRoyCaptureExecutorOptions
): AflTradeFitzRoyProcessExecutor {
  const dockerBinary = options.dockerBinary?.trim() || 'docker';
  const { runtimeIdentity, admittedPolicy } = options;
  if (
    !imageDigestPattern.test(options.imageReference) ||
    options.imageReference !== runtimeIdentity.imageDigest
  ) {
    throw new TypeError(
      'Local fitzRoy capture requires one immutable SHA-256 image reference matching the runtime identity.'
    );
  }
  if (
    runtimeIdentity.rVersion !== '4.5.1' ||
    !sha256Pattern.test(runtimeIdentity.dependencyLockSha256)
  ) {
    throw new TypeError('Local fitzRoy capture requires the exact reviewed R and lock identities.');
  }
  if (
    admittedPolicy.upstreamRate.requests !== 1 ||
    admittedPolicy.upstreamRate.burst !== 1 ||
    !Number.isInteger(admittedPolicy.upstreamRate.perSeconds) ||
    admittedPolicy.upstreamRate.perSeconds <= 0 ||
    !Number.isInteger(admittedPolicy.cacheSeconds) ||
    admittedPolicy.cacheSeconds <= 0 ||
    !evidenceIdPattern.test(admittedPolicy.egressPolicyEvidenceId)
  ) {
    throw new TypeError(
      'The local executor supports one exact single-request admission rate, cache policy, and evidence identity.'
    );
  }
  if (
    !/^[A-Za-z0-9._:-]{1,200}$/.test(options.signingKey.keyId) ||
    options.signingKey.privateKey.asymmetricKeyType !== 'ed25519' ||
    options.signingKey.privateKey.type !== 'private'
  ) {
    throw new TypeError('Local execution receipts require one named Ed25519 private signing key.');
  }

  const nowMs = options.nowMs ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const executeDocker = options.runDocker ?? runDockerCommand;
  const admissionIntervalMs = admittedPolicy.upstreamRate.perSeconds * 1_000;
  let nextAdmissionAtMs = 0;
  let admissionTail = Promise.resolve();

  async function admitCapture(): Promise<void> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = admissionTail;
    admissionTail = turn;
    await previous;
    try {
      const observedAt = nowMs();
      const waitMs = Math.max(0, nextAdmissionAtMs - observedAt);
      if (waitMs > 0) await sleep(waitMs);
      const admittedAt = waitMs > 0 ? nowMs() : observedAt;
      nextAdmissionAtMs = Math.max(nextAdmissionAtMs, admittedAt) + admissionIntervalMs;
    } finally {
      release();
    }
  }

  return {
    executionBoundary: 'local_rate_limited_docker',
    egressPolicyEvidenceIds: [admittedPolicy.egressPolicyEvidenceId],
    async execute(invocation, limits): Promise<AflTradeFitzRoyProcessResult> {
      requirePositiveInteger(limits.timeoutMs, 'timeoutMs');
      requirePositiveInteger(limits.maximumSourceBytes, 'maximumSourceBytes');
      requirePositiveInteger(limits.maximumDiagnosticsBytes, 'maximumDiagnosticsBytes');
      await admitCapture();

      const temporaryRoot = join(process.cwd(), '.statly-local');
      await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
      const directory = await realpath(await mkdtemp(join(temporaryRoot, 'fitzroy-capture-')));
      const inputDirectory = join(directory, 'input');
      const outputDirectory = join(directory, 'output');
      const invocationPath = join(inputDirectory, 'invocation.json');
      const sourceOutputPath = join(outputDirectory, 'source.rds');
      const diagnosticsOutputPath = join(outputDirectory, 'diagnostics.json');
      try {
        await mkdir(inputDirectory, { mode: 0o700 });
        await mkdir(outputDirectory, { mode: 0o700 });
        await writeFile(invocationPath, canonicalizeAflTradeJson(invocation), {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o400,
        });
        // The parent remains private; only the mounted output directory is writable by the image UID.
        await chmod(outputDirectory, 0o777);
        const args = [
          'run',
          '--rm',
          '--read-only',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--pids-limit=128',
          '--memory=1g',
          '--network=bridge',
          '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m',
          `--mount=type=bind,src=${invocationPath},dst=/statly/input/invocation.json,readonly`,
          `--mount=type=bind,src=${outputDirectory},dst=/statly/output`,
          '--env=STATLY_CAPTURE_RENV_PROJECT=',
          `--env=STATLY_CAPTURE_IMAGE_DIGEST=${runtimeIdentity.imageDigest}`,
          options.imageReference,
          '/statly/input/invocation.json',
          '/statly/output/source.rds',
          '/statly/output/diagnostics.json',
        ] as const;
        const startedAt = isoDateTime(nowMs());
        const processResult = await executeDocker({
          binary: dockerBinary,
          args,
          timeoutMs: limits.timeoutMs,
          maximumOutputBytes: limits.maximumDiagnosticsBytes,
          workingDirectory: directory,
          sourceOutputPath,
          diagnosticsOutputPath,
        });
        if (processResult.stdout.trim() !== '' || processResult.stderr.trim() !== '') {
          throw new Error(
            'The local fitzRoy container emitted unstructured output outside its diagnostics artifact.'
          );
        }
        const sourceBytes = await readBoundedLocalOutput(
          sourceOutputPath,
          limits.maximumSourceBytes,
          'source'
        );
        const rawDiagnosticsBytes = await readBoundedLocalOutput(
          diagnosticsOutputPath,
          limits.maximumDiagnosticsBytes,
          'diagnostics'
        );
        let diagnostics: unknown;
        try {
          diagnostics = JSON.parse(new TextDecoder().decode(rawDiagnosticsBytes));
        } catch {
          throw new Error('The local fitzRoy container emitted invalid diagnostics JSON.');
        }
        const invocationBytes = new TextEncoder().encode(canonicalizeAflTradeJson(invocation));
        const diagnosticsBytes = new TextEncoder().encode(canonicalizeAflTradeJson(diagnostics));
        if (diagnosticsBytes.byteLength > limits.maximumDiagnosticsBytes) {
          throw new Error('The canonical local diagnostics exceeded its configured byte bound.');
        }
        const completedAt = isoDateTime(nowMs());
        const content = {
          schemaVersion: 'afl-trade-fitzroy-egress-execution/v1' as const,
          executionBoundary: 'local_non_production_docker' as const,
          enforcementScope: 'capture_admission_only' as const,
          provider: invocation.provider,
          capabilityId: invocation.capabilityId,
          directFunction: invocation.directFunction,
          fitzRoyVersion: invocation.fitzRoyVersion,
          invocationSha256: digest(invocationBytes),
          sourceOutput: { contentSha256: digest(sourceBytes), byteLength: sourceBytes.byteLength },
          diagnosticsOutput: {
            contentSha256: digest(diagnosticsBytes),
            byteLength: diagnosticsBytes.byteLength,
          },
          runtime: runtimeIdentity,
          enforcedPolicy: admittedPolicy,
          startedAt,
          completedAt,
          status: 'succeeded' as const,
        };
        const unsigned = createAflTradeFitzRoyEgressExecutionReceipt({
          content,
          signature: {
            algorithm: 'Ed25519',
            keyId: options.signingKey.keyId,
            valueBase64Url: 'A'.repeat(86),
          },
        });
        const valueBase64Url = sign(
          null,
          Buffer.from(canonicalizeAflTradeJson(unsigned.content), 'utf8'),
          options.signingKey.privateKey
        ).toString('base64url');
        return {
          sourceBytes,
          diagnostics,
          egressExecutionReceipt: createAflTradeFitzRoyEgressExecutionReceipt({
            content: unsigned.content,
            signature: { ...unsigned.signature, valueBase64Url },
          }),
        };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
