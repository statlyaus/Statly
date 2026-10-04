import { open, rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  backfillLocalAflTradeArtifactCustodyLocations,
  registerLocalAflTradeArtifactStore,
  type LocalArtifactLocationBackfillReport,
} from '../src/server/aflTradeIntelligence/development/localArtifactCustodyLocationBackfill';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { requireDurableArtifactRoot } from './capture-local-external-pages';

/**
 * Registers the local non-production artifact store and records where each custody row's bytes live
 * in it. A dry run is the default and writes nothing. See the operations runbook section
 * "Locating retained evidence bytes".
 *
 * Usage:
 *   npm run outcomes:artifacts:locate-local -- \
 *     --store-id <store-id> --artifact-root <durable-absolute-dir> \
 *     [--report <absolute-report.json>] [--apply]
 */

export interface LocateLocalArtifactCustodyArguments {
  databaseUrl: string;
  storeId: string;
  artifactRootDirectory: string;
  reportPath: string | null;
  apply: boolean;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const VALUE_OPTIONS = new Set(['--store-id', '--artifact-root', '--report']);
const SUMMARY_LIST_LIMIT = 20;

function usage(message: string): never {
  throw new TypeError(`${message} See the runbook section "Locating retained evidence bytes".`);
}

export function requireLoopbackDatabaseUrl(value: string | undefined): string {
  const databaseUrl = value?.trim() ?? '';
  let host = '';
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:') {
      host = parsed.hostname;
    }
  } catch {
    host = '';
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    usage('AFL_OUTCOMES_DATABASE_URL must name a loopback PostgreSQL outcomes database.');
  }
  return databaseUrl;
}

export function parseLocateLocalArtifactCustodyArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  temporaryDirectories?: readonly string[]
): LocateLocalArtifactCustodyArguments {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index] ?? '';
    if (name === '--apply') {
      if (apply) usage('--apply may be given once.');
      apply = true;
      continue;
    }
    const value = argv[index + 1];
    if (!VALUE_OPTIONS.has(name) || value === undefined || value.startsWith('--')) {
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
  const root = values.get('--artifact-root');
  if (root === undefined) usage('--artifact-root is required.');
  const reportPath = values.get('--report') ?? null;
  if (reportPath !== null && !isAbsolute(reportPath)) usage('--report must be an absolute path.');
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    storeId,
    artifactRootDirectory: requireDurableArtifactRoot(root, temporaryDirectories),
    reportPath,
    apply,
  };
}

/** The printed summary keeps every count but shortens the long lists; --report keeps them whole. */
export function summarizeLocalArtifactLocationReport(report: LocalArtifactLocationBackfillReport) {
  const head = <T>(items: readonly T[]) => ({
    count: items.length,
    first: items.slice(0, SUMMARY_LIST_LIMIT),
  });
  return {
    mode: report.mode,
    storeId: report.storeId,
    rootDirectory: report.rootDirectory,
    envelopesRead: report.envelopesRead,
    located: report.located,
    alreadyLocated: report.alreadyLocated,
    notEnvelopes: head(report.notEnvelopes),
    invalidEnvelopes: head(report.invalidEnvelopes),
    duplicateFiles: head(report.duplicateFiles),
    filesWithoutCustody: head(report.filesWithoutCustody),
    conflicts: head(report.conflicts),
    unlocated: {
      total: report.unlocated.total,
      byClassAndCustody: report.unlocated.byClassAndCustody,
    },
  };
}

export async function runLocateLocalArtifactCustodyCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
  temporaryDirectories?: readonly string[];
}): Promise<LocalArtifactLocationBackfillReport> {
  const parsed = parseLocateLocalArtifactCustodyArguments(
    input.argv,
    input.env,
    input.temporaryDirectories
  );
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  // Reserve the report before any database change, so an existing or unwritable path stops the run
  // with nothing registered or located.
  const reportHandle =
    parsed.reportPath === null ? null : await open(parsed.reportPath, 'wx', 0o600);
  let reportWritten = false;
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const client = createPgAflOutcomeSqlClient(pool);
    if (parsed.apply) {
      const registration = await registerLocalAflTradeArtifactStore(client, {
        storeId: parsed.storeId,
        rootDirectory: parsed.artifactRootDirectory,
      });
      write(JSON.stringify({ storeId: parsed.storeId, ...registration }));
    }
    const report = await backfillLocalAflTradeArtifactCustodyLocations({
      client,
      storeId: parsed.storeId,
      rootDirectory: parsed.artifactRootDirectory,
      apply: parsed.apply,
    });
    if (reportHandle !== null) {
      await reportHandle.writeFile(`${JSON.stringify(report, null, 1)}\n`, 'utf8');
      reportWritten = true;
    }
    write(JSON.stringify(summarizeLocalArtifactLocationReport(report), null, 1));
    return report;
  } finally {
    await reportHandle?.close();
    if (parsed.reportPath !== null && !reportWritten) {
      await rm(parsed.reportPath, { force: true });
    }
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runLocateLocalArtifactCustodyCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Artifact location stopped. ${message}\n`);
      process.exitCode = 1;
    }
  );
}
