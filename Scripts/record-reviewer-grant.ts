import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { storeLocalAflTradeEvidence } from '../src/server/aflTradeIntelligence/development/localEvidenceStorage';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeOperationalGrantSchema,
  createAflTradeOperationalGrantEvidence,
  PostgresAflTradeOperationalGrantRepository,
  type AflTradeOperationalGrant,
  type AflTradeOperationalGrantCheck,
} from '../src/server/aflTradeIntelligence/source/postgresOperationalGrantRepository';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Records the owner's grant of an intake role (external identity reviewer or canonical promoter) to
 * one principal for a season range and term. The grant evidence is stored first, then the approval,
 * governed evidence reference and operational authority in one transaction. A dry run is the
 * default and writes nothing. See the runbook section "Recording reviewer and promoter grants".
 *
 * Usage:
 *   npm run outcomes:sources:record-reviewer-grant -- --role <role> --principal <ref> \
 *     --provider <draftguru|footyinfo|multi_source> --from-season <year> --through-season <year> \
 *     --valid-through <iso> --approval-artifact <artifact:...> --decided-by <ref> \
 *     --decided-at <iso> --store-id <store-id> [--apply]
 */

const OPTIONS = {
  '--role': 'role',
  '--principal': 'principalRef',
  '--provider': 'provider',
  '--from-season': 'validFromSeason',
  '--through-season': 'validThroughSeason',
  '--valid-through': 'validThrough',
  '--approval-artifact': 'approvalArtifactId',
  '--decided-by': 'decidedBy',
  '--decided-at': 'decidedAt',
  '--store-id': 'storeId',
} as const;
const MAXIMUM_EVIDENCE_BYTES = 1024 * 1024;

function usage(message: string): never {
  throw new TypeError(
    `${message} See the runbook section "Recording reviewer and promoter grants".`
  );
}

export function parseReviewerGrantArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): { databaseUrl: string; grant: AflTradeOperationalGrant; storeId: string; apply: boolean } {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index] ?? '';
    if (name === '--apply' && !apply) {
      apply = true;
      continue;
    }
    const value = argv[index + 1];
    if (!Object.hasOwn(OPTIONS, name) || value === undefined || value.startsWith('--')) {
      usage(`Unexpected argument ${name}.`);
    }
    if (values.has(name)) usage(`${name} may be given once.`);
    values.set(name, value);
    index += 1;
  }
  const storeId = values.get('--store-id');
  if (storeId === undefined) usage('--store-id is required.');
  const parsed = aflTradeOperationalGrantSchema.safeParse({
    role: values.get('--role'),
    principalRef: values.get('--principal'),
    provider: values.get('--provider'),
    validFromSeason: Number(values.get('--from-season')),
    validThroughSeason: Number(values.get('--through-season')),
    validThrough: values.get('--valid-through'),
    approvalArtifactId: values.get('--approval-artifact'),
    decidedBy: values.get('--decided-by'),
    decidedAt: values.get('--decided-at'),
  });
  if (!parsed.success) {
    usage(
      `Invalid grant: ${parsed.error.issues.map(({ path, message }) => `${path.join('.') || 'grant'}: ${message}`).join('; ')}.`
    );
  }
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    grant: parsed.data,
    storeId,
    apply,
  };
}

export type ReviewerGrantOutcome =
  | Exclude<AflTradeOperationalGrantCheck, { status: 'ready' }>
  | { status: 'dry_run' | 'recorded'; authorityEvidenceId: string };

export async function recordReviewerGrant(
  sql: AflOutcomeSqlClient,
  input: { grant: AflTradeOperationalGrant; storeId: string; apply: boolean }
): Promise<ReviewerGrantOutcome> {
  const repository = new PostgresAflTradeOperationalGrantRepository(sql);
  const check = await repository.check(input.grant);
  if (check.status !== 'ready') return check;
  if (!input.apply) return { status: 'dry_run', authorityEvidenceId: check.authorityEvidenceId };
  const stored = await storeLocalAflTradeEvidence(sql, {
    storeId: input.storeId,
    repositoryId: 'governance-evidence',
    artifactClass: 'capture_metadata',
    bytes: new TextEncoder().encode(
      createAflTradeOperationalGrantEvidence(input.grant).canonicalJson
    ),
    mediaType: 'application/json',
    maximumObjectBytes: MAXIMUM_EVIDENCE_BYTES,
  });
  const recorded = await repository.record(input.grant, stored.reference.artifactId);
  return recorded.status === 'ready'
    ? { status: 'recorded', authorityEvidenceId: recorded.authorityEvidenceId }
    : recorded;
}

export async function runReviewerGrantCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<ReviewerGrantOutcome> {
  const { databaseUrl, ...parsed } = parseReviewerGrantArguments(input.argv, input.env);
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const outcome = await recordReviewerGrant(createPgAflOutcomeSqlClient(pool), parsed);
    write(
      JSON.stringify({
        role: parsed.grant.role,
        principalRef: parsed.grant.principalRef,
        provider: parsed.grant.provider,
        seasons: [parsed.grant.validFromSeason, parsed.grant.validThroughSeason],
        validThrough: parsed.grant.validThrough,
        ...outcome,
      })
    );
    return outcome;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runReviewerGrantCommand({ argv: process.argv.slice(2), env: process.env })
    .then((outcome) => {
      if (outcome.status === 'refused') process.exitCode = 2;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Reviewer grant stopped. ${message}\n`);
      process.exitCode = 1;
    });
}
