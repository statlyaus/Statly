import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const runtimePaths = [
  'src/app/api/leagues/[id]/roster/[userId]/route.ts',
  'src/app/api/leagues/[id]/actions/[userId]/route.ts',
  'src/services/rosterService.ts',
  'src/app/api/test-lobby/route.ts',
  'src/lib/ensureLobbyColumns.ts',
] as const;

function readWorkspaceFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('roster schema ownership architecture', () => {
  it('keeps roster tables and league-scoped ownership in Prisma migrations', () => {
    const baseMigration = readWorkspaceFile(
      'prisma/migrations/20250823150655_add_draft_league_status_index/migration.sql'
    );
    const normalizedRosterMigration = readWorkspaceFile(
      'prisma/migrations/20260606073500_add_league_roster_player/migration.sql'
    );

    expect(baseMigration).toContain('CREATE TABLE "LeagueRoster"');
    expect(baseMigration).toContain('CREATE TABLE "TeamAction"');
    expect(normalizedRosterMigration).toContain('CREATE TABLE IF NOT EXISTS "LeagueRosterPlayer"');
    expect(normalizedRosterMigration).toContain(
      '"LeagueRosterPlayer_leagueId_playerId_key"'
    );
  });

  it('does not manage the roster schema from request or service runtime code', () => {
    for (const path of runtimePaths) {
      const source = readWorkspaceFile(path);

      expect(source, path).not.toContain('ensureRosterTables');
      expect(source, path).not.toContain('information_schema');
      expect(source, path).not.toContain('pg_constraint');
      expect(source, path).not.toMatch(/CREATE TABLE[^;]+(?:LeagueRoster|TeamAction)/s);
    }
  });

  it('keeps the lobby diagnostic read-only', () => {
    const diagnostic = readWorkspaceFile('src/app/api/test-lobby/route.ts');

    expect(diagnostic).toContain('prisma.leagueRoster.count()');
    expect(diagnostic).toContain('prisma.teamAction.count()');
    expect(diagnostic).toContain('prisma.leagueRosterPlayer.count()');
    expect(diagnostic).not.toContain('$executeRaw');
  });
});
