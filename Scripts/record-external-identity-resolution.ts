import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  recordAflTradeExternalIdentityReviewDecision,
  type AflTradeExternalIdentityReviewDependencies,
} from '../src/server/aflTradeIntelligence/source/externalIdentityReviewService';
import { PostgresAflTradeExternalHistoricalReconciliationSource } from '../src/server/aflTradeIntelligence/source/postgresExternalHistoricalReconciliationSource';
import {
  PostgresAflTradeExternalIdentityReviewRepository,
  type PersistedAflTradeExternalIdentityReview,
} from '../src/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';

interface CommandConnection {
  recordDecision(input: {
    completionId: string;
    subjectId: string;
    decision: 'approved' | 'rejected' | 'withdrawn';
    canonicalId?: string;
    rationale: string;
    authorityEvidenceId: string;
    decidedBy: string;
    decidedAt: string;
  }): Promise<PersistedAflTradeExternalIdentityReview>;
  close(): Promise<void>;
}

interface CommandDependencies {
  connect(databaseUrl: string): Promise<CommandConnection>;
  now(): Date;
  writeOutput(line: string): void;
}

const commandSchema = z
  .object({
    completion: z.string().regex(/^external-historical-capture-completion:[a-f0-9]{64}$/),
    subject: z.string().regex(/^external-identity-subject:[a-f0-9]{64}$/),
    decision: z.enum(['approved', 'rejected', 'withdrawn']),
    canonicalId: z.string().trim().min(1).max(240).optional(),
    reviewer: z.string().trim().min(1).max(240),
    authorityEvidence: z.string().regex(/^reviewer-authority-evidence:[a-f0-9]{64}$/),
    rationale: z.string().trim().min(1).max(4_000),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.decision === 'approved' && input.canonicalId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalId'],
        message: '--canonical-id is required for an approved decision.',
      });
    }
    if (input.decision !== 'approved' && input.canonicalId !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalId'],
        message: '--canonical-id is permitted only for an approved decision.',
      });
    }
  });

const flagToField = {
  '--completion': 'completion',
  '--subject': 'subject',
  '--decision': 'decision',
  '--canonical-id': 'canonicalId',
  '--reviewer': 'reviewer',
  '--authority-evidence': 'authorityEvidence',
  '--rationale': 'rationale',
} as const;

function parseCommand(argv: readonly string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index] as keyof typeof flagToField | undefined;
    const value = argv[index + 1];
    const field = flag === undefined ? undefined : flagToField[flag];
    if (field === undefined || value === undefined || value.trim() === '' || field in values) {
      throw new TypeError(
        'Invalid identity review arguments; provide each documented flag exactly once.'
      );
    }
    values[field] = value;
  }
  const parsed = commandSchema.safeParse(values);
  if (!parsed.success) {
    const canonicalIssue = parsed.error.issues.find(({ path }) => path[0] === 'canonicalId');
    throw new TypeError(
      canonicalIssue?.message ??
        'The identity review command is missing or contains an invalid required argument.'
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
  const client = createPgAflOutcomeSqlClient(pool);
  const dependencies: AflTradeExternalIdentityReviewDependencies = {
    source: new PostgresAflTradeExternalHistoricalReconciliationSource(client),
    reviewRepository: new PostgresAflTradeExternalIdentityReviewRepository(client),
  };
  return {
    recordDecision: (input) => recordAflTradeExternalIdentityReviewDecision(input, dependencies),
    close: () => pool.end(),
  };
}

const defaultDependencies: CommandDependencies = {
  connect: connectPostgres,
  now: () => new Date(),
  writeOutput: (line) => process.stdout.write(`${line}\n`),
};

export async function runAflTradeRecordExternalIdentityResolutionCommand(
  input: {
    argv: readonly string[];
    env: Readonly<Record<string, string | undefined>>;
  },
  dependencies: CommandDependencies = defaultDependencies
): Promise<PersistedAflTradeExternalIdentityReview> {
  const command = parseCommand(input.argv);
  const connection = await dependencies.connect(databaseUrl(input.env));
  try {
    const result = await connection.recordDecision({
      completionId: command.completion,
      subjectId: command.subject,
      decision: command.decision,
      ...(command.canonicalId === undefined ? {} : { canonicalId: command.canonicalId }),
      rationale: command.rationale,
      authorityEvidenceId: command.authorityEvidence,
      decidedBy: command.reviewer,
      decidedAt: dependencies.now().toISOString(),
    });
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await connection.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runAflTradeRecordExternalIdentityResolutionCommand({
    argv: process.argv.slice(2),
    env: process.env,
  }).catch(() => {
    process.stderr.write(
      'External AFL identity review decision failed; no reconciliation, promotion, release, or publication was assumed.\n'
    );
    process.exitCode = 1;
  });
}
