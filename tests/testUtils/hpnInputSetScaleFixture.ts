import { Pool, type PoolClient } from 'pg';

/**
 * Inflates one genuinely built and finalized HPN PAV season input set into a second, still
 * `building`, input set of genuine-season scale.
 *
 * The source input set supplies every real run, projected field map, capture, factual run, method,
 * decoded typed payload and acquisition-spell rule. Each synthetic completed match clones the
 * source's result row, and each synthetic player clones the source's player row for the same
 * provider role and match side, so every set-based finalization check (factual universe,
 * decoded-row conservation, typed-payload projection, provider candidates, completed-match and
 * corroborated membership) compares real reviewed bytes. Synthetic players, clubs, matches,
 * decoded rows, candidates, facts and appearance-membership spells are seeded directly; their
 * owners are covered by their own suites.
 *
 * The defaults approximate a genuine AFLM season: 216 completed matches with 23 players per side
 * from two providers, about 20,000 player-stat rows.
 */
export async function inflateHpnInputSetToSeasonScale(
  client: PoolClient,
  sourceInputSetId: string,
  {
    label,
    matches = 216,
    playersPerSide = 23,
  }: { label: string; matches?: number; playersPerSide?: number }
): Promise<string> {
  // Runs inside the caller's transaction: a caller that rolls back leaves no synthetic decoded
  // rows or facts in the shared source runs and factual universe.
  await client.query(`SET LOCAL session_replication_role='replica'`);
  await client.query(
    `CREATE TEMP TABLE scale_parameter ON COMMIT DROP AS
       SELECT $1::TEXT AS source_input_set_id,$2::TEXT AS label,$3::INTEGER AS matches,
              $4::INTEGER AS players_per_side`,
    [sourceInputSetId, label, matches, playersPerSide]
  );
  // Each statement is separate so no single statement holds more than one season-sized value.
  for (const statement of INFLATE_STATEMENTS) await client.query(statement);
  const result = await client.query<{ input_set_id: string }>(
    'SELECT input_set_id FROM scale_input_set'
  );
  for (const table of SCALE_TEMP_TABLES) await client.query(`DROP TABLE ${table}`);
  await client.query(`SET LOCAL session_replication_role='origin'`);
  return result.rows[0]!.input_set_id;
}

/**
 * Per-row identity and acquisition-spell currency is derived by functions owned and covered by
 * their own suites (the latter measured by the 0236 spell-currency suite). A scale measurement of
 * the finalization's own set-based statements replaces them, inside its rolled-back transaction,
 * with constant functions of identical signatures: every resolution is current and a spell's
 * source currency is its supplied registration currency.
 */
const STUBBED_ROW_AUTHORITIES: Record<string, string> = {
  outcome_hpn_pav_player_resolution_current: 'SELECT TRUE',
  outcome_hpn_pav_match_resolution_current: 'SELECT TRUE',
  outcome_hpn_pav_club_resolution_current: 'SELECT TRUE',
  // 0242: the finalizer's per-row checks take their assignment continuity as an argument.
  outcome_hpn_pav_player_resolution_current_with_assignment: 'SELECT TRUE',
  outcome_hpn_pav_match_resolution_current_with_assignment: 'SELECT TRUE',
  outcome_hpn_pav_club_resolution_current_with_assignment: 'SELECT TRUE',
  outcome_acquisition_spell_registration_current: 'SELECT TRUE',
  outcome_hpn_acquisition_spell_source_current: 'SELECT $6',
};

export async function stubHpnRowAuthorities(client: PoolClient): Promise<void> {
  const deployed = await client.query<{ name: string; arguments: string }>(
    `SELECT proname AS name,pg_get_function_arguments(oid) AS arguments FROM pg_proc
      WHERE pronamespace=current_schema()::regnamespace AND proname=ANY($1::text[])`,
    [Object.keys(STUBBED_ROW_AUTHORITIES)]
  );
  if (deployed.rows.length !== Object.keys(STUBBED_ROW_AUTHORITIES).length)
    throw new Error('Expected exactly one deployed definition of each stubbed row authority.');
  for (const { name, arguments: parameters } of deployed.rows)
    await client.query(
      `CREATE OR REPLACE FUNCTION ${name}(${parameters}) RETURNS BOOLEAN LANGUAGE sql STABLE
         AS '${STUBBED_ROW_AUTHORITIES[name]}'`
    );
  // 0242 evaluates the rows' assignment continuity once, before the row loop: every requested
  // decision is current, so the finalizer still builds and consults its full continuity set.
  await client.query(
    `CREATE OR REPLACE FUNCTION outcome_provider_assignment_continuity_current_set(
       origin_decision_ids TEXT[]) RETURNS TABLE(continuity_decision_id TEXT, continuity_current BOOLEAN)
       LANGUAGE sql AS 'SELECT DISTINCT requested_id,TRUE FROM unnest(origin_decision_ids) requested_id
         WHERE requested_id IS NOT NULL'`
  );
}

