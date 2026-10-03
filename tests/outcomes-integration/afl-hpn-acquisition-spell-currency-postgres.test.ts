import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeAppearanceMembershipSpellRule } from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { deriveAflTradeAppearanceMembershipSpells } from '@/server/aflTradeIntelligence/outcomes/appearanceMembershipSpellDerivation';
import { PostgresAflTradeAcquisitionSpellRegistrationRepository } from '@/server/aflTradeIntelligence/outcomes/postgresAcquisitionSpellRegistrationRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  installPre0236AppearanceCurrencyReference,
  PRE_0236_APPEARANCE_CURRENCY,
} from '../testUtils/pre0236AcquisitionCurrencyReference';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

// Migration 0236 makes appearance-membership (v3) currency sargable and lets HPN season input
// evaluate each spell's currency once instead of once per player-stat row. This suite seeds a
// season at a scale where the per-row cost is measurable (long club identity-assignment chains,
// many players and rounds) and proves that the deployed currency equals the original 0233
// definition in current and non-current states.
const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL database is required.');
const schemaName = `hpn_spell_currency_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const seasonYear = 2025;
const batchId = 'fact-batch:synthetic-2025';
const CLUBS = ['club:a', 'club:b'] as const;
const PLAYERS_PER_CLUB = 12;
const ROUNDS = 8;
// Same-target confirmations appended to each club's identity-assignment chain, so every
// represented-club continuity check walks a chain of this length, as on a genuine database.
const CLUB_CHAIN_CONFIRMATIONS = 600;
// A genuine season input binds each spell to one row per round per provider.
const ROWS_PER_SPELL = ROUNDS * 2;

const ruleBytes = new TextEncoder().encode(
  canonicalizeAflTradeJson({ syntheticHpnSpellCurrencyRule: true })
);
const evidence = createAflTradeCanonicalJsonArtifactRef(
  { syntheticHpnSpellCurrencyRule: true },
  '2026-09-01T00:00:00.000Z'
);
const rule = createAflTradeAppearanceMembershipSpellRule({
  environment: 'test_fixture',
  competition: 'AFLM',
  ruleVersion: 'synthetic-hpn-spell-currency-v1',
  evidence: [evidence],
  createdAt: '2026-09-02T00:00:00.000Z',
});
const execution = { environment: 'test_fixture' as const, competition: 'AFLM' as const };
const repository = new PostgresAflTradeAcquisitionSpellRegistrationRepository(
  createPgAflOutcomeSqlClient(pool),
  { read: async () => ruleBytes }
);
const player = (club: string, index: number) => `player:${club.slice(5)}:${index}`;
const roundDate = (round: number) =>
  new Date(Date.UTC(seasonYear, 2, 15 + round * 7, 8, 40)).toISOString();

async function inReplicaTransaction(work: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Reviewed factual and identity prerequisites are seeded directly; their owners are covered
    // by their own suites. Spells, rules and reviews below go through their database guards.
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

/** One current reviewed identity assignment (decision, resolution, head) per entity. */
async function seedIdentities(
  client: PoolClient,
  kind: 'player' | 'match' | 'club',
  targets: string[]
) {
  const table = `outcome_provider_${kind}_resolution`;
  const targetColumns =
    kind === 'player'
      ? 'identity_candidate_id,player_identity_id,player_id'
      : kind === 'match'
        ? 'match_candidate_id,match_identity_id,match_id'
        : 'occurrence_source,club_identity_id,club_id';
  const targetValues =
    kind === 'player'
      ? `'identity-candidate:'||target,'player-identity:'||target,target`
      : kind === 'match'
        ? `'match-candidate:'||target,'match-identity:'||target,target`
        : `'synthetic','club-identity:'||target,target`;
  const decision = `'identity-decision:${kind}:'||target`;
  const assignmentCase = `'provider-identity-assignment-case:'||encode(sha256(convert_to('${kind}:'||target,'UTF8')),'hex')`;
  await client.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     SELECT ${decision},'provider_resolution_case','case:${kind}:'||target,'approved',
       'Synthetic current identity','{}'::jsonb,'synthetic-reviewer','2026-07-01T00:00:00.000Z'
       FROM unnest($1::text[]) target`,
    [targets]
  );
  await client.query(
    `INSERT INTO ${table}
      (resolution_id,resolution_case_id,revision,outcome,assignment_case_id,assignment_entity_kind,
       assignment_identity_id,assignment_revision,assignment_status,decision_id,proposal_id,
       resolution_sha256,decided_at,effective_at,decision_json,${targetColumns})
     SELECT ${decision},'case:${kind}:'||target,1,'approved',${assignmentCase},'${kind}',
       '${kind}-identity:'||target,1,'active',${decision},'proposal:${kind}:'||target,
       encode(sha256(convert_to(${decision},'UTF8')),'hex'),'2026-07-01T00:00:00.000Z',
       '2026-07-01T00:00:00.000Z','{}'::jsonb,${targetValues}
       FROM unnest($1::text[]) target`,
    [targets]
  );
  await client.query(
    `INSERT INTO outcome_provider_identity_assignment_head
      (assignment_case_id,entity_kind,identity_id,revision,decision_id,status,updated_at)
     SELECT ${assignmentCase},'${kind}','${kind}-identity:'||target,1,${decision},'active',
       '2026-07-01T00:00:00.000Z' FROM unnest($1::text[]) target`,
    [targets]
  );
}

