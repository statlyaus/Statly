import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `reviewed_status_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
}, 120000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

// Minimal JSON exercises the pure SQL transition; it does not stand in for authenticated ingestion.
function example() {
  const parent = { candidateId: 'parent', content: {
    environment: 'test_fixture', reviewedCorrection: {}, issues: [], identityResolutionIds: ['identity'],
    reviewedSessionCorrection: { projections: [{ selectedSessions: [{
      selectionIds: ['selection'], draftYear: 2012, draftType: 'mini', evidenceIds: ['session'],
      datePrecision: { kind: 'window', earliestDate: '2012-10-08', latestDate: '2012-10-26' },
    }] }] },
    transactions: [{ transactionId: 'transaction', transferIds: ['leg'], parties: ['a', 'b'], status: 'unresolved', occurredOn: null }],
    transfers: [{ transferId: 'leg', transactionId: 'transaction', fromClubId: 'a', toClubId: 'b', status: 'single_source', asset: { kind: 'player', playerId: 'player' } }],
    draftSelections: [{ selectionId: 'selection', draftYear: 2012, draftType: 'mini', selectionNumber: 1, playerId: 'player', clubId: 'b', evidenceIds: ['session'], status: 'unresolved' }],
    pickCustody: [],
  } };
  const candidate = { candidateId: 'successor', content: {
    ...structuredClone(parent.content),
    reviewedStatusCorrection: { schemaVersion: 'afl-trade-reviewed-status-correction/v1', parentCandidateId: 'parent', transactionIds: ['transaction'], selectionIds: ['selection'] },
  } };
  candidate.content.transactions[0]!.status = 'single_source';
  candidate.content.draftSelections[0]!.status = 'single_source';
  return { parent, candidate };
}
const exact = async (parent: unknown, candidate: unknown) => (await pool.query(
  'SELECT outcome_reviewed_status_transition_exact($1::jsonb,$2::jsonb) AS valid',
  [JSON.stringify(parent), JSON.stringify(candidate)]
)).rows[0].valid;

it('allows precisely evidenced status changes without inventing custody or exact dates', async () => {
  const { parent, candidate } = example();
  expect(await exact(parent, candidate)).toBe(true);
  candidate.content.transactions[0]!.status = 'corroborated';
  expect(await exact(parent, candidate)).toBe(false);
  candidate.content.transactions[0]!.status = 'single_source';
  candidate.content.reviewedSessionCorrection.projections[0]!.selectedSessions[0]!.datePrecision.latestDate = '2012-10-27';
  expect(await exact(parent, candidate)).toBe(false);
});

it('rejects unresolved dependencies even when the proposed successor preserves their values', async () => {
  for (const mode of ['disputed_leg', 'missing_party', 'missing_player', 'missing_session', 'production', 'empty_change']) {
    const { parent, candidate } = example();
    for (const content of [parent.content, candidate.content]) {
      if (mode === 'disputed_leg') content.transfers[0]!.status = 'disputed';
      if (mode === 'missing_party') content.transactions[0]!.parties = ['a'];
      if (mode === 'missing_player') content.draftSelections[0]!.playerId = '';
      if (mode === 'missing_session') content.reviewedSessionCorrection.projections = [];
      if (mode === 'production') content.environment = 'production';
    }
    if (mode === 'missing_player') {
      // JSON null is the unresolved identity representation at the persisted boundary.
      const p = JSON.parse(JSON.stringify(parent)); const c = JSON.parse(JSON.stringify(candidate));
      p.content.draftSelections[0].playerId = null; c.content.draftSelections[0].playerId = null;
      expect(await exact(p, c), mode).toBe(false); continue;
    }
    if (mode === 'empty_change') {
      parent.content.transactions[0]!.status = 'single_source';
      parent.content.draftSelections[0]!.status = 'single_source';
    }
    expect(await exact(parent, candidate), mode).toBe(false);
  }
});
