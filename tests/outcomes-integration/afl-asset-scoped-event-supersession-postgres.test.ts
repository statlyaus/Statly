import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
  createAflTradeArrivalSpell,
  createAflTradeArrivalSpellRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { bindTestEvidenceStore } from '../testUtils/testEvidenceStore';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0256_asset_scoped_event_supersession';
// The local fitzRoy rehearsal owners only run inside a schema with this disposable naming pattern.
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
const scope = { environment: 'non_production' as const, competition: 'AFLM' as const };
const OTHER_PLAYER = 'synthetic-event-supersession-other';
const RELISTED_PLAYERS = ['synthetic-event-supersession-kept-a', 'synthetic-event-supersession-kept-b'];
const ADDED_PLAYER = 'synthetic-event-supersession-added';
let cleanup: () => Promise<void> = async () => undefined;
let migrationSql = '';
let promoted: Awaited<ReturnType<typeof createSyntheticAcquisitionPlayerPromotion>>;
let spells: PostgresAflTradeAcquisitionSpellRegistrationRepository;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  const history = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
  cleanup = history.cleanup;
  migrationSql = history.migrationSql;
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_governance_registry_writer`
  );
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schemaName}"
       TO afl_trade_nonproduction_governance_registry_writer`
  );
  // Seeded under the deployed rules; the migration is applied part-way through the sequence below.
  promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
    draftSessions: true,
  });
  spells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
    client,
    {
      read: async (reference) => {
        const artifact = promoted.retainedArtifacts.get(reference.artifactId);
        if (!artifact) throw new Error('Missing exact retained fixture artifact.');
        return artifact.bytes;
      },
    },
    await bindTestEvidenceStore(pool)
  );
  for (const player of [OTHER_PLAYER, ...RELISTED_PLAYERS, ADDED_PLAYER]) {
    await pool.query(
      "INSERT INTO outcome_player(player_id,display_name,status) VALUES($1,$2,'approved')",
      [player, `Synthetic ${player}`]
    );
  }
}, 300_000);

