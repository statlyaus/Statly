import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OUTCOMES_TEMPLATE_SCHEMA_KEY,
  runOutcomesPrismaTestCommand,
} from './outcomesPrismaTestCli';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTCOMES_PRISMA = join(WORKSPACE, 'prisma', 'afl-trade-outcomes');

function withoutTemplateAdoption(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { [OUTCOMES_TEMPLATE_SCHEMA_KEY]: _template, ...rest } = environment;
  return rest;
}

/**
 * Deploys the outcomes migration history as it stood just before `migration` into `databaseUrl`
 * (already scoped to a disposable schema). A suite can then seed data under the old rules and apply
 * the migration itself to the deployed definitions, exactly as `prisma migrate deploy` will on the
 * grading database. Returns the migration's SQL and a cleanup for the temporary workspace.
 */
export async function deployOutcomesHistoryBefore(
  migration: string,
  databaseUrl: string
): Promise<{ migrationSql: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), `statly-outcomes-pre-${migration.slice(0, 4)}-`));
  const prisma = join(root, 'prisma', 'afl-trade-outcomes');
  await mkdir(join(prisma, 'migrations'), { recursive: true });
  await copyFile(join(OUTCOMES_PRISMA, 'schema.prisma'), join(prisma, 'schema.prisma'));
  await copyFile(
    join(OUTCOMES_PRISMA, 'migrations', 'migration_lock.toml'),
    join(prisma, 'migrations', 'migration_lock.toml')
  );
  const names = (await readdir(join(OUTCOMES_PRISMA, 'migrations'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!names.includes(migration)) throw new Error(`Expected migration ${migration} to exist.`);
  // Copied, not symlinked: Prisma skips symlinked migration directories.
  for (const name of names.filter((candidate) => candidate < migration)) {
    await cp(join(OUTCOMES_PRISMA, 'migrations', name), join(prisma, 'migrations', name), {
      recursive: true,
    });
  }
  await symlink(join(WORKSPACE, 'node_modules'), join(root, 'node_modules'), 'dir');
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl,
    // Replay the history up to the previous migration; a template-cloned file database would
    // otherwise adopt the template's schema, which already includes this migration.
    dependencies: { workspaceRoot: root, environment: withoutTemplateAdoption(process.env) },
  });
  return {
    migrationSql: await readFile(
      join(OUTCOMES_PRISMA, 'migrations', migration, 'migration.sql'),
      'utf8'
    ),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
