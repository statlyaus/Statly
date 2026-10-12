import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  PostgresSourceCaptureSuccessorRepository,
  type SourceCaptureSuccessorOutcome,
  type SourceCaptureSuccessorRequest,
} from '../src/server/aflTradeIntelligence/outcomes/postgresSourceCaptureSuccessorRepository';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Records a successor for one lost source capture under the delegated capture-successor rule. A dry
 * run is the default and writes nothing. See the runbook section "Recording successors for lost
 * source captures".
 *
 * Usage:
 *   npm run outcomes:sources:register-capture-successor -- \
 *     --lost-artifact <artifact:...> --successor-capture <source-capture:...> [--apply]
 *   npm run outcomes:sources:register-capture-successor -- \
 *     --lost-artifact <artifact:...> --omit --owner-decision <reference> [--apply]
 */

const VALUE_OPTIONS = new Set(['--lost-artifact', '--successor-capture', '--owner-decision']);
const FLAGS = new Set(['--omit', '--apply']);

function usage(message: string): never {
  throw new TypeError(
    `${message} See the runbook section "Recording successors for lost source captures".`
  );
}

/** Splits the arguments into valued options and flags, each given at most once. */
function readOptions(argv: readonly string[]): {
  values: Map<string, string>;
  flags: Set<string>;
} {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index] ?? '';
    if (FLAGS.has(name)) {
      if (flags.has(name)) usage(`${name} may be given once.`);
      flags.add(name);
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
  return { values, flags };
}

function omittedRequest(lostArtifactId: string, values: Map<string, string>) {
  if (values.has('--successor-capture')) usage('--omit takes no --successor-capture.');
  const ownerDecisionRef = values.get('--owner-decision')?.trim();
  if (ownerDecisionRef === undefined || ownerDecisionRef.length < 3) {
    usage('--omit requires --owner-decision naming the owner decision that allows it.');
  }
  return { kind: 'omitted' as const, lostArtifactId, ownerDecisionRef };
}

function recapturedRequest(lostArtifactId: string, values: Map<string, string>) {
  if (values.has('--owner-decision')) usage('--owner-decision is only for --omit.');
  const successorCaptureId = values.get('--successor-capture');
  if (
    successorCaptureId === undefined ||
    !/^source-capture:[0-9a-f]{64}$/u.test(successorCaptureId)
  ) {
    usage('--successor-capture must be a source capture ID, or use --omit.');
  }
  return { kind: 'recaptured' as const, lostArtifactId, successorCaptureId };
}

export function parseRegisterCaptureSuccessorArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): { databaseUrl: string; request: SourceCaptureSuccessorRequest; apply: boolean } {
  const { values, flags } = readOptions(argv);
  const lostArtifactId = values.get('--lost-artifact');
  if (lostArtifactId === undefined || !/^artifact:[0-9a-f]{64}$/u.test(lostArtifactId)) {
    usage('--lost-artifact must be an artifact ID.');
  }
  const request: SourceCaptureSuccessorRequest = flags.has('--omit')
    ? omittedRequest(lostArtifactId, values)
    : recapturedRequest(lostArtifactId, values);
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    request,
    apply: flags.has('--apply'),
  };
}

export async function runRegisterCaptureSuccessorCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<SourceCaptureSuccessorOutcome> {
  const parsed = parseRegisterCaptureSuccessorArguments(input.argv, input.env);
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const repository = new PostgresSourceCaptureSuccessorRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const outcome = await repository.register(parsed.request, { apply: parsed.apply });
    write(JSON.stringify({ lostArtifactId: parsed.request.lostArtifactId, ...outcome }));
    return outcome;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runRegisterCaptureSuccessorCommand({ argv: process.argv.slice(2), env: process.env })
    .then((outcome) => {
      if (outcome.status === 'refused') process.exitCode = 2;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Capture successor registration stopped. ${message}\n`);
      process.exitCode = 1;
    });
}
