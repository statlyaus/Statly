import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  prepareAflTradeHistoricalReconciliation,
  type PreparedAflTradeHistoricalReconciliation,
} from '../src/server/aflTradeIntelligence/source/externalHistoricalReconciliationPreparation';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '../src/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import { PostgresAflTradeExternalIdentityReviewRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';
import { PostgresAflTradeExternalReconciliationRepository } from '../src/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { PostgresAflTradePromotedDraftSelectionReader } from '../src/server/aflTradeIntelligence/source/postgresPromotedDraftSelectionReader';
import { PostgresAflTradeReconciliationScopeDecisionRepository } from '../src/server/aflTradeIntelligence/source/postgresReconciliationScopeDecisionRepository';

export interface PrepareCommandArguments {
  completionId: string;
  /** `--defer-pick-lineage <review-decision:…>`: the owner's approved reconciliation-scope decision (#869). */
  pickLineageDeferral?: { decisionId: string };
  /**
   * `--bid-ladder <absolute path>`: the owner's `afl-trade-bid-ladder/v1` file (owner, 2026-11-24), the
   * season's final ranking including finals by Draftguru club id, recorded on each order matched bid.
   */
  bidLadderPath?: string;
}

/** What the command prepares with: the arguments, with the ladder file read and parsed as JSON. */
export interface PrepareCommandInput {
  completionId: string;
  pickLineageDeferral?: { decisionId: string };
  bidLadder?: unknown;
}

interface CommandConnection {
  prepare(input: PrepareCommandInput): Promise<PreparedAflTradeHistoricalReconciliation>;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string): Promise<CommandConnection>;
  writeOutput(line: string): void;
  /** Reads the `--bid-ladder` file; the file system by default. */
  readTextFile?: (path: string) => Promise<string>;
}

const usage =
  'Invalid arguments: use --completion <id> [--defer-pick-lineage <review-decision:sha256>] [--bid-ladder <absolute-path.json>].';

export function parseAflTradePrepareExternalReconciliationArguments(
  argv: readonly string[]
): PrepareCommandArguments {
  if (
    argv.length % 2 !== 0 ||
    argv[0] !== '--completion' ||
    argv[1] === undefined ||
    argv[1].trim() === ''
  ) {
    throw new TypeError(usage);
  }
  const parsed: PrepareCommandArguments = { completionId: argv[1] };
  for (let index = 2; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1]!;
    if (
      flag === '--defer-pick-lineage' &&
      parsed.pickLineageDeferral === undefined &&
      /^review-decision:[a-f0-9]{64}$/.test(value)
    )
      parsed.pickLineageDeferral = { decisionId: value };
    else if (flag === '--bid-ladder' && parsed.bidLadderPath === undefined && isAbsolute(value))
      parsed.bidLadderPath = value;
    else throw new TypeError(usage);
  }
  return parsed;
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  return value;
}

async function connectPostgres(url: string): Promise<CommandConnection> {
  const pool = new Pool({ connectionString: url });
  const client = createPgAflOutcomeSqlClient(pool);
  const source = new PostgresAflTradeExternalHistoricalReconciliationSource(client);
  const identityReviewRepository = new PostgresAflTradeExternalIdentityReviewRepository(client);
  const candidateRepository = new PostgresAflTradeExternalReconciliationRepository(client);
  const scopeDecisionRepository = new PostgresAflTradeReconciliationScopeDecisionRepository(client);
  const promotedSelectionRepository = new PostgresAflTradePromotedDraftSelectionReader(client);
  return {
    prepare: (input) =>
      prepareAflTradeHistoricalReconciliation(input, {
        source,
        identityReviewRepository,
        candidateRepository,
        scopeDecisionRepository,
        promotedSelectionRepository,
      }),
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradePrepareExternalHistoricalReconciliationCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: CommandDependencies = defaultDependencies
): Promise<PreparedAflTradeHistoricalReconciliation> {
  const { bidLadderPath, ...args } = parseAflTradePrepareExternalReconciliationArguments(
    input.argv
  );
  const readTextFile = dependencies.readTextFile ?? ((path: string) => readFile(path, 'utf8'));
  const bidLadder =
    bidLadderPath === undefined
      ? undefined
      : (JSON.parse(await readTextFile(bidLadderPath)) as unknown);
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const result = await connection.prepare(
      bidLadder === undefined ? args : { ...args, bidLadder }
    );
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradePrepareExternalHistoricalReconciliationCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'Historical AFL draft/trade reconciliation preparation failed; no promotion, release, or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
