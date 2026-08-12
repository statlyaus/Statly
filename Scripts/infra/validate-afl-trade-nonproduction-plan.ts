import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  validateAflTradeNonproductionPlan,
  type AflTradeNonproductionPlanIssue,
} from './afl-trade-nonproduction-plan-policy';

interface PlanExecutionOptions {
  readonly environment: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

type ExecutePlanRenderer = (
  command: string,
  args: readonly string[],
  options: PlanExecutionOptions
) => Promise<string>;
type ComputeConfigurationSourceDigest = (sourceDirectory?: string) => Promise<string>;

interface AflTradeNonproductionPlanSnapshot {
  readonly configurationSourceDigest: string;
  readonly dataDirectory: string;
  readonly inputStateDigest: string | null;
  readonly outputDirectory: string;
  readonly rootDirectory: string;
  readonly sourceDirectory: string;
  readonly stateDirectory: string;
  readonly statePath: string;
}

interface AflTradeNonproductionPlanInputs {
  readonly awsAccountId: string;
  readonly captureRetentionDays: string;
  readonly databaseBackupRetentionDays: string;
  readonly enableMigrationSecretAccess: boolean;
  readonly permissionsBoundaryArn: string | null;
  readonly statePath: string | null;
}

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const infrastructureDirectory = resolve(workspaceRoot, 'infrastructure/afl-trade-nonproduction');
const configurationSourceFiles = [
  '.terraform.lock.hcl',
  'attestation.tf',
  'custody.tf',
  'data.tf',
  'iam.tf',
  'network.tf',
  'providers.tf',
  'review.tfrc',
  'variables.tf',
  'versions.tf',
] as const;
const forwardedEnvironmentNames = new Set([
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NODE_EXTRA_CA_CERTS',
  'NO_PROXY',
  'PATH',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TMPDIR',
  'USER',
  'https_proxy',
  'http_proxy',
  'no_proxy',
]);
const forwardedAwsCredentialEnvironmentNames = new Set([
  'AWS_ACCESS_KEY_ID',
  'AWS_CONFIG_FILE',
  'AWS_EC2_METADATA_DISABLED',
  'AWS_PROFILE',
  'AWS_ROLE_ARN',
  'AWS_ROLE_SESSION_NAME',
  'AWS_SDK_LOAD_CONFIG',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SECURITY_TOKEN',
  'AWS_SESSION_TOKEN',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
]);
const maximumPriorStateBytes = 64 * 1024 * 1024;
const priorStateChunkBytes = 64 * 1024;

export class AflTradeNonproductionPlanValidationError extends Error {
  readonly issues: readonly AflTradeNonproductionPlanIssue[];

