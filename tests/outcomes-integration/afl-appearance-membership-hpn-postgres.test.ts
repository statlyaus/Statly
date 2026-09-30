import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAflTradeAcquisitionSpellRegistration,
  createAflTradeAcquisitionSpellRegistrationRule,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createSyntheticAcquisitionPlayerPromotion } from '../testUtils/acquisitionPlayerPromotionFixture';
import { buildAppearanceMembershipHpnInputFixture } from '../testUtils/appearanceMembershipHpnInputFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
import {
  installPre0236AppearanceCurrencyReference,
  PRE_0236_APPEARANCE_CURRENCY,
} from '../testUtils/pre0236AcquisitionCurrencyReference';

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
let artifactRoot: string;
beforeAll(async () => {
  artifactRoot = await mkdtemp(join(tmpdir(), 'postseason-measured-'));
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await installPre0236AppearanceCurrencyReference(pool);
});
afterAll(async () => {
  await rm(artifactRoot, { recursive: true, force: true });
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});
// Every candidate (row, spell) pair of an input set, evaluated three ways on one snapshot: the per-row
// function, the 0236 set-based form the build and finalization use (registration currency once per
// spell), and, for appearance-membership spells, the original 0233 registration currency.
const compareSpellCurrency = async (inputSetId: string) => {
  const result = await pool.query<{
    spell_version_id: string;
    per_row: boolean;
    set_based: boolean;
    deployed_registration: boolean;
    original_registration: boolean | null;
  }>(
    `WITH requested AS MATERIALIZED (
       SELECT row.provider_decoded_row_id,row.normalization_run_id,run.projected_field_map_id,
              match.effective_at::DATE AS effective_date,
              row.row_json#>>'{player,canonicalId}' AS player_id,
              row.row_json#>>'{club,canonicalId}' AS club_id
         FROM outcome_hpn_pav_input_row row
         JOIN outcome_hpn_pav_input_run run
           ON run.input_set_id=row.input_set_id AND run.normalization_run_id=row.normalization_run_id
         JOIN outcome_hpn_pav_input_match match
           ON match.input_set_id=row.input_set_id
          AND match.match_id=row.row_json#>>'{match,canonicalId}'
        WHERE row.input_set_id=$1 AND row.row_kind='player_match_stats'
     ), registered AS MATERIALIZED (
       SELECT candidate.spell_version_id,
              outcome_acquisition_spell_registration_current(candidate.spell_version_id,
                clock_timestamp()) AS current
         FROM (SELECT DISTINCT spell.spell_version_id FROM requested
                 JOIN outcome_acquisition_spell_version spell
                   ON spell.player_id=requested.player_id AND spell.club_id=requested.club_id
              ) candidate
     )
     SELECT spell.spell_version_id,
            outcome_hpn_acquisition_spell_is_current(spell.spell_version_id,
              requested.provider_decoded_row_id,requested.normalization_run_id,
              requested.projected_field_map_id,requested.effective_date,clock_timestamp()) AS per_row,
            outcome_hpn_acquisition_spell_source_current(spell.spell_version_id,
              requested.provider_decoded_row_id,requested.normalization_run_id,
              requested.projected_field_map_id,requested.effective_date,registered.current)
              AS set_based,
            registered.current AS deployed_registration,
            CASE WHEN spell.registration_canonical_json::JSONB->>'schemaVersion'
                   ='afl-trade-acquisition-registration/v3'
              THEN ${PRE_0236_APPEARANCE_CURRENCY}(spell.spell_version_id,clock_timestamp())
            END AS original_registration
       FROM requested
       JOIN outcome_acquisition_spell_version spell
         ON spell.player_id=requested.player_id AND spell.club_id=requested.club_id
       JOIN registered ON registered.spell_version_id=spell.spell_version_id
      ORDER BY requested.provider_decoded_row_id,spell.spell_version_id`,
    [inputSetId]
  );
  for (const pair of result.rows) {
    expect(pair.set_based).toBe(pair.per_row);
    if (pair.original_registration !== null) {
      expect(pair.deployed_registration).toBe(pair.original_registration);
    }
  }
  return result.rows;
};
const instant = async () => {
  await new Promise((resolve) => setTimeout(resolve, 3));
  return (
    await pool.query<{ at: string }>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    )
  ).rows[0]!.at;
};

