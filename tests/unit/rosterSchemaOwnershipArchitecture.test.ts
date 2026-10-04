import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const runtimePaths = [
  'src/app/api/leagues/[id]/roster/[userId]/route.ts',
  'src/app/api/leagues/[id]/actions/[userId]/route.ts',
  'src/services/rosterService.ts',
  'src/app/api/test-lobby/route.ts',
  'src/server/diagnostics/lobbySchemaDiagnostic.ts',
] as const;

function readWorkspaceFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('roster schema ownership architecture', () => {
  it('keeps roster tables and league-scoped ownership in Prisma migrations', () => {
    const baseline = readWorkspaceFile(
      'prisma/migrations/20261004000000_postgresql_baseline/migration.sql'
    );

    expect(baseline).toContain('CREATE TABLE "LeagueRoster" (');
    expect(baseline).toContain('CREATE TABLE "TeamAction" (');
    expect(baseline).toContain('CREATE TABLE "LeagueRosterPlayer" (');
    expect(baseline).toContain('"LeagueRosterPlayer_leagueId_playerId_key"');
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
    const route = readWorkspaceFile('src/app/api/test-lobby/route.ts');
    const diagnostic = readWorkspaceFile('src/server/diagnostics/lobbySchemaDiagnostic.ts');

    expect(route).toContain('loadLobbySchemaDiagnostic()');
    expect(route).not.toContain("from '@/lib/prisma'");
    expect(diagnostic).toContain('Promise.allSettled');
    expect(diagnostic).toContain('prisma.leagueRoster.count()');
    expect(diagnostic).toContain('prisma.teamAction.count()');
    expect(diagnostic).toContain('prisma.leagueRosterPlayer.count()');
    expect(diagnostic).not.toContain('$executeRaw');
  });
});
