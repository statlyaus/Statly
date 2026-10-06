import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  mirrorLocalAflTradeArtifactStore,
  restoreTestLocalAflTradeArtifactMirror,
  type AflTradeCloudStorageCommand,
} from '../src/server/aflTradeIntelligence/development/artifactStoreMirror';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Mirrors the registered local non-production store to its versioned Cloud Storage bucket after a
 * clean custody readback, or runs the monthly restore test. See the operations runbook section
 * "Evidence store mirror".
 *
 * Usage:
 *   npm run outcomes:artifacts:mirror -- --store-id <store-id> --mirror gs://<bucket>/<path>
 *   npm run outcomes:artifacts:mirror -- --store-id <store-id> --restore-test \
 *     --receipt <absolute-receipt.json>
 */

export type MirrorArtifactStoreArguments =
  | { mode: 'mirror'; databaseUrl: string; storeId: string; mirrorLocator: string }
  | { mode: 'restore-test'; databaseUrl: string; storeId: string; receiptPath: string };

function usage(message: string): never {
  throw new TypeError(`${message} See the runbook section "Evidence store mirror".`);
}

export function parseMirrorArtifactStoreArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): MirrorArtifactStoreArguments {
  const values = new Map<string, string>();
  let restoreTest = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index] ?? '';
    if (name === '--restore-test') {
      if (restoreTest) usage('--restore-test may be given once.');
      restoreTest = true;
      continue;
    }
    const value = argv[index + 1];
    if (
      !['--store-id', '--mirror', '--receipt'].includes(name) ||
      value === undefined ||
      value.startsWith('--')
    ) {
      usage(`Unexpected argument ${name}.`);
    }
    if (values.has(name)) usage(`${name} may be given once.`);
    values.set(name, value);
    index += 1;
  }
  const storeId = values.get('--store-id');
  if (storeId === undefined || !/^[a-z][a-z0-9-]{2,62}$/u.test(storeId)) {
    usage('--store-id must be lowercase letters, digits and hyphens, starting with a letter.');
  }
  const databaseUrl = requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL);
  if (restoreTest) {
    if (values.has('--mirror')) usage('--restore-test reads the recorded mirror; omit --mirror.');
    const receiptPath = values.get('--receipt');
    if (receiptPath === undefined || !isAbsolute(receiptPath)) {
      usage('--restore-test requires an absolute --receipt path.');
    }
    return { mode: 'restore-test', databaseUrl, storeId, receiptPath };
  }
  if (values.has('--receipt')) usage('--receipt is only for --restore-test.');
  const mirrorLocator = values.get('--mirror');
  if (mirrorLocator === undefined || !mirrorLocator.startsWith('gs://')) {
    usage('--mirror must be a gs:// bucket path.');
  }
  return { mode: 'mirror', databaseUrl, storeId, mirrorLocator };
}

const STDERR_TAIL_BYTES = 64 * 1024;

/**
 * Runs one `gcloud storage` command without buffering its output. A store sync prints a line per
 * object, hundreds of thousands of them, so stdout is discarded and only the last 64 KiB of stderr
 * is kept for the failure message.
 */
export function runGcloudStorage(args: readonly string[], command = 'gcloud'): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ['storage', ...args, '--quiet'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // Registered first: a failed spawn (EMFILE, ENFILE, ENOENT) can leave stderr null and must
    // reject the promise rather than crash the process.
    child.on('error', reject);
    let tail = Buffer.alloc(0);
    child.stderr?.on('data', (chunk: Buffer) => {
      tail = Buffer.concat([tail, chunk]);
      if (tail.byteLength > STDERR_TAIL_BYTES) {
        tail = tail.subarray(tail.byteLength - STDERR_TAIL_BYTES);
      }
    });
    child.on('close', (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(
            `gcloud storage ${args[0] ?? ''} failed (${signal ?? `exit ${code}`}): ${tail.toString('utf8').trim().slice(-2000)}`
          )
        );
    });
  });
}

const gcloudStorage: AflTradeCloudStorageCommand = (args) => runGcloudStorage(args);

export async function runMirrorArtifactStoreCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  runCloudStorage?: AflTradeCloudStorageCommand;
  writeOutput?: (line: string) => void;
}): Promise<boolean> {
  const parsed = parseMirrorArtifactStoreArguments(input.argv, input.env);
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const runCloudStorage = input.runCloudStorage ?? gcloudStorage;
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const client = createPgAflOutcomeSqlClient(pool);
    if (parsed.mode === 'mirror') {
      write(
        JSON.stringify(
          await mirrorLocalAflTradeArtifactStore({
            client,
            storeId: parsed.storeId,
            mirrorLocator: parsed.mirrorLocator,
            runCloudStorage,
          })
        )
      );
      return true;
    }
    const receipt = await restoreTestLocalAflTradeArtifactMirror({
      client,
      storeId: parsed.storeId,
      runCloudStorage,
    });
    await writeFile(parsed.receiptPath, `${JSON.stringify(receipt, null, 1)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    write(JSON.stringify(receipt));
    return receipt.verdict === 'exact';
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runMirrorArtifactStoreCommand({ argv: process.argv.slice(2), env: process.env })
    .then((exact) => {
      if (!exact) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Evidence store mirror stopped. ${message}\n`);
      process.exitCode = 1;
    });
}
