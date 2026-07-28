import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function model(schema: string, name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing Prisma model: ${name}`);
  return match[1];
}

describe('production database index architecture', () => {
  it('indexes demonstrated player and matchup-score hot paths', () => {
    const schema = read('prisma/schema.prisma');

    expect(model(schema, 'Player')).toContain('@@index([active, position, name])');
    expect(model(schema, 'LeagueMatchupScore')).toContain('@@index([leagueId, status])');
  });

  it('keeps polling branches independently indexed', () => {
    const schema = read('prisma/schema.prisma');

    expect(model(schema, 'DraftEvent')).toContain('@@index([publishedAt, lockedAt, createdAt])');
    expect(model(schema, 'SocialOutboxEvent')).toContain(
      '@@index([status, availableAt, createdAt])'
    );
    expect(model(schema, 'SocialOutboxEvent')).toContain('@@index([lockedAt, createdAt])');
  });

  it('ships the hot-path indexes through an additive migration', () => {
    const migration = read('prisma/migrations/20260728033000_add_hot_path_indexes/migration.sql');

    expect(migration).toContain('"Player_active_position_name_idx"');
    expect(migration).toContain('"LeagueMatchupScore_leagueId_status_idx"');
    expect(migration).not.toMatch(/DROP (TABLE|COLUMN|INDEX)/);
  });
});