  constructor(issues: readonly AflTradeNonproductionPlanIssue[]) {
    super(
      `AFL trade non-production plan policy failed: ${issues.map(({ code }) => code).join(', ')}`
    );
    this.name = 'AflTradeNonproductionPlanValidationError';
    this.issues = issues;
  }
}

function validatedWholeDays(
  option: string,
  value: string,
  minimum: number,
  maximum: number
): string {
  if (!/^\d+$/.test(value)) {
    throw new TypeError(`${option} must be a whole number between ${minimum} and ${maximum}.`);
  }
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < minimum || days > maximum) {
    throw new TypeError(`${option} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return String(days);
}

function parsePlanInputs(argv: readonly string[]): AflTradeNonproductionPlanInputs {
  const values = new Map<string, string>();
  let enableMigrationSecretAccess = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--enable-migration-secret-access') {
      if (enableMigrationSecretAccess) {
        throw new TypeError('Plan validation options must be supplied at most once.');
      }
      enableMigrationSecretAccess = true;
      continue;
    }
    if (
      option !== '--aws-account-id' &&
      option !== '--capture-retention-days' &&
      option !== '--database-backup-retention-days' &&
      option !== '--permissions-boundary-arn' &&
      option !== '--state'
    ) {
      throw new TypeError(`Unsupported plan validation option: ${option ?? '<missing>'}.`);
    }
    const value = argv[index + 1]?.trim();
    if (value === undefined || value === '' || values.has(option)) {
      throw new TypeError('Plan validation options require one non-empty value each.');
    }
    values.set(option, value);
    index += 1;
  }
  const awsAccountId = values.get('--aws-account-id');
  const captureRetentionDays = values.get('--capture-retention-days');
  if (awsAccountId === undefined || captureRetentionDays === undefined) {
    throw new TypeError('Plan validation requires --aws-account-id and --capture-retention-days.');
  }
  if (!/^\d{12}$/.test(awsAccountId)) {
    throw new TypeError('--aws-account-id must be exactly 12 decimal digits.');
  }
  const reviewedCaptureRetentionDays = validatedWholeDays(
    '--capture-retention-days',
    captureRetentionDays,
    2,
    3650
  );
  const reviewedDatabaseBackupRetentionDays = validatedWholeDays(
    '--database-backup-retention-days',
    values.get('--database-backup-retention-days') ?? '7',
    7,
    35
  );
  const statePath = values.get('--state') ?? null;
  if (enableMigrationSecretAccess && statePath === null) {
    throw new TypeError('--enable-migration-secret-access requires one explicit --state path.');
  }
  return {
    awsAccountId,
    captureRetentionDays: reviewedCaptureRetentionDays,
    databaseBackupRetentionDays: reviewedDatabaseBackupRetentionDays,
    enableMigrationSecretAccess,
    permissionsBoundaryArn: values.get('--permissions-boundary-arn') ?? null,
    statePath,
  };
}

function planArguments(
  inputs: AflTradeNonproductionPlanInputs,
  savedPlanPath: string,
  statePath: string
): string[] {
  return [
    'plan',
    '-input=false',
    '-refresh=true',
    '-lock=true',
    '-lock-timeout=30s',
    '-parallelism=10',
    `-out=${savedPlanPath}`,
    `-state=${statePath}`,
    `-var=aws_account_id=${inputs.awsAccountId}`,
    '-var=aws_region=ap-southeast-2',
    '-var=environment=non_production',
    '-var=vpc_cidr=10.64.0.0/16',
    '-var=database_instance_class=db.t4g.micro',
    `-var=database_backup_retention_days=${inputs.databaseBackupRetentionDays}`,
    `-var=enable_migration_secret_access=${String(inputs.enableMigrationSecretAccess)}`,
    `-var=capture_retention_days=${inputs.captureRetentionDays}`,
    '-var=cache_node_type=cache.t4g.micro',
    `-var=permissions_boundary_arn=${inputs.permissionsBoundaryArn ?? 'null'}`,
    '-var=tags={}',
  ];
}

function sanitizedPlanEnvironment(
  environment: NodeJS.ProcessEnv,
  snapshot: AflTradeNonproductionPlanSnapshot
): NodeJS.ProcessEnv {
  const sanitized = Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) =>
        value !== undefined &&
        (forwardedAwsCredentialEnvironmentNames.has(name) || forwardedEnvironmentNames.has(name))
    )
  );
  return {
    ...sanitized,
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
    TF_CLI_CONFIG_FILE: resolve(snapshot.sourceDirectory, 'review.tfrc'),
    TF_DATA_DIR: snapshot.dataDirectory,
  };
}

function executePlanRenderer(
  command: string,
  args: readonly string[],
  options: PlanExecutionOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: 'utf8',
        env: options.environment,
        killSignal: 'SIGKILL',
        maxBuffer: 128 * 1024 * 1024,
        signal: options.signal,
        timeout: options.timeoutMs,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
  });
}

function parseRenderedPlan(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch (cause) {
    throw new TypeError('OpenTofu did not render valid plan JSON.', { cause });
  }
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function hashFileHandle(
  handle: FileHandle,
  byteLength: number,
  signal: AbortSignal
): Promise<string> {
  const digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(priorStateChunkBytes, Math.max(byteLength, 1)));
  let position = 0;
  while (position < byteLength) {
    signal.throwIfAborted();
    const requestedBytes = Math.min(buffer.length, byteLength - position);
    const { bytesRead } = await handle.read(buffer, 0, requestedBytes, position);
    if (bytesRead === 0) {
      throw new TypeError(
        'Prior OpenTofu state changed while its owned snapshot was being created.'
      );
    }
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  signal.throwIfAborted();
  return digest.digest('hex');
}

async function closeHandlePreservingError(
  handle: FileHandle,
  primaryError: unknown
): Promise<void> {
  try {
    await handle.close();
  } catch (closeError) {
    if (primaryError !== undefined) {
      throw new AggregateError(
        [primaryError, closeError],
        'Prior-state processing and file-handle cleanup both failed.'
      );
    }
    throw closeError;
  }
  if (primaryError !== undefined) throw primaryError;
}

async function copyPriorStateFromHandle(input: {
  byteLength: number;
  destinationPath: string;
  signal: AbortSignal;
  sourceHandle: FileHandle;
}): Promise<string> {
  const destinationHandle = await open(
    input.destinationPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
    0o600
  );
  let primaryError: unknown;
  let copiedDigest: string | undefined;
  try {
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(
      Math.min(priorStateChunkBytes, Math.max(input.byteLength, 1))
    );
    let position = 0;
    while (position < input.byteLength) {
      input.signal.throwIfAborted();
      const requestedBytes = Math.min(buffer.length, input.byteLength - position);
      const { bytesRead } = await input.sourceHandle.read(buffer, 0, requestedBytes, position);
      if (bytesRead === 0) {
        throw new TypeError(
          'Prior OpenTofu state changed while its owned snapshot was being created.'
        );
      }
      let writtenBytes = 0;
      while (writtenBytes < bytesRead) {
        input.signal.throwIfAborted();
        const writeResult = await destinationHandle.write(
          buffer,
          writtenBytes,
          bytesRead - writtenBytes,
          position + writtenBytes
        );
        if (writeResult.bytesWritten === 0) {
          throw new TypeError('The owned prior-state snapshot could not be written completely.');
        }
        writtenBytes += writeResult.bytesWritten;
      }
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    await destinationHandle.chmod(0o600);
    const destinationMetadata = await destinationHandle.stat({ bigint: true });
    if (destinationMetadata.size !== BigInt(input.byteLength)) {
      throw new TypeError('The owned prior-state snapshot has an unexpected byte length.');
    }
    copiedDigest = digest.digest('hex');
    const verifiedDestinationDigest = await hashFileHandle(
      destinationHandle,
      input.byteLength,
      input.signal
    );
    if (verifiedDestinationDigest !== copiedDigest) {
      throw new TypeError('The owned prior-state snapshot differs from the admitted source bytes.');
    }
  } catch (error) {
    primaryError = error;
  }
  await closeHandlePreservingError(destinationHandle, primaryError);
  if (copiedDigest === undefined) {
    throw new TypeError('Prior-state processing did not produce a digest.');
  }
  return copiedDigest;
}

async function snapshotPriorState(input: {
  afterOpen?: () => Promise<void> | void;
  destinationPath: string;
  sourcePath: string;
  signal: AbortSignal;
}): Promise<string> {
  let sourceHandle: FileHandle;
  try {
    sourceHandle = await open(
      input.sourcePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new TypeError('Prior OpenTofu state must be one regular file, not a link.', {
        cause: error,
      });
    }
    throw error;
  }
  let primaryError: unknown;
  let inputStateDigest: string | undefined;
  try {
    const metadataBeforeCopy = await sourceHandle.stat({ bigint: true });
    if (!metadataBeforeCopy.isFile()) {
      throw new TypeError('Prior OpenTofu state must be one regular file, not a link.');
    }
    if (metadataBeforeCopy.size > BigInt(maximumPriorStateBytes)) {
      throw new TypeError('Prior OpenTofu state exceeds the reviewed 64 MiB limit.');
    }
    const byteLength = Number(metadataBeforeCopy.size);
    await input.afterOpen?.();
    input.signal.throwIfAborted();
    inputStateDigest = await copyPriorStateFromHandle({
      byteLength,
      destinationPath: input.destinationPath,
      signal: input.signal,
      sourceHandle,
    });
    const verifiedSourceDigest = await hashFileHandle(sourceHandle, byteLength, input.signal);
    const metadataAfterCopy = await sourceHandle.stat({ bigint: true });
    if (
      verifiedSourceDigest !== inputStateDigest ||
      metadataAfterCopy.dev !== metadataBeforeCopy.dev ||
      metadataAfterCopy.ino !== metadataBeforeCopy.ino ||
      metadataAfterCopy.size !== metadataBeforeCopy.size ||
      metadataAfterCopy.mtimeNs !== metadataBeforeCopy.mtimeNs ||
      metadataAfterCopy.ctimeNs !== metadataBeforeCopy.ctimeNs
    ) {
      throw new TypeError(
        'Prior OpenTofu state changed while its owned snapshot was being created.'
      );
    }
  } catch (error) {
    primaryError = error;
  }
  await closeHandlePreservingError(sourceHandle, primaryError);
  if (inputStateDigest === undefined) {
    throw new TypeError('Prior-state processing did not produce a digest.');
  }
  return inputStateDigest;
}

export async function computeAflTradeNonproductionConfigurationSourceDigest(
  sourceDirectory = infrastructureDirectory
): Promise<string> {
  const sourceEntries = (await readdir(sourceDirectory, { withFileTypes: true })).filter(
    (entry) =>
      entry.name === '.terraform.lock.hcl' ||
      entry.name === 'review.tfrc' ||
      entry.name.endsWith('.tofu') ||
      entry.name.endsWith('.tofu.json') ||
      entry.name.endsWith('.tf') ||
      entry.name.endsWith('.tf.json')
  );
  if (sourceEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new TypeError('Terraform source and lockfile entries must be regular files, not links.');
  }
  const loadedSourceFiles = sourceEntries.map(({ name }) => name).sort();
  if (
    loadedSourceFiles.length !== configurationSourceFiles.length ||
    loadedSourceFiles.some((filename, index) => filename !== configurationSourceFiles[index])
  ) {
    throw new TypeError('Terraform source manifest differs from the exact reviewed file set.');
  }
  const fileDigests: string[] = [];
  for (const filename of configurationSourceFiles) {
    fileDigests.push(await sha256File(resolve(sourceDirectory, filename)));
  }
  return createHash('sha256').update(fileDigests.join('')).digest('hex');
}

async function removeOwnedPlanSnapshot(
  rootDirectory: string,
  sourceDirectory: string
): Promise<void> {
  let permissionError: unknown;
  try {
    await chmod(sourceDirectory, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') permissionError = error;
  }
  let removalError: unknown;
  try {
    await rm(rootDirectory, { force: false, maxRetries: 3, recursive: true, retryDelay: 100 });
  } catch (error) {
    removalError = error;
  }
  if (permissionError !== undefined && removalError !== undefined) {
    throw new AggregateError(
      [permissionError, removalError],
      'Snapshot permissions and exact recursive cleanup both failed.'
    );
  }
  if (permissionError !== undefined) throw permissionError;
  if (removalError !== undefined) throw removalError;
}

async function createOwnedPlanSnapshot(input: {
  afterPriorStateOpen?: () => Promise<void> | void;
  computeConfigurationSourceDigest: ComputeConfigurationSourceDigest;
  copySnapshotFile: typeof copyFile;
  priorStatePath: string | null;
  signal: AbortSignal;
  workspaceSourceDirectory: string;
}): Promise<AflTradeNonproductionPlanSnapshot> {
  input.signal.throwIfAborted();
  const workspaceDigestBeforeCopy = await input.computeConfigurationSourceDigest(
    input.workspaceSourceDirectory
  );
  const rootDirectory = await mkdtemp(join(tmpdir(), 'statly-afl-trade-nonproduction-plan-'));
  const sourceDirectory = join(rootDirectory, 'source');
  const dataDirectory = join(rootDirectory, 'data');
  const outputDirectory = join(rootDirectory, 'output');
  const stateDirectory = join(rootDirectory, 'state');
  const statePath = join(stateDirectory, 'terraform.tfstate');
  try {
    await mkdir(sourceDirectory, { mode: 0o700 });
    await mkdir(dataDirectory, { mode: 0o700 });
    await mkdir(outputDirectory, { mode: 0o700 });
    await mkdir(stateDirectory, { mode: 0o700 });
    for (const filename of configurationSourceFiles) {
      input.signal.throwIfAborted();
      await input.copySnapshotFile(
        resolve(input.workspaceSourceDirectory, filename),
        resolve(sourceDirectory, filename)
      );
    }
    input.signal.throwIfAborted();
    const configurationSourceDigest = await input.computeConfigurationSourceDigest(sourceDirectory);
    const workspaceDigestAfterCopy = await input.computeConfigurationSourceDigest(
      input.workspaceSourceDirectory
    );
    if (
      configurationSourceDigest !== workspaceDigestBeforeCopy ||
      workspaceDigestAfterCopy !== workspaceDigestBeforeCopy
    ) {
      throw new TypeError(
        'Terraform source changed while the owned plan snapshot was being created.'
      );
    }
    let inputStateDigest: string | null = null;
    if (input.priorStatePath !== null) {
      inputStateDigest = await snapshotPriorState({
        afterOpen: input.afterPriorStateOpen,
        destinationPath: statePath,
        signal: input.signal,
        sourcePath: resolve(input.priorStatePath),
      });
    }
    for (const filename of configurationSourceFiles) {
      input.signal.throwIfAborted();
      await chmod(resolve(sourceDirectory, filename), 0o400);
    }
    await chmod(sourceDirectory, 0o500);
    input.signal.throwIfAborted();
    return {
      configurationSourceDigest,
      dataDirectory,
      inputStateDigest,
      outputDirectory,
      rootDirectory,
      sourceDirectory,
      stateDirectory,
      statePath,
    };
  } catch (error) {
    let cleanupError: unknown;
    try {
      await removeOwnedPlanSnapshot(rootDirectory, sourceDirectory);
    } catch (snapshotCleanupError) {
      cleanupError = snapshotCleanupError;
    }
    if (cleanupError !== undefined) {
      throw new AggregateError(
        [error, cleanupError],
        'Snapshot creation and exact recursive cleanup both failed.'
      );
    }
    throw error;
  }
}

export async function runAflTradeNonproductionPlanValidationCommand(input: {
  afterPriorStateOpen?: () => Promise<void> | void;
  argv: readonly string[];
  beforeSnapshotCleanup?: () => Promise<void> | void;
  computeConfigurationSourceDigest?: ComputeConfigurationSourceDigest;
  copySnapshotFile?: typeof copyFile;
  environment?: NodeJS.ProcessEnv;
  execute?: ExecutePlanRenderer;
  signal?: AbortSignal;
  workspaceSourceDirectory?: string;
  writeOutput?: (line: string) => void;
}) {
  const inputs = parsePlanInputs(input.argv);
  const execute = input.execute ?? executePlanRenderer;
  const computeConfigurationSourceDigest =
    input.computeConfigurationSourceDigest ?? computeAflTradeNonproductionConfigurationSourceDigest;
  const commandController = new AbortController();
  const relayAbort = () => commandController.abort(input.signal?.reason);
  if (input.signal?.aborted === true) relayAbort();
  else input.signal?.addEventListener('abort', relayAbort, { once: true });
  let snapshot: AflTradeNonproductionPlanSnapshot | undefined;
  let result:
    | {
        readonly configurationSourceDigest: string;
        readonly inputStateDigest: string | null;
        readonly issueCount: 0;
        readonly status: 'plan_policy_passed';
      }
    | undefined;
  let primaryError: unknown;
  try {
    snapshot = await createOwnedPlanSnapshot({
      afterPriorStateOpen: input.afterPriorStateOpen,
      computeConfigurationSourceDigest,
      copySnapshotFile: input.copySnapshotFile ?? copyFile,
      priorStatePath: inputs.statePath,
      signal: commandController.signal,
      workspaceSourceDirectory: input.workspaceSourceDirectory ?? infrastructureDirectory,
    });
    const environment = sanitizedPlanEnvironment(input.environment ?? process.env, snapshot);
    const executionOptions = (timeoutMs: number): PlanExecutionOptions => ({
      environment,
      signal: commandController.signal,
      timeoutMs,
    });
    const savedPlanPath = join(snapshot.outputDirectory, 'review.tfplan');
    await execute(
      'tofu',
      [
        `-chdir=${snapshot.sourceDirectory}`,
        'init',
        '-backend=true',
        '-input=false',
        '-lockfile=readonly',
      ],
      executionOptions(300_000)
    );
    const workspace = await execute(
      'tofu',
      [`-chdir=${snapshot.sourceDirectory}`, 'workspace', 'show'],
      executionOptions(30_000)
    );
    if (workspace.trim() !== 'default') {
      throw new TypeError('Plan validation requires the default OpenTofu workspace.');
    }
    await execute(
      'tofu',
      [
        `-chdir=${snapshot.sourceDirectory}`,
        ...planArguments(inputs, savedPlanPath, snapshot.statePath),
      ],
      executionOptions(600_000)
    );
    const digestAfterPlanning = await computeConfigurationSourceDigest(snapshot.sourceDirectory);
    if (digestAfterPlanning !== snapshot.configurationSourceDigest) {
      throw new TypeError('The owned Terraform snapshot changed while the plan was being created.');
    }
    commandController.signal.throwIfAborted();
    const rendered = await execute(
      'tofu',
      [`-chdir=${snapshot.sourceDirectory}`, 'show', '-json', savedPlanPath],
      executionOptions(60_000)
    );
    const issues = validateAflTradeNonproductionPlan(parseRenderedPlan(rendered), {
      configurationSourceDigest: snapshot.configurationSourceDigest,
    });
    if (issues.length > 0) throw new AflTradeNonproductionPlanValidationError(issues);
    const digestAfterValidation = await computeConfigurationSourceDigest(snapshot.sourceDirectory);
    if (digestAfterValidation !== snapshot.configurationSourceDigest) {
      throw new TypeError('The owned Terraform snapshot changed before validation could complete.');
    }
    commandController.signal.throwIfAborted();
    result = {
      configurationSourceDigest: snapshot.configurationSourceDigest,
      inputStateDigest: snapshot.inputStateDigest,
      issueCount: 0,
      status: 'plan_policy_passed',
    };
  } catch (error) {
    primaryError = error;
  }
  let cleanupError: unknown;
  if (snapshot !== undefined) {
    let beforeCleanupError: unknown;
    try {
      await input.beforeSnapshotCleanup?.();
    } catch (error) {
      beforeCleanupError = error;
    }
    let snapshotRemovalError: unknown;
    try {
      await removeOwnedPlanSnapshot(snapshot.rootDirectory, snapshot.sourceDirectory);
    } catch (error) {
      snapshotRemovalError = error;
    }
    if (beforeCleanupError !== undefined && snapshotRemovalError !== undefined) {
      cleanupError = new AggregateError(
        [beforeCleanupError, snapshotRemovalError],
        'Pre-cleanup work and exact snapshot cleanup both failed.'
      );
    } else {
      cleanupError = beforeCleanupError ?? snapshotRemovalError;
    }
  }
  const cancellationAfterCleanup = commandController.signal.aborted
    ? commandController.signal.reason
    : undefined;
  input.signal?.removeEventListener('abort', relayAbort);
  if (primaryError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'Plan validation and exact snapshot cleanup both failed.'
    );
  }
  if (primaryError !== undefined) throw primaryError;
  if (cleanupError !== undefined) throw cleanupError;
  if (cancellationAfterCleanup !== undefined) throw cancellationAfterCleanup;
  if (result === undefined) throw new TypeError('Plan validation did not produce a result.');

  (input.writeOutput ?? ((line) => process.stdout.write(`${line}\n`)))(JSON.stringify(result));
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  const controller = new AbortController();
  let requestedExitCode: number | undefined;
  const handleSignal = (exitCode: number) => {
    requestedExitCode = exitCode;
    controller.abort(new Error('Plan validation was cancelled by an operator signal.'));
  };
  const handleInterrupt = () => handleSignal(130);
  const handleTermination = () => handleSignal(143);
  process.on('SIGINT', handleInterrupt);
  process.on('SIGTERM', handleTermination);
  runAflTradeNonproductionPlanValidationCommand({
    argv: process.argv.slice(2),
    signal: controller.signal,
  })
    .catch((error) => {
      const codes =
        error instanceof AflTradeNonproductionPlanValidationError
          ? error.issues.map(({ code }) => code).join(', ')
          : 'PLAN_RENDER_OR_PARSE_FAILED';
      process.stderr.write(`AFL trade non-production plan validation failed: ${codes}.\n`);
      process.exitCode = requestedExitCode ?? 1;
    })
    .finally(() => {
      process.removeListener('SIGINT', handleInterrupt);
      process.removeListener('SIGTERM', handleTermination);
    });
}
