import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'prisma',
    'afl-trade-outcomes',
    'migrations',
    '0041_valuation_publication_post_lock_time',
    'migration.sql'
  ),
  'utf8'
);

describe('valuation publication post-lock Gate time', () => {
  it('refreshes trusted database time after serializing and re-reading Gate authority', () => {
    const gateLock = migration.indexOf("'afl-trade-gate:' || gate_row");
    const gateRead = migration.indexOf('SELECT * INTO STRICT gate_row', gateLock);
    const refreshedTime = migration.indexOf(
      "trusted_now:=date_trunc('milliseconds',clock_timestamp())",
      gateRead
    );
    const expiryCheck = migration.indexOf('gate_row."revalidate_at" <= trusted_now', refreshedTime);

    expect(gateLock).toBeGreaterThan(-1);
    expect(gateRead).toBeGreaterThan(gateLock);
    expect(refreshedTime).toBeGreaterThan(gateRead);
    expect(expiryCheck).toBeGreaterThan(refreshedTime);
  });
});