export interface HpnFinalizationMeasurement {
  milliseconds: number;
  /** Peak resident set (VmHWM) of the finalizing backend, in KiB. */
  peakResidentKib: number;
  /** Resident set of the same backend immediately before finalization, in KiB. */
  baselineResidentKib: number;
  /** The finalization's error, including a cancellation by the time or memory bound. */
  error: string | null;
  /** True when the monitor cancelled the finalization for exceeding `cancelAboveKib`. */
  exceededMemoryBound: boolean;
}

const residentKib = (status: string) => ({
  now: Number(/VmRSS:\s+(\d+) kB/.exec(status)![1]),
  peak: Number(/VmHWM:\s+(\d+) kB/.exec(status)![1]),
});

/**
 * Finalizes an input set on a fresh backend inside a transaction that is always rolled back.
 * A second connection samples the finalizing backend's /proc status (the disposable service's own
 * process; the test role is its superuser) and cancels it once its peak resident set exceeds
 * `cancelAboveKib`, so an unbounded finalization is measured without exhausting the host.
 * `finalizer`, when given, replaces the deployed finalization trigger function for this
 * transaction only.
 */
export async function measureHpnInputFinalization(
  connectionString: string,
  schemaName: string,
  inputSetId: string,
  {
    finalizer,
    timeoutMs,
    cancelAboveKib,
  }: { finalizer?: string; timeoutMs: number; cancelAboveKib: number }
): Promise<HpnFinalizationMeasurement> {
  // Dedicated single-connection pools: one finalizing backend and one monitoring backend.
  const finalizing = new Pool({
    connectionString,
    options: `-c search_path=${schemaName}`,
    max: 1,
  });
  const monitoring = new Pool({ connectionString, max: 1 });
  const client = await finalizing.connect();
  const monitor = await monitoring.connect();
  const statusOf = async (connection: PoolClient, pid: number | null) =>
    residentKib(
      (
        await connection.query<{ status: string }>(
          `SELECT pg_read_file('/proc/'||COALESCE($1::TEXT,'self')||'/status') AS status`,
          [pid]
        )
      ).rows[0]!.status
    );
  let sampling = true;
  let sampledPeak = 0;
  let exceededMemoryBound = false;
  try {
    const pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
      .pid;
    await client.query('BEGIN');
    await stubHpnRowAuthorities(client);
    if (finalizer) await client.query(finalizer);
    await client.query(`SET LOCAL statement_timeout=${Math.trunc(timeoutMs)}`);
    const baseline = await statusOf(client, null);
    const sampler = (async () => {
      while (sampling) {
        const sample = await statusOf(monitor, pid).catch(() => null);
        if (sample) sampledPeak = Math.max(sampledPeak, sample.peak);
        if (sample && sample.peak > cancelAboveKib && !exceededMemoryBound) {
          exceededMemoryBound = true;
          await monitor.query('SELECT pg_cancel_backend($1)', [pid]);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })();
    const started = performance.now();
    let error: string | null = null;
    await client.query('SAVEPOINT finalization');
    try {
      await client.query(
        `UPDATE outcome_hpn_pav_input_set SET status='finalized', finalized_at=created_at
          WHERE input_set_id=$1 AND status='building'`,
        [inputSetId]
      );
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      await client.query('ROLLBACK TO SAVEPOINT finalization');
    }
    const milliseconds = performance.now() - started;
    sampling = false;
    await sampler;
    const after = await statusOf(client, null);
    return {
      milliseconds,
      peakResidentKib: Math.max(after.peak, sampledPeak),
      baselineResidentKib: baseline.now,
      error,
      exceededMemoryBound,
    };
  } finally {
    sampling = false;
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    monitor.release();
    await finalizing.end();
    await monitoring.end();
  }
}

const SCALE_TEMP_TABLES = [
  'scale_parameter',
  'scale_source',
  'scale_template',
  'scale_match',
  'scale_player',
  'scale_row',
  'scale_match_fact',
  'scale_appearance_fact',
  'scale_all_row',
  'scale_completed_match',
  'scale_content',
  'scale_input_set',
];

const INFLATE_STATEMENTS = [
  `CREATE TEMP TABLE scale_source ON COMMIT DROP AS
     SELECT source_set.*,member.match_id AS source_match_id,member.home_club_id AS source_home_club_id,
            encode(sha256(convert_to('season-scale:'||source_set.input_set_id||':'||parameter.label,
              'UTF8')),'hex') AS scale_sha256,
            -- Each inflated set has its own copy of the factual run, whose universe it must equal.
            'factual-reconciliation-run:'||encode(sha256(convert_to('season-scale-run:'||
              source_set.factual_run_id||':'||parameter.label,'UTF8')),'hex') AS scale_factual_run_id,
            encode(sha256(convert_to('season-scale-universe:'||source_set.factual_input_set_sha256||':'||
              parameter.label,'UTF8')),'hex') AS scale_factual_input_set_sha256,
            -- Each inflated set is its own logical input scope.
            source_set.effective_through-(1+abs(hashtext(parameter.label))%1000)*INTERVAL '1 millisecond'
              AS scale_effective_through
       FROM scale_parameter parameter
       JOIN outcome_hpn_pav_input_set source_set
         ON source_set.input_set_id=parameter.source_input_set_id AND source_set.status='finalized'
       JOIN LATERAL (SELECT * FROM outcome_hpn_pav_input_match
         WHERE input_set_id=source_set.input_set_id ORDER BY ordinal LIMIT 1) member ON TRUE`,
  // One real player row per (role, side) and the real completed-match result row.
  `CREATE TEMP TABLE scale_template ON COMMIT DROP AS
     SELECT DISTINCT ON (input_row.row_kind,input_row.role,side.value) input_row.*,side.value AS side
       FROM scale_source
       JOIN outcome_hpn_pav_input_row input_row ON input_row.input_set_id=scale_source.input_set_id
      CROSS JOIN LATERAL (SELECT CASE
        WHEN input_row.row_kind='completed_match_result' THEN 'result'
        WHEN input_row.row_json#>>'{club,canonicalId}'=scale_source.source_home_club_id THEN 'home'
        ELSE 'away' END AS value) side
      ORDER BY input_row.row_kind,input_row.role,side.value,input_row.ordinal`,
  `CREATE TEMP TABLE scale_match ON COMMIT DROP AS
     SELECT game,'afl-match:'||label||'-'||game AS match_id,
            'afl-club:'||label||'-'||((game*2)%18) AS home_club_id,
            'afl-club:'||label||'-'||((game*2+1)%18) AS away_club_id,
            TIMESTAMPTZ '2026-01-01T02:00:00Z'+game*INTERVAL '5 hours' AS effective_at
       FROM scale_parameter CROSS JOIN generate_series(1,scale_parameter.matches) game`,
  `CREATE TEMP TABLE scale_player ON COMMIT DROP AS
     SELECT scale_match.*,side.value AS side,slot,
            CASE side.value WHEN 'home' THEN home_club_id ELSE away_club_id END AS club_id,
            'afl-player:'||substr(CASE side.value WHEN 'home' THEN home_club_id
              ELSE away_club_id END,10)||'-'||slot AS player_id
       FROM scale_match CROSS JOIN scale_parameter
      CROSS JOIN (VALUES ('home'),('away')) side(value)
      CROSS JOIN generate_series(1,scale_parameter.players_per_side) slot`,
  `CREATE TEMP TABLE scale_row ON COMMIT DROP AS
     WITH synthetic AS (
       SELECT template.*,player.match_id,player.home_club_id,player.away_club_id,
              player.effective_at,player.club_id,player.player_id,player.game,player.slot,
              'provider-row:'||encode(sha256(convert_to(template.provider_decoded_row_id||':'||
                player.match_id||':'||player.player_id,'UTF8')),'hex') AS decoded_row_id
         FROM scale_player player JOIN scale_template template ON template.side=player.side
       UNION ALL
       SELECT template.*,match.match_id,match.home_club_id,match.away_club_id,match.effective_at,
              NULL,NULL,match.game,0,
              'provider-row:'||encode(sha256(convert_to(template.provider_decoded_row_id||':'||
                match.match_id,'UTF8')),'hex')
         FROM scale_match match JOIN scale_template template ON template.side='result'
     ), keyed AS (
       SELECT synthetic.*,
              encode(sha256(convert_to('source:'||decoded_row_id,'UTF8')),'hex') AS synthetic_source_sha256,
              'acquisition-spell-version:'||encode(sha256(convert_to(player_id||':'||club_id,'UTF8')),'hex')
                AS spell_version_id,
              (SELECT count(*) FROM outcome_hpn_pav_input_row source_row
                 JOIN scale_source ON source_row.input_set_id=scale_source.input_set_id)
                +row_number() OVER (ORDER BY game,row_kind DESC,role,side,slot)-1 AS row_ordinal
         FROM synthetic
     )
     SELECT keyed.*,CASE WHEN row_kind='completed_match_result' THEN
         row_json||jsonb_build_object(
           'match',row_json->'match'||jsonb_build_object('canonicalId',match_id),
           'homeClub',row_json->'homeClub'||jsonb_build_object('canonicalId',home_club_id),
           'awayClub',row_json->'awayClub'||jsonb_build_object('canonicalId',away_club_id),
           'source',row_json->'source'||jsonb_build_object('providerDecodedRowId',decoded_row_id,
             'sourceRowSha256',synthetic_source_sha256))
         ||CASE WHEN row_json ? 'effectiveAt' THEN jsonb_build_object('effectiveAt',
             to_char(effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ELSE '{}' END
       ELSE
         row_json||jsonb_build_object(
           'player',row_json->'player'||jsonb_build_object('canonicalId',player_id),
           'club',row_json->'club'||jsonb_build_object('canonicalId',club_id),
           'match',row_json->'match'||jsonb_build_object('canonicalId',match_id),
           'source',row_json->'source'||jsonb_build_object('providerDecodedRowId',decoded_row_id,
             'sourceRowSha256',synthetic_source_sha256),
           'acquisitionSpell',row_json->'acquisitionSpell'||jsonb_build_object(
             'spellId',spell_version_id,'spellVersionId',spell_version_id,'playerId',player_id,
             'clubId',club_id,'startDate','2026-01-01','endDate','2026-03-20'))
       END AS synthetic_json
       FROM keyed`,
  `INSERT INTO outcome_provider_decoded_row
     (provider_decoded_row_id,normalization_run_id,capture_id,competition,season_year,
      source_row_number,source_row_sha256,row_status,typed_payload,recorded_at)
   SELECT scale_row.decoded_row_id,decoded.normalization_run_id,decoded.capture_id,
          decoded.competition,decoded.season_year,
          (SELECT max(source_row_number) FROM outcome_provider_decoded_row)+1+scale_row.row_ordinal,
          scale_row.synthetic_source_sha256,decoded.row_status,decoded.typed_payload,decoded.recorded_at
     FROM scale_row JOIN outcome_provider_decoded_row decoded
       ON decoded.provider_decoded_row_id=scale_row.provider_decoded_row_id`,
  `INSERT INTO outcome_provider_match_candidate
   SELECT 'match-candidate:'||encode(sha256(convert_to(scale_row.decoded_row_id,'UTF8')),'hex'),
          scale_row.decoded_row_id,candidate.provider,candidate.native_match_id,candidate.round_label,
          candidate.match_date_text,candidate.home_club_native_id,candidate.home_club_name,
          candidate.away_club_native_id,candidate.away_club_name,candidate.provider_status,
          candidate.order_independent_sha256,candidate.candidate_sha256,
          candidate.candidate_canonical_json,candidate.candidate_json
     FROM scale_row JOIN outcome_provider_match_candidate candidate
       ON candidate.provider_decoded_row_id=scale_row.provider_decoded_row_id`,
  `INSERT INTO outcome_provider_identity_candidate
   SELECT 'identity-candidate:'||encode(sha256(convert_to(scale_row.decoded_row_id,'UTF8')),'hex'),
          scale_row.decoded_row_id,candidate.provider,candidate.entity_kind,candidate.native_entity_id,
          candidate.recorded_name,candidate.recorded_club_id,candidate.recorded_club_name,
          candidate.locator_sha256,candidate.candidate_sha256,candidate.candidate_canonical_json,
          candidate.candidate_json
     FROM scale_row JOIN outcome_provider_identity_candidate candidate
       ON candidate.provider_decoded_row_id=scale_row.provider_decoded_row_id`,
  `INSERT INTO outcome_acquisition_spell_version
     (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,
      start_asset_version_id,start_date,end_date,end_reason,rule_id,status,
      supersedes_spell_version_id,recorded_at,registration_canonical_json,
      registration_approval_decision_id,registered_at)
   SELECT DISTINCT ON (scale_row.spell_version_id) scale_row.spell_version_id,
          scale_row.spell_version_id,spell.version,scale_row.player_id,scale_row.club_id,
          spell.start_event_version_id,spell.start_asset_version_id,DATE '2026-01-01',
          DATE '2026-03-20',spell.end_reason,spell.rule_id,spell.status,NULL,spell.recorded_at,
          spell.registration_canonical_json,spell.registration_approval_decision_id,spell.registered_at
     FROM scale_row JOIN outcome_acquisition_spell_version spell
       ON spell.spell_version_id=scale_row.row_json#>>'{acquisitionSpell,spellVersionId}'
    WHERE scale_row.row_kind='player_match_stats'
    ORDER BY scale_row.spell_version_id`,
  `INSERT INTO outcome_match
     (match_id,competition,season_year,provider,native_match_id,round_label,match_date,
      home_club_id,away_club_id)
   SELECT scale_match.match_id,real.competition,real.season_year,real.provider,
          real.native_match_id,real.round_label,scale_match.effective_at,
          scale_match.home_club_id,scale_match.away_club_id
     FROM scale_match CROSS JOIN scale_source
     JOIN outcome_match real ON real.match_id=scale_source.source_match_id`,
  `CREATE TEMP TABLE scale_match_fact ON COMMIT DROP AS
     SELECT scale_match.game,scale_match.match_id AS synthetic_match_id,
            scale_match.home_club_id AS synthetic_home_club_id,
            scale_match.away_club_id AS synthetic_away_club_id,
            scale_match.effective_at AS synthetic_effective_at,fact.match_fact_id AS source_fact_id,
            'source-fact:'||encode(sha256(convert_to(fact.match_fact_id||':'||scale_match.match_id,
              'UTF8')),'hex') AS synthetic_fact_id
       FROM scale_match CROSS JOIN scale_source
       JOIN outcome_hpn_pav_input_factual_match_member member
         ON member.input_set_id=scale_source.input_set_id
       JOIN outcome_provider_match_universe_fact fact ON fact.match_fact_id=member.fact_id`,
  `INSERT INTO outcome_provider_match_universe_fact
   SELECT scale.synthetic_fact_id,fact.fact_batch_id,fact.normalization_run_id,
          'provider-row:'||encode(sha256(convert_to(fact.provider_decoded_row_id||':'||
            scale.synthetic_match_id,'UTF8')),'hex'),fact.match_candidate_id,
          fact.match_resolution_decision_id,fact.match_assignment_decision_id,fact.match_identity_id,
          scale.synthetic_match_id,fact.competition,fact.season_year,fact.availability,
          fact.completion_state,fact.reason_code,scale.synthetic_effective_at,fact.recorded_at,
          fact.candidate_sha256,fact.candidate_digests_json,fact.fact_sha256,
          jsonb_set(jsonb_set(fact.fact_json,'{match,homeClub,clubId}',
            to_jsonb(scale.synthetic_home_club_id)),'{match,awayClub,clubId}',
            to_jsonb(scale.synthetic_away_club_id))
     FROM scale_match_fact scale
     JOIN outcome_provider_match_universe_fact fact ON fact.match_fact_id=scale.source_fact_id`,
  `CREATE TEMP TABLE scale_appearance_fact ON COMMIT DROP AS
     SELECT scale_player.game,scale_player.side,scale_player.slot,
            scale_player.match_id AS synthetic_match_id,scale_player.player_id AS synthetic_player_id,
            scale_player.club_id AS synthetic_club_id,scale_player.effective_at AS synthetic_effective_at,
            fact.appearance_fact_id AS source_fact_id,
            'source-fact:'||encode(sha256(convert_to(fact.appearance_fact_id||':'||
              scale_player.match_id||':'||scale_player.player_id,'UTF8')),'hex') AS synthetic_fact_id
       FROM scale_player CROSS JOIN scale_source
       JOIN outcome_hpn_pav_input_factual_appearance_member member
         ON member.input_set_id=scale_source.input_set_id
       JOIN outcome_provider_player_appearance_fact fact ON fact.appearance_fact_id=member.fact_id
        AND (fact.represented_club_id=scale_source.source_home_club_id)=(scale_player.side='home')`,
  `INSERT INTO outcome_provider_player_appearance_fact
   SELECT scale.synthetic_fact_id,fact.fact_batch_id,fact.normalization_run_id,
          'provider-row:'||encode(sha256(convert_to(fact.provider_decoded_row_id||':'||
            scale.synthetic_match_id||':'||scale.synthetic_player_id,'UTF8')),'hex'),
          fact.appearance_candidate_id,fact.identity_candidate_id,fact.match_candidate_id,
          fact.player_resolution_decision_id,fact.player_assignment_decision_id,
          fact.match_resolution_decision_id,fact.match_assignment_decision_id,
          fact.represented_club_resolution_decision_id,fact.represented_club_assignment_decision_id,
          fact.player_identity_id,fact.match_identity_id,fact.represented_club_identity_id,
          scale.synthetic_player_id,scale.synthetic_match_id,scale.synthetic_club_id,fact.competition,
          fact.season_year,fact.availability,fact.appeared,fact.reason_code,
          scale.synthetic_effective_at,fact.recorded_at,fact.candidate_sha256,
          fact.candidate_digests_json,fact.fact_sha256,fact.fact_json
     FROM scale_appearance_fact scale
     JOIN outcome_provider_player_appearance_fact fact ON fact.appearance_fact_id=scale.source_fact_id`,
  `INSERT INTO outcome_factual_reconciliation_run
   SELECT (jsonb_populate_record(run,jsonb_build_object(
            'factual_run_id',scale_source.scale_factual_run_id,
            'input_set_sha256',scale_source.scale_factual_input_set_sha256))).*
     FROM scale_source
     JOIN outcome_factual_reconciliation_run run ON run.factual_run_id=scale_source.factual_run_id`,
  `INSERT INTO outcome_factual_reconciliation_match_input
   SELECT scale_source.scale_factual_run_id,input.match_fact_id,input.ordinal,
          input.membership_sha256,input.membership_json
     FROM scale_source JOIN outcome_factual_reconciliation_match_input input
       ON input.factual_run_id=scale_source.factual_run_id`,
  `INSERT INTO outcome_factual_reconciliation_appearance_input
   SELECT scale_source.scale_factual_run_id,input.appearance_fact_id,input.ordinal,
          input.membership_sha256,input.membership_json
     FROM scale_source JOIN outcome_factual_reconciliation_appearance_input input
       ON input.factual_run_id=scale_source.factual_run_id`,
  `INSERT INTO outcome_factual_reconciliation_match_input
   SELECT input.factual_run_id,scale.synthetic_fact_id,
          (SELECT max(ordinal) FROM outcome_factual_reconciliation_match_input
            WHERE factual_run_id=input.factual_run_id)
            +row_number() OVER (ORDER BY scale.game,scale.synthetic_fact_id),
          input.membership_sha256,input.membership_json
     FROM scale_match_fact scale CROSS JOIN scale_source
     JOIN outcome_factual_reconciliation_match_input input
       ON input.factual_run_id=scale_source.scale_factual_run_id
      AND input.match_fact_id=scale.source_fact_id`,
  `INSERT INTO outcome_factual_reconciliation_appearance_input
   SELECT input.factual_run_id,scale.synthetic_fact_id,
          (SELECT max(ordinal) FROM outcome_factual_reconciliation_appearance_input
            WHERE factual_run_id=input.factual_run_id)
            +row_number() OVER (ORDER BY scale.game,scale.synthetic_fact_id),
          input.membership_sha256,input.membership_json
     FROM scale_appearance_fact scale CROSS JOIN scale_source
     JOIN outcome_factual_reconciliation_appearance_input input
       ON input.factual_run_id=scale_source.scale_factual_run_id
      AND input.appearance_fact_id=scale.source_fact_id`,
  `CREATE TEMP TABLE scale_all_row ON COMMIT DROP AS
     SELECT source_row.ordinal,source_row.normalization_run_id,source_row.provider_decoded_row_id,
            source_row.row_kind,source_row.role,source_row.source_row_sha256,
            source_row.typed_payload_sha256,source_row.row_json
       FROM outcome_hpn_pav_input_row source_row
       JOIN scale_source ON source_row.input_set_id=scale_source.input_set_id
     UNION ALL
     SELECT row_ordinal,normalization_run_id,decoded_row_id,row_kind,role,synthetic_source_sha256,
            typed_payload_sha256,synthetic_json
       FROM scale_row`,
  `CREATE TEMP TABLE scale_completed_match ON COMMIT DROP AS
     WITH completed AS (
       SELECT member.ordinal,member.match_id,member.effective_at,member.home_club_id,
              member.away_club_id,member.result_provider_decoded_row_id
         FROM outcome_hpn_pav_input_match member
         JOIN scale_source ON member.input_set_id=scale_source.input_set_id
       UNION ALL
       SELECT (SELECT count(*) FROM outcome_hpn_pav_input_match member
                 JOIN scale_source ON member.input_set_id=scale_source.input_set_id)+scale_match.game-1,
              scale_match.match_id,scale_match.effective_at,scale_match.home_club_id,
              scale_match.away_club_id,result.decoded_row_id
         FROM scale_match JOIN scale_row result
           ON result.match_id=scale_match.match_id AND result.row_kind='completed_match_result'
     )
     SELECT completed.*,jsonb_build_object('matchId',match_id,'effectiveAt',
              to_char(effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'homeClubId',home_club_id,'awayClubId',away_club_id) AS match_json
       FROM completed`,
  // The season content is assembled as text and parsed once: a JSONB aggregate of every row
  // would hold several in-memory trees of the whole season at once.
  `CREATE TEMP TABLE scale_content ON COMMIT DROP AS
     SELECT '{'||string_agg(to_jsonb(field.key)::TEXT||':'||field.value,',' ORDER BY field.key)||'}'
              AS content_text
       FROM (
         SELECT key,value::TEXT AS value
           FROM scale_source,jsonb_each(scale_source.input_set_json->'content')
          WHERE key NOT IN ('rows','completedMatches','counts','effectiveThrough','factualUniverse')
         UNION ALL
         SELECT 'effectiveThrough',to_jsonb(to_char(scale_effective_through
           AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::TEXT FROM scale_source
         UNION ALL
         SELECT 'rows','['||string_agg(row_json::TEXT,',' ORDER BY ordinal)||']' FROM scale_all_row
         UNION ALL
         SELECT 'completedMatches','['||string_agg(match_json::TEXT,',' ORDER BY ordinal)||']'
           FROM scale_completed_match
         UNION ALL
         SELECT 'counts',jsonb_build_object(
           'completedMatches',(SELECT count(*) FROM scale_completed_match),
           'resultRows',count(*) FILTER (WHERE row_kind='completed_match_result'),
           'primaryPlayerRows',count(*) FILTER (WHERE role='primary'),
           'corroboratingPlayerRows',count(*) FILTER (WHERE role='corroborating'))::TEXT
           FROM scale_all_row
         UNION ALL
         SELECT 'factualUniverse',((scale_source.input_set_json#>'{content,factualUniverse}')
           ||jsonb_build_object(
             'factualRunId',scale_source.scale_factual_run_id,
             'inputSetSha256',scale_source.scale_factual_input_set_sha256,
             'completedMatchFacts',(scale_source.input_set_json#>'{content,factualUniverse,completedMatchFacts}')
               ||COALESCE((SELECT jsonb_agg(jsonb_build_object('matchId',synthetic_match_id,
                   'effectiveAt',to_char(synthetic_effective_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                   'homeClubId',synthetic_home_club_id,'awayClubId',synthetic_away_club_id,
                   'factIds',fact_ids) ORDER BY game)
                 FROM (SELECT game,synthetic_match_id,synthetic_effective_at,synthetic_home_club_id,
                              synthetic_away_club_id,
                              jsonb_agg(synthetic_fact_id ORDER BY synthetic_fact_id) AS fact_ids
                         FROM scale_match_fact GROUP BY 1,2,3,4,5) grouped),'[]'),
             'playerAppearanceFacts',(scale_source.input_set_json#>'{content,factualUniverse,playerAppearanceFacts}')
               ||COALESCE((SELECT jsonb_agg(jsonb_build_object('matchId',synthetic_match_id,
                   'playerId',synthetic_player_id,'clubId',synthetic_club_id,
                   'factIds',jsonb_build_array(synthetic_fact_id)) ORDER BY game,side,slot)
                 FROM scale_appearance_fact),'[]')))::TEXT
           FROM scale_source
       ) field`,
  `CREATE TEMP TABLE scale_input_set ON COMMIT DROP AS
     SELECT 'hpn-pav-input-set:'||scale_sha256 AS input_set_id FROM scale_source`,
  `INSERT INTO outcome_hpn_pav_input_set
     (input_set_id,factual_run_id,factual_input_set_sha256,factual_finalized_at,environment,
      competition,season_year,method_id,effective_through,created_at,input_set_sha256,status,
      source_run_count,source_row_count,completed_match_count,result_row_count,
      primary_player_row_count,corroborating_player_row_count,input_set_canonical_json,
      input_set_json,excluded_source_row_count)
   SELECT scale_input_set.input_set_id,source.scale_factual_run_id,
          source.scale_factual_input_set_sha256,
          source.factual_finalized_at,source.environment,source.competition,source.season_year,
          source.method_id,source.scale_effective_through,source.created_at,
          source.scale_sha256,'building',source.source_run_count,
          (SELECT count(*) FROM scale_all_row),(SELECT count(*) FROM scale_completed_match),
          (SELECT count(*) FROM scale_all_row WHERE row_kind='completed_match_result'),
          (SELECT count(*) FROM scale_all_row WHERE role='primary'),
          (SELECT count(*) FROM scale_all_row WHERE role='corroborating'),
          scale_content.content_text,
          ('{"inputSetId":'||to_jsonb(scale_input_set.input_set_id)::TEXT||',"content":'||
            scale_content.content_text||'}')::JSONB,
          source.excluded_source_row_count
     FROM scale_source source CROSS JOIN scale_input_set CROSS JOIN scale_content`,
  `INSERT INTO outcome_hpn_pav_input_run
     (input_set_id,ordinal,normalization_run_id,field_map_id,projected_field_map_id,input_kind,role)
   SELECT scale_input_set.input_set_id,run.ordinal,run.normalization_run_id,run.field_map_id,
          run.projected_field_map_id,run.input_kind,run.role
     FROM scale_input_set CROSS JOIN scale_source
     JOIN outcome_hpn_pav_input_run run ON run.input_set_id=scale_source.input_set_id`,
  `INSERT INTO outcome_hpn_pav_input_row
     (input_set_id,ordinal,normalization_run_id,provider_decoded_row_id,row_kind,role,
      source_row_sha256,typed_payload_sha256,row_sha256,row_canonical_json,row_json)
   SELECT scale_input_set.input_set_id,ordinal,normalization_run_id,provider_decoded_row_id,
          row_kind,role,source_row_sha256,typed_payload_sha256,
          encode(sha256(convert_to(row_json::TEXT,'UTF8')),'hex'),row_json::TEXT,row_json
     FROM scale_input_set CROSS JOIN scale_all_row`,
  `INSERT INTO outcome_hpn_pav_input_match
     (input_set_id,ordinal,match_id,result_provider_decoded_row_id,effective_at,home_club_id,
      away_club_id,match_sha256,match_canonical_json)
   SELECT scale_input_set.input_set_id,ordinal,match_id,result_provider_decoded_row_id,
          effective_at,home_club_id,away_club_id,
          encode(sha256(convert_to(match_json::TEXT,'UTF8')),'hex'),match_json::TEXT
     FROM scale_input_set CROSS JOIN scale_completed_match`,
  `INSERT INTO outcome_hpn_pav_input_factual_match_member(input_set_id,fact_id,ordinal)
   SELECT scale_input_set.input_set_id,fact_id,row_number() OVER (ORDER BY position,fact_id)-1
     FROM scale_input_set CROSS JOIN (
       SELECT member.fact_id,0 AS position FROM outcome_hpn_pav_input_factual_match_member member
         JOIN scale_source ON member.input_set_id=scale_source.input_set_id
       UNION ALL SELECT synthetic_fact_id,game FROM scale_match_fact) member`,
  `INSERT INTO outcome_hpn_pav_input_factual_appearance_member(input_set_id,fact_id,ordinal)
   SELECT scale_input_set.input_set_id,fact_id,row_number() OVER (ORDER BY position,fact_id)-1
     FROM scale_input_set CROSS JOIN (
       SELECT member.fact_id,0 AS position FROM outcome_hpn_pav_input_factual_appearance_member member
         JOIN scale_source ON member.input_set_id=scale_source.input_set_id
       UNION ALL SELECT synthetic_fact_id,game FROM scale_appearance_fact) member`,
];
