import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeAppearanceMembershipSpell,
  createAflTradeAppearanceMembershipSpellRule,
  type AflTradeAcquisitionSpellRegistration,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { deriveAflTradeAppearanceMembershipSpells } from '@/server/aflTradeIntelligence/outcomes/appearanceMembershipSpellDerivation';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');
const schemaName = `appearance_membership_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const ruleBytes = new TextEncoder().encode(
  canonicalizeAflTradeJson({ syntheticAppearanceMembershipRule: true })
);
const evidence = createAflTradeCanonicalJsonArtifactRef(
  { syntheticAppearanceMembershipRule: true },
  '2026-09-01T00:00:00.000Z'
);
const rule = createAflTradeAppearanceMembershipSpellRule({
  environment: 'test_fixture',
  competition: 'AFLM',
  ruleVersion: 'synthetic-appearance-membership-v1',
  evidence: [evidence],
  createdAt: '2026-09-02T00:00:00.000Z',
});
const execution = { environment: 'test_fixture' as const, competition: 'AFLM' as const };
const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
  createPgAflOutcomeSqlClient(pool),
  { read: async () => ruleBytes }
);
const seasonYear = 2021;
const batchId = 'fact-batch:synthetic-2021';
// Player one appears for club A in rounds 1, 2 and 3; player two for club B in round 2 only;
// player three is named for club A in round 3 but did not appear.
const appearances = [
  {
    factId: 'fact:p1:r1',
    player: 'player:one',
    club: 'club:a',
    match: 'match:r1',
    at: '2021-03-20T08:40:00.000Z',
    appeared: true,
  },
  {
    factId: 'fact:p1:r2',
    player: 'player:one',
    club: 'club:a',
    match: 'match:r2',
    at: '2021-03-27T09:30:00.000Z',
    appeared: true,
  },
  {
    factId: 'fact:p1:r3',
    player: 'player:one',
    club: 'club:a',
    match: 'match:r3',
    at: '2021-04-03T04:10:00.000Z',
    appeared: true,
  },
  {
    factId: 'fact:p2:r2',
    player: 'player:two',
    club: 'club:b',
    match: 'match:r2',
    at: '2021-03-27T09:30:00.000Z',
    appeared: true,
  },
  {
    factId: 'fact:p3:r3',
    player: 'player:three',
    club: 'club:a',
    match: 'match:r3',
    at: '2021-04-03T04:10:00.000Z',
    appeared: false,
  },
];

async function approveSpell(spell: AflTradeAcquisitionSpellRegistration, decisionId: string) {
  await pool.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,'acquisition_spell_registration',$2,'approved',
       'Rule-bound appearance membership',$3::jsonb,'synthetic-reviewer',
       date_trunc('milliseconds',clock_timestamp()))`,
    [decisionId, spell.spellVersionId, canonicalizeAflTradeJson(spell)]
  );
}

