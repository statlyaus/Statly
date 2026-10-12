import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  AFL_TRADE_RECONCILIATION_SCOPE_DECISION_SCHEMA_VERSION,
  PostgresAflTradeReconciliationScopeDecisionRepository,
  type AflTradeReconciliationScopeDecisionContent,
  type RecordedAflTradeReconciliationScopeDecision,
} from '../src/server/aflTradeIntelligence/source/postgresReconciliationScopeDecisionRepository';

interface ScopeDecisionRepository {
  recordApproval(content: unknown): Promise<RecordedAflTradeReconciliationScopeDecision>;
}

interface CommandConnection {
  repository: ScopeDecisionRepository;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string): Promise<CommandConnection>;
  writeOutput(line: string): void;
}

/**
 * Records the owner's approved `reconciliation_scope` decision that lets `prepare-external-reconciliation
 * --defer-pick-lineage` defer the pick side of one completion (statlyaus/Statly#869). The approval
 * record itself is stored first (`outcomes:artifacts:store-evidence`) and cited here by artifact id.
 */
const commandSchema = z
  .tuple([
    z.literal('--completion'),
    z.string().regex(/^external-historical-capture-completion:[a-f0-9]{64}$/),
    z.literal('--scope'),
    z.literal('pick_lineage_deferral'),
    z.literal('--approval-artifact'),
    z.string().regex(/^artifact:[a-f0-9]{64}$/),
    z.literal('--reviewer'),
    z.string().trim().min(1).max(240),
    z.literal('--rationale'),
    z.string().trim().min(1).max(4_000),
    z.literal('--decided-at'),
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  ])
  .transform(
    ([, completionId, , scope, , approvalArtifactId, , decidedBy, , rationale, , decidedAt]) =>
      ({
        schemaVersion: AFL_TRADE_RECONCILIATION_SCOPE_DECISION_SCHEMA_VERSION,
        completionId,
        scope,
        approvalArtifactId,
        rationale,
        decidedBy,
        decidedAt,
      }) satisfies AflTradeReconciliationScopeDecisionContent
  );

export function parseAflTradeReconciliationScopeDecisionArguments(
  argv: readonly string[]
): AflTradeReconciliationScopeDecisionContent {
  const parsed = commandSchema.safeParse(argv);
  if (!parsed.success) {
    throw new TypeError(
      'The command requires --completion <id> --scope pick_lineage_deferral --approval-artifact <artifact:sha256> --reviewer <principal-ref> --rationale <text> --decided-at <UTC-millisecond-instant>.'
    );
  }
  return parsed.data;
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  return value;
}

async function connectPostgres(url: string): Promise<CommandConnection> {
  const pool = new Pool({ connectionString: url });
  return {
    repository: new PostgresAflTradeReconciliationScopeDecisionRepository(
      createPgAflOutcomeSqlClient(pool)
    ),
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradeRecordReconciliationScopeDecisionCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: CommandDependencies = defaultDependencies
): Promise<RecordedAflTradeReconciliationScopeDecision> {
  const content = parseAflTradeReconciliationScopeDecisionArguments(input.argv);
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const result = await connection.repository.recordApproval(content);
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeRecordReconciliationScopeDecisionCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'Recording the reconciliation scope decision failed; no candidate was prepared, promoted or published.\n'
    );
    process.exitCode = 1;
  });
}
