import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { assertLocalAflTradeOutcomesRuntimeIdentity } from '../../src/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';
import { createPgAflOutcomeSqlClient } from '../../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  PostgresAflTradePrivateReviewedEvidenceEvaluationAuthority,
  type RecordAflTradePrivateReviewedEvidenceEvaluationDecisionInput,
} from '../../src/server/aflTradeIntelligence/valuation/postgresPrivateReviewedEvidenceEvaluationAuthority';
import type { AflTradePrivateReviewedEvidenceEvaluationDecision } from '../../src/server/aflTradeIntelligence/valuation/privateReviewedEvidenceEvaluation';

interface EvidenceBundleSummary {
  readonly candidateCount: number;
  readonly decisionCount: number;
  readonly sourceCaptureCount: number;
  readonly sourceRightsCount: number;
}

interface CommandConnection {
  recordDecision(
    input: RecordAflTradePrivateReviewedEvidenceEvaluationDecisionInput
  ): Promise<AflTradePrivateReviewedEvidenceEvaluationDecision>;
  loadBundleSummary(evidenceBundleId: string): Promise<EvidenceBundleSummary>;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string, runtimeNonce: string): Promise<CommandConnection>;
  loadRuntimeNonce(configuredNonce: string | undefined): Promise<string>;
  writeOutput(line: string): void;
}

interface ParsedCommand {
  valuationScopeKey: string;
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
const decisionIdSchema = z
  .string()
  .regex(/^private-reviewed-evidence-evaluation-decision:[a-f0-9]{64}$/u);

function parseFlags(argv: readonly string[]): Map<string, string> {
  if (argv.length === 0 || argv.length % 2 !== 0) {
    throw new TypeError('Every private reviewed-evidence option requires one value.');
  }
  const allowed = new Set([
    '--scope',
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
      throw new TypeError(`Invalid or duplicate private reviewed-evidence option: ${name}.`);
    }
    flags.set(name, value.trim());
  }
  return flags;
}

function parseCommand(argv: readonly string[]): ParsedCommand {
  const flags = parseFlags(argv);
  const expected = flags.get('--expected-current');
  return {
    valuationScopeKey: publicIdSchema.parse(flags.get('--scope')),
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
      'Private reviewed-evidence authority requires loopback statly_outcomes_test.'
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
  const authority = new PostgresAflTradePrivateReviewedEvidenceEvaluationAuthority(
    createPgAflOutcomeSqlClient(pool)
  );
  return {
    recordDecision: (input) => authority.recordDecision(input),
    loadBundleSummary: async (evidenceBundleId) => {
      const result = await pool.query<{
        candidate_count: number | string;
        decision_count: number | string;
        source_capture_count: number | string;
        source_rights_count: number | string;
      }>(
        `SELECT candidate_count,decision_count,source_capture_count,source_rights_count
           FROM outcome_private_reviewed_evidence_bundle
          WHERE evidence_bundle_id=$1`,
        [evidenceBundleId]
      );
      const row = result.rows[0];
      if (result.rows.length !== 1 || !row) {
        throw new TypeError('The exact retained reviewed-evidence bundle is unavailable.');
      }
      return {
        candidateCount: Number(row.candidate_count),
        decisionCount: Number(row.decision_count),
        sourceCaptureCount: Number(row.source_capture_count),
        sourceRightsCount: Number(row.source_rights_count),
      };
    },
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  connect: connectPostgres,
  loadRuntimeNonce,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runRecordLocalAflTradePrivateReviewedEvaluationCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: Partial<CommandDependencies> &
    Pick<CommandDependencies, 'connect' | 'writeOutput'> = defaultDependencies
): Promise<AflTradePrivateReviewedEvidenceEvaluationDecision> {
  const command = parseCommand(input.argv);
  const url = databaseUrl(input.env);
  const loadNonce = dependencies.loadRuntimeNonce ?? defaultDependencies.loadRuntimeNonce;
  const runtimeNonce = await loadNonce(input.env.STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE);
  const connection = await dependencies.connect(url, runtimeNonce);
  try {
    const decision = await connection.recordDecision({
      status: command.status,
      valuationScopeKey: command.valuationScopeKey,
      expectedCurrentDecisionId: command.expectedCurrentDecisionId,
      reviewerId: command.reviewerId,
      rationale: command.rationale,
    });
    const evidence = await connection.loadBundleSummary(decision.content.evidenceBundleId);
    dependencies.writeOutput(
      JSON.stringify({
        mode: 'private_local_retained_reviewed_evidence_calculation_authority',
        decisionId: decision.decisionId,
        decision: decision.content.status,
        revision: decision.content.revision,
        valuationScopeKey: decision.content.valuationScopeKey,
        evidenceBundleId: decision.content.evidenceBundleId,
        evidenceKind: decision.content.evidenceKind,
        ...evidence,
        derivedCalculationAuthority: 'private_nonproduction_only',
        internalEvaluationAuthority: 'private_nonproduction_only',
        modelTrainingAuthority: 'none',
        publicDisplayAuthority: 'none',
        redistributionAuthority: 'none',
        productionAuthority: 'none',
        liveCaptureAuthority: 'none',
        factualReleaseAuthority: 'none',
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
  runRecordLocalAflTradePrivateReviewedEvaluationCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'Private reviewed-evidence decision failed; no calculation, training, publication, production, or capture authority was assumed.\n'
    );
    process.exitCode = 1;
  });
}
