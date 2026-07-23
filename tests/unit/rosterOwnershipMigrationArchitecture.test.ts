import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('roster ownership migration architecture', () => {
  it('creates LeagueRosterPlayer through a Prisma migration directory', () => {
    const migrationsRoot = join(root, 'prisma/migrations');
    const migrationSqlFiles = readdirSync(migrationsRoot)
      .map((entry) => join(migrationsRoot, entry))
      .filter((entryPath) => statSync(entryPath).isDirectory())
      .map((entryPath) => join(entryPath, 'migration.sql'))
      .filter((migrationPath) => existsSync(migrationPath));

    const structuredMigration = migrationSqlFiles.find((migrationPath) => {
      const sql = readFileSync(migrationPath, 'utf8');

      return (
        sql.includes('CREATE TABLE') &&
        sql.includes('"LeagueRosterPlayer"') &&
        sql.includes('"leagueId"') &&
        sql.includes('"playerId"')
      );
    });

    expect(structuredMigration).toBeDefined();
  });

  it('uses the shared authenticated request helper for roster APIs', () => {
    const source = readFileSync(
      join(root, 'src/app/api/leagues/[id]/roster/[userId]/route.ts'),
      'utf8'
    );

    expect(source).toContain("import { getAuthenticatedUserId } from '@/lib/serverAuth'");
    expect(source).toContain('const reqUserId = await getAuthenticatedUserId(request)');
    expect(source).not.toContain('getUserIdFromRequest');
  });

  it('projects canonical ownership through the shared averages-only stat read model', () => {
    const source = readFileSync(
      join(root, 'src/app/api/leagues/[id]/roster/[userId]/route.ts'),
      'utf8'
    );

    expect(source).toContain('buildLeaguePlayerStatDatasetForTargets');
    expect(source).toContain('prisma.leagueRosterPlayer.findMany');
    expect(source).toContain('leaguePlayerStats');
    expect(source).toContain('selectedCategories');
    expect(source).not.toContain('loadDraftPlayerStatsLookup');
    expect(source).not.toContain('deriveDeterministicStats');
    expect(source).not.toContain('statsTotal');
    expect(source).not.toContain('prisma.$queryRaw');
  });
});
