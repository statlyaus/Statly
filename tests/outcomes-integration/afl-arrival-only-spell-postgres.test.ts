import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
  createAflTradeAppearanceMembershipSpell,
  createAflTradeArrivalSpell,
  createAflTradeArrivalSpellRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { buildAppearanceMembershipHpnInputFixture } from '../testUtils/appearanceMembershipHpnInputFixture';
import { bindTestEvidenceStore } from '../testUtils/testEvidenceStore';
import { deployOutcomesHistoryBefore } from './outcomesPreMigrationWorkspace';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');

const MIGRATION = '0247_arrival_only_reviewed_spells';

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
  migration = await deployOutcomesHistoryBefore(MIGRATION, scoped.toString(), pool);
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

// A reviewed spell whose evidence was lost is re-made as an arrival: it proves how the player
// arrived, and continuity comes from the season (v3) spells, which may then sit inside its stint.
it('leaves reviewed spells unchanged and re-makes one as an arrival that admits season spells', async () => {
  const { approve, proposals, scope, spells } = await buildAppearanceMembershipHpnInputFixture({
    pool,
    client,
    instant,
  });
  const homeWindow = proposals.find(
    (proposal) => proposal.content.playerId === 'afl-player:local-rehearsal'
  )!;
  const homeV3 = homeWindow.content;
  if (homeV3.schemaVersion !== 'afl-trade-acquisition-registration/v3')
    throw new Error('Expected an appearance-membership window.');
  const { schemaVersion: _schema, observedThrough: _observed, ...homeContent } = homeV3;
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

  // Under the old rules: a reviewed (v1) spell checked only up to its own arrival day.
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
    observedThrough: promoted.entry.eventDate,
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
  const pinTodaysRules = async () => {
    // The v1 spell occupies its stint, retires the season window inside it and refuses a successor.
    expect(await currentness(reviewedSpell.spellVersionId)).toBe(true);
    expect(await currentness(homeWindow.spellVersionId)).toBe(false);
    const blocked = await successorWindow();
    await expect(
      spells.registerReviewedSpell(
        blocked,
        await approve('acquisition_spell_registration', blocked.spellVersionId, blocked),
        scope
      )
    ).rejects.toThrow('cannot overlap');
  };
  await pinTodaysRules();
  const versionsBefore = await spellVersions();

  // The migration edits the deployed definitions in place and writes no row.
  await pool.query(migration.migrationSql);
  expect(await spellVersions()).toBe(versionsBefore);
  // Existing reviewed spells keep their meaning exactly.
  await pinTodaysRules();

  // The arrival supersedes the v1 spell with the same entry and no continuity claim.
  const arrivalRule = createAflTradeArrivalSpellRule({
    ...scope,
    ruleVersion: 'synthetic-arrival-v4',
    evidence: [promoted.sourceArtifact],
    createdAt: await instant(),
  });
  await reviewedSpells.registerReviewedRule(
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
    supersedesSpellVersionId: reviewedSpell.spellVersionId,
    createdAt: await instant(),
  });
  const arrivalApproval = await approve(
    'acquisition_spell_registration',
    arrival.spellVersionId,
    arrival
  );
  await expect(
    Promise.all([
      reviewedSpells.registerReviewedSpell(arrival, arrivalApproval, scope),
      reviewedSpells.registerReviewedSpell(arrival, arrivalApproval, scope),
    ])
  ).resolves.toEqual([arrival, arrival]);
  await expect(reviewedSpells.loadCurrentExact(arrival.spellVersionId, scope)).resolves.toEqual(
    arrival
  );
  expect(await currentness(arrival.spellVersionId)).toBe(true);
  expect(await currentness(reviewedSpell.spellVersionId)).toBe(false);
  const stored = await pool.query<{
    spell_id: string;
    end_date: string | null;
    end_reason: string | null;
  }>(
    `SELECT spell_id,end_date,end_reason FROM outcome_acquisition_spell_version
      WHERE spell_version_id=$1`,
    [arrival.spellVersionId]
  );
  expect(stored.rows).toEqual([
    { spell_id: reviewedSpell.spellVersionId, end_date: null, end_reason: null },
  ]);

  // An arrival does not retire the season window inside its stint.
  expect(await currentness(homeWindow.spellVersionId)).toBe(true);

  // A season spell registers inside the arrival's open stint, and both stay current.
  const inside = await successorWindow();
  await spells.registerReviewedSpell(
    inside,
    await approve('acquisition_spell_registration', inside.spellVersionId, inside),
    scope
  );
  expect(await currentness(inside.spellVersionId)).toBe(true);
  expect(await currentness(arrival.spellVersionId)).toBe(true);

  // Season statistics bind season spells, never an arrival.
  await expect(
    pool.query(`INSERT INTO outcome_hpn_pav_calculation_player (spell_version_id) VALUES ($1)`, [
      arrival.spellVersionId,
    ])
  ).rejects.toThrow('binds season spells, not arrival-only spells');

  // Two reviewed spells for one player and club still cannot overlap.
  const secondArrival = createAflTradeArrivalSpell({
    ...arrival.content,
    version: 1,
    supersedesSpellVersionId: null,
    createdAt: await instant(),
  });
  await expect(
    reviewedSpells.registerReviewedSpell(
      secondArrival,
      await approve('acquisition_spell_registration', secondArrival.spellVersionId, secondArrival),
      scope
    )
  ).rejects.toThrow('cannot overlap');

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
  expect(await spellVersions()).toBe(versionsBefore + 2);
}, 300_000);
