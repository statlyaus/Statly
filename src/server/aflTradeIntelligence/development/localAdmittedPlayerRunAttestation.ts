import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import type { AflTradeAdmittedPlayerCandidateConfig } from '../modeling/admittedPlayerContributionCandidate';
import type { LocalAflTradeAdmittedPlayerRunProfile } from './localPostgresAdmittedPlayerPreparation';

const execute = promisify(execFile);
const MAXIMUM_GIT_OUTPUT_BYTES = 1024 * 1024;
const MAXIMUM_DEPENDENCY_LOCK_BYTES = 64 * 1024 * 1024;
const gitCommitPattern = /^[a-f0-9]{40}([a-f0-9]{24})?$/u;
export const localAflTradeAdmittedPlayerExecutingCheckoutRoot = resolve(
  import.meta.dirname,
  '../../../..'
);
const MAXIMUM_IMPLEMENTATION_FILE_COUNT = 10_000;
const MAXIMUM_IMPLEMENTATION_BYTES = 256 * 1024 * 1024;

function captureImplementationSourceEvidence() {
  const relativePaths = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--', 'src', 'package.json', 'package-lock.json'],
    {
      cwd: localAflTradeAdmittedPlayerExecutingCheckoutRoot,
      encoding: 'utf8',
      maxBuffer: MAXIMUM_GIT_OUTPUT_BYTES,
      timeout: 10_000,
    }
  )
    .split('\0')
    .filter((relativePath) => relativePath !== '')
    .sort((left, right) => left.localeCompare(right));
  if (relativePaths.length === 0 || relativePaths.length > MAXIMUM_IMPLEMENTATION_FILE_COUNT) {
    throw new TypeError('The loaded admitted player source closure has an invalid file count.');
  }
  let totalBytes = 0;
  const files = relativePaths.map((relativePath) => {
    const path = join(localAflTradeAdmittedPlayerExecutingCheckoutRoot, relativePath);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new TypeError('The loaded admitted player source closure must contain regular files.');
    }
    totalBytes += stat.size;
    if (totalBytes > MAXIMUM_IMPLEMENTATION_BYTES) {
      throw new TypeError('The loaded admitted player source closure exceeds its byte limit.');
    }
    return {
      relativePath,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    };
  });
  return {
    schemaVersion: 'afl-trade-loaded-player-source-closure/v1' as const,
    fileCount: files.length,
    totalBytes,
    files,
    aggregateSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  };
}

export const localAflTradeLoadedPlayerImplementationEvidence =
  captureImplementationSourceEvidence();

export function reauthenticateLoadedAflTradePlayerImplementation(): void {
  const current = captureImplementationSourceEvidence();
  if (current.aggregateSha256 !== localAflTradeLoadedPlayerImplementationEvidence.aggregateSha256) {
    throw new TypeError('The loaded admitted player implementation differs from the checkout.');
  }
}

type RetainArtifact = (input: {
  readonly document: unknown;
  readonly createdAt: string;
}) => Promise<AflTradeArtifactRef>;

async function git(checkoutRoot: string, args: readonly string[]): Promise<string> {
  const result = await execute('git', [...args], {
    cwd: checkoutRoot,
    encoding: 'utf8',
    maxBuffer: MAXIMUM_GIT_OUTPUT_BYTES,
    timeout: 10_000,
  });
  return result.stdout.trim();
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return digest.digest('hex');
}

