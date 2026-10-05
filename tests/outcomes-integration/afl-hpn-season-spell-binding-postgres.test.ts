import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
  createAflTradeAppearanceMembershipSpell,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { buildAppearanceMembershipHpnInputFixture } from '../testUtils/appearanceMembershipHpnInputFixture';
import { bindTestEvidenceStore } from '../testUtils/testEvidenceStore';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0248_hpn_season_spell_binding';

// The local fitzRoy rehearsal owners only run inside a schema with this disposable naming pattern.
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
let migration: Awaited<ReturnType<typeof deployOutcomesHistoryBefore>>;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  migration = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString());
  const latest = await pool.query<{ migration_name: string }>(
    `SELECT migration_name FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 1`
  );
  expect(latest.rows[0]!.migration_name < MIGRATION).toBe(true);
}, 300_000);

afterAll(async () => {
  await migration?.cleanup();
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

const currentness = async (spellVersionId: string) =>
  (
    await pool.query<{ current: boolean }>(
      'SELECT outcome_acquisition_spell_registration_current($1,clock_timestamp()) AS current',
      [spellVersionId]
    )
  ).rows[0]!.current;

const spellVersions = async () =>
  (
    await pool.query<{ versions: number }>(
      'SELECT count(*)::integer AS versions FROM outcome_acquisition_spell_version'
    )
  ).rows[0]!.versions;

const sourceCurrent = async (inputSetId: string, spellVersionId: string) =>
  (
    await pool.query<{ current: boolean }>(
      `SELECT bool_and(outcome_hpn_acquisition_spell_source_current($2,row.provider_decoded_row_id,
          row.normalization_run_id,run.projected_field_map_id,match.effective_at::DATE,
          outcome_acquisition_spell_registration_current($2,clock_timestamp()))) AS current
         FROM outcome_hpn_pav_input_row row
         JOIN outcome_hpn_pav_input_run run
           ON run.input_set_id=row.input_set_id AND run.normalization_run_id=row.normalization_run_id
         JOIN outcome_hpn_pav_input_match match
           ON match.input_set_id=row.input_set_id
          AND match.match_id=row.row_json#>>'{match,canonicalId}'
        WHERE row.input_set_id=$1 AND row.row_kind='player_match_stats'
          AND row.row_json#>>'{player,canonicalId}'='afl-player:local-rehearsal'`,
      [inputSetId, spellVersionId]
    )
  ).rows[0]!.current;

// Season statistics bind season (v3) spells only. A reviewed spell proves the arrival; it no longer
// blocks or retires the season spells inside its stint, and it is never a binding candidate.
it('binds season statistics to season spells inside a reviewed stint', async () => {
  const { approve, built, proposals, repository, request, scope, spells } =
    await buildAppearanceMembershipHpnInputFixture({ pool, client, instant });
  const homeWindow = proposals.find(
    (proposal) => proposal.content.playerId === 'afl-player:local-rehearsal'
  )!;
  const homeV3 = homeWindow.content;
  if (homeV3.schemaVersion !== 'afl-trade-acquisition-registration/v3')
    throw new Error('Expected an appearance-membership window.');
  const { schemaVersion: _schema, observedThrough: _observed, ...homeContent } = homeV3;
  const read = {
    ...scope,
    seasonYear: 2026,
    methodId: request.methodId,
    inputSetId: built.inputSet.inputSetId,
  };
  const promoted = await createSyntheticAcquisitionPlayerPromotion(pool, {
    environment: 'non_production',
    completeCaptureReceipts: true,
    draftSessions: true,
    existingDraftTargets: [
      {
        playerId: 'afl-player:local-rehearsal',
        playerName: 'Player One',
        clubId: 'afl-club:local-rehearsal',
        clubName: 'Carlton',
      },
      {
        playerId: 'afl-player:local-rehearsal-away',
        playerName: 'Player Two',
        clubId: 'afl-club:local-rehearsal-away',
        clubName: 'Fremantle',
      },
    ],
    existingTargets: {
      playerId: 'afl-player:local-rehearsal',
      playerName: 'Player One',
      fromClubId: 'afl-club:local-rehearsal-away',
      fromClubName: 'Fremantle',
      toClubId: 'afl-club:local-rehearsal',
      toClubName: 'Carlton',
    },
  });
  const reviewedSpells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
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

  // Under the old rules: a reviewed (v1) spell whose open stint covers the home player's window.
  const entryRule = createAflTradeAcquisitionSpellRegistrationRule({
    ...scope,
    ruleVersion: 'synthetic-reviewed-entry-v1',
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  await reviewedSpells.registerReviewedRule(
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
    observedThrough: '2026-03-20',
    continuityEvidence: promoted.entry.evidence,
    createdAt: await instant(),
  });
  await reviewedSpells.registerReviewedSpell(
    reviewedSpell,
    await approve('acquisition_spell_registration', reviewedSpell.spellVersionId, reviewedSpell),
    scope
  );
  const successorWindow = async () =>
    createAflTradeAppearanceMembershipSpell({
      ...homeContent,
      version: 2,
      supersedesSpellVersionId: homeWindow.spellVersionId,
      createdAt: await instant(),
    });
  // The reviewed spell retires the window, so the input bound to it is no longer current, the
  // reviewed spell could bind the row instead, and no successor window may sit inside it.
  expect(await currentness(reviewedSpell.spellVersionId)).toBe(true);
  expect(await currentness(homeWindow.spellVersionId)).toBe(false);
  await expect(repository.loadCurrentFinalizedSeasonInputSet(read, scope)).rejects.toThrow();
  expect(await sourceCurrent(built.inputSet.inputSetId, reviewedSpell.spellVersionId)).toBe(true);
  const blocked = await successorWindow();
  await expect(
    spells.registerReviewedSpell(
      blocked,
      await approve('acquisition_spell_registration', blocked.spellVersionId, blocked),
      scope
    )
  ).rejects.toThrow('cannot overlap');
  const versionsBefore = await spellVersions();

  // The migration edits the deployed definitions in place and writes no row.
  await pool.query(migration.migrationSql);
  expect(await spellVersions()).toBe(versionsBefore);

  // The reviewed spell keeps its meaning, and the window inside its stint is current again.
  expect(await currentness(reviewedSpell.spellVersionId)).toBe(true);
  expect(await currentness(homeWindow.spellVersionId)).toBe(true);
  // A reviewed spell never binds season statistics; the season window does.
  expect(await sourceCurrent(built.inputSet.inputSetId, reviewedSpell.spellVersionId)).toBe(false);
  expect(await sourceCurrent(built.inputSet.inputSetId, homeWindow.spellVersionId)).toBe(true);
  // So the input bound to the window reads as current authority again, unchanged.
  await expect(repository.loadCurrentFinalizedSeasonInputSet(read, scope)).resolves.toEqual(
    built.inputSet
  );

  // Two season spells for one player and club still cannot overlap.
  const duplicateWindow = createAflTradeAppearanceMembershipSpell({
    ...homeContent,
    version: 1,
    supersedesSpellVersionId: null,
    createdAt: await instant(),
  });
  await expect(
    spells.registerReviewedSpell(
      duplicateWindow,
      await approve(
        'acquisition_spell_registration',
        duplicateWindow.spellVersionId,
        duplicateWindow
      ),
      scope
    )
  ).rejects.toThrow('cannot overlap');

  // A successor season window registers inside the reviewed stint, and both stay current.
  const inside = await successorWindow();
  await spells.registerReviewedSpell(
    inside,
    await approve('acquisition_spell_registration', inside.spellVersionId, inside),
    scope
  );
  expect(await currentness(inside.spellVersionId)).toBe(true);
  expect(await currentness(reviewedSpell.spellVersionId)).toBe(true);
  expect(await sourceCurrent(built.inputSet.inputSetId, inside.spellVersionId)).toBe(true);

  // Two reviewed spells for one player and club still cannot overlap.
  const { schemaVersion: _reviewedSchema, ...reviewedContent } = reviewedSpell.content;
  const secondReviewed = createAflTradeAcquisitionSpellRegistration({
    ...reviewedContent,
    createdAt: await instant(),
  });
  await expect(
    reviewedSpells.registerReviewedSpell(
      secondReviewed,
      await approve(
        'acquisition_spell_registration',
        secondReviewed.spellVersionId,
        secondReviewed
      ),
      scope
    )
  ).rejects.toThrow('cannot overlap');
  expect(await spellVersions()).toBe(versionsBefore + 1);
}, 300_000);
