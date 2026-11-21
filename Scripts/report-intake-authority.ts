import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  isLocalExternalCaptureCapability,
  LocalExternalCaptureError,
  loadRecordedLocalCaptureAuthority,
  localExternalCaptureDecisionKey,
  type LocalExternalCaptureCapability,
} from '../src/server/aflTradeIntelligence/development/localExternalPageCaptureRunner';
import {
  createPostgresAflTradeGateDecisionLedgerRepository,
  type AflTradeGateDecisionLedgerRepository,
  type AflTradeStoredGateLedger,
} from '../src/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  PostgresAflTradeOperationalGrantRepository,
  type AflTradeOperationalGrantRow,
} from '../src/server/aflTradeIntelligence/source/postgresOperationalGrantRepository';
import {
  readAflTradeRetainedCompletionCurrency,
  type AflTradeRetainedCompletionCurrency,
} from '../src/server/aflTradeIntelligence/source/postgresRetainedCompletionCurrency';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Read-only report of what the 2026 intake needs to be current: for each capability and season,
 * whether the capture runner accepts its recorded decision; every reviewer and promoter grant; and,
 * for a named retained completion, whether it is current and, only when not, why each target is not.
 * Exits 2 when anything requested is not current at `--at` (default now). See the runbook section
 * "Checking intake authority".
 *
 * Usage:
 *   npm run outcomes:sources:report-intake-authority -- [--capability <id>:<season>]... \
 *     [--completion <id>] [--at <iso>]
 */

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function usage(message: string): never {
  throw new TypeError(`${message} See the runbook section "Checking intake authority".`);
}

export interface IntakeAuthorityArguments {
  databaseUrl: string;
  capabilities: { capabilityId: LocalExternalCaptureCapability; season: number }[];
  completionId: string | null;
  at: string | null;
}

export function parseIntakeAuthorityArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): IntakeAuthorityArguments {
  const capabilities: IntakeAuthorityArguments['capabilities'] = [];
  let completionId: string | null = null;
  let at: string | null = null;
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index] ?? '';
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) usage(`${name} needs a value.`);
    if (name === '--capability') {
      const match = /^(.+):(\d{4})$/u.exec(value);
      if (match === null || !isLocalExternalCaptureCapability(match[1])) {
        usage('--capability must be <capture capability>:<season>.');
      }
      capabilities.push({ capabilityId: match[1], season: Number(match[2]) });
    } else if (name === '--completion' && completionId === null) {
      if (!/^external-historical-capture-completion:[a-f0-9]{64}$/u.test(value)) {
        usage('--completion must be a retained completion ID.');
      }
      completionId = value;
    } else if (name === '--at' && at === null) {
      if (!INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
        usage('--at must be a UTC millisecond instant.');
      }
      at = value;
    } else {
      usage(`Unexpected argument ${name}.`);
    }
  }
  return {
    databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL),
    capabilities,
    completionId,
    at,
  };
}

export interface CapabilityAuthorityReport {
  capabilityId: LocalExternalCaptureCapability;
  season: number;
  decisionKey: string;
  accepted: boolean;
  refusal: string | null;
  decisionId: string | null;
  version: number | null;
  revalidateAt: string | null;
  termsExpireAt: string | null;
  /** A later version on the same key: retained targets bound to an earlier one are not current. */
  successorPresent: boolean;
}

export interface IntakeAuthorityReport {
  at: string;
  current: boolean;
  capabilities: CapabilityAuthorityReport[];
  grants: (AflTradeOperationalGrantRow & { currentAt: boolean })[];
  completion: AflTradeRetainedCompletionCurrency | null;
}

async function reportCapability(
  ledger: AflTradeGateDecisionLedgerRepository,
  stored: AflTradeStoredGateLedger,
  capabilityId: LocalExternalCaptureCapability,
  season: number,
  at: string
): Promise<CapabilityAuthorityReport> {
  const decisionKey = localExternalCaptureDecisionKey(capabilityId, season);
  const onKey = stored.ledger.decisions
    .filter((decision) => decision.content.decisionKey === decisionKey)
    .sort((left, right) => right.content.version - left.content.version);
  let accepted: Awaited<ReturnType<typeof loadRecordedLocalCaptureAuthority>> | null = null;
  let refusal: string | null = null;
  try {
    accepted = await loadRecordedLocalCaptureAuthority(ledger, capabilityId, season, at);
  } catch (error) {
    if (!(error instanceof LocalExternalCaptureError)) throw error;
    refusal = error.message;
  }
  const decision =
    onKey.find(({ decisionId }) => decisionId === accepted?.decisionId) ?? onKey[0] ?? null;
  let termsExpireAt = accepted?.authority.sourceRights.content.termsExpireAt ?? null;
  const rightsId = decision?.content.affectedArtifacts.find(
    ({ kind }) => kind === 'source_rights'
  )?.artifactId;
  if (accepted === null && rightsId !== undefined) {
    termsExpireAt = await ledger
      .resolveAuthorization(rightsId)
      .then(({ sourceRights }) => sourceRights.content.termsExpireAt)
      .catch(() => null);
  }
  return {
    capabilityId,
    season,
    decisionKey,
    accepted: accepted !== null,
    refusal,
    decisionId: decision?.decisionId ?? null,
    version: decision?.content.version ?? null,
    revalidateAt: decision?.content.revalidateAt ?? null,
    termsExpireAt,
    successorPresent: onKey.length > 1,
  };
}

export async function reportIntakeAuthority(
  sql: AflOutcomeSqlClient,
  input: Omit<IntakeAuthorityArguments, 'databaseUrl'>
): Promise<IntakeAuthorityReport> {
  const at = input.at ?? new Date().toISOString();
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(sql);
  const stored = await ledger.load();
  const capabilities: CapabilityAuthorityReport[] = [];
  for (const { capabilityId, season } of input.capabilities) {
    capabilities.push(await reportCapability(ledger, stored, capabilityId, season, at));
  }
  const grants = (await new PostgresAflTradeOperationalGrantRepository(sql).listCurrent()).map(
    (grant) => ({
      ...grant,
      currentAt:
        Date.parse(grant.validFrom) <= Date.parse(at) &&
        (grant.validThrough === null || Date.parse(grant.validThrough) > Date.parse(at)),
    })
  );
  const completion =
    input.completionId === null
      ? null
      : await readAflTradeRetainedCompletionCurrency(sql, input.completionId, at);
  return {
    at,
    current: capabilities.every(({ accepted }) => accepted) && (completion?.current ?? true),
    capabilities,
    grants,
    completion,
  };
}

export async function runIntakeAuthorityReportCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<IntakeAuthorityReport> {
  const { databaseUrl, ...parsed } = parseIntakeAuthorityArguments(input.argv, input.env);
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const report = await reportIntakeAuthority(createPgAflOutcomeSqlClient(pool), parsed);
    write(JSON.stringify(report));
    return report;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runIntakeAuthorityReportCommand({ argv: process.argv.slice(2), env: process.env })
    .then((report) => {
      if (!report.current) process.exitCode = 2;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Intake authority report stopped. ${message}\n`);
      process.exitCode = 1;
    });
}