async function inspectDependencyLock(checkoutRoot: string) {
  const path = join(checkoutRoot, 'package-lock.json');
  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size <= 0 ||
    before.size > MAXIMUM_DEPENDENCY_LOCK_BYTES
  ) {
    throw new TypeError('The admitted player dependency lock must be one bounded regular file.');
  }
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    bytes.byteLength !== before.size
  ) {
    throw new TypeError('The admitted player dependency lock changed during attestation.');
  }
  return {
    schemaVersion: 'afl-trade-dependency-lock-attestation/v1' as const,
    relativePath: 'package-lock.json' as const,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function inspectExactCleanAflTradeCheckout(checkoutRoot: string) {
  if (!isAbsolute(checkoutRoot)) {
    throw new TypeError('Admitted player execution requires an absolute checkout root.');
  }
  const canonicalRoot = await realpath(checkoutRoot);
  const reportedRoot = await realpath(await git(canonicalRoot, ['rev-parse', '--show-toplevel']));
  const codeCommitSha = await git(canonicalRoot, ['rev-parse', 'HEAD']);
  const worktreeStatus = await git(canonicalRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);
  if (
    reportedRoot !== canonicalRoot ||
    !gitCommitPattern.test(codeCommitSha) ||
    worktreeStatus !== ''
  ) {
    throw new TypeError('Admitted player execution requires an exact clean Git checkout.');
  }
  return { canonicalRoot, codeCommitSha };
}

export async function reauthenticateExactCleanAflTradeCheckout(input: {
  readonly canonicalRoot: string;
  readonly codeCommitSha: string;
  readonly dependencyLockSha256: string;
}): Promise<void> {
  const checkout = await inspectExactCleanAflTradeCheckout(input.canonicalRoot);
  const dependencyLock = await inspectDependencyLock(checkout.canonicalRoot);
  if (
    checkout.codeCommitSha !== input.codeCommitSha ||
    dependencyLock.sha256 !== input.dependencyLockSha256
  ) {
    throw new TypeError('The admitted player checkout changed during attestation.');
  }
}

export const localAflTradeAdmittedPlayerCandidateConfiguration = {
  schemaVersion: 'afl-trade-admitted-player-candidate-config/v1' as const,
  baseline: {
    schemaVersion: 'afl-trade-player-baseline-config/v1' as const,
    replacementQuantile: 0.25,
    minimumGamesForReplacementFit: 1,
    minimumTrainingObservationsPerGroup: 1,
    weighting: 'games_played' as const,
    replacementStratification: 'role_and_era' as const,
    unavailableAndZeroTreatment: 'distinct' as const,
    activeCareerTreatment: 'right_censored' as const,
  },
  validation: {
    schemaVersion: 'afl-trade-player-validation-config/v1' as const,
    minimumComparableObservations: 1,
    acceptanceRule: 'candidate_improves_both_mae_and_rmse' as const,
    minimumRelativeMaeImprovement: 0.01,
    minimumRelativeRmseImprovement: 0.01,
    incompletePredictionCoverage: 'fail_closed' as const,
    governanceEffect: 'evidence_only_no_gate_or_source_approval' as const,
  },
  ridgeLambda: 1,
  intervalCoverageLevel: 0.8,
} satisfies AflTradeAdmittedPlayerCandidateConfig;

export async function attestLocalAflTradeAdmittedPlayerRunProfile(input: {
  readonly seed: number;
  readonly createdAt: string;
  readonly retainArtifact: RetainArtifact;
  readonly operationalAuthorizationLifetimeMs?: number;
}): Promise<LocalAflTradeAdmittedPlayerRunProfile> {
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new TypeError('Admitted player execution requires one non-negative integer seed.');
  }
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new TypeError('Admitted player execution requires one exact creation timestamp.');
  }
  const checkout = await inspectExactCleanAflTradeCheckout(
    localAflTradeAdmittedPlayerExecutingCheckoutRoot
  );
  const dependencyLock = await inspectDependencyLock(checkout.canonicalRoot);
  const runtime = {
    schemaVersion: 'afl-trade-local-node-runtime-attestation/v2' as const,
    nodeVersion: process.version,
    nodeExecutableSha256: await sha256File(process.execPath),
    platform: process.platform,
    architecture: process.arch,
    loadedImplementation: localAflTradeLoadedPlayerImplementationEvidence,
  };
  const container = {
    schemaVersion: 'afl-trade-local-execution-container-attestation/v2' as const,
    executionBoundary: 'container_identity_unverified' as const,
    imageDigest: null,
  };
  const environment = {
    schemaVersion: 'afl-trade-local-model-environment-attestation/v1' as const,
    environment: 'non_production' as const,
    publicationPosture: 'prohibited' as const,
    databaseRole: 'afl_trade_private_evaluation_coordinator' as const,
  };
  const [
    dependencyLockArtifact,
    runtimeArtifact,
    containerArtifact,
    configurationArtifact,
    environmentArtifact,
  ] = await Promise.all(
    [
      dependencyLock,
      runtime,
      container,
      localAflTradeAdmittedPlayerCandidateConfiguration,
      environment,
    ].map((document) => input.retainArtifact({ document, createdAt: input.createdAt }))
  );
  const sourceCodeArtifact = await input.retainArtifact({
    createdAt: input.createdAt,
    document: {
      schemaVersion: 'afl-trade-admitted-player-executor-build/v1',
      implementationId: 'statly-admitted-player-contribution-candidate',
      candidateSchemaVersion: 'afl-trade-admitted-player-candidate/v1',
      codeCommitSha: checkout.codeCommitSha,
      cleanWorktree: true,
      dependencyLockArtifactId: dependencyLockArtifact.artifactId,
      runtimeArtifactId: runtimeArtifact.artifactId,
      containerArtifactId: containerArtifact.artifactId,
      environmentArtifactId: environmentArtifact.artifactId,
    },
  });
  await reauthenticateExactCleanAflTradeCheckout({
    canonicalRoot: checkout.canonicalRoot,
    codeCommitSha: checkout.codeCommitSha,
    dependencyLockSha256: dependencyLock.sha256,
  });
  reauthenticateLoadedAflTradePlayerImplementation();
  return {
    codeCommitSha: checkout.codeCommitSha,
    seed: input.seed,
    sourceCodeArtifact,
    dependencyLockArtifact,
    runtimeArtifact,
    containerArtifact,
    configurationArtifact,
    environmentArtifact,
    operationalAuthorizationLifetimeMs: input.operationalAuthorizationLifetimeMs,
  };
}
