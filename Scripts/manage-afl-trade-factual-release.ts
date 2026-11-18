import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import {
  createPostgresAflTradeGateDecisionLedgerRepository,
  type AflTradeGateDecisionLedgerRepository,
} from '../src/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import type { AflDraftTradeOutcomeReleaseRepository } from '../src/server/aflTradeIntelligence/outcomes/outcomeReleaseRepository';
import type {
  AflDraftTradeOutcomeReleaseCommand,
  AflDraftTradeOutcomeReleaseRegistry,
} from '../src/server/aflTradeIntelligence/outcomes/outcomeReleaseState';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createPostgresAflDraftTradeOutcomeReleaseRepository } from '../src/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

/**
 * Operator command for the factual release registry: record a reviewed Gate 4/5 decision, then
 * register, validate, approve, activate, reject or withdraw a release. The input file holds one
 * command; the registry library validates every field. This command only adds the current time and
 * the stored Gate ledger, so an input file can never supply its own Gate evidence.
 */

const argvSchema = z
  .tuple([z.literal('--input'), z.string().trim().min(1).max(4_096)])
  .transform(([, inputPath]) => inputPath);
const actionSchema = z.object({
  action: z.enum([
    'record-gate',
    'register',
    'validate',
    'approve',
    'activate',
    'reject',
    'withdraw',
  ]),
});

type Input = Record<string, unknown> & z.output<typeof actionSchema>;

export type AflTradeFactualReleaseLifecycleSummary =
  | {
      action: 'record-gate';
      gateDecisionId: string;
      gateRevision: number;
      idempotentReplay: boolean;
    }
  | {
      action: Exclude<Input['action'], 'record-gate'>;
      releaseId: string;
      state: string;
      registryRevision: number;
      activeReleaseId: string | null;
    };

interface FactualReleaseLifecycle {
  execute(input: Input): Promise<AflTradeFactualReleaseLifecycleSummary>;
}

interface FactualReleaseLifecycleConnection extends FactualReleaseLifecycle {
  close(): Promise<void>;
}

interface FactualReleaseLifecycleDependencies {
  readInput(path: string): Promise<unknown>;
  connect(databaseUrl: string): Promise<FactualReleaseLifecycleConnection>;
  writeOutput(line: string): void;
}

function summarize(
  action: Exclude<Input['action'], 'record-gate'>,
  releaseId: string,
  registry: AflDraftTradeOutcomeReleaseRegistry
): AflTradeFactualReleaseLifecycleSummary {
  const record = registry.releases[releaseId];
  if (!record) throw new TypeError('The release transition omitted its exact target record.');
  return {
    action,
    releaseId,
    state: record.state,
    registryRevision: registry.revision,
    activeReleaseId: registry.activeByScope[record.scopeKey]?.releaseId ?? null,
  };
}

export function createAflTradeFactualReleaseLifecycle(dependencies: {
  releases: Pick<AflDraftTradeOutcomeReleaseRepository, 'register' | 'apply'>;
  gates: Pick<AflTradeGateDecisionLedgerRepository, 'load' | 'appendDecision'>;
  now(): string;
}): FactualReleaseLifecycle {
  const { releases, gates, now } = dependencies;
  return {
    async execute(input) {
      if (input.action === 'record-gate') {
        const result = await gates.appendDecision({
          expectedRevision: input.expectedRevision,
          proposal: input.proposal,
          decision: input.decision,
        } as Parameters<typeof gates.appendDecision>[0]);
        return {
          action: 'record-gate',
          gateDecisionId: (input.decision as { decisionId: string }).decisionId,
          gateRevision: result.revision,
          idempotentReplay: result.idempotentReplay,
        };
      }
      if (input.action === 'register') {
        const registryAfter = await releases.register({
          expectedRevision: input.expectedRevision,
          manifest: input.manifest,
          actor: input.actor,
          evidenceId: input.evidenceId,
          occurredAt: now(),
        } as Parameters<typeof releases.register>[0]);
        const releaseId = (input.manifest as { releaseId: string }).releaseId;
        return summarize('register', releaseId, registryAfter);
      }
      let command: Record<string, unknown> = { ...input, occurredAt: now() };
      if (input.action === 'validate' || input.action === 'approve') {
        command = { ...command, gateDecisionLedger: (await gates.load()).ledger };
      } else if (input.action === 'activate') {
        const { ledger } = await gates.load();
        command = {
          ...command,
          gateDecisionLedger: ledger,
          sourceRightsDecisionLedger: ledger,
          factualReviewDecisionLedger: ledger,
        };
      }
      const registryAfter = await releases.apply(command as AflDraftTradeOutcomeReleaseCommand);
      return summarize(input.action, String(input.releaseId), registryAfter);
    },
  };
}

async function connectPostgres(databaseUrl: string): Promise<FactualReleaseLifecycleConnection> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = createPgAflOutcomeSqlClient(pool);
  const lifecycle = createAflTradeFactualReleaseLifecycle({
    releases: createPostgresAflDraftTradeOutcomeReleaseRepository(client),
    gates: createPostgresAflTradeGateDecisionLedgerRepository(client),
    now: () => new Date().toISOString(),
  });
  return { execute: lifecycle.execute, close: () => pool.end() };
}

const defaultDependencies: FactualReleaseLifecycleDependencies = {
  readInput: async (path) => JSON.parse(await readFile(path, 'utf8')) as unknown,
  connect: connectPostgres,
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradeManageFactualReleaseCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: FactualReleaseLifecycleDependencies = defaultDependencies
): Promise<AflTradeFactualReleaseLifecycleSummary> {
  const inputPath = argvSchema.parse(input.argv);
  const databaseUrl = input.env.AFL_OUTCOMES_DATABASE_URL?.trim();
  if (!databaseUrl) throw new TypeError('AFL_OUTCOMES_DATABASE_URL is required.');
  const raw = await dependencies.readInput(inputPath);
  actionSchema.parse(raw);
  const connection = await dependencies.connect(databaseUrl);
  try {
    const result = await connection.execute(raw as Input);
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeManageFactualReleaseCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      process.stderr.write(
        `AFL trade factual release command failed:\n${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    }
  );
}
