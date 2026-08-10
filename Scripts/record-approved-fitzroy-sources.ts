import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { createPostgresAflTradeGateDecisionLedgerRepository } from '../src/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import {
  recordApprovedAflTradeFitzRoySources,
  type RecordApprovedAflTradeFitzRoySourcesInput,
} from '../src/server/aflTradeIntelligence/governance/recordApprovedFitzRoySources';
import type { AflTradeGateDecisionLedgerRepository } from '../src/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';

interface CommandConnection {
  repository: AflTradeGateDecisionLedgerRepository;
  close(): Promise<void>;
}

interface CommandDependencies {
  readFile(path: string): Promise<string>;
  connect(databaseUrl: string): Promise<CommandConnection>;
  writeOutput(line: string): void;
}

interface CommandInput {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
}

export interface RecordApprovedFitzRoySourcesCommandResult {
  revision: number;
  records: readonly {
    provider: string;
    capabilityId: string;
    rightsArtifactId: string;
    proposalId: string;
    decisionId: string;
    idempotentReplay: boolean;
  }[];
}

function parseInputPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--input' || argv[1]?.trim() === '') {
    throw new TypeError('The command requires exactly one --input <reviewed-json-path>.');
  }
  return argv[1];
}

function requireDatabaseUrl(env: CommandInput['env']): string {
  const databaseUrl = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required for the isolated outcomes store.');
  }
  return databaseUrl;
}

function parseReviewedInput(json: string): RecordApprovedAflTradeFitzRoySourcesInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new TypeError('The reviewed source-approval input is not valid JSON.', { cause });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('The reviewed source-approval input must be a JSON object.');
  }
  return parsed as RecordApprovedAflTradeFitzRoySourcesInput;
}

async function connectPostgres(databaseUrl: string): Promise<CommandConnection> {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    repository: createPostgresAflTradeGateDecisionLedgerRepository(
      createPgAflOutcomeSqlClient(pool)
    ),
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  readFile: (path) => readFile(path, 'utf8'),
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runRecordApprovedFitzRoySourcesCommand(
  input: CommandInput,
  dependencies: CommandDependencies = defaultDependencies
): Promise<RecordApprovedFitzRoySourcesCommandResult> {
  const inputPath = parseInputPath(input.argv);
  const databaseUrl = requireDatabaseUrl(input.env);
  const reviewedInput = parseReviewedInput(await dependencies.readFile(inputPath));
  const connection = await dependencies.connect(databaseUrl);

  try {
    const stored = await recordApprovedAflTradeFitzRoySources(connection.repository, reviewedInput);
    const result = {
      revision: stored.revision,
      records: stored.records.map(({ sourceRights, proposal, decision, idempotentReplay }) => ({
        provider: sourceRights.content.provider,
        capabilityId:
          sourceRights.content.acquisition.kind === 'fitzroy'
            ? (sourceRights.content.acquisition.capabilities[0]?.capabilityId ?? 'unavailable')
            : 'unavailable',
        rightsArtifactId: sourceRights.rightsArtifactId,
        proposalId: proposal.proposalId,
        decisionId: decision.decisionId,
        idempotentReplay,
      })),
    } satisfies RecordApprovedFitzRoySourcesCommandResult;
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runRecordApprovedFitzRoySourcesCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    () => {
      process.stderr.write(
        'Recording the reviewed AFL trade source approvals failed; no approval was assumed.\n'
      );
      process.exitCode = 1;
    }
  );
}
