import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  registerDraftees,
  type RegisterDrafteesOptions,
  type RegisterDrafteesOutcome,
} from '../src/server/aflTradeIntelligence/development/drafteeRegistrationRun';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Creates a season's national draftees as canonical players and links each to its Draftguru and,
 * when given, Footyinfo subject, from a reviewed JSONL plan and a stored owner approval. A dry run
 * is the default and writes nothing. See the runbook section "Registering a season's national
 * draftees".
 *
 * Usage:
 *   npm run outcomes:sources:register-draftees -- --completion <completion-id> \
 *     --plan <reviewed.jsonl> --approval-artifact <artifact:...> --principal <reviewer-ref> \
 *     --store-id <store-id> [--apply]
 */

const VALUE_OPTIONS = [
  '--completion',
  '--plan',
  '--approval-artifact',
  '--principal',
  '--store-id',
] as const;

function usage(message: string): never {
  throw new TypeError(
    `${message} See the runbook section "Registering a season's national draftees".`
  );
}

export function parseRegisterDrafteesArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): { databaseUrl: string; options: RegisterDrafteesOptions } {
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
    if (
      !VALUE_OPTIONS.some((option) => option === name) ||
      value === undefined ||
      value.startsWith('--')
    ) {
      usage(`Unexpected argument ${name}.`);
    }
    if (values.has(name)) usage(`${name} may be given once.`);
    values.set(name, value);
    index += 1;
  }
  const required = (name: (typeof VALUE_OPTIONS)[number], pattern: RegExp) => {
    const value = values.get(name)?.trim();
    if (value === undefined || !pattern.test(value)) usage(`${name} is missing or invalid.`);
    return value;
  };
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    options: {
      completionId: required(
        '--completion',
        /^external-historical-capture-completion:[a-f0-9]{64}$/u
      ),
      planPath: required('--plan', /./u),
      approvalArtifactId: required('--approval-artifact', /^artifact:[a-f0-9]{64}$/u),
      principalRef: required('--principal', /^\S.{0,239}$/u),
      storeId: required('--store-id', /^[a-z][a-z0-9-]{2,62}$/u),
      apply,
    },
  };
}

export async function runRegisterDrafteesCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<RegisterDrafteesOutcome> {
  const parsed = parseRegisterDrafteesArguments(input.argv, input.env);
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    return await registerDraftees({
      client: createPgAflOutcomeSqlClient(pool),
      options: parsed.options,
      write,
    });
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runRegisterDrafteesCommand({ argv: process.argv.slice(2), env: process.env })
    .then((outcome) => {
      if (outcome.status === 'refused') process.exitCode = 2;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Draftee registration stopped. ${message}\n`);
      process.exitCode = 1;
    });
}
