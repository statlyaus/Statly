import { Pool, type PoolClient } from 'pg';
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

const MIGRATION = '0281_undated_lineage_trade_arrival_window';
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const scope = { environment: 'non_production' as const, competition: 'AFLM' as const };
// The fixture's synthetic trade season is 2024; its dated trade falls on 2024-10-15, inside this.
const tradePeriodWindow = { earliestDate: '2024-10-07', latestDate: '2024-10-16' };
const windowPrecision = { precision: 'window' as const, eventDate: null, ...tradePeriodWindow };

type Promoted = Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>>;

/**
 * One disposable schema per promotion: the synthetic promotion fixture content-addresses its
 * artifacts, captures and canonical rows, so two promotions in one schema collide on primary keys.
 */
interface Workspace {
  pool: Pool;
  client: ReturnType<typeof createPgAflOutcomeSqlClient>;
  migrationSql: string;
  dispose: () => Promise<void>;
}
const workspaces: Workspace[] = [];
let ordinal = 0;

async function workspace(migrated: boolean): Promise<Workspace> {
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
  if (migrated) await pool.query(built.migrationSql);
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
  const id = `synthetic-lineage-window-review:${subject}`;
  await ws.pool.query(
    `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES($1,$2,$3,'approved','Synthetic undated reviewed-lineage trade arrival',$4::jsonb,'synthetic-reviewer',$5)`,
    [id, type, subject, canonicalizeAflTradeJson(content), await instant(ws)]
  );
  return id;
};