async function proposalTime(): Promise<string> {
  const result = await pool.query<{ instant: Date }>(
    `SELECT date_trunc('milliseconds',clock_timestamp()) AS instant`
  );
  return result.rows[0]!.instant.toISOString();
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Seed reviewed factual prerequisites directly; their own owners are covered elsewhere.
    await client.query(`SET LOCAL session_replication_role='replica'`);
    await client.query(
      `INSERT INTO outcome_club(club_id,current_name,status)
       VALUES ('club:a','Club A','approved'),('club:b','Club B','approved')`
    );
    await client.query(
      `INSERT INTO outcome_player(player_id,display_name,status)
       VALUES ('player:one','One','approved'),('player:two','Two','approved'),
              ('player:three','Three','approved')`
    );
    await client.query(
      `INSERT INTO outcome_competition_season(competition,season_year) VALUES ('AFLM',$1)`,
      [seasonYear]
    );
    for (const [round, at] of [
      ['r1', '2021-03-20T08:40:00.000Z'],
      ['r2', '2021-03-27T09:30:00.000Z'],
      ['r3', '2021-04-03T04:10:00.000Z'],
    ] as const) {
      await client.query(
        `INSERT INTO outcome_match
          (match_id,competition,season_year,provider,native_match_id,round_label,match_date,
           home_club_id,away_club_id)
         VALUES ($1,'AFLM',$2,NULL,NULL,$3,$4,'club:a','club:b')`,
        [`match:${round}`, seasonYear, round, at]
      );
    }
    const finalization = sha256('finalization');
    await client.query(
      `INSERT INTO outcome_provider_fact_batch
        (fact_batch_id,normalization_run_id,capture_id,environment,provider,capability_id,
         competition,season_year,extractor_version,normalization_finalization_id,
         normalization_finalization_sha256,normalization_finalized_at,source_staging_sha256,
         source_row_set_sha256,source_issue_set_sha256,fact_batch_sha256,status,
         source_row_count,match_fact_count,appearance_fact_count,metric_fact_count,
         achievement_fact_count,issue_count,normalized_row_count,non_normalized_row_count,
         started_at,completed_at,finalized_at,receipt_json)
       VALUES ($1,'run:synthetic','capture:synthetic','test_fixture','afl_tables','player-stats',
         'AFLM',$2,'synthetic-v1',$3,$4,'2026-08-01T00:00:00.000Z',$5,$5,$5,$5,'approved',
         5,3,5,0,0,0,5,0,'2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z',
         '2026-08-01T00:00:00.000Z','{}'::jsonb)`,
      [
        batchId,
        seasonYear,
        `provider-normalization-finalization:${finalization}`,
        finalization,
        sha256('x'),
      ]
    );
    for (const [index, item] of appearances.entries()) {
      const candidate = sha256(`candidate:${item.factId}`);
      await client.query(
        `INSERT INTO outcome_provider_player_appearance_fact
          (appearance_fact_id,fact_batch_id,normalization_run_id,provider_decoded_row_id,
           appearance_candidate_id,identity_candidate_id,match_candidate_id,
           player_resolution_decision_id,player_assignment_decision_id,
           match_resolution_decision_id,match_assignment_decision_id,
           represented_club_resolution_decision_id,represented_club_assignment_decision_id,
           player_identity_id,match_identity_id,represented_club_identity_id,player_id,match_id,
           represented_club_id,competition,season_year,availability,appeared,reason_code,
           effective_at,recorded_at,candidate_sha256,candidate_digests_json,fact_sha256,fact_json)
         VALUES ($1,$2,'run:synthetic',$3,$4,$4,$4,'d','d','d','d','d','d',$5,$6,$7,$8,$9,$10,
           'AFLM',$11,'measured',$12,NULL,$13,'2026-08-01T00:00:00.000Z',$14::text,
           jsonb_build_object('appearance',$14::text,'identity','i','match','m'),$15::text,'{}'::jsonb)`,
        [
          item.factId,
          batchId,
          `row:${index}`,
          `candidate:${item.factId}`,
          `identity:${item.player}`,
          `match-identity:${item.match}`,
          `club-identity:${item.club}`,
          item.player,
          item.match,
          item.club,
          seasonYear,
          item.appeared,
          item.at,
          candidate,
          sha256(`fact:${item.factId}`),
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await pool.query(
    `INSERT INTO outcome_artifact_custody
    (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
     environment,created_at,verified_at,custody_json)
    VALUES ($1,$2,$3,$4,$5,'derived_private','test_fixture',$6,$6,'{}')`,
    [
      evidence.artifactId,
      evidence.contentSha256,
      evidence.storageUri,
      evidence.mediaType,
      evidence.byteLength,
      evidence.createdAt,
    ]
  );
  await pool.query(
    `INSERT INTO outcome_review_decision
    (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
    VALUES ('appearance-rule-approval','acquisition_spell_rule',$1,'approved',
      'Owner-approved appearance membership rule',$2::jsonb,'synthetic-reviewer',
      '2026-09-03T00:00:00.000Z')`,
    [rule.ruleId, canonicalizeAflTradeJson(rule)]
  );
  await repository.registerReviewedRule(rule, 'appearance-rule-approval', execution);
}, 120_000);

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  await admin.end();
});

function derived(createdAt: string) {
  return deriveAflTradeAppearanceMembershipSpells({
    ...execution,
    seasonYear,
    ruleId: rule.ruleId,
    createdAt,
    facts: appearances.map((item) => ({
      appearanceFactId: item.factId,
      playerId: item.player,
      clubId: item.club,
      matchId: item.match,
      competition: 'AFLM' as const,
      seasonYear,
      effectiveAt: item.at,
      availability: 'measured' as const,
      appeared: item.appeared,
    })),
  });
}

// Runs before any window exists for player one, so only the completeness guard can reject it.
it('rejects a window that omits a reviewed appearance for the same player, club and season', async () => {
  const spell = createAflTradeAppearanceMembershipSpell({
    ...execution,
    playerId: 'player:one',
    clubId: 'club:a',
    seasonYear,
    firstAppearance: { appearanceFactId: 'fact:p1:r2', matchId: 'match:r2', date: '2021-03-27' },
    lastAppearance: { appearanceFactId: 'fact:p1:r3', matchId: 'match:r3', date: '2021-04-03' },
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    createdAt: await proposalTime(),
  });
  await approveSpell(spell, 'truncated-window-approval');
  await expect(
    repository.registerReviewedSpell(spell, 'truncated-window-approval', execution)
  ).rejects.toThrow('exact current review');
});

