import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260720100000_add_giphy_to_social_messages',
    'migration.sql'
  ),
  'utf8'
);

describe('league social GIPHY migration', () => {
  it('stores only the durable GIPHY identity on chat messages', () => {
    expect(migrationSql).toContain('ALTER TABLE "SocialMessage" ADD COLUMN "giphyId" TEXT;');
    expect(migrationSql).not.toMatch(/url|media|asset/i);
  });
});
