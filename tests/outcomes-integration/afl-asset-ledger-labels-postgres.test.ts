import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { loadAflTradeAssetLedgerLabels } from '@/server/aflTradeIntelligence/development/postgresAssetLedgerLabels';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `asset_ledger_labels_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 2,
});
const client = createPgAflOutcomeSqlClient(pool);

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
}, 300_000);

afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

// Runs the asset ledger's label read against the real migrated schema, so a renamed column or status
// fails here rather than on the grading VM.
it('loads every approved player name and every club name, in id order', async () => {
  await pool.query(
    `INSERT INTO outcome_club(club_id,current_name,status)
     VALUES ('western_bulldogs','Western Bulldogs','approved'), ('carlton','Carlton','approved')`
  );
  await pool.query(
    `INSERT INTO outcome_player(player_id,display_name,status)
     VALUES ('player-2','Sam Darcy','approved'), ('player-1','Player One','approved'),
            ('player-3','Rejected Row','rejected')`
  );

  await expect(loadAflTradeAssetLedgerLabels(client)).resolves.toEqual({
    players: [
      { playerId: 'player-1', name: 'Player One' },
      { playerId: 'player-2', name: 'Sam Darcy' },
    ],
    clubs: [
      { clubId: 'carlton', name: 'Carlton' },
      { clubId: 'western_bulldogs', name: 'Western Bulldogs' },
    ],
  });
});