/** Appends same-target confirmations to a club's identity-assignment chain and advances its head. */
async function extendClubChain(client: PoolClient, club: string, confirmations: number) {
  const assignmentCase = `provider-identity-assignment-case:${sha256(`club:${club}`)}`;
  const decision = (revision: string) => `'synthetic-confirmation:${club}:'||${revision}`;
  await client.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     SELECT ${decision('(1+g)')},'provider_resolution_case','confirmation-case:${club}:'||g,
       'approved','Synthetic same-target confirmation','{}'::jsonb,'synthetic-reviewer',
       '2026-07-02T00:00:00.000Z' FROM generate_series(1,$1::integer) g`,
    [confirmations]
  );
  await client.query(
    `INSERT INTO outcome_provider_club_resolution
      (resolution_id,resolution_case_id,occurrence_source,revision,outcome,assignment_case_id,
       assignment_entity_kind,assignment_identity_id,assignment_revision,
       supersedes_assignment_decision_id,assignment_status,club_identity_id,club_id,decision_id,
       proposal_id,resolution_sha256,decided_at,effective_at,decision_json)
     SELECT ${decision('(1+g)')},'confirmation-case:${club}:'||g,'synthetic',1,'approved',$2,'club',
       'club-identity:${club}',1+g,
       CASE WHEN g=1 THEN 'identity-decision:club:${club}' ELSE ${decision('g')} END,
       'active','club-identity:${club}','${club}',${decision('(1+g)')},'proposal:confirmation:'||g,
       encode(sha256(convert_to(${decision('(1+g)')},'UTF8')),'hex'),'2026-07-02T00:00:00.000Z',
       '2026-07-02T00:00:00.000Z','{}'::jsonb FROM generate_series(1,$1::integer) g`,
    [confirmations, assignmentCase]
  );
  await client.query(
    `UPDATE outcome_provider_identity_assignment_head SET revision=1+$1::integer,
       decision_id='synthetic-confirmation:${club}:'||(1+$1::integer)
     WHERE assignment_case_id=$2`,
    [confirmations, assignmentCase]
  );
}

type SeededFact = {
  factId: string;
  player: string;
  club: string;
  match: string;
  at: string;
  recordedAt: string;
};

async function seedFacts(client: PoolClient, facts: readonly SeededFact[]) {
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
     SELECT fact."factId",$2,'run:synthetic','row:'||fact."factId",'candidate:'||fact."factId",
       'candidate:'||fact."factId",'candidate:'||fact."factId",
       'identity-decision:player:'||fact.player,'identity-decision:player:'||fact.player,
       'identity-decision:match:'||fact.match,'identity-decision:match:'||fact.match,
       'identity-decision:club:'||fact.club,'identity-decision:club:'||fact.club,
       'identity:'||fact.player,'match-identity:'||fact.match,'club-identity:'||fact.club,
       fact.player,fact.match,fact.club,'AFLM',$3,'measured',TRUE,NULL,fact.at,
       fact."recordedAt",encode(sha256(convert_to('candidate:'||fact."factId",'UTF8')),'hex'),
       jsonb_build_object('appearance',encode(sha256(convert_to('candidate:'||fact."factId",'UTF8')),'hex'),
         'identity','i','match','m'),
       encode(sha256(convert_to('fact:'||fact."factId",'UTF8')),'hex'),'{}'::jsonb
       FROM jsonb_to_recordset($1::jsonb) AS fact("factId" text,player text,club text,match text,
         at timestamptz,"recordedAt" timestamptz)`,
    [JSON.stringify(facts), batchId, seasonYear]
  );
}

