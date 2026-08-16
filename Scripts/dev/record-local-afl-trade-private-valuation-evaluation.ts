import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  PostgresAflTradePrivateValuationEvaluationAuthority,
  type RecordAflTradePrivateValuationEvaluationDecisionInput,
} from '../../src/server/aflTradeIntelligence/valuation/postgresPrivateValuationEvaluationAuthority';
import type { AflTradePrivateValuationEvaluationDecision } from '../../src/server/aflTradeIntelligence/valuation/privateValuationEvaluationDecision';

interface CommandConnection {
  resolveActiveRelease(scopeKey: string): Promise<string | null>;
  recordDecision(
    input: RecordAflTradePrivateValuationEvaluationDecisionInput
  ): Promise<AflTradePrivateValuationEvaluationDecision>;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string, runtimeNonce: string): Promise<CommandConnection>;
  loadRuntimeNonce(configuredNonce: string | undefined): Promise<string>;
  writeOutput(line: string): void;
}

interface ParsedCommand {
  valuationScopeKey: string;
  factualReleaseId: string | null;
  releaseScopeKey: string | null;
  expectedCurrentDecisionId: string | null;
  status: 'authorized' | 'withdrawn';
  reviewerId: string;
  rationale: string;
}

const root = resolve(import.meta.dirname, '../..');
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const releaseIdSchema = z.string().regex(/^outcome-release:[a-f0-9]{64}$/u);
const decisionIdSchema = z.string().regex(/^private-valuation-evaluation-decision:[a-f0-9]{64}$/u);

function parseFlags(argv: readonly string[]): Map<string, string> {
  if (argv.length === 0 || argv.length % 2 !== 0) {
    throw new TypeError('Every private valuation evaluation option requires one value.');
  }
  const allowed = new Set([
    '--scope',
    '--release',
    '--release-scope',
    '--expected-current',
    '--decision',
    '--reviewer',
    '--rationale',
  ]);
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]!;
    const value = argv[index + 1]!;
    if (!allowed.has(name) || flags.has(name) || !value.trim()) {
      throw new TypeError(`Invalid or duplicate private valuation option: ${name}.`);
    }
    flags.set(name, value.trim());
  }
  return flags;
}

function parseCommand(argv: readonly string[]): ParsedCommand {
  const flags = parseFlags(argv);
  const factualReleaseId = flags.has('--release')
    ? releaseIdSchema.parse(flags.get('--release'))
    : null;
  const releaseScopeKey = flags.has('--release-scope')
    ? publicIdSchema.parse(flags.get('--release-scope'))
    : null;
  if ((factualReleaseId === null) === (releaseScopeKey === null)) {
    throw new TypeError('Provide exactly one of --release or --release-scope.');
  }
  const expected = flags.get('--expected-current');
  return {
    valuationScopeKey: publicIdSchema.parse(flags.get('--scope')),
    factualReleaseId,
    releaseScopeKey,
    expectedCurrentDecisionId: expected === 'none' ? null : decisionIdSchema.parse(expected),
    status: z.enum(['authorized', 'withdrawn']).parse(flags.get('--decision')),
    reviewerId: publicIdSchema.parse(flags.get('--reviewer')),
    rationale: z.string().trim().min(1).max(2_000).parse(flags.get('--rationale')),
  };
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  const parsed = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !new Set(['127.0.0.1', 'localhost', '::1']).has(parsed.hostname) ||
    parsed.pathname !== '/statly_outcomes_test'
  ) {
    throw new TypeError(
      'Private valuation evaluation authority requires loopback statly_outcomes_test.'
    );
  }
  return value;
}

async function loadRuntimeNonce(configuredNonce: string | undefined): Promise<string> {
  const nonce = (
    configuredNonce ??
    (await readFile(resolve(root, '.statly-local/afl-trade-outcomes-runtime-nonce'), 'utf8'))
  ).trim();
  if (!/^[a-f0-9]{64}$/u.test(nonce)) {
    throw new TypeError('STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE is invalid.');
  }
  return nonce;
}

async function connectPostgres(url: string, runtimeNonce: string): Promise<CommandConnection> {
  const pool = new Pool({ connectionString: url, max: 1, statement_timeout: 120_000 });
  try {
    await assertLocalAflTradeOutcomesRuntimeIdentity(pool, runtimeNonce);
  } catch (error) {
    await pool.end();
    throw error;
  }
  const authority = new PostgresAflTradePrivateValuationEvaluationAuthority(
    createPgAflOutcomeSqlClient(pool)
  );
  return {
    resolveActiveRelease: async (scopeKey) =>
      (
        await pool.query<{ release_id: string }>(
          `SELECT release_id FROM outcome_active_release WHERE scope_key=$1`,
          [scopeKey]
        )
      ).rows[0]?.release_id ?? null,
    recordDecision: (input) => authority.recordDecision(input),
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  connect: connectPostgres,
  loadRuntimeNonce,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runRecordLocalAflTradePrivateValuationEvaluationCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: Partial<CommandDependencies> &
    Pick<CommandDependencies, 'connect' | 'writeOutput'> = defaultDependencies
): Promise<AflTradePrivateValuationEvaluationDecision> {
  const command = parseCommand(input.argv);
  const url = databaseUrl(input.env);
  const loadNonce = dependencies.loadRuntimeNonce ?? defaultDependencies.loadRuntimeNonce;
  const runtimeNonce = await loadNonce(input.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE);
  const connection = await dependencies.connect(url, runtimeNonce);
  try {
    const factualReleaseId =
      command.factualReleaseId ?? (await connection.resolveActiveRelease(command.releaseScopeKey!));
    if (factualReleaseId === null) {
      throw new TypeError('No active local factual release exists for the requested scope.');
    }
    const decision = await connection.recordDecision({
      status: command.status,
      valuationScopeKey: command.valuationScopeKey,
      factualReleaseId,
      expectedCurrentDecisionId: command.expectedCurrentDecisionId,
      reviewerId: command.reviewerId,
      rationale: command.rationale,
    });
    dependencies.writeOutput(
      JSON.stringify({
        mode: 'private_local_nonproduction_derived_calculation_authority',
        decisionId: decision.decisionId,
        decision: decision.content.status,
        revision: decision.content.revision,
        valuationScopeKey: decision.content.valuationScopeKey,
        factualReleaseId: decision.content.factualReleaseId,
        sourceArtifactCount: decision.content.sourceRightsEvidenceRefs.length,
        modelTrainingAuthority: 'none',
        publicDisplayAuthority: 'none',
        redistributionAuthority: 'none',
        productionAuthority: 'none',
        liveCaptureAuthority: 'none',
        publicationAuthority: 'none',
        decidedAt: decision.content.decidedAt,
      })
    );
    return decision;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runRecordLocalAflTradePrivateValuationEvaluationCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'Private valuation evaluation decision failed; no calculation, training, publication, production, or capture authority was assumed.\n'
    );
    process.exitCode = 1;
  });
}
