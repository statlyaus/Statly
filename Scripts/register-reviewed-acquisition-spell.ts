import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { bindLocalAflTradeArtifactStore } from '../src/server/aflTradeIntelligence/development/localArtifactStoreBinding';
import {
  aflTradeAcquisitionSpellRegistrationRuleSchema,
  aflTradeAcquisitionSpellRegistrationSchema,
} from '../src/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createPgAflOutcomeSqlClient } from '../src/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '../src/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { requireLoopbackDatabaseUrl } from './locate-local-artifact-custody';

/**
 * Registers one reviewed acquisition rule and/or spell, writing its evidence first: each evidence
 * file is stored in the registered artifact store and read back before anything is recorded. The
 * approvals must already exist. See the runbook section "Registering reviewed acquisition spells".
 *
 * Usage:
 *   npm run outcomes:spells:register-reviewed -- --input <absolute-registration.json>
 */

const MAXIMUM_EVIDENCE_BYTES = 32 * 1024 * 1024;
const absolutePath = z.string().refine(isAbsolute, 'Paths must be absolute.');

export const reviewedSpellRegistrationInputSchema = z
  .object({
    schemaVersion: z.literal('statly-reviewed-spell-registration-input/v1'),
    storeId: z.string().regex(/^[a-z][a-z0-9-]{2,62}$/u),
    repositoryId: z.string().min(1),
    artifactClass: z.enum(['raw_source', 'capture_metadata']),
    execution: z
      .object({ environment: z.literal('non_production'), competition: z.enum(['AFLM', 'AFLW']) })
      .strict(),
    evidence: z
      .array(z.object({ artifactId: z.string().min(1), path: absolutePath }).strict())
      .min(1),
    rule: z
      .object({ record: aflTradeAcquisitionSpellRegistrationRuleSchema, approvalDecisionId: z.string().min(1) })
      .strict()
      .optional(),
    spell: z
      .object({ record: aflTradeAcquisitionSpellRegistrationSchema, approvalDecisionId: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((input) => input.rule !== undefined || input.spell !== undefined, {
    message: 'Name a reviewed rule, a reviewed spell, or both.',
  })
  .refine(
    (input) => new Set(input.evidence.map((item) => item.artifactId)).size === input.evidence.length,
    { message: 'Each evidence artifact may be listed once.' }
  );

export type ReviewedSpellRegistrationInput = z.infer<typeof reviewedSpellRegistrationInputSchema>;

export function parseRegisterReviewedSpellArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): { databaseUrl: string; inputPath: string } {
  if (argv.length !== 2 || argv[0] !== '--input' || argv[1] === undefined) {
    throw new TypeError('Usage: --input <absolute-registration.json>.');
  }
  if (!isAbsolute(argv[1])) throw new TypeError('--input must be an absolute path.');
  return { databaseUrl: requireLoopbackDatabaseUrl(env.AFL_OUTCOMES_DATABASE_URL), inputPath: argv[1] };
}

export async function runRegisterReviewedSpellCommand(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  writeOutput?: (line: string) => void;
}): Promise<{ ruleId: string | null; spellVersionId: string | null }> {
  const parsed = parseRegisterReviewedSpellArguments(input.argv, input.env);
  const registration = reviewedSpellRegistrationInputSchema.parse(
    JSON.parse(await readFile(parsed.inputPath, 'utf8'))
  );
  const write = input.writeOutput ?? ((line: string) => process.stdout.write(`${line}\n`));
  const paths = new Map(registration.evidence.map((item) => [item.artifactId, item.path]));
  const pool = new Pool({ connectionString: parsed.databaseUrl, max: 2 });
  try {
    const client = createPgAflOutcomeSqlClient(pool);
    const store = await bindLocalAflTradeArtifactStore(client, {
      storeId: registration.storeId,
      repositoryId: registration.repositoryId,
      artifactClass: registration.artifactClass,
      maximumObjectBytes: MAXIMUM_EVIDENCE_BYTES,
    });
    const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
      client,
      {
        read: async (reference) => {
          const path = paths.get(reference.artifactId);
          if (path === undefined) {
            throw new Error(`Evidence ${reference.artifactId} is not listed in the input.`);
          }
          return new Uint8Array(await readFile(path));
        },
      },
      store
    );
    if (registration.rule !== undefined) {
      await repository.registerReviewedRule(
        registration.rule.record,
        registration.rule.approvalDecisionId,
        registration.execution
      );
    }
    if (registration.spell !== undefined) {
      await repository.registerReviewedSpell(
        registration.spell.record,
        registration.spell.approvalDecisionId,
        registration.execution
      );
    }
    const result = {
      ruleId: registration.rule?.record.ruleId ?? null,
      spellVersionId: registration.spell?.record.spellVersionId ?? null,
    };
    write(JSON.stringify({ storeId: registration.storeId, ...result }));
    return result;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runRegisterReviewedSpellCommand({ argv: process.argv.slice(2), env: process.env }).catch(
    (error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
      process.stderr.write(`Reviewed spell registration stopped. ${message}\n`);
      process.exitCode = 1;
    }
  );
}
