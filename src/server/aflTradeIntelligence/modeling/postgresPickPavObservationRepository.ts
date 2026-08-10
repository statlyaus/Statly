import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeFinalizedHpnPavCalculationSchema } from './hpnPavCalculationService';
import {
  aflTradePickPavObservationSetSchema,
  aflTradePickPavPolicySchema,
  type AflTradePickPavObservation,
  type AflTradePickPavObservationSet,
  type AflTradePickPavPolicy,
} from './pickOutcomeContracts';
import { materializeAflTradePickPavObservationSet } from './pickPavObservationService';
import {
  AflTradePickPavObservationError,
  aflTradeFinalizedPickPavObservationSetRequestSchema,
  aflTradePickPavMaterializationRequestSchema,
  aflTradePickPavSelectionAccessRegistrationSchema,
  type AflTradePickPavExecutionContext,
  type AflTradePickPavObservationRepository,
} from './pickPavObservationRepository';

interface PolicyRow {
  policy_json: unknown;
  decision: string;
  has_successor: boolean;
}

interface StoredAccessRow {
  selection_id: string;
  access_json: unknown;
}

interface ObservationSetRow {
  observation_set_json: unknown;
  finalized_at: Date | string | null;
  calculation_count: number;
  draft_class_count: number;
  observation_count: number;
  actual_calculation_count: number;
  actual_draft_class_count: number;
  actual_observation_count: number;
}

interface SelectionRow {
  selection_id: string;
  event_id: string;
  event_version_id: string;
  event_date: Date | string;
  recorded_at: Date | string;
  draft_year: number;
  selection_number: number;
  nominal_pick: number | null;
  nominal_round: number | null;
  pick_id: string | null;
  player_id: string | null;
  club_id: string;
  access_json: unknown | null;
}

interface CalculationRow {
  calculation_json: unknown;
  finalized_at: Date | string | null;
  actual_team_count: number;
  actual_player_count: number;
}

function digestFromId(id: string, prefix: string): string {
  const marker = `${prefix}:`;
  if (!id.startsWith(marker)) throw new TypeError(`Expected ${prefix} content address.`);
  return id.slice(marker.length);
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError('PostgreSQL returned invalid time.');
  return parsed.toISOString();
}

function dateOnly(value: Date | string): string {
  return iso(value).slice(0, 10);
}

