import { Pool } from 'pg';
import { afterAll, expect, it } from 'vitest';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeArrivalSpell,
  createAflTradeArrivalSpellRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { bindTestEvidenceStore } from '../testUtils/testEvidenceStore';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0261_trade_period_window_arrivals';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const scope = { environment: 'non_production' as const, competition: 'AFLM' as const };
// The fixture's synthetic trade season is 2024; this is a reviewed trade-period window inside it.
const tradePeriodWindow = { earliestDate: '2024-10-07', latestDate: '2024-10-16' };

type Promoted = Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>>;

/**
 * One disposable schema per promotion. The synthetic promotion fixture content-addresses its
 * artifacts, captures and canonical rows, so two promotions in one schema collide on primary keys;
 * each test builds its own schema with the history deployed just before the migration.
 */
interface Workspace {
  pool: Pool;
  client: ReturnType<typeof createPgAflOutcomeSqlClient>;
  migrationSql: string;
  dispose: () => Promise<void>;
}
const workspaces: Workspace[] = [];
let ordinal = 0;

async function workspace(): Promise<Workspace> {
  // The local fitzRoy rehearsal owners only run inside a schema with this disposable naming pattern.
  const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}_${ordinal++}`;
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const pool = new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schemaName}`,
    max: 4,
  });
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  const history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schemaName}"
       TO afl_trade_nonproduction_governance_registry_writer`
  );
  const built: Workspace = {
    pool,
    client: createPgAflOutcomeSqlClient(pool),
    migrationSql: history.migrationSql,
    dispose: async () => {
      await history.cleanup();
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    },
  };
  workspaces.push(built);
  return built;
}

afterAll(async () => {
  try {
    for (const built of workspaces) await built.dispose();
  } finally {
    await admin.end();
  }
});

const instant = async (ws: Workspace) => {
  await new Promise((resolve) => setTimeout(resolve, 3));
  return (
    await ws.pool.query<{ at: string }>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;
};

const approve = async (ws: Workspace, type: string, subject: string, content: unknown) => {
  const id = `synthetic-trade-window-review:${subject}`;
  await ws.pool.query(
    `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES($1,$2,$3,'approved','Synthetic trade-period window arrival',$4::jsonb,'synthetic-reviewer',$5)`,
    [id, type, subject, canonicalizeAflTradeJson(content), await instant(ws)]
  );
  return id;
};

const currentness = async (ws: Workspace, spellVersionId: string) =>
  (
    await ws.pool.query<{ current: boolean }>(
      'SELECT outcome_acquisition_spell_registration_current($1,clock_timestamp()) AS current',
      [spellVersionId]
    )
  ).rows[0]!.current;

const spellVersions = async (ws: Workspace) =>
  (
    await ws.pool.query<{ versions: number }>(
      'SELECT count(*)::integer AS versions FROM outcome_acquisition_spell_version'
    )
  ).rows[0]!.versions;

const repositoryFor = async (ws: Workspace, promoted: Promoted) =>
  new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    ws.client,
    {
      read: async (reference) => {
        const artifact = promoted.retainedArtifacts.get(reference.artifactId);
        if (!artifact) throw new Error('Missing exact retained fixture artifact.');
        return artifact.bytes;
      },
    },
    await bindTestEvidenceStore(ws.pool)
  );

const registerArrivalRule = async (
  ws: Workspace,
  spells: PostgresAflTradeAcquisitionSpellRegistrationRepository,
  promoted: Promoted,
  ruleVersion: string
) => {
  const rule = createAflTradeArrivalSpellRule({
    ...scope,
    ruleVersion,
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(ws),
  });
  await spells.registerReviewedRule(
    rule,
    await approve(ws, 'acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  return rule;
};

const windowEntryFor = (promoted: Promoted) => ({
  promotionId: promoted.entry.promotionId,
  eventVersionId: promoted.entry.eventVersionId,
  assetVersionId: promoted.entry.assetVersionId,
  eventDate: null,
  datePrecision: { precision: 'window' as const, eventDate: null, ...tradePeriodWindow },
  evidence: promoted.entry.evidence,
});

// A trade the source does not date carries the season's reviewed trade-period window as explicit
// precision (statlyaus/Statly#869). A traded player's arrival then cites that window exactly and
// starts at its earliest day; a year-only trade and an exact-day trade keep their meaning.
it('refuses a windowed arrival against a year-only trade before and after the migration', async () => {
  const ws = await workspace();
  // A year-only trade promoted under the deployed rules: no day, no window.
  const yearOnly = await createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
    draftSessions: true,
    sessionProposalV5: true,
    partialTransactionDates: true,
  });
  const spells = await repositoryFor(ws, yearOnly);
  const rule = await registerArrivalRule(ws, spells, yearOnly, 'synthetic-arrival-trade-window-v4');
  const arrival = createAflTradeArrivalSpell({
    ...scope,
    playerId: yearOnly.playerId,
    clubId: yearOnly.clubId,
    entry: windowEntryFor(yearOnly),
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    createdAt: await instant(ws),
  });
  const approval = await approve(
    ws,
    'acquisition_spell_registration',
    arrival.spellVersionId,
    arrival
  );
  const versionsBefore = await spellVersions(ws);
  // The promoted event has no precision, so a window does not match it under the deployed rules.
  await expect(spells.registerReviewedSpell(arrival, approval, scope)).rejects.toThrow();
  expect(await spellVersions(ws)).toBe(versionsBefore);

  // The migration edits definitions in place and writes no row.
  await ws.pool.query(ws.migrationSql);
  expect(await spellVersions(ws)).toBe(versionsBefore);
  // Still no match: the window is not the event's precision, and it is not the 0212 full year.
  await expect(spells.registerReviewedSpell(arrival, approval, scope)).rejects.toThrow();
  expect(await spellVersions(ws)).toBe(versionsBefore);
}, 300_000);

it('promotes an undated trade with its reviewed window and registers the arrival inside it', async () => {
  const ws = await workspace();
  await ws.pool.query(ws.migrationSql);
  const promoted = await createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
    draftSessions: true,
    sessionProposalV5: true,
    partialTransactionDates: true,
    tradePeriodWindow,
    fixtureNamespace: 'trade-window',
    providerEventId: '2024-trade-window-alpha',
    nativePlayerId: 'trade-window-player',
  });
  expect(promoted.proposal.content.transactionDateCoverage).toEqual([
    expect.objectContaining({
      occurredOn: null,
      datePrecision: { precision: 'window', eventDate: null, ...tradePeriodWindow },
    }),
  ]);
  const event = await ws.pool.query<{
    event_date: string | null;
    date_precision: unknown;
    season_year: number;
  }>(
    `SELECT event.event_date::TEXT,event.date_precision,root.season_year
       FROM outcome_event_version event JOIN outcome_event root USING(event_id)
      WHERE event.event_version_id=$1`,
    [promoted.entry.eventVersionId]
  );
  expect(event.rows).toEqual([
    {
      event_date: null,
      date_precision: { precision: 'window', eventDate: null, ...tradePeriodWindow },
      season_year: 2024,
    },
  ]);
  const bounds = await ws.pool.query<{ bounds: string | null }>(
    'SELECT outcome_event_evidenced_date_bounds($1)::text AS bounds',
    [promoted.entry.eventVersionId]
  );
  expect(bounds.rows).toEqual([{ bounds: '[2024-10-07,2024-10-17)' }]);

  const spells = await repositoryFor(ws, promoted);
  const rule = await registerArrivalRule(
    ws,
    spells,
    promoted,
    'synthetic-arrival-trade-window-v4-b'
  );
  const arrival = createAflTradeArrivalSpell({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.windowEntry,
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    createdAt: await instant(ws),
  });
  const approval = await approve(
    ws,
    'acquisition_spell_registration',
    arrival.spellVersionId,
    arrival
  );
  await expect(
    Promise.all([
      spells.registerReviewedSpell(arrival, approval, scope),
      spells.registerReviewedSpell(arrival, approval, scope),
    ])
  ).resolves.toEqual([arrival, arrival]);
  expect(await currentness(ws, arrival.spellVersionId)).toBe(true);
  const stored = await ws.pool.query<{
    start_date: string;
    end_date: string | null;
    end_reason: string | null;
  }>(
    `SELECT start_date::TEXT,end_date,end_reason FROM outcome_acquisition_spell_version
      WHERE spell_version_id=$1`,
    [arrival.spellVersionId]
  );
  expect(stored.rows).toEqual([
    { start_date: tradePeriodWindow.earliestDate, end_date: null, end_reason: null },
  ]);

  // A day inside the window is not the event's precision: an exact-day arrival is refused.
  const { datePrecision: _window, ...dayEntry } = windowEntryFor(promoted);
  const dayArrival = createAflTradeArrivalSpell({
    ...arrival.content,
    entry: { ...dayEntry, eventDate: tradePeriodWindow.earliestDate },
    createdAt: await instant(ws),
  });
  const versionsBefore = await spellVersions(ws);
  await expect(
    spells.registerReviewedSpell(
      dayArrival,
      await approve(ws, 'acquisition_spell_registration', dayArrival.spellVersionId, dayArrival),
      scope
    )
  ).rejects.toThrow();
  expect(await spellVersions(ws)).toBe(versionsBefore);
}, 300_000);
