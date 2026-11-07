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

  it('enforces one canonical owner per player inside each league through Prisma schema ownership', () => {
    const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');
    const migration = readFileSync(
      join(root, 'prisma/migrations/20261004000000_postgresql_baseline/migration.sql'),
      'utf8'
    );

    const rosterPlayerModel = schema.match(/model LeagueRosterPlayer \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(rosterPlayerModel).not.toBe('');
    expect(rosterPlayerModel).toContain('@@unique([leagueId, playerId])');
    expect(migration).toContain('CREATE UNIQUE INDEX "LeagueRosterPlayer_leagueId_playerId_key"');
    expect(migration).toContain('ON "LeagueRosterPlayer"("leagueId", "playerId")');
    for (const column of ['draftId', 'pickId', 'slot', 'acquiredBy', 'acquiredAt']) {
      expect(migration).toContain(`"${column}"`);
    }
  });
});
