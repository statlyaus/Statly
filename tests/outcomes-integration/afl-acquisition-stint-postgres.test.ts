import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeArrivalSpell,
  createAflTradeArrivalSpellRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { buildAppearanceMembershipHpnInputFixture } from '../testUtils/appearanceMembershipHpnInputFixture';
import { bindTestEvidenceStore } from '../testUtils/testEvidenceStore';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
// The local fitzRoy rehearsal owners only run inside a schema with this disposable naming pattern.
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
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

const instant = async () => {
  await new Promise((resolve) => setTimeout(resolve, 3));
  return (
    await pool.query<{ at: string }>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;
};

interface Stint {
  schemaVersion: string;
  playerId: string;
  clubId: string;
  arrival: { spellVersionId: string; schemaVersion: string; date: string };
  seasons: {
    seasonYear: number;
    spellVersionId: string;
    firstAppearanceDate: string;
    lastAppearanceDate: string;
  }[];
  closingSeason: number | null;
  closedBy: { kind: string; spellVersionId: string; date: string } | null;
  endDate: string | null;
  status: 'open' | 'closed' | 'no_appearances';
}

const stint = async (playerId: string, clubId: string, arrival: string) =>
  (
    await pool.query<{ stint: Stint }>('SELECT outcome_acquisition_stint($1,$2,$3) AS stint', [
      playerId,
      clubId,
      arrival,
    ])
  ).rows[0]!.stint;

// Real registration and currency: an arrival re-made from a reviewed entry admits the season window
// inside its stint, the stint reads it, and a second arrival on a different date may coexist.
it('reads a registered arrival and the current season spell inside its stint', async () => {
  const { approve, proposals, scope } = await buildAppearanceMembershipHpnInputFixture({
    pool,
    client,
    instant,
  });
  const homeWindow = proposals.find(
    (proposal) => proposal.content.playerId === 'afl-player:local-rehearsal'
  )!;
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
    version: 1,
    supersedesSpellVersionId: null,
    createdAt: await instant(),
  });
  await reviewedSpells.registerReviewedSpell(
    arrival,
    await approve('acquisition_spell_registration', arrival.spellVersionId, arrival),
    scope
  );
  const window = homeWindow.content;
  if (window.schemaVersion !== 'afl-trade-acquisition-registration/v3')
    throw new Error('Expected an appearance-membership window.');
  await expect(stint(promoted.playerId, promoted.clubId, arrival.spellVersionId)).resolves.toEqual({
    schemaVersion: 'afl-trade-acquisition-stint/v1',
    playerId: promoted.playerId,
    clubId: promoted.clubId,
    arrival: {
      spellVersionId: arrival.spellVersionId,
      schemaVersion: 'afl-trade-acquisition-registration/v4',
      date: promoted.entry.eventDate,
    },
    seasons: [
      {
        seasonYear: window.seasonYear,
        spellVersionId: homeWindow.spellVersionId,
        firstAppearanceDate: window.firstAppearance.date,
        lastAppearanceDate: window.lastAppearance.date,
      },
    ],
    closingSeason: null,
    closedBy: null,
    endDate: null,
    status: 'open',
  });
  // A stint starts only at a reviewed arrival for the same player and club.
  await expect(
    stint(promoted.playerId, promoted.clubId, homeWindow.spellVersionId)
  ).rejects.toThrow('starts at a current reviewed arrival');
  await expect(
    stint(promoted.playerId, 'afl-club:local-rehearsal-away', arrival.spellVersionId)
  ).rejects.toThrow('starts at a current reviewed arrival');

  // The overlap guard (registration validity is covered by the spell registration suites; only the
  // after-insert registration guard is disabled in this disposable schema): an arrival is a point
  // claim, so a second arrival for the same player and club on another date coexists, while one on
  // the same date still overlaps.
  await pool.query(
    'ALTER TABLE outcome_acquisition_spell_version DISABLE TRIGGER outcome_acquisition_spell_registration_guard'
  );
  const copyArrival = (suffix: string, startDate: string) =>
    pool.query(
      `INSERT INTO outcome_acquisition_spell_version
        (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,start_asset_version_id,
         start_date,end_date,end_reason,rule_id,status,supersedes_spell_version_id,recorded_at,
         registration_canonical_json,registration_approval_decision_id,registered_at)
       SELECT spell_version_id||$2,spell_version_id||$2,1,player_id,club_id,start_event_version_id,
              start_asset_version_id,$3::date,NULL,NULL,rule_id,status,NULL,recorded_at,
              registration_canonical_json,registration_approval_decision_id,registered_at
         FROM outcome_acquisition_spell_version WHERE spell_version_id=$1`,
      [arrival.spellVersionId, suffix, startDate]
    );
  await expect(copyArrival(':same-day', promoted.entry.eventDate)).rejects.toThrow(
    'cannot overlap'
  );
  await expect(copyArrival(':redraft', '2027-02-15')).resolves.toBeDefined();
  await pool.query(
    'ALTER TABLE outcome_acquisition_spell_version ENABLE TRIGGER outcome_acquisition_spell_registration_guard'
  );
}, 300_000);