afterAll(async () => {
  await cleanup();
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

const instant = async () => {
  await new Promise((resolve) => setTimeout(resolve, 3));
  return (
    await pool.query<{ at: string }>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;
};

const approve = async (type: string, subject: string, content: unknown) => {
  const id = `synthetic-event-supersession-review:${subject}`;
  await pool.query(
    `INSERT INTO outcome_review_decision(decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES($1,$2,$3,'approved','Synthetic asset-scoped event supersession regression',$4::jsonb,'synthetic-reviewer',$5)`,
    [id, type, subject, canonicalizeAflTradeJson(content), await instant()]
  );
  return id;
};

const currentness = async (spellVersionId: string) =>
  (
    await pool.query<{ current: boolean }>(
      'SELECT outcome_acquisition_spell_registration_current($1,clock_timestamp()) AS current',
      [spellVersionId]
    )
  ).rows[0]!.current;

const supersededFor = async (
  eventVersionId: string,
  player: string | null,
  selection: number | null
) =>
  (
    await pool.query<{ superseded: boolean }>(
      'SELECT outcome_event_version_superseded_for($1,$2,$3) AS superseded',
      [eventVersionId, player, selection]
    )
  ).rows[0]!.superseded;

const functionBody = async (signature: string) =>
  (
    await pool.query<{ body: string }>('SELECT pg_get_functiondef($1::regprocedure) AS body', [
      signature,
    ])
  ).rows[0]!.body;

/** A copy of a version's source import row under a new id, so every row-level constraint holds. */
async function copyImportRow(templateVersionId: string, rowId: string, suffix: string, ordinal: number) {
  await pool.query(
    `INSERT INTO outcome_import_row
       (import_row_id,import_run_id,source_locator,source_ordinal,record_kind,row_sha256,parse_status,raw_payload,recorded_at)
     SELECT $1,import_row.import_run_id,import_row.source_locator||'#'||$2,import_row.source_ordinal*1000+$3,
            import_row.record_kind,encode(sha256(convert_to($1,'UTF8')),'hex'),import_row.parse_status,import_row.raw_payload,clock_timestamp()
       FROM outcome_event_version version
       JOIN outcome_import_row import_row ON import_row.import_row_id=version.source_import_row_id
      WHERE version.event_version_id=$4`,
    [rowId, suffix, ordinal, templateVersionId]
  );
}

/**
 * An approved player asset on a version, copied from the promotion-time asset so every column the
 * schema requires is present; only identity, version, key, source row and the player change.
 */
async function addAsset(eventVersionId: string, player: string, suffix: string, ordinal: number) {
  const rowId = `${eventVersionId}:asset-row-${suffix}`;
  await copyImportRow(promoted.entry.eventVersionId, rowId, suffix, ordinal);
  await pool.query(
    `INSERT INTO outcome_event_asset
     SELECT * FROM jsonb_populate_record(NULL::outcome_event_asset,
       (SELECT to_jsonb(asset) || jsonb_build_object(
          'asset_version_id','event-asset-version:synthetic-supersession-'||$4::text,'event_version_id',$2::text,
          'player_id',$3::text,'asset_key','player-'||$4::text,'source_import_row_id',$1::text,
          'external_identity_decision_id',NULL)
          FROM outcome_event_asset asset WHERE asset.asset_version_id=$5))`,
    [rowId, eventVersionId, player, suffix, promoted.entry.assetVersionId]
  );
}

/**
 * A later version of the promoted event carrying the given players' assets, the way a follow-up
 * promotion (a few players) or a correction (most of the night) re-versions a draft night.
 */
async function supersedeEvent(previousVersionId: string, players: string[], suffix: string) {
  const eventVersionId = `event-version:synthetic-supersession-${suffix}`;
  const eventRow = `${eventVersionId}:event-row`;
  await copyImportRow(previousVersionId, eventRow, suffix, 0);
  await pool.query(
    `INSERT INTO outcome_event_version
       (event_version_id,event_id,version,kind,acquisition_mechanism,event_date,official_name,status,
        source_import_row_id,supersedes_version_id,recorded_at,date_precision)
     SELECT $1,event_id,version+1,kind,acquisition_mechanism,event_date,official_name,'approved',
            $2,event_version_id,clock_timestamp(),date_precision
       FROM outcome_event_version WHERE event_version_id=$3`,
    [eventVersionId, eventRow, previousVersionId]
  );
  for (const [index, player] of players.entries()) {
    await addAsset(eventVersionId, player, `${suffix}-${index}`, index + 1);
  }
  return eventVersionId;
}

let reviewedSpellId = '';
let arrivalSpellId = '';
let secondVersionId = '';
let thirdVersionId = '';

it('a later version that adds another player breaks a reviewed spell under the deployed rules', async () => {
  const entryRule = createAflTradeAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'synthetic-event-supersession-entry-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  await spells.registerReviewedRule(
    entryRule,
    await approve('acquisition_spell_rule', entryRule.ruleId, entryRule),
    scope
  );
  const reviewedSpell = createAflTradeAcquisitionSpellRegistration({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.entry,
    departure: null,
    ruleId: entryRule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough: promoted.entry.eventDate,
    continuityEvidence: promoted.entry.evidence,
    createdAt: await instant(),
  });
  await spells.registerReviewedSpell(
    reviewedSpell,
    await approve('acquisition_spell_registration', reviewedSpell.spellVersionId, reviewedSpell),
    scope
  );
  reviewedSpellId = reviewedSpell.spellVersionId;
  expect(await currentness(reviewedSpellId)).toBe(true);

  // The 2026-09-30 regression: the night re-versioned for one other player, this asset untouched.
  secondVersionId = await supersedeEvent(promoted.entry.eventVersionId, [OTHER_PLAYER], 'second');
  expect(await currentness(reviewedSpellId)).toBe(false);
});

it('the migration scopes supersession to the asset and the spell is current again', async () => {
  await pool.query(migrationSql);
  expect(await supersededFor(promoted.entry.eventVersionId, promoted.playerId, null)).toBe(false);
  expect(await supersededFor(promoted.entry.eventVersionId, OTHER_PLAYER, null)).toBe(true);
  // No player and no selection number keeps the whole-event rule.
  expect(await supersededFor(promoted.entry.eventVersionId, null, null)).toBe(true);
  expect(await supersededFor(secondVersionId, promoted.playerId, null)).toBe(false);
  expect(await currentness(reviewedSpellId)).toBe(true);
});

it('an arrival-only spell registers against the promotion-time event version', async () => {
  const arrivalRule = createAflTradeArrivalSpellRule({
    ...scope,
    ruleVersion: 'synthetic-event-supersession-arrival-v4',
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  await spells.registerReviewedRule(
    arrivalRule,
    await approve('acquisition_spell_rule', arrivalRule.ruleId, arrivalRule),
    scope
  );
  const arrival = createAflTradeArrivalSpell({
    ...scope,
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    entry: promoted.entry,
    ruleId: arrivalRule.ruleId,
    version: 2,
    supersedesSpellVersionId: reviewedSpellId,
    createdAt: await instant(),
  });
  await spells.registerReviewedSpell(
    arrival,
    await approve('acquisition_spell_registration', arrival.spellVersionId, arrival),
    scope
  );
  arrivalSpellId = arrival.spellVersionId;
  expect(await currentness(arrivalSpellId)).toBe(true);
  expect(await currentness(reviewedSpellId)).toBe(false);
});

it('a further version that re-versions the player makes the spell stale, two hops down', async () => {
  thirdVersionId = await supersedeEvent(secondVersionId, [promoted.playerId], 'third');
  expect(await supersededFor(promoted.entry.eventVersionId, promoted.playerId, null)).toBe(true);
  expect(await supersededFor(secondVersionId, promoted.playerId, null)).toBe(true);
  expect(await supersededFor(thirdVersionId, promoted.playerId, null)).toBe(false);
  expect(await currentness(arrivalSpellId)).toBe(false);
});

it('a re-listing that omits a player retires that player; an addition does not', async () => {
  // The third version becomes a three-player night.
  for (const [index, player] of RELISTED_PLAYERS.entries()) {
    await addAsset(thirdVersionId, player, `kept-${index}`, index + 10);
  }
  // An addition carries none of the night's other players, so nobody on the night is retired.
  await supersedeEvent(thirdVersionId, [ADDED_PLAYER], 'addition');
  expect(await supersededFor(thirdVersionId, promoted.playerId, null)).toBe(false);
  expect(await supersededFor(thirdVersionId, RELISTED_PLAYERS[0]!, null)).toBe(false);
  // A correction re-lists two of the three players and omits the third: all of the omitted player's
  // other players, so it is retired along with the carried ones.
  const correctionId = await supersedeEvent(thirdVersionId, RELISTED_PLAYERS, 'correction');
  expect(await supersededFor(thirdVersionId, promoted.playerId, null)).toBe(true);
  expect(await supersededFor(thirdVersionId, RELISTED_PLAYERS[0]!, null)).toBe(true);
  expect(await supersededFor(correctionId, promoted.playerId, null)).toBe(false);
  expect(await supersededFor(correctionId, RELISTED_PLAYERS[1]!, null)).toBe(false);
  // A two-asset event (a trade shape) corrected to drop one player re-lists the one other player.
  const halfId = await supersedeEvent(correctionId, [RELISTED_PLAYERS[1]!], 'half');
  expect(await supersededFor(correctionId, RELISTED_PLAYERS[0]!, null)).toBe(true);
  expect(await supersededFor(correctionId, RELISTED_PLAYERS[1]!, null)).toBe(true);
  expect(await supersededFor(halfId, RELISTED_PLAYERS[0]!, null)).toBe(false);
  // A single-asset origin has no other assets: only carrying the player retires it.
  expect(await supersededFor(halfId, RELISTED_PLAYERS[1]!, null)).toBe(false);
});

it('a draft selection on a later version supersedes its selection number, not its neighbours', async () => {
  // A selection copied from the promotion-time night onto the second version under a new number;
  // only identity, version, number, pick and source row change.
  const selectionNumber = 9001;
  await pool.query(
    `INSERT INTO outcome_draft_selection
     SELECT * FROM jsonb_populate_record(NULL::outcome_draft_selection,
       (SELECT to_jsonb(selection) || jsonb_build_object(
          'selection_id','synthetic-supersession-selection:'||$1::text,'event_version_id',$2::text,
          'selection_number',$1::int,'pick_id',NULL,'source_import_row_id',$2::text||':asset-row')
          FROM outcome_draft_selection selection
          WHERE selection.event_version_id=$3 ORDER BY selection.selection_number LIMIT 1))`,
    [selectionNumber, secondVersionId, promoted.entry.eventVersionId]
  );
  expect(await supersededFor(promoted.entry.eventVersionId, null, selectionNumber)).toBe(true);
  expect(await supersededFor(promoted.entry.eventVersionId, null, selectionNumber + 1)).toBe(false);
  // The third version carries no selection, so the second is not superseded for that number.
  expect(await supersededFor(secondVersionId, null, selectionNumber)).toBe(false);
  expect(await supersededFor(thirdVersionId, null, selectionNumber)).toBe(false);
});

it.each([
  [
    'validate_outcome_version_chain()',
    'current_spell."start_event_version_id", current_spell."player_id", NULL',
  ],
  [
    'authenticate_outcome_special_entitlement_lifecycle(jsonb,text)',
    'selection.event_version_id,selection.player_id,selection.selection_number',
  ],
  [
    'authenticate_outcome_special_entitlement_revision_lifecycle(jsonb,text,jsonb)',
    'selection.event_version_id,selection.player_id,selection.selection_number',
  ],
  [
    'authenticate_outcome_special_entitlement_revision(jsonb,text)',
    'canonical.event_version_id,canonical.player_id,NULL',
  ],
])('%s scopes event supersession to the cited asset', async (signature, arguments_) => {
  const body = await functionBody(signature);
  expect(body).toContain(
    `outcome_event_version_superseded_for"(${arguments_}`
      .replace('"(', '(')
      .replace(
        'outcome_event_version_superseded_for(current',
        '"outcome_event_version_superseded_for"(current'
      )
  );
  expect(body).not.toMatch(
    /FROM outcome_event_version WHERE supersedes_version_id=(selection|canonical)\.event_version_id\)/u
  );
});

it('whole-event checks are unchanged', async () => {
  for (const signature of [
    'outcome_postseason_observation_exact(jsonb)',
    'authenticate_outcome_private_valuation_historical_cohort_input(text,text,jsonb)',
    'require_outcome_special_correction_dependencies()',
  ]) {
    expect(await functionBody(signature)).not.toContain('outcome_event_version_superseded_for');
  }
});