// Synthetic upstream bytes and reviews; all source, identity, factual, projection, appearance
// membership and HPN owners execute without replacing database guards. No player has a promoted
// entry event: season PAV is attributed through appearance-membership (v3) spells only.
it('builds, calculates and reloads season HPN PAV attributed through appearance-membership spells', async () => {
  const { approve, built, calculations, proposals, repository, request, scope } =
    await buildAppearanceMembershipHpnInputFixture({ pool, client, instant });
  expect(built.idempotentReplay).toBe(false);
  const players = built.inputSet.content.rows.filter((row) => row.kind === 'player_match_stats');
  expect(players).toHaveLength(4);
  const spellFor = new Map(proposals.map((proposal) => [proposal.content.playerId, proposal]));
  const bound = await compareSpellCurrency(built.inputSet.inputSetId);
  expect(bound).toHaveLength(players.length);
  expect(bound.every((pair) => pair.per_row && pair.set_based)).toBe(true);
  for (const row of players) {
    const expected = spellFor.get(row.player.canonicalId)!;
    expect(row.acquisitionSpell).toMatchObject({
      spellVersionId: expected.spellVersionId,
      startEventVersionId: null,
      startAssetVersionId: null,
      endReason: 'last_reviewed_appearance_in_season',
    });
  }
  const read = {
    ...scope,
    seasonYear: 2026,
    methodId: request.methodId,
    inputSetId: built.inputSet.inputSetId,
  };
  await expect(repository.loadCurrentFinalizedSeasonInputSet(read, scope)).resolves.toEqual(
    built.inputSet
  );
  await expect(repository.buildAndPersistSeasonInputSet(request, scope)).resolves.toEqual({
    inputSet: built.inputSet,
    idempotentReplay: true,
  });
  const finalized = await calculations.calculateAndPersist(read, scope);
  expect(finalized.calculation.content.valueUnit).toBe('season_pav');
  expect(
    finalized.calculation.content.players.map((player) => player.spellVersionId).sort()
  ).toEqual(proposals.map((proposal) => proposal.spellVersionId).sort());
  const persisted = await pool.query<{ players: number }>(
    'SELECT count(*)::integer AS players FROM outcome_hpn_pav_calculation_player WHERE calculation_id=$1',
    [finalized.calculation.calculationId]
  );
  expect(persisted.rows[0]!.players).toBe(proposals.length);
  // The same appearance-membership spells stay unusable for trade-attribution consumers.
  await expect(
    pool.query(`INSERT INTO outcome_player_pav_observation (spell_version_id) VALUES ($1)`, [
      proposals[0]!.spellVersionId,
    ])
  ).rejects.toThrow('limited to HPN season PAV attribution');

  // Retirement: a reviewed entry spell covering the home player's window is admitted over the
  // current appearance-membership spell and makes it non-current, with no manual supersession.
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
  const reviewedSpells = new PostgresAflTradeAcquisitionSpellRegistrationRepository(client, {
    read: async (reference) => {
      const artifact = promoted.retainedArtifacts.get(reference.artifactId);
      if (!artifact) throw new Error('Missing exact retained fixture artifact.');
      return artifact.bytes;
    },
  });
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
  const currentness = async (spellVersionId: string) =>
    (
      await pool.query<{ current: boolean }>(
        'SELECT outcome_acquisition_spell_registration_current($1,clock_timestamp()) AS current',
        [spellVersionId]
      )
    ).rows[0]!.current;
  const homeWindow = spellFor.get('afl-player:local-rehearsal')!;
  const awayWindow = spellFor.get('afl-player:local-rehearsal-away')!;
  expect(await currentness(reviewedSpell.spellVersionId)).toBe(true);
  expect(await currentness(homeWindow.spellVersionId)).toBe(false);
  expect(await currentness(awayWindow.spellVersionId)).toBe(true);
  // The retained input bound to the retired window now fails current-authority reads; the logical
  // input scope is immutable, so a successor calculation belongs to a new scope, not this test.
  await expect(repository.loadCurrentFinalizedSeasonInputSet(read, scope)).rejects.toThrow();
  const retired = await compareSpellCurrency(built.inputSet.inputSetId);
  const pairsFor = (rows: typeof retired, spellVersionId: string) =>
    rows.filter((pair) => pair.spell_version_id === spellVersionId);
  expect(pairsFor(retired, homeWindow.spellVersionId).every((pair) => !pair.per_row)).toBe(true);
  expect(pairsFor(retired, awayWindow.spellVersionId).every((pair) => pair.per_row)).toBe(true);

  // A withdrawn player-identity decision withdraws the away window's boundary appearance. The
  // provider-resolution review owner is covered elsewhere; seed the successor review directly.
  const awayFact = await pool.query<{ decision_id: string; subject_id: string }>(
    `SELECT review.decision_id,review.subject_id
       FROM outcome_provider_player_appearance_fact fact
       JOIN outcome_review_decision review
         ON review.decision_id=fact.player_assignment_decision_id
      WHERE fact.player_id='afl-player:local-rehearsal-away' LIMIT 1`
  );
  const withdrawal = await pool.connect();
  try {
    await withdrawal.query('BEGIN');
    await withdrawal.query(`SET LOCAL session_replication_role='replica'`);
    await withdrawal.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,
         evidence_json,decided_by,decided_at)
       VALUES ($1,'provider_resolution_case',$2,'rejected',$3,'Synthetic identity withdrawal',
         '{}'::jsonb,'synthetic-reviewer',date_trunc('milliseconds',clock_timestamp()))`,
      [
        `${awayFact.rows[0]!.decision_id}:withdrawn`,
        awayFact.rows[0]!.subject_id,
        awayFact.rows[0]!.decision_id,
      ]
    );
    await withdrawal.query('COMMIT');
  } catch (error) {
    await withdrawal.query('ROLLBACK');
    throw error;
  } finally {
    withdrawal.release();
  }
  const withdrawn = await compareSpellCurrency(built.inputSet.inputSetId);
  expect(pairsFor(withdrawn, awayWindow.spellVersionId).every((pair) => !pair.per_row)).toBe(true);
  expect(pairsFor(withdrawn, reviewedSpell.spellVersionId)).toEqual(
    pairsFor(retired, reviewedSpell.spellVersionId)
  );
});