it('derives and registers one appearance window per player and club, then reloads it exactly', async () => {
  const spells = derived(await proposalTime());
  expect(spells.map((spell) => spell.content)).toMatchObject([
    {
      playerId: 'player:one',
      clubId: 'club:a',
      firstAppearance: { appearanceFactId: 'fact:p1:r1', date: '2021-03-20' },
      lastAppearance: { appearanceFactId: 'fact:p1:r3', date: '2021-04-03' },
    },
    { playerId: 'player:two', clubId: 'club:b' },
  ]);
  for (const [index, spell] of spells.entries()) {
    await approveSpell(spell, `appearance-spell-approval-${index}`);
    await expect(
      repository.registerReviewedSpell(spell, `appearance-spell-approval-${index}`, execution)
    ).resolves.toEqual(spell);
  }
  await expect(repository.loadCurrentExact(spells[0]!.spellVersionId, execution)).resolves.toEqual(
    spells[0]
  );
  const stored = await pool.query(
    `SELECT start_event_version_id,start_asset_version_id,start_date::text,end_date::text,end_reason,
            outcome_acquisition_is_appearance_membership(spell_version_id) AS appearance
       FROM outcome_acquisition_spell_version WHERE spell_version_id=$1`,
    [spells[0]!.spellVersionId]
  );
  expect(stored.rows[0]).toEqual({
    start_event_version_id: null,
    start_asset_version_id: null,
    start_date: '2021-03-20',
    end_date: '2021-04-03',
    end_reason: 'last_reviewed_appearance_in_season',
    appearance: true,
  });
});

it('rejects a boundary that is not a measured appearance for that player and club', async () => {
  const notAppeared = createAflTradeAppearanceMembershipSpell({
    ...execution,
    playerId: 'player:three',
    clubId: 'club:a',
    seasonYear,
    firstAppearance: { appearanceFactId: 'fact:p3:r3', matchId: 'match:r3', date: '2021-04-03' },
    lastAppearance: { appearanceFactId: 'fact:p3:r3', matchId: 'match:r3', date: '2021-04-03' },
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    createdAt: await proposalTime(),
  });
  await approveSpell(notAppeared, 'not-appeared-approval');
  await expect(
    repository.registerReviewedSpell(notAppeared, 'not-appeared-approval', execution)
  ).rejects.toThrow('exact current review');
  const wrongClub = createAflTradeAppearanceMembershipSpell({
    ...execution,
    playerId: 'player:two',
    clubId: 'club:a',
    seasonYear,
    firstAppearance: { appearanceFactId: 'fact:p2:r2', matchId: 'match:r2', date: '2021-03-27' },
    lastAppearance: { appearanceFactId: 'fact:p2:r2', matchId: 'match:r2', date: '2021-03-27' },
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    createdAt: await proposalTime(),
  });
  await approveSpell(wrongClub, 'wrong-club-approval');
  await expect(
    repository.registerReviewedSpell(wrongClub, 'wrong-club-approval', execution)
  ).rejects.toThrow('exact current review');
});

it('keeps appearance membership out of every trade-attribution consumer', async () => {
  const spell = await pool.query<{ spell_version_id: string }>(
    `SELECT spell_version_id FROM outcome_acquisition_spell_version
      WHERE player_id='player:one' AND club_id='club:a'`
  );
  const spellVersionId = spell.rows[0]!.spell_version_id;
  for (const table of [
    'outcome_acquisition_spell_metric',
    'outcome_release_acquisition_spell',
    'outcome_player_pav_observation',
  ]) {
    await expect(
      pool.query(`INSERT INTO ${table} (spell_version_id) VALUES ($1)`, [spellVersionId])
    ).rejects.toThrow('limited to HPN season PAV attribution');
  }
  await expect(
    pool.query(
      `INSERT INTO outcome_valuation_dataset_row (acquisition_spell_version_id) VALUES ($1)`,
      [spellVersionId]
    )
  ).rejects.toThrow('limited to HPN season PAV attribution');
  // HPN season PAV calculation is the one permitted consumer: the appearance guard does not fire,
  // so the insert fails only on the table's own required columns.
  const calculation = pool.query(
    `INSERT INTO outcome_hpn_pav_calculation_player (spell_version_id) VALUES ($1)`,
    [spellVersionId]
  );
  await expect(calculation).rejects.toThrow();
  await expect(calculation).rejects.not.toThrow('limited to HPN season PAV attribution');
});

it('treats an existing appearance window as current membership for its player and club', async () => {
  const overlapping = createAflTradeAppearanceMembershipSpell({
    ...execution,
    playerId: 'player:one',
    clubId: 'club:a',
    seasonYear,
    firstAppearance: { appearanceFactId: 'fact:p1:r1', matchId: 'match:r1', date: '2021-03-20' },
    lastAppearance: { appearanceFactId: 'fact:p1:r3', matchId: 'match:r3', date: '2021-04-03' },
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    createdAt: await proposalTime(),
  });
  await approveSpell(overlapping, 'overlapping-window-approval');
  await expect(
    repository.registerReviewedSpell(overlapping, 'overlapping-window-approval', execution)
  ).rejects.toThrow('cannot overlap');
});