async function currentSpells(): Promise<{ spellVersionId: string; playerId: string }[]> {
  const result = await pool.query<{ spell_version_id: string; player_id: string }>(
    `SELECT spell.spell_version_id,spell.player_id FROM outcome_acquisition_spell_version spell
      WHERE NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version successor
        WHERE successor.supersedes_spell_version_id=spell.spell_version_id)
      ORDER BY spell.spell_version_id`
  );
  return result.rows.map((row) => ({
    spellVersionId: row.spell_version_id,
    playerId: row.player_id,
  }));
}

/** Deployed and original (0233) currency for every spell, evaluated on the same snapshot. */
async function compareWithOriginal() {
  const result = await pool.query<{
    spell_version_id: string;
    player_id: string;
    deployed: boolean;
    original: boolean;
  }>(
    `SELECT spell.spell_version_id,spell.player_id,
            outcome_acquisition_spell_registration_current(spell.spell_version_id,clock_timestamp())
              AS deployed,
            ${PRE_0236_APPEARANCE_CURRENCY}(spell.spell_version_id,clock_timestamp()) AS original
       FROM outcome_acquisition_spell_version spell ORDER BY spell.spell_version_id`
  );
  for (const row of result.rows) expect(row.deployed).toBe(row.original);
  return new Map(result.rows.map((row) => [row.player_id, row.deployed]));
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  const players = CLUBS.flatMap((club) =>
    Array.from({ length: PLAYERS_PER_CLUB }, (_, index) => player(club, index))
  );
  const matches = Array.from({ length: ROUNDS + 1 }, (_, round) => `match:r${round + 1}`);
  await inReplicaTransaction(async (client) => {
    await client.query(
      `INSERT INTO outcome_club(club_id,current_name,status)
       SELECT club,club,'approved' FROM unnest($1::text[]) club`,
      [CLUBS]
    );
    await client.query(
      `INSERT INTO outcome_player(player_id,display_name,status)
       SELECT id,id,'approved' FROM unnest($1::text[]) id`,
      [players]
    );
    await client.query(
      `INSERT INTO outcome_competition_season(competition,season_year) VALUES ('AFLM',$1)`,
      [seasonYear]
    );
    // One extra round beyond the registered windows is used to break window completeness.
    for (const [index, match] of matches.entries()) {
      await client.query(
        `INSERT INTO outcome_match
          (match_id,competition,season_year,provider,native_match_id,round_label,match_date,
           home_club_id,away_club_id)
         VALUES ($1,'AFLM',$2,NULL,NULL,$1,$3,'club:a','club:b')`,
        [match, seasonYear, roundDate(index + 1)]
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
         0,0,0,0,0,0,0,0,'2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z',
         '2026-08-01T00:00:00.000Z','{}'::jsonb)`,
      [
        batchId,
        seasonYear,
        `provider-normalization-finalization:${finalization}`,
        finalization,
        sha256('x'),
      ]
    );
    await seedIdentities(client, 'player', players);
    await seedIdentities(client, 'match', matches);
    await seedIdentities(client, 'club', [...CLUBS]);
    await seedFacts(
      client,
      CLUBS.flatMap((club) =>
        Array.from({ length: PLAYERS_PER_CLUB }, (_, index) =>
          Array.from({ length: ROUNDS }, (_, round) => ({
            factId: `fact:${player(club, index)}:r${round + 1}`,
            player: player(club, index),
            club,
            match: `match:r${round + 1}`,
            at: roundDate(round + 1),
            recordedAt: '2026-08-01T00:00:00.000Z',
          }))
        ).flat()
      )
    );
  });
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
    VALUES ('spell-currency-rule-approval','acquisition_spell_rule',$1,'approved',
      'Owner-approved appearance membership rule',$2::jsonb,'synthetic-reviewer',
      '2026-09-03T00:00:00.000Z')`,
    [rule.ruleId, canonicalizeAflTradeJson(rule)]
  );
  await repository.registerReviewedRule(rule, 'spell-currency-rule-approval', execution);
  const facts = await pool.query<{
    appearance_fact_id: string;
    player_id: string;
    represented_club_id: string;
    match_id: string;
    effective_at: Date;
  }>(
    `SELECT appearance_fact_id,player_id,represented_club_id,match_id,effective_at
       FROM outcome_provider_player_appearance_fact`
  );
  const createdAt = (
    await pool.query<{ at: Date }>(`SELECT date_trunc('milliseconds',clock_timestamp()) AS at`)
  ).rows[0]!.at.toISOString();
  const proposals = deriveAflTradeAppearanceMembershipSpells({
    ...execution,
    seasonYear,
    ruleId: rule.ruleId,
    createdAt,
    facts: facts.rows.map((fact) => ({
      appearanceFactId: fact.appearance_fact_id,
      playerId: fact.player_id,
      clubId: fact.represented_club_id,
      matchId: fact.match_id,
      competition: 'AFLM' as const,
      seasonYear,
      effectiveAt: fact.effective_at.toISOString(),
      availability: 'measured' as const,
      appeared: true,
    })),
  });
  expect(proposals).toHaveLength(CLUBS.length * PLAYERS_PER_CLUB);
  for (const [index, proposal] of proposals.entries()) {
    const decisionId = `spell-currency-approval-${index}`;
    await pool.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'acquisition_spell_registration',$2,'approved','Rule-bound appearance membership',
         $3::jsonb,'synthetic-reviewer',date_trunc('milliseconds',clock_timestamp()))`,
      [decisionId, proposal.spellVersionId, canonicalizeAflTradeJson(proposal)]
    );
    await repository.registerReviewedSpell(proposal, decisionId, execution);
  }
  await inReplicaTransaction(async (client) => {
    for (const club of CLUBS) await extendClubChain(client, club, CLUB_CHAIN_CONFIRMATIONS);
  });
  await pool.query('ANALYZE');
  await installPre0236AppearanceCurrencyReference(pool);
}, 300_000);

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  await admin.end();
});

it('costs one spell-currency derivation per spell instead of one per player-stat row', async () => {
  const spells = await currentSpells();
  expect(spells).toHaveLength(CLUBS.length * PLAYERS_PER_CLUB);
  const sample = spells.slice(0, 4).map(({ spellVersionId }) => spellVersionId);
  const rows = sample.length * ROWS_PER_SPELL;
  const timed = async (sql: string, values: unknown[]) => {
    const started = performance.now();
    const result = await pool.query<{ current: number }>(sql, values);
    return { current: result.rows[0]!.current, milliseconds: performance.now() - started };
  };
  // Before 0236: the per-row HPN check re-derived the original (0233) currency for every row.
  const original = await timed(
    `SELECT count(*) FILTER (WHERE ${PRE_0236_APPEARANCE_CURRENCY}(spell,clock_timestamp()))::integer
       AS current FROM unnest($1::text[]) spell CROSS JOIN generate_series(1,$2::integer)`,
    [sample, ROWS_PER_SPELL]
  );
  // 0236 per-row callers: the same number of derivations, each sargable.
  const perRow = await timed(
    `SELECT count(*) FILTER (WHERE outcome_acquisition_spell_registration_current(spell,
       clock_timestamp()))::integer AS current
       FROM unnest($1::text[]) spell CROSS JOIN generate_series(1,$2::integer)`,
    [sample, ROWS_PER_SPELL]
  );
  // 0236 season input build and finalization: one derivation per spell.
  const perSpell = await timed(
    `SELECT count(*) FILTER (WHERE outcome_acquisition_spell_registration_current(spell,
       clock_timestamp()))::integer AS current FROM unnest($1::text[]) spell`,
    [sample]
  );
  expect(original.current).toBe(rows);
  expect(perRow.current).toBe(rows);
  expect(perSpell.current).toBe(sample.length);
  const perRowCost = (milliseconds: number) => Math.round((milliseconds / rows) * 100) / 100;
  console.info(
    `HPN acquisition-spell currency per player-stat row (${rows} rows, ${sample.length} spells, ` +
      `${CLUB_CHAIN_CONFIRMATIONS + 1}-revision club chains): original ` +
      `${perRowCost(original.milliseconds)} ms, sargable per-row ${perRowCost(perRow.milliseconds)} ms, ` +
      `per-spell ${perRowCost(perSpell.milliseconds)} ms`
  );
  // The sargable gain depends on the plan the original anti-joins receive (it is largest with many
  // reviewed entry spells and facts), so only the per-spell bound is asserted here.
  expect(perSpell.milliseconds * 5).toBeLessThan(original.milliseconds);
}, 300_000);

it('keeps every appearance-membership currency result identical to the original definition', async () => {
  const initial = await compareWithOriginal();
  expect([...initial.values()].every(Boolean)).toBe(true);

  // A withdrawn player-identity decision withdraws that player's boundary appearances.
  const withdrawn = player('club:a', 1);
  await inReplicaTransaction(async (client) => {
    await client.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,
         evidence_json,decided_by,decided_at)
       VALUES ($1,'provider_resolution_case',$2,'rejected',$3,'Synthetic identity withdrawal',
         '{}'::jsonb,'synthetic-reviewer',date_trunc('milliseconds',clock_timestamp()))`,
      [
        `identity-decision:player:${withdrawn}:withdrawn`,
        `case:player:${withdrawn}`,
        `identity-decision:player:${withdrawn}`,
      ]
    );
  });
  // A reviewed appearance recorded before registration but outside the window breaks completeness.
  const incomplete = player('club:b', 2);
  await inReplicaTransaction(async (client) => {
    await seedFacts(client, [
      {
        factId: `fact:${incomplete}:r${ROUNDS + 1}`,
        player: incomplete,
        club: 'club:b',
        match: `match:r${ROUNDS + 1}`,
        at: roundDate(ROUNDS + 1),
        recordedAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });
  const changed = await compareWithOriginal();
  expect(changed.get(withdrawn)).toBe(false);
  expect(changed.get(incomplete)).toBe(false);
  expect(changed.get(player('club:a', 0))).toBe(true);
  expect(changed.get(player('club:b', 0))).toBe(true);

  // A superseded club-chain link breaks continuity for every appearance of that club.
  await inReplicaTransaction(async (client) => {
    await client.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,supersedes_decision_id,rationale,
         evidence_json,decided_by,decided_at)
       VALUES ('synthetic-confirmation:club:a:withdrawn','provider_resolution_case',
         'confirmation-case:club:a:3','rejected','synthetic-confirmation:club:a:4',
         'Synthetic link withdrawal','{}'::jsonb,'synthetic-reviewer',
         date_trunc('milliseconds',clock_timestamp()))`
    );
  });
  const brokenClub = await compareWithOriginal();
  for (const [playerId, current] of brokenClub) {
    expect(current).toBe(playerId.startsWith('player:b:') && playerId !== incomplete);
  }
}, 300_000);
