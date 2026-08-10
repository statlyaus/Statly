import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { createPostgresAflTradeGateDecisionLedgerRepository } from '../src/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import type { AflTradeGateDecisionLedgerRepository } from '../src/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import {
  recordApprovedAflTradeExternalSources,
  type RecordApprovedAflTradeExternalSourcesInput,
} from '../src/server/aflTradeIntelligence/governance/recordApprovedExternalDraftTradeSources';
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

export interface RecordApprovedExternalSourcesCommandResult {
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

function inputPath(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--input' || argv[1]?.trim() === '') {
    throw new TypeError('The command requires exactly one --input <reviewed-json-path>.');
  }
  return argv[1];
}

function databaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!value) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  return value;
}

function reviewedInput(json: string): RecordApprovedAflTradeExternalSourcesInput {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (cause) {
    throw new TypeError('The reviewed external-source approval input is not valid JSON.', {
      cause,
    });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('The reviewed external-source approval input must be a JSON object.');
  }
  return value as RecordApprovedAflTradeExternalSourcesInput;
}

async function connectPostgres(url: string): Promise<CommandConnection> {
  const pool = new Pool({ connectionString: url });
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

export async function runRecordApprovedExternalSourcesCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: CommandDependencies = defaultDependencies
): Promise<RecordApprovedExternalSourcesCommandResult> {
  const parsed = reviewedInput(await dependencies.readFile(inputPath(input.argv)));
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const stored = await recordApprovedAflTradeExternalSources(connection.repository, parsed);
    const result = {
      revision: stored.revision,
      records: stored.records.map(({ sourceRights, proposal, decision, idempotentReplay }) => ({
        provider: sourceRights.content.provider,
        capabilityId:
          sourceRights.content.acquisition.kind === 'provider_web'
            ? sourceRights.content.acquisition.capabilityId
            : 'unavailable',
        rightsArtifactId: sourceRights.rightsArtifactId,
        proposalId: proposal.proposalId,
        decisionId: decision.decisionId,
        idempotentReplay,
      })),
    } satisfies RecordApprovedExternalSourcesCommandResult;
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runRecordApprovedExternalSourcesCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    () => {
      process.stderr.write(
        'Recording reviewed external AFL trade-source approvals failed; no approval was assumed.\n'
      );
      process.exitCode = 1;
    }
  );
}