// Stint assembly over synthetic spells. Spell currency is replaced in this disposable schema by a
// stub that reads an explicit non-current list, so each case pins one assembly rule; registration
// currency itself is covered by the spell registration suites.
it('assembles first stints, closures, return stints and redrafts', async () => {
  await pool.query(`CREATE TABLE stint_noncurrent (spell_version_id TEXT PRIMARY KEY)`);
  await pool.query(
    `CREATE OR REPLACE FUNCTION outcome_acquisition_spell_registration_current(target_id TEXT, cutoff TIMESTAMPTZ)
     RETURNS BOOLEAN LANGUAGE sql STABLE AS
     $$ SELECT NOT EXISTS (SELECT 1 FROM stint_noncurrent WHERE spell_version_id=target_id) $$`
  );
  const at = await instant();
  const seeded = await pool.connect();
  const arrival = async (
    id: string,
    player: string,
    club: string,
    date: string,
    version = 1,
    supersedes: string | null = null
  ) =>
    seeded.query(
      `INSERT INTO outcome_acquisition_spell_version
        (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,start_asset_version_id,
         start_date,end_date,end_reason,rule_id,status,supersedes_spell_version_id,recorded_at,
         registration_canonical_json,registration_approval_decision_id,registered_at)
       VALUES($1,$1,$5,$2,$3,'synthetic-event:'||$1,'synthetic-asset:'||$1,$4::date,NULL,NULL,
         'synthetic-rule','approved',$6,$7,
         '{"schemaVersion":"afl-trade-acquisition-registration/v4"}','synthetic-review',$7)`,
      [id, player, club, date, version, supersedes, at]
    );
  const season = async (
    id: string,
    player: string,
    club: string,
    year: number,
    version = 1,
    supersedes: string | null = null
  ) =>
    seeded.query(
      `INSERT INTO outcome_acquisition_spell_version
        (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,start_asset_version_id,
         start_date,end_date,end_reason,rule_id,status,supersedes_spell_version_id,recorded_at,
         registration_canonical_json,registration_approval_decision_id,registered_at)
       VALUES($1,$1,$5,$2,$3,NULL,NULL,make_date($4,3,15),make_date($4,8,20),
         'last_reviewed_appearance_in_season','synthetic-rule','approved',$6,$7,
         jsonb_build_object('schemaVersion','afl-trade-acquisition-registration/v3','seasonYear',$4)::text,
         'synthetic-review',$7)`,
      [id, player, club, year, version, supersedes, at]
    );
  try {
    await seeded.query('BEGIN');
    await seeded.query(`SET LOCAL session_replication_role='replica'`);
    // Brodie Grundy: Collingwood to Melbourne (October 2022), then Melbourne to Sydney (October 2023).
    await season('grundy-col-2022', 'grundy', 'collingwood', 2022);
    await arrival('grundy-mel', 'grundy', 'melbourne', '2022-10-12');
    await season('grundy-mel-2023', 'grundy', 'melbourne', 2023);
    await arrival('grundy-syd', 'grundy', 'sydney', '2023-10-16');
    await season('grundy-syd-2024', 'grundy', 'sydney', 2024);
    await season('grundy-syd-2025', 'grundy', 'sydney', 2025);
    // Jack Gunston: Hawthorn to Brisbane (October 2022), then back to Hawthorn (October 2023).
    await arrival('gunston-haw', 'gunston', 'hawthorn', '2012-10-11');
    await season('gunston-haw-2021', 'gunston', 'hawthorn', 2021);
    await season('gunston-haw-2022', 'gunston', 'hawthorn', 2022);
    await arrival('gunston-bri', 'gunston', 'brisbane', '2022-10-13');
    await season('gunston-bri-2023', 'gunston', 'brisbane', 2023);
    await arrival('gunston-haw-return', 'gunston', 'hawthorn', '2023-10-12');
    await season('gunston-haw-2024', 'gunston', 'hawthorn', 2024);
    await season('gunston-haw-2025', 'gunston', 'hawthorn', 2025);
    // Delisted and redrafted by the same club; the first season window was re-made (version 2).
    await arrival('redraft-first', 'redraft', 'geelong', '2019-11-27');
    await season('redraft-2020-v1', 'redraft', 'geelong', 2020);
    await season('redraft-2020', 'redraft', 'geelong', 2020, 2, 'redraft-2020-v1');
    await arrival('redraft-second', 'redraft', 'geelong', '2021-02-17');
    await season('redraft-2021', 'redraft', 'geelong', 2021);
    await season('redraft-2022', 'redraft', 'geelong', 2022);
    // Retired after three seasons; one season spell is no longer current.
    await arrival('retired', 'retired', 'adelaide', '2015-11-26');
    await season('retired-2016', 'retired', 'adelaide', 2016);
    await season('retired-2017', 'retired', 'adelaide', 2017);
    await season('retired-2018', 'retired', 'adelaide', 2018);
    await season('retired-2019-withdrawn', 'retired', 'adelaide', 2019);
    // Drafted, never played.
    await arrival('unplayed', 'unplayed', 'richmond', '2024-11-20');
    // A non-current arrival and a superseded arrival.
    await arrival('withdrawn-arrival', 'withdrawn', 'carlton', '2020-11-18');
    await arrival('remade-v1', 'remade', 'carlton', '2020-11-18');
    await arrival('remade', 'remade', 'carlton', '2020-11-18', 2, 'remade-v1');
    await seeded.query('COMMIT');
  } catch (error) {
    await seeded.query('ROLLBACK');
    throw error;
  } finally {
    seeded.release();
  }
  await pool.query(
    `INSERT INTO stint_noncurrent VALUES ('retired-2019-withdrawn'),('withdrawn-arrival')`
  );
  const seasonOf = (id: string, year: number) => ({
    seasonYear: year,
    spellVersionId: id,
    firstAppearanceDate: `${year}-03-15`,
    lastAppearanceDate: `${year}-08-20`,
  });
  const arrivalOf = (id: string, date: string) => ({
    spellVersionId: id,
    schemaVersion: 'afl-trade-acquisition-registration/v4',
    date,
  });

  // Grundy at Melbourne: one season, closed by his first season at Sydney.
  await expect(stint('grundy', 'melbourne', 'grundy-mel')).resolves.toEqual({
    schemaVersion: 'afl-trade-acquisition-stint/v1',
    playerId: 'grundy',
    clubId: 'melbourne',
    arrival: arrivalOf('grundy-mel', '2022-10-12'),
    seasons: [seasonOf('grundy-mel-2023', 2023)],
    closingSeason: 2024,
    closedBy: {
      kind: 'season_spell_at_another_club',
      spellVersionId: 'grundy-syd-2024',
      date: '2024-03-15',
    },
    endDate: '2023-08-20',
    status: 'closed',
  });
  // Grundy at Sydney: still open, read to the latest registered season.
  await expect(stint('grundy', 'sydney', 'grundy-syd')).resolves.toMatchObject({
    seasons: [seasonOf('grundy-syd-2024', 2024), seasonOf('grundy-syd-2025', 2025)],
    closingSeason: null,
    closedBy: null,
    endDate: null,
    status: 'open',
  });
  // Gunston at Brisbane: one season, closed by Hawthorn 2024.
  await expect(stint('gunston', 'brisbane', 'gunston-bri')).resolves.toMatchObject({
    seasons: [seasonOf('gunston-bri-2023', 2023)],
    closingSeason: 2024,
    closedBy: { kind: 'season_spell_at_another_club', spellVersionId: 'gunston-haw-2024' },
    endDate: '2023-08-20',
    status: 'closed',
  });
  // Gunston's first Hawthorn stint closes at Brisbane 2023 and excludes the return stint.
  await expect(stint('gunston', 'hawthorn', 'gunston-haw')).resolves.toMatchObject({
    seasons: [seasonOf('gunston-haw-2021', 2021), seasonOf('gunston-haw-2022', 2022)],
    closingSeason: 2023,
    closedBy: { kind: 'season_spell_at_another_club', spellVersionId: 'gunston-bri-2023' },
    endDate: '2022-08-20',
    status: 'closed',
  });
  // The return is a separate stint from its own arrival.
  await expect(stint('gunston', 'hawthorn', 'gunston-haw-return')).resolves.toMatchObject({
    seasons: [seasonOf('gunston-haw-2024', 2024), seasonOf('gunston-haw-2025', 2025)],
    status: 'open',
  });
  // Redrafted by the same club: the first arrival is closed by the second and reads the re-made
  // (current) season window only.
  await expect(stint('redraft', 'geelong', 'redraft-first')).resolves.toMatchObject({
    seasons: [seasonOf('redraft-2020', 2020)],
    closingSeason: 2021,
    closedBy: {
      kind: 'later_arrival_at_same_club',
      spellVersionId: 'redraft-second',
      date: '2021-02-17',
    },
    endDate: '2020-08-20',
    status: 'closed',
  });
  await expect(stint('redraft', 'geelong', 'redraft-second')).resolves.toMatchObject({
    seasons: [seasonOf('redraft-2021', 2021), seasonOf('redraft-2022', 2022)],
    status: 'open',
  });
  // Retired: stays open; a non-current season spell is not read.
  await expect(stint('retired', 'adelaide', 'retired')).resolves.toMatchObject({
    seasons: [
      seasonOf('retired-2016', 2016),
      seasonOf('retired-2017', 2017),
      seasonOf('retired-2018', 2018),
    ],
    endDate: null,
    status: 'open',
  });
  // Drafted, never played.
  await expect(stint('unplayed', 'richmond', 'unplayed')).resolves.toMatchObject({
    seasons: [],
    closedBy: null,
    endDate: null,
    status: 'no_appearances',
  });
  // Only a current, unsuperseded reviewed arrival starts a stint.
  await expect(stint('withdrawn', 'carlton', 'withdrawn-arrival')).rejects.toThrow(
    'starts at a current reviewed arrival'
  );
  await expect(stint('remade', 'carlton', 'remade-v1')).rejects.toThrow(
    'starts at a current reviewed arrival'
  );
  await expect(stint('remade', 'carlton', 'remade')).resolves.toMatchObject({
    status: 'no_appearances',
  });
});