// Seeded directly, in states the reviewed writers refuse to create from this fixture; reviewed pick
// lineage and Official AFL trade-period capture have their own suites.
async function seeded(ws: Workspace, work: (client: PoolClient) => Promise<unknown>) {
  const client = await ws.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL session_replication_role='replica'`);
    await work(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// The promoted candidate becomes reviewed pick lineage: a reviewed lineage registration names it,
// which is how `outcome_current_canonical_reviewed_lineage_transactions` (0274) recognises it.
async function markReviewedLineage(ws: Workspace, promoted: Promoted) {
  const candidateId = promoted.candidate.candidateId;
  const registrationId = `reviewed-pick-lineage-registration:synthetic-${ordinal}`;
  const decisionId = await approve(ws, 'reviewed_pick_lineage_registration', registrationId, {
    candidateId,
  });
  await seeded(ws, (client) =>
    client.query(
      `INSERT INTO outcome_reviewed_pick_lineage_registration
         (registration_id,candidate_id,approval_decision_id,registration_json)
       VALUES($1,$2,$3,$4::jsonb)`,
      [
        registrationId,
        candidateId,
        decisionId,
        JSON.stringify({ registrationId, content: { candidateId } }),
      ]
    )
  );
  const reviewed = await ws.pool.query<{ listed: number }>(
    `SELECT count(*)::integer AS listed
       FROM outcome_current_canonical_reviewed_lineage_transactions('AFLM') reviewed
       JOIN outcome_event_version version ON version.event_id=reviewed.transaction_id
      WHERE version.event_version_id=$1`,
    [promoted.entry.eventVersionId]
  );
  expect(reviewed.rows).toEqual([{ listed: 1 }]);
}

// Another approved capture of the season's trade period, copied from the fixture's own capture. It
// restates the same window, or states one ending on `latestDate` instead.
async function stageTradePeriodRecapture(ws: Workspace, copy: string, latestDate?: string) {
  const suffix = `:copy-${copy}`;
  await seeded(ws, async (client) => {
    await client.query(
      `INSERT INTO outcome_source_capture
         (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,dataset_version,
          access_mechanism,capability_id,competition,anchor_season_year,effective_at,captured_at,status,manifest_json)
       SELECT capture_id||$1,attempt_id||$1,source_snapshot_id||$1,source_artifact_id,
              environment,provider,dataset,dataset_version,access_mechanism,capability_id,competition,
              anchor_season_year,effective_at,captured_at,status,manifest_json
         FROM outcome_source_capture
        WHERE capability_id='official-afl-trade-period-dates' AND capture_id NOT LIKE '%:copy-%'`,
      [suffix]
    );
    await client.query(
      `INSERT INTO outcome_external_evidence_batch
         (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,issue_set_sha256,status,finalized_at,batch_json)
       SELECT 'external-evidence-batch:'||encode(sha256(convert_to(batch.batch_id||$1,'UTF8')),'hex'),
              batch.capture_id||$1,batch.provider,batch.evidence_count,
              batch.issue_count,batch.row_set_sha256,batch.issue_set_sha256,batch.status,batch.finalized_at,batch.batch_json
         FROM outcome_external_evidence_batch batch
         JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
        WHERE capture.capability_id='official-afl-trade-period-dates'
          AND capture.capture_id NOT LIKE '%:copy-%'`,
      [suffix]
    );
    await client.query(
      `INSERT INTO outcome_external_evidence_row
         (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
       SELECT 'external-evidence:'||encode(sha256(convert_to(row.evidence_id||$1,'UTF8')),'hex'),
              'external-evidence-batch:'||encode(sha256(convert_to(row.batch_id||$1,'UTF8')),'hex'),
              row.ordinal,row.source_key,row.claim_kind,
              CASE WHEN $2::text IS NULL THEN row.evidence_json
                   ELSE jsonb_set(row.evidence_json,'{content,claim,datePrecision,latestDate}',to_jsonb($2::text)) END
         FROM outcome_external_evidence_row row
         JOIN outcome_external_evidence_batch batch ON batch.batch_id=row.batch_id
         JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
        WHERE row.claim_kind='trade_period_window' AND capture.capture_id NOT LIKE '%:copy-%'`,
      [suffix, latestDate ?? null]
    );
  });
}

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

async function arrivalRule(ws: Workspace, promoted: Promoted) {
  const spells = await repositoryFor(ws, promoted);
  const rule = createAflTradeArrivalSpellRule({
    ...scope,
    ruleVersion: `synthetic-lineage-window-v4-${ordinal}`,
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(ws),
  });
  await spells.registerReviewedRule(
    rule,
    await approve(ws, 'acquisition_spell_rule', rule.ruleId, rule),
    scope
  );
  return { spells, ruleId: rule.ruleId };
}

// The 0212 full-year binding of the fixture's 2024 trade season.
const yearPrecision = {
  precision: 'window' as const,
  eventDate: null,
  earliestDate: '2024-01-01',
  latestDate: '2024-12-31',
};

// A null-day entry citing the season window (or the 0212 full year), or the promoted event's day.
async function arrivalFor(
  ws: Workspace,
  promoted: Promoted,
  ruleId: string,
  entry: 'window' | 'year' | 'day'
) {
  const arrival = createAflTradeArrivalSpell({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry:
      entry === 'day'
        ? promoted.entry
        : {
            promotionId: promoted.entry.promotionId,
            eventVersionId: promoted.entry.eventVersionId,
            assetVersionId: promoted.entry.assetVersionId,
            eventDate: null,
            datePrecision: entry === 'window' ? windowPrecision : yearPrecision,
            evidence: promoted.entry.evidence,
          },
    ruleId,
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
  return { arrival, approval };
}

// The registration trigger's refusal (0142) when `outcome_acquisition_spell_registration_current`
// does not hold the new spell current: the arrival test itself refused it, not a fixture, evidence
// or custody failure on the way.
const NOT_CURRENT =
  /Acquisition spell registration requires exact current review and retained ancestry/;

const spellVersions = async (ws: Workspace) =>
  (
    await ws.pool.query<{ versions: number }>(
      'SELECT count(*)::integer AS versions FROM outcome_acquisition_spell_version'
    )
  ).rows[0]!.versions;

const currentness = async (ws: Workspace, spellVersionId: string) =>
  (
    await ws.pool.query<{ current: boolean }>(
      'SELECT outcome_acquisition_spell_registration_current($1,clock_timestamp()) AS current',
      [spellVersionId]
    )
  ).rows[0]!.current;

const undatedTrade = {
  environment: 'non_production' as const,
  completeCaptureReceipts: true,
  draftSessions: true,
  sessionProposalV5: true,
  partialTransactionDates: true,
};

// An undated trade promoted before migration 0261 carries no window and cannot be re-versioned once
// its pick lineage is reviewed (statlyaus/Statly#869). Its arrival takes the one window the season's
// approved trade-period captures state; the event row stays undated and every other undated trade
// is unchanged.
it('registers an undated reviewed-lineage trade arrival inside its season window, and only that', async () => {
  const ws = await workspace(false);
  // A year-only trade under the deployed rules, with the season's approved trade-period capture.
  const promoted = await createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    ...undatedTrade,
    tradePeriodWindow,
    tradePeriodWindowClaim: true,
    tradePeriodWindowCaptureOnly: true,
  });
  expect(promoted.proposal.content.transactionDateCoverage).toEqual([
    expect.not.objectContaining({ datePrecision: expect.anything() }),
  ]);
  await markReviewedLineage(ws, promoted);
  const { spells, ruleId } = await arrivalRule(ws, promoted);
  const { arrival, approval } = await arrivalFor(ws, promoted, ruleId, 'window');
  const versionsBefore = await spellVersions(ws);
  // Before the migration the window is not the event's precision.
  await expect(spells.registerReviewedSpell(arrival, approval, scope)).rejects.toThrow(NOT_CURRENT);
  expect(await spellVersions(ws)).toBe(versionsBefore);

  // The migration edits definitions and writes no row.
  await ws.pool.query(ws.migrationSql);
  expect(await spellVersions(ws)).toBe(versionsBefore);
  await expect(spells.registerReviewedSpell(arrival, approval, scope)).resolves.toEqual(arrival);
  expect(await currentness(ws, arrival.spellVersionId)).toBe(true);
  const stored = await ws.pool.query(
    `SELECT start_date::TEXT FROM outcome_acquisition_spell_version WHERE spell_version_id=$1`,
    [arrival.spellVersionId]
  );
  expect(stored.rows).toEqual([{ start_date: tradePeriodWindow.earliestDate }]);
  // The event row itself stays undated, and its evidenced bounds are unchanged.
  const event = await ws.pool.query(
    `SELECT event_date,date_precision,outcome_event_evidenced_date_bounds(event_version_id) AS bounds
       FROM outcome_event_version WHERE event_version_id=$1`,
    [promoted.entry.eventVersionId]
  );
  expect(event.rows).toEqual([{ event_date: null, date_precision: null, bounds: null }]);

  // A recapture restating the same window keeps it: distinct windows are counted, as the review
  // command reads them.
  await stageTradePeriodRecapture(ws, 'same');
  expect(await currentness(ws, arrival.spellVersionId)).toBe(true);

  const seasonWindow = async () =>
    (
      await ws.pool.query<{ window: unknown }>(
        `SELECT outcome_reviewed_lineage_trade_arrival_window($1,'non_production') AS window`,
        [promoted.entry.eventVersionId]
      )
    ).rows[0]!.window;
  expect(await seasonWindow()).toEqual(windowPrecision);

  // A capture stating a different window makes the season ambiguous: no window is given and the
  // arrival is no longer current. (A new registration for this player and club would meet the
  // stint overlap guard first; the no-capture case below proves the refusal at registration.)
  await stageTradePeriodRecapture(ws, 'other', '2024-10-15');
  expect(await seasonWindow()).toBeNull();
  expect(await currentness(ws, arrival.spellVersionId)).toBe(false);
}, 300_000);

it('refuses the season window for an undated trade that is not reviewed lineage', async () => {
  const ws = await workspace(true);
  const promoted = await createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    ...undatedTrade,
    tradePeriodWindow,
    tradePeriodWindowClaim: true,
    tradePeriodWindowCaptureOnly: true,
  });
  const { spells, ruleId } = await arrivalRule(ws, promoted);
  const { arrival, approval } = await arrivalFor(ws, promoted, ruleId, 'window');
  const versionsBefore = await spellVersions(ws);
  await expect(spells.registerReviewedSpell(arrival, approval, scope)).rejects.toThrow(NOT_CURRENT);
  expect(await spellVersions(ws)).toBe(versionsBefore);

  // Positive control: the same arrival registers once the trade is reviewed lineage.
  await markReviewedLineage(ws, promoted);
  await expect(spells.registerReviewedSpell(arrival, approval, scope)).resolves.toEqual(arrival);
  expect(await currentness(ws, arrival.spellVersionId)).toBe(true);
}, 300_000);

it('refuses the window for an undated reviewed-lineage trade with no approved capture', async () => {
  const ws = await workspace(true);
  const promoted = await createSyntheticAcquisitionPlayerPromotion(ws.pool, undatedTrade);
  await markReviewedLineage(ws, promoted);
  const { spells, ruleId } = await arrivalRule(ws, promoted);
  const { arrival, approval } = await arrivalFor(ws, promoted, ruleId, 'window');
  const versionsBefore = await spellVersions(ws);
  await expect(spells.registerReviewedSpell(arrival, approval, scope)).rejects.toThrow(NOT_CURRENT);
  expect(await spellVersions(ws)).toBe(versionsBefore);

  // Positive control: the same promotion, rule and evidence register the 0212 full-year arrival.
  const year = await arrivalFor(ws, promoted, ruleId, 'year');
  await expect(spells.registerReviewedSpell(year.arrival, year.approval, scope)).resolves.toEqual(
    year.arrival
  );
  expect(await currentness(ws, year.arrival.spellVersionId)).toBe(true);
}, 300_000);

it('leaves a dated reviewed-lineage trade to its own day', async () => {
  const ws = await workspace(true);
  const promoted = await createSyntheticAcquisitionPlayerPromotion(ws.pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
    draftSessions: true,
    sessionProposalV5: true,
    tradePeriodWindow,
    tradePeriodWindowClaim: true,
    tradePeriodWindowCaptureOnly: true,
  });
  await markReviewedLineage(ws, promoted);
  const { spells, ruleId } = await arrivalRule(ws, promoted);
  const windowed = await arrivalFor(ws, promoted, ruleId, 'window');
  const versionsBefore = await spellVersions(ws);
  await expect(
    spells.registerReviewedSpell(windowed.arrival, windowed.approval, scope)
  ).rejects.toThrow(NOT_CURRENT);
  expect(await spellVersions(ws)).toBe(versionsBefore);
  const day = await arrivalFor(ws, promoted, ruleId, 'day');
  await expect(spells.registerReviewedSpell(day.arrival, day.approval, scope)).resolves.toEqual(
    day.arrival
  );
  expect(await currentness(ws, day.arrival.spellVersionId)).toBe(true);
}, 300_000);