async function trustedNow(transaction: AflOutcomeSqlTransaction): Promise<string> {
  const result = await transaction.query<{ trusted_at: Date | string }>(
    `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
  );
  const value = result.rows[0]?.trusted_at;
  if (!value)
    throw new AflTradePickPavObservationError('PERSISTENCE_REJECTED', 'No trusted DB time.');
  return iso(value);
}

async function loadPolicy(
  transaction: AflOutcomeSqlTransaction,
  policyId: string,
  environment: AflTradePickPavExecutionContext['environment']
): Promise<AflTradePickPavPolicy> {
  const stored = await transaction.query<{ policy_json: unknown }>(
    `SELECT policy_json FROM outcome_pick_pav_policy
     WHERE policy_id=$1 AND environment=$2::"OutcomeEnvironment" FOR SHARE`,
    [policyId, environment]
  );
  let candidate: AflTradePickPavPolicy;
  try {
    candidate = aflTradePickPavPolicySchema.parse(stored.rows[0]?.policy_json);
  } catch {
    throw new AflTradePickPavObservationError(
      'POLICY_NOT_CURRENT',
      'Stored pick-PAV policy is absent or failed authentication.'
    );
  }
  await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `outcome-review-subject:pick_pav_policy:${candidate.content.competition}:${candidate.content.policyVersion}`,
  ]);
  const result = await transaction.query<PolicyRow>(
    `SELECT policy.policy_json,decision.decision,
       EXISTS (SELECT 1 FROM outcome_review_decision successor
         WHERE successor.supersedes_decision_id=decision.decision_id) AS has_successor
     FROM outcome_pick_pav_policy policy
     JOIN outcome_review_decision decision ON decision.decision_id=policy.approval_decision_id
     WHERE policy.policy_id=$1 AND policy.environment=$2::"OutcomeEnvironment"
     FOR SHARE OF policy,decision`,
    [policyId, environment]
  );
  const row = result.rows[0];
  if (!row || row.decision !== 'approved' || row.has_successor) {
    throw new AflTradePickPavObservationError(
      'POLICY_NOT_CURRENT',
      'Pick-PAV policy is missing, withdrawn, or outside the execution environment.'
    );
  }
  try {
    return aflTradePickPavPolicySchema.parse(row.policy_json);
  } catch {
    throw new AflTradePickPavObservationError(
      'POLICY_NOT_CURRENT',
      'Stored pick-PAV policy failed authentication.'
    );
  }
}

async function loadSelections(
  transaction: AflOutcomeSqlTransaction,
  releaseId: string,
  environment: AflTradePickPavExecutionContext['environment'],
  policy: AflTradePickPavPolicy
): Promise<AflTradePickPavObservation['selection'][]> {
  const reviewedYears = [
    ...new Set(
      policy.content.partitions.flatMap(({ fromDraftYear, throughDraftYear }) =>
        Array.from(
          { length: throughDraftYear - fromDraftYear + 1 },
          (_, index) => fromDraftYear + index
        )
      )
    ),
  ].sort((left, right) => left - right);
  await transaction.query(
    `SELECT pg_advisory_xact_lock(hashtextextended(
       'outcome-review-subject:pick_pav_selection_access:'||selection.selection_id,0))
     FROM outcome_active_release active
     JOIN outcome_release_manifest release ON release.release_id=active.release_id
     JOIN outcome_release_draft_selection member ON member.release_id=release.release_id
     JOIN outcome_draft_selection selection ON selection.selection_id=member.selection_id
     JOIN outcome_event_version version ON version.event_version_id=selection.event_version_id
     JOIN outcome_event event ON event.event_id=version.event_id
     WHERE active.release_id=$1 AND release.environment=$2
       AND event.competition=$3 AND event.season_year=ANY($4::integer[])
       AND version.kind='national_draft'::"OutcomeEventKind"
     ORDER BY selection.selection_id`,
    [releaseId, environment, policy.content.competition, reviewedYears]
  );
  const result = await transaction.query<SelectionRow>(
    `SELECT selection.selection_id,event.event_id,version.event_version_id,version.event_date,
       version.recorded_at,event.season_year AS draft_year,selection.selection_number,
       pick.nominal_pick,pick.nominal_round,selection.pick_id,selection.player_id,selection.club_id,
       access.access_json
     FROM outcome_active_release active
     JOIN outcome_release_manifest release ON release.release_id=active.release_id
     JOIN outcome_release_draft_selection member ON member.release_id=release.release_id
     JOIN outcome_draft_selection selection ON selection.selection_id=member.selection_id
     JOIN outcome_event_version version ON version.event_version_id=selection.event_version_id
     JOIN outcome_event event ON event.event_id=version.event_id
     LEFT JOIN outcome_draft_pick pick ON pick.pick_id=selection.pick_id
     LEFT JOIN LATERAL (
       SELECT reviewed.access_json
       FROM outcome_pick_pav_selection_access reviewed
       JOIN outcome_review_decision decision ON decision.decision_id=reviewed.decision_id
       WHERE reviewed.selection_id=selection.selection_id AND decision.decision='approved'
         AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
           WHERE successor.supersedes_decision_id=decision.decision_id)
       ORDER BY reviewed.recorded_at DESC LIMIT 1
     ) access ON TRUE
     WHERE active.release_id=$1 AND release.environment=$2
       AND event.competition=$3 AND event.season_year=ANY($4::integer[])
       AND version.kind='national_draft'::"OutcomeEventKind"
       AND version.status='approved'::"OutcomeRecordStatus"
       AND selection.status='approved'::"OutcomeRecordStatus"
     ORDER BY selection.selection_id
     FOR SHARE OF active,release,member,selection,version,event`,
    [releaseId, environment, policy.content.competition, reviewedYears]
  );
  const observedYears = new Set(result.rows.map(({ draft_year }) => draft_year));
  if (
    result.rows.length < 4 ||
    reviewedYears.some((year) => !observedYears.has(year)) ||
    observedYears.size !== reviewedYears.length
  ) {
    throw new AflTradePickPavObservationError(
      'SELECTION_MEMBERSHIP_INCOMPLETE',
      'The active release does not contain four complete reviewed draft classes.'
    );
  }
  return result.rows.map((row) => {
    if (!row.pick_id || !row.player_id) {
      throw new AflTradePickPavObservationError(
        'SELECTION_MEMBERSHIP_INCOMPLETE',
        `Draft selection ${row.selection_id} has unresolved pick or player identity.`
      );
    }
    return {
      releaseId,
      selectionId: row.selection_id,
      eventId: row.event_id,
      eventVersionId: row.event_version_id,
      eventDate: dateOnly(row.event_date),
      recordedAt: iso(row.recorded_at),
      draftYear: row.draft_year,
      pathway: 'national' as const,
      actualSelectionNumber: row.selection_number,
      nominalSelectionNumber: row.nominal_pick,
      draftRound: row.nominal_round,
      pickId: row.pick_id,
      playerId: row.player_id,
      clubId: row.club_id,
      access:
        row.access_json === null
          ? ({ state: 'unresolved', reason: 'selection-access-not-reviewed' } as const)
          : (row.access_json as AflTradePickPavObservation['selection']['access']),
    };
  });
}

async function requireCurrentObservationSetAuthority(
  transaction: AflOutcomeSqlTransaction,
  set: AflTradePickPavObservationSet,
  suppliedPolicy?: AflTradePickPavPolicy,
  suppliedSelections?: readonly AflTradePickPavObservation['selection'][]
): Promise<void> {
  const policy =
    suppliedPolicy ??
    (await loadPolicy(transaction, set.content.policy.policyId, set.content.environment));
  if (canonicalizeAflTradeJson(policy) !== canonicalizeAflTradeJson(set.content.policy)) {
    throw new AflTradePickPavObservationError(
      'POLICY_NOT_CURRENT',
      'The observation set is not bound to the exact current pick-PAV policy.'
    );
  }
  const selections =
    suppliedSelections ??
    (await loadSelections(transaction, set.content.releaseId, set.content.environment, policy));
  const currentById = new Map(
    selections.map((selection) => [selection.selectionId, canonicalizeAflTradeJson(selection)])
  );
  if (
    currentById.size !== set.content.observations.length ||
    set.content.observations.some(
      (observation) =>
        currentById.get(observation.selection.selectionId) !==
        canonicalizeAflTradeJson(observation.selection)
    )
  ) {
    throw new AflTradePickPavObservationError(
      'RELEASE_NOT_CURRENT',
      'The observation set no longer matches the exact active release and current selection-access reviews.'
    );
  }
  const calculationIds = set.content.calculations.map(({ calculationId }) => calculationId).sort();
  const current = await transaction.query<{ calculation_id: string }>(
    `SELECT member.calculation_id
     FROM outcome_pick_pav_calculation_member member
     JOIN outcome_hpn_pav_calculation calculation
       ON calculation.calculation_id=member.calculation_id
     JOIN outcome_hpn_pav_calculation_head head
       ON head.environment=calculation.environment AND head.competition=calculation.competition
      AND head.season_year=calculation.season_year AND head.method_id=calculation.method_id
      AND head.calculation_id=calculation.calculation_id
     WHERE member.observation_set_id=$1
     ORDER BY member.calculation_id
     FOR SHARE OF member,calculation,head`,
    [set.observationSetId]
  );
  if (
    canonicalizeAflTradeJson(current.rows.map(({ calculation_id }) => calculation_id)) !==
    canonicalizeAflTradeJson(calculationIds)
  ) {
    throw new AflTradePickPavObservationError(
      'CALCULATION_EVIDENCE_INCOMPLETE',
      'The observation set references an HPN calculation that is no longer current.'
    );
  }
}

async function loadCalculations(
  transaction: AflOutcomeSqlTransaction,
  policy: AflTradePickPavPolicy,
  selections: readonly AflTradePickPavObservation['selection'][],
  knowledgeCutoffAt: string
) {
  const seasons = [
    ...new Set(
      selections.flatMap(({ draftYear }) =>
        Array.from(
          { length: policy.content.fixedHorizonSeasons },
          (_, offset) => draftYear + policy.content.firstOutcomeSeasonOffset + offset
        )
      )
    ),
  ].sort((left, right) => left - right);
  const result = await transaction.query<CalculationRow>(
    `SELECT calculation.calculation_json,calculation.finalized_at,
       (SELECT count(*)::integer FROM outcome_hpn_pav_calculation_team team
         WHERE team.calculation_id=calculation.calculation_id) AS actual_team_count,
       (SELECT count(*)::integer FROM outcome_hpn_pav_calculation_player player
         WHERE player.calculation_id=calculation.calculation_id) AS actual_player_count
     FROM outcome_hpn_pav_calculation_head head
     JOIN outcome_hpn_pav_calculation calculation
       ON calculation.calculation_id=head.calculation_id
     WHERE calculation.environment=$1::"OutcomeEnvironment" AND calculation.competition=$2
       AND calculation.method_id=$3 AND calculation.season_year=ANY($4::integer[])
       AND calculation.status='finalized' AND calculation.finalized_at IS NOT NULL
       AND calculation.calculated_at<=$5::timestamptz
       AND calculation.effective_through<=$5::timestamptz
     ORDER BY calculation.season_year
     FOR SHARE OF head,calculation`,
    [
      policy.content.environment,
      policy.content.competition,
      policy.content.methodId,
      seasons,
      knowledgeCutoffAt,
    ]
  );
  return result.rows.map((row) => {
    const calculation = aflTradeFinalizedHpnPavCalculationSchema.parse(row.calculation_json);
    if (
      !row.finalized_at ||
      calculation.content.teams.length !== row.actual_team_count ||
      calculation.content.players.length !== row.actual_player_count
    ) {
      throw new AflTradePickPavObservationError(
        'CALCULATION_EVIDENCE_INCOMPLETE',
        'A selected PAV calculation has incomplete durable membership.'
      );
    }
    const calculationSha256 = digestFromId(calculation.calculationId, 'hpn-pav-season');
    return {
      calculation: {
        calculationId: calculation.calculationId,
        calculationSha256,
        inputSetId: calculation.content.inputSetId,
        methodId: calculation.content.methodId,
        seasonYear: calculation.content.seasonYear,
        effectiveThrough: calculation.content.effectiveThrough,
        calculatedAt: calculation.content.calculatedAt,
      },
      playerValues: calculation.content.players.map((player) => ({
        calculationId: calculation.calculationId,
        calculationSha256,
        seasonYear: calculation.content.seasonYear,
        spellVersionId: player.spellVersionId,
        playerId: player.playerId,
        playerSha256: sha256AflTradeCanonicalJson(player),
        clubId: player.teamId,
        sourceRowIds: player.source.sourceRowIds,
        gamesPlayed: player.source.gamesPlayed,
        totalPav: player.totalPav,
      })),
    };
  });
}

async function findReplay(
  transaction: AflOutcomeSqlTransaction,
  environment: AflTradePickPavExecutionContext['environment'],
  releaseId: string,
  policyId: string,
  knowledgeCutoffAt: string
): Promise<AflTradePickPavObservationSet | null> {
  const result = await transaction.query<ObservationSetRow>(
    `SELECT parent.observation_set_json,parent.finalized_at,parent.calculation_count,
       parent.draft_class_count,parent.observation_count,
       (SELECT count(*)::integer FROM outcome_pick_pav_calculation_member child
         WHERE child.observation_set_id=parent.observation_set_id) AS actual_calculation_count,
       (SELECT count(*)::integer FROM outcome_pick_pav_draft_class child
         WHERE child.observation_set_id=parent.observation_set_id) AS actual_draft_class_count,
       (SELECT count(*)::integer FROM outcome_pick_pav_observation child
         WHERE child.observation_set_id=parent.observation_set_id) AS actual_observation_count
     FROM outcome_pick_pav_observation_set parent
     WHERE parent.environment=$1::"OutcomeEnvironment" AND parent.release_id=$2
       AND parent.policy_id=$3 AND parent.knowledge_cutoff_at=$4::timestamptz
     FOR SHARE OF parent`,
    [environment, releaseId, policyId, knowledgeCutoffAt]
  );
  const row = result.rows[0];
  if (!row) return null;
  try {
    const set = aflTradePickPavObservationSetSchema.parse(row.observation_set_json);
    if (
      !row.finalized_at ||
      row.calculation_count !== row.actual_calculation_count ||
      row.draft_class_count !== row.actual_draft_class_count ||
      row.observation_count !== row.actual_observation_count
    ) {
      throw new Error('incomplete');
    }
    return set;
  } catch {
    throw new AflTradePickPavObservationError(
      'REPLAY_CONFLICT',
      'The logical pick-PAV scope contains incomplete or unauthenticated immutable content.'
    );
  }
}

async function persistSet(
  transaction: AflOutcomeSqlTransaction,
  set: AflTradePickPavObservationSet
): Promise<void> {
  const content = set.content;
  await transaction.query(
    `INSERT INTO outcome_pick_pav_observation_set
      (observation_set_id,observation_set_sha256,environment,competition,release_id,policy_id,
       created_at,knowledge_cutoff_at,status,calculation_count,draft_class_count,observation_count,
       observation_set_canonical_json,observation_set_json,finalized_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'building',$9,$10,$11,$12,$13::jsonb,NULL)`,
    [
      set.observationSetId,
      digestFromId(set.observationSetId, 'pick-pav-observation-set'),
      content.environment,
      content.competition,
      content.releaseId,
      content.policy.policyId,
      content.createdAt,
      content.knowledgeCutoffAt,
      content.calculations.length,
      content.draftClasses.length,
      content.observations.length,
      canonicalizeAflTradeJson(content),
      canonicalizeAflTradeJson(set),
    ]
  );
  const calculations = content.calculations.map((calculation, ordinal) => ({
    observationSetId: set.observationSetId,
    calculationId: calculation.calculationId,
    ordinal,
    calculationSha256: calculation.calculationSha256,
    membershipJson: calculation,
  }));
  await transaction.query(
    `INSERT INTO outcome_pick_pav_calculation_member
      (observation_set_id,calculation_id,ordinal,calculation_sha256,membership_json)
     SELECT "observationSetId","calculationId",ordinal,"calculationSha256","membershipJson"
     FROM jsonb_to_recordset($1::jsonb) AS value(
       "observationSetId" text,"calculationId" text,ordinal integer,
       "calculationSha256" text,"membershipJson" jsonb)`,
    [canonicalizeAflTradeJson(calculations)]
  );
  const draftClasses = content.draftClasses.map((draftClass, ordinal) => ({
    observationSetId: set.observationSetId,
    ordinal,
    ...draftClass,
  }));
  await transaction.query(
    `INSERT INTO outcome_pick_pav_draft_class
      (observation_set_id,draft_year,pathway,ordinal,expected_selection_count,observation_count)
     SELECT "observationSetId","draftYear",pathway,ordinal,"expectedSelectionCount","observationCount"
     FROM jsonb_to_recordset($1::jsonb) AS value(
       "observationSetId" text,"draftYear" integer,pathway text,ordinal integer,
       "expectedSelectionCount" integer,"observationCount" integer)`,
    [canonicalizeAflTradeJson(draftClasses)]
  );
  const observations = content.observations.map((observation) => {
    const { observationId: _observationId, ...observationContent } = observation;
    return {
      observationSetId: set.observationSetId,
      observationId: observation.observationId,
      ordinal: observation.ordinal,
      partition: observation.partition,
      selectionId: observation.selection.selectionId,
      accessDecisionId:
        observation.selection.access.state === 'unresolved'
          ? null
          : observation.selection.access.decision.id,
      outcomeState: observation.outcome.state,
      calculationCount: observation.calculationIds.length,
      playerValueCount: observation.playerValues.length,
      observationSha256: digestFromId(observation.observationId, 'pick-pav-observation'),
      observationCanonicalJson: canonicalizeAflTradeJson(observationContent),
      observationJson: observation,
    };
  });
  await transaction.query(
    `INSERT INTO outcome_pick_pav_observation
      (observation_set_id,observation_id,ordinal,partition,selection_id,access_decision_id,
       outcome_state,calculation_count,player_value_count,observation_sha256,
       observation_canonical_json,observation_json)
     SELECT "observationSetId","observationId",ordinal,partition,"selectionId","accessDecisionId",
       "outcomeState","calculationCount","playerValueCount","observationSha256",
       "observationCanonicalJson","observationJson"
     FROM jsonb_to_recordset($1::jsonb) AS value(
       "observationSetId" text,"observationId" text,ordinal integer,partition text,
       "selectionId" text,"accessDecisionId" text,"outcomeState" text,
       "calculationCount" integer,"playerValueCount" integer,"observationSha256" text,
       "observationCanonicalJson" text,"observationJson" jsonb)`,
    [canonicalizeAflTradeJson(observations)]
  );
  const links = content.observations.flatMap((observation) =>
    observation.calculationIds.map((calculationId, ordinal) => ({
      observationSetId: set.observationSetId,
      observationId: observation.observationId,
      calculationId,
      ordinal,
    }))
  );
  await transaction.query(
    `INSERT INTO outcome_pick_pav_observation_calculation
      (observation_set_id,observation_id,calculation_id,ordinal)
     SELECT "observationSetId","observationId","calculationId",ordinal
     FROM jsonb_to_recordset($1::jsonb) AS value(
       "observationSetId" text,"observationId" text,"calculationId" text,ordinal integer)`,
    [canonicalizeAflTradeJson(links)]
  );
  const values = content.observations.flatMap((observation) =>
    observation.playerValues.map((value, ordinal) => ({
      observationSetId: set.observationSetId,
      observationId: observation.observationId,
      ordinal,
      ...value,
      valueCanonicalJson: canonicalizeAflTradeJson(value),
      valueJson: value,
    }))
  );
  await transaction.query(
    `INSERT INTO outcome_pick_pav_player_value
      (observation_set_id,observation_id,calculation_id,spell_version_id,ordinal,player_id,
       club_id,player_sha256,games_played,total_pav,source_row_ids,value_canonical_json,value_json)
     SELECT "observationSetId","observationId","calculationId","spellVersionId",ordinal,
       "playerId","clubId","playerSha256","gamesPlayed","totalPav","sourceRowIds",
       "valueCanonicalJson","valueJson"
     FROM jsonb_to_recordset($1::jsonb) AS value(
       "observationSetId" text,"observationId" text,"calculationId" text,
       "spellVersionId" text,ordinal integer,"playerId" text,"clubId" text,
       "playerSha256" text,"gamesPlayed" integer,"totalPav" double precision,
       "sourceRowIds" text[],"valueCanonicalJson" text,"valueJson" jsonb)`,
    [canonicalizeAflTradeJson(values)]
  );
  const finalized = await transaction.query(
    `UPDATE outcome_pick_pav_observation_set
        SET status='finalized',finalized_at=created_at
      WHERE observation_set_id=$1 AND status='building'`,
    [set.observationSetId]
  );
  if (finalized.rowCount !== 1) {
    throw new AflTradePickPavObservationError(
      'PERSISTENCE_REJECTED',
      'Pick-PAV observation set did not finalize.'
    );
  }
}

export class PostgresAflTradePickPavObservationRepository implements AflTradePickPavObservationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async registerPolicy(input: unknown, execution: AflTradePickPavExecutionContext) {
    let policy: AflTradePickPavPolicy;
    try {
      policy = aflTradePickPavPolicySchema.parse(input);
    } catch (error) {
      throw new AflTradePickPavObservationError(
        'INVALID_POLICY',
        error instanceof Error ? error.message : 'Invalid pick-PAV policy.'
      );
    }
    if (policy.content.environment !== execution.environment) {
      throw new AflTradePickPavObservationError(
        'ENVIRONMENT_MISMATCH',
        'Pick-PAV policy execution environment mismatch.'
      );
    }
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `outcome-pick-pav-policy:${policy.policyId}`,
        ]);
        const existing = await transaction.query<{ policy_json: unknown }>(
          `SELECT policy_json FROM outcome_pick_pav_policy WHERE policy_id=$1 FOR SHARE`,
          [policy.policyId]
        );
        if (existing.rows[0]) {
          const stored = aflTradePickPavPolicySchema.parse(existing.rows[0].policy_json);
          if (canonicalizeAflTradeJson(stored) !== canonicalizeAflTradeJson(policy)) {
            throw new AflTradePickPavObservationError(
              'REPLAY_CONFLICT',
              'Stored pick-PAV policy differs.'
            );
          }
          return stored;
        }
        await transaction.query(
          `INSERT INTO outcome_pick_pav_policy
            (policy_id,policy_sha256,environment,competition,policy_version,method_id,
             approval_decision_id,created_at,policy_canonical_json,policy_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [
            policy.policyId,
            digestFromId(policy.policyId, 'pick-pav-policy'),
            policy.content.environment,
            policy.content.competition,
            policy.content.policyVersion,
            policy.content.methodId,
            policy.content.approvalDecision.id,
            policy.content.createdAt,
            canonicalizeAflTradeJson(policy.content),
            canonicalizeAflTradeJson(policy),
          ]
        );
        return policy;
      });
    } catch (error) {
      if (error instanceof AflTradePickPavObservationError) throw error;
      throw new AflTradePickPavObservationError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected the pick-PAV policy.'
      );
    }
  }

  async registerSelectionAccess(input: unknown, execution: AflTradePickPavExecutionContext) {
    let registration: ReturnType<typeof aflTradePickPavSelectionAccessRegistrationSchema.parse>;
    try {
      registration = aflTradePickPavSelectionAccessRegistrationSchema.parse(input);
    } catch (error) {
      throw new AflTradePickPavObservationError(
        'INVALID_ACCESS_REVIEW',
        error instanceof Error ? error.message : 'Invalid selection-access review.'
      );
    }
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `outcome-review-subject:pick_pav_selection_access:${registration.selectionId}`,
        ]);
        const eligible = await transaction.query(
          `SELECT 1 FROM outcome_active_release active
           JOIN outcome_release_manifest release ON release.release_id=active.release_id
           JOIN outcome_release_draft_selection member ON member.release_id=release.release_id
           WHERE member.selection_id=$1 AND release.environment=$2 FOR SHARE OF active,release,member`,
          [registration.selectionId, execution.environment]
        );
        if (eligible.rowCount !== 1) {
          throw new AflTradePickPavObservationError(
            'RELEASE_NOT_CURRENT',
            'Selection access can only be registered for the current environment release.'
          );
        }
        const existing = await transaction.query<StoredAccessRow>(
          `SELECT selection_id,access_json FROM outcome_pick_pav_selection_access
           WHERE decision_id=$1 FOR SHARE`,
          [registration.access.decision.id]
        );
        if (existing.rows[0]) {
          if (
            existing.rows[0].selection_id !== registration.selectionId ||
            canonicalizeAflTradeJson(existing.rows[0].access_json) !==
              canonicalizeAflTradeJson(registration.access)
          ) {
            throw new AflTradePickPavObservationError(
              'REPLAY_CONFLICT',
              'Stored selection-access review differs.'
            );
          }
          return registration;
        }
        await transaction.query(
          `INSERT INTO outcome_pick_pav_selection_access
            (decision_id,selection_id,access_state,restriction,bid_selection_number,recorded_at,
             access_canonical_json,access_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [
            registration.access.decision.id,
            registration.selectionId,
            registration.access.state,
            registration.access.state === 'restricted' ? registration.access.restriction : null,
            registration.access.state === 'restricted'
              ? registration.access.bidSelectionNumber
              : null,
            registration.access.recordedAt,
            canonicalizeAflTradeJson(registration.access),
            canonicalizeAflTradeJson(registration.access),
          ]
        );
        return registration;
      });
    } catch (error) {
      if (error instanceof AflTradePickPavObservationError) throw error;
      throw new AflTradePickPavObservationError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected selection access.'
      );
    }
  }

  async materializeAndPersist(input: unknown, execution: AflTradePickPavExecutionContext) {
    let request: ReturnType<typeof aflTradePickPavMaterializationRequestSchema.parse>;
    try {
      request = aflTradePickPavMaterializationRequestSchema.parse(input);
    } catch (error) {
      throw new AflTradePickPavObservationError(
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid pick-PAV materialization request.'
      );
    }
    if (request.environment !== execution.environment) {
      throw new AflTradePickPavObservationError(
        'ENVIRONMENT_MISMATCH',
        'Pick-PAV materialization environment mismatch.'
      );
    }
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `outcome-pick-pav-set:${request.environment}:${request.releaseId}:${request.policyId}:${request.knowledgeCutoffAt}`,
        ]);
        const policy = await loadPolicy(transaction, request.policyId, request.environment);
        if (policy.content.competition !== request.competition) {
          throw new AflTradePickPavObservationError(
            'POLICY_NOT_CURRENT',
            'The requested competition does not match the current pick-PAV policy.'
          );
        }
        const selections = await loadSelections(
          transaction,
          request.releaseId,
          request.environment,
          policy
        );
        const replay = await findReplay(
          transaction,
          request.environment,
          request.releaseId,
          request.policyId,
          request.knowledgeCutoffAt
        );
        if (replay) {
          await requireCurrentObservationSetAuthority(transaction, replay, policy, selections);
          return { observationSet: replay, idempotentReplay: true };
        }
        const createdAt = await trustedNow(transaction);
        const calculations = await loadCalculations(
          transaction,
          policy,
          selections,
          request.knowledgeCutoffAt
        );
        const observationSet = materializeAflTradePickPavObservationSet({
          environment: request.environment,
          competition: request.competition,
          createdAt,
          knowledgeCutoffAt: request.knowledgeCutoffAt,
          releaseId: request.releaseId,
          policy,
          selections,
          calculations,
        });
        await persistSet(transaction, observationSet);
        return { observationSet, idempotentReplay: false };
      });
    } catch (error) {
      if (error instanceof AflTradePickPavObservationError) throw error;
      throw new AflTradePickPavObservationError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected pick-PAV materialization.'
      );
    }
  }

  async loadFinalized(input: unknown, execution: AflTradePickPavExecutionContext) {
    let request: ReturnType<typeof aflTradeFinalizedPickPavObservationSetRequestSchema.parse>;
    try {
      request = aflTradeFinalizedPickPavObservationSetRequestSchema.parse(input);
    } catch (error) {
      throw new AflTradePickPavObservationError(
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid finalized pick-PAV request.'
      );
    }
    if (request.environment !== execution.environment) {
      throw new AflTradePickPavObservationError(
        'ENVIRONMENT_MISMATCH',
        'Pick-PAV load environment mismatch.'
      );
    }
    return this.client.transaction(async (transaction) => {
      const result = await transaction.query<ObservationSetRow>(
        `SELECT parent.observation_set_json,parent.finalized_at,parent.calculation_count,
           parent.draft_class_count,parent.observation_count,
           (SELECT count(*)::integer FROM outcome_pick_pav_calculation_member child
             WHERE child.observation_set_id=parent.observation_set_id) AS actual_calculation_count,
           (SELECT count(*)::integer FROM outcome_pick_pav_draft_class child
             WHERE child.observation_set_id=parent.observation_set_id) AS actual_draft_class_count,
           (SELECT count(*)::integer FROM outcome_pick_pav_observation child
             WHERE child.observation_set_id=parent.observation_set_id) AS actual_observation_count
         FROM outcome_pick_pav_observation_set parent
         WHERE parent.observation_set_id=$1 AND parent.environment=$2::"OutcomeEnvironment"
         FOR SHARE OF parent`,
        [request.observationSetId, request.environment]
      );
      const row = result.rows[0];
      if (!row || !row.finalized_at) {
        throw new AflTradePickPavObservationError(
          'NOT_FINALIZED',
          'Pick-PAV observation set is absent or not finalized.'
        );
      }
      let set: AflTradePickPavObservationSet;
      try {
        set = aflTradePickPavObservationSetSchema.parse(row.observation_set_json);
      } catch {
        throw new AflTradePickPavObservationError(
          'NOT_FINALIZED',
          'Stored pick-PAV observation-set content failed authentication.'
        );
      }
      if (
        row.calculation_count !== row.actual_calculation_count ||
        row.draft_class_count !== row.actual_draft_class_count ||
        row.observation_count !== row.actual_observation_count
      ) {
        throw new AflTradePickPavObservationError(
          'NOT_FINALIZED',
          'Pick-PAV observation-set child counts drifted.'
        );
      }
      await requireCurrentObservationSetAuthority(transaction, set);
      return set;
    });
  }
}

export function createPostgresAflTradePickPavObservationRepository(
  client: AflOutcomeSqlClient
): AflTradePickPavObservationRepository {
  return new PostgresAflTradePickPavObservationRepository(client);
}
