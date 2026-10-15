import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

/**
 * A session-proved draft promotion whose selections reuse picks an earlier trade promotion already
 * stored with facts (#853). A completed draft session states no round, number or original club, so
 * a pick only its selections define asserts no facts and references the stored pick unchanged: no
 * enrichment, no conflict, exact replay. A stored pick of a different draft is still a conflict.
 */
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

/** The fixture's 2024 national draft: selection 1 in session 1, selection 2 in session 2. */
const numberOnly = (selectionNumber: number) =>
  createAflTradeContentAddress('draft-pick', {
    draftYear: 2024,
    draftType: 'national',
    nominalPick: selectionNumber,
    nominalRound: null,
  });
const SELECTION_PICK_IDS = [numberOnly(1), numberOnly(2)];

describe.each(['reference', 'scope-conflict'] as const)('selection-only pick: %s', (mode) => {
  const schemaName = `afl_selection_pick_reference_${mode.replace('-', '_')}_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 2 });
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName}`,
    max: 4,
  });

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    const scoped = new URL(databaseUrl);
    scoped.searchParams.set('schema', schemaName);
    runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  }, 300_000);

  afterAll(async () => {
    await pool.end();
    try {
      await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    } finally {
      await admin.end();
    }
  });

  // The picks as an earlier trade promotion stored them: round and number known, under the slot's
  // number-only id. The scope-conflict case stores the second as another draft's pick.
  async function seedTradePromotedPicks(): Promise<void> {
    for (const [index, pickId] of SELECTION_PICK_IDS.entries()) {
      const draftKind =
        mode === 'scope-conflict' && index === 1 ? 'rookie_draft' : 'national_draft';
      await pool.query(
        `INSERT INTO outcome_draft_pick (pick_id,draft_season_year,draft_kind,nominal_round,nominal_pick,
          original_club_id,status)
         VALUES ($1,2024,$2::"OutcomeEventKind",1,$3,NULL,'approved')`,
        [pickId, draftKind, index + 1]
      );
    }
  }
  const storedPicks = async () =>
    (
      await pool.query(
        `SELECT pick_id,draft_season_year,draft_kind::text AS draft_kind,nominal_round,nominal_pick,
                original_club_id,status::text AS status
           FROM outcome_draft_pick WHERE pick_id = ANY($1::text[]) ORDER BY nominal_pick`,
        [SELECTION_PICK_IDS]
      )
    ).rows;
  const count = async (table: string) =>
    (await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count;

  it(
    mode === 'reference'
      ? 'references the stored picks unchanged, with no enrichment and exact replay'
      : 'keeps a stored pick of another draft an immutable conflict',
    async () => {
      await seedTradePromotedPicks();
      const before = await storedPicks();
      const promote = () =>
        createSyntheticAcquisitionPlayerPromotion(pool, {
          draftSessions: true,
          draftSelectionPicksNumberOnly: true,
        });

      if (mode === 'scope-conflict') {
        await expect(promote()).rejects.toMatchObject({
          code: 'IMMUTABLE_CONFLICT',
          message: expect.stringContaining(SELECTION_PICK_IDS[1]!),
        });
        expect(await count('outcome_external_canonical_promotion')).toBe(0);
        expect(await count('outcome_draft_selection')).toBe(0);
        expect(await storedPicks()).toEqual(before);
        return;
      }

      // The fixture promotes, then replays and requires an identical receipt.
      const promoted = await promote();
      expect(promoted.promotion).toMatchObject({ idempotentReplay: false, draftSelectionCount: 2 });
      expect(await storedPicks()).toEqual(before);
      expect(await count('outcome_draft_pick_enrichment')).toBe(0);
      const selections = await pool.query<{ pick_id: string }>(
        `SELECT selection.pick_id
           FROM outcome_external_canonical_promotion_record member
           JOIN outcome_draft_selection selection
             ON selection.selection_id = member.canonical_record_id
          WHERE member.promotion_id = $1 AND member.record_kind = 'draft_selection'
          ORDER BY selection.selection_number`,
        [promoted.promotion.promotionId]
      );
      expect(selections.rows.map(({ pick_id }) => pick_id)).toEqual(SELECTION_PICK_IDS);
    },
    120_000
  );
});
