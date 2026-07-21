import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260719120000_separate_league_social_activity',
    'migration.sql'
  ),
  'utf8'
);

describe('league social Activity migration', () => {
  it('adds structured message context and reclassifies only system-message outbox rows', () => {
    expect(migrationSql).toContain('ALTER TABLE "SocialMessage" ADD COLUMN "contextJson" TEXT;');
    expect(migrationSql).toContain('"channel" = \'ACTIVITY\'');
    expect(migrationSql).toContain('"eventType" = \'social:activity\'');
    expect(migrationSql).toContain('WHERE "type" = \'SYSTEM\'');
  });

  it('preserves chat read progress for Activity and removes arbitrary member ownership', () => {
    expect(migrationSql).toContain('INSERT OR IGNORE INTO "SocialReadState"');
    expect(migrationSql).toContain('\'activity:\' || "id"');
    expect(migrationSql).toContain('WHERE "channel" = \'CHAT\'');
    expect(migrationSql).toContain('"actorMemberId" TEXT,');
    expect(migrationSql).toContain('ON DELETE SET NULL');
  });
});
