import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  storeLocalAflTradeEvidence,
  type AflTradeStoredEvidence,
} from '../src/server/aflTradeIntelligence/development/localEvidenceStorage';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Stores one evidence file, such as an owner's approval record, in the registered artifact store
 * before anything cites it: write, read back, then custody and location in one transaction. Prints
 * the `artifact:` id to cite. See the runbook section "Storing evidence before it is cited".
 *
 * Usage:
 *   npm run outcomes:artifacts:store-evidence -- --store-id <store-id> --file <absolute-path> \
 *     --media-type <type/subtype> [--repository-id <id>] [--artifact-class raw_source|capture_metadata]
 */

const MAXIMUM_EVIDENCE_BYTES = 32 * 1024 * 1024;
const DEFAULT_REPOSITORY_ID = 'governance-evidence';
const OPTIONS = ['--store-id', '--file', '--media-type', '--repository-id', '--artifact-class'];

export interface StoreEvidenceArguments {
  databaseUrl: string;
  storeId: string;
  file: string;
  mediaType: string;
  repositoryId: string;
  artifactClass: 'raw_source' | 'capture_metadata';
}

export function parseStoreEvidenceArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): StoreEvidenceArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]!;
    const value = argv[index + 1];
    if (!OPTIONS.includes(name)) throw new TypeError(`Unexpected argument ${name}.`);
    if (value === undefined || value.startsWith('--'))
      throw new TypeError(`${name} needs a value.`);
    if (values.has(name)) throw new TypeError(`${name} may be given once.`);
    values.set(name, value);
  }
  const required = (name: string) => {
    const value = values.get(name);
    if (value === undefined) throw new TypeError(`${name} is required.`);
    return value;
  };
  const file = required('--file');
  if (!isAbsolute(file)) throw new TypeError('--file must be an absolute path.');
  const artifactClass = values.get('--artifact-class') ?? 'raw_source';
  if (artifactClass !== 'raw_source' && artifactClass !== 'capture_metadata') {
    throw new TypeError('--artifact-class must be raw_source or capture_metadata.');
  }
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    storeId: required('--store-id'),
    file,
    mediaType: required('--media-type'),
    repositoryId: values.get('--repository-id') ?? DEFAULT_REPOSITORY_ID,
    artifactClass,
  };
}

export async function runStoreEvidenceCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<AflTradeStoredEvidence> {
  const parsed = parseStoreEvidenceArguments(input.argv, input.env);
  const bytes = new Uint8Array(await readFile(parsed.file));
  if (bytes.byteLength > MAXIMUM_EVIDENCE_BYTES) {
    throw new RangeError(`--file exceeds ${MAXIMUM_EVIDENCE_BYTES} bytes.`);
  }
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const stored = await storeLocalAflTradeEvidence(createPgAflOutcomeSqlClient(pool), {
      storeId: parsed.storeId,
      repositoryId: parsed.repositoryId,
      artifactClass: parsed.artifactClass,
      bytes,
      mediaType: parsed.mediaType,
      maximumObjectBytes: MAXIMUM_EVIDENCE_BYTES,
    });
    write(
      JSON.stringify({
        artifactId: stored.reference.artifactId,
        contentSha256: stored.reference.contentSha256,
        byteLength: stored.reference.byteLength,
        mediaType: stored.reference.mediaType,
        storeId: stored.storeId,
        objectKey: stored.objectKey,
        custody: stored.custody,
      })
    );
    return stored;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runStoreEvidenceCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Evidence storage stopped; nothing was recorded. ${message}\n`);
      process.exitCode = 1;
    }
  );
}
