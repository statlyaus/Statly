import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

function modelBlock(schema: string, name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  return match?.[0] ?? '';
}

// players-data-11: /players reads season totals from Prisma, keyed on the canonical Player id.
describe('PlayerSeasonStat schema', () => {
  const schema = read('prisma/schema.prisma');
  const model = modelBlock(schema, 'PlayerSeasonStat');

  it('keeps one row per canonical player and season', () => {
    expect(model).toMatch(/playerId\s+String/);
    expect(model).toMatch(/season\s+Int/);
    expect(model).toMatch(/games\s+Int/);
    expect(model).toMatch(/totalsJson\s+Json/);
    expect(model).toMatch(/gamesByStatJson\s+Json/);
    expect(model).toContain('@relation(fields: [playerId], references: [id], onDelete: Cascade)');
    expect(model).toContain('@@unique([playerId, season])');
    expect(model).toContain('@@index([season])');
    expect(modelBlock(schema, 'Player')).toMatch(/seasonStats\s+PlayerSeasonStat\[\]/);
  });

  it('is created by an additive migration', () => {
    const dir = readdirSync(join(process.cwd(), 'prisma/migrations')).find((name) =>
      name.endsWith('_player_season_stat')
    );
    expect(dir).toBeDefined();
    const sql = read(`prisma/migrations/${dir}/migration.sql`);
    expect(sql).toContain('CREATE TABLE "PlayerSeasonStat"');
    expect(sql).toContain('"PlayerSeasonStat_playerId_season_key"');
    expect(sql).toContain('ON DELETE CASCADE');
    const statements = sql.replace(/^--.*$/gm, '');
    expect(statements).not.toMatch(/\b(DROP|ALTER TABLE "Player" )/);
  });
});
