import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradeFinalizedHpnPavCalculationSchema } from './hpnPavCalculationService';
import {
  aflTradePlayerPavObservationSetSchema,
  aflTradePlayerPavPolicySchema,
  type AflTradePlayerPavObservationSet,
  type AflTradePlayerPavPolicy,
} from './playerPavObservationContracts';
import {
  AflTradePlayerPavObservationError,
  aflTradeFinalizedPlayerPavObservationSetRequestSchema,
  aflTradePlayerPavMaterializationRequestSchema,
  type AflTradePlayerPavExecutionContext,
  type AflTradePlayerPavObservationRepository,
} from './playerPavObservationRepository';
import {
  materializeAflTradePlayerPavObservationSet,
  type AflTradePlayerPavCalculationEvidence,
  type AflTradeReleasedPlayerSpellPrediction,
} from './playerPavObservationService';

interface PolicyRow {
  policy_json: unknown;
  decision: string;
  has_successor: boolean;
}

interface SpellRow {
  spell_version_id: string;
  spell_id: string;
  player_id: string;
  club_id: string;
  start_date: Date | string;
  end_date: Date | string | null;
  recorded_at: Date | string;
  prediction_season: number;
}

interface CalculationRow {
  calculation_json: unknown;
  finalized_at: Date | string | null;
  actual_team_count: number;
  actual_player_count: number;
}

interface ObservationSetRow {
  observation_set_json: unknown;
  finalized_at: Date | string | null;
  calculation_count: number;
  observation_count: number;
  actual_calculation_count: number;
  actual_observation_count: number;
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
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return iso(value).slice(0, 10);
}

async function trustedNow(transaction: AflOutcomeSqlTransaction): Promise<string> {
  const result = await transaction.query<{ trusted_at: Date | string }>(
    `SELECT date_trunc('milliseconds',transaction_timestamp()) AS trusted_at`
  );
  const value = result.rows[0]?.trusted_at;
  if (!value) {
    throw new AflTradePlayerPavObservationError(
      'PERSISTENCE_REJECTED',
      'PostgreSQL did not provide a trusted materialization time.'
    );
  }
  return iso(value);
}

async function loadPolicy(
  transaction: AflOutcomeSqlTransaction,
  policyId: string,
  environment: AflTradePlayerPavExecutionContext['environment']
): Promise<AflTradePlayerPavPolicy> {
  const stored = await transaction.query<{ policy_json: unknown }>(
    `SELECT policy_json FROM outcome_player_pav_policy
     WHERE policy_id=$1 AND environment=$2::"OutcomeEnvironment" FOR SHARE`,
    [policyId, environment]
  );
  let candidate: AflTradePlayerPavPolicy;
  try {
    candidate = aflTradePlayerPavPolicySchema.parse(stored.rows[0]?.policy_json);
  } catch {
    throw new AflTradePlayerPavObservationError(
      'POLICY_NOT_CURRENT',
      'Stored player-PAV policy is absent or failed authentication.'
    );
  }
  await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `outcome-review-subject:player_pav_policy:${candidate.content.competition}:${candidate.content.policyVersion}`,
  ]);
  const current = await transaction.query<PolicyRow>(
    `SELECT policy.policy_json,decision.decision,
       EXISTS (SELECT 1 FROM outcome_review_decision successor
         WHERE successor.supersedes_decision_id=decision.decision_id) AS has_successor
     FROM outcome_player_pav_policy policy
     JOIN outcome_review_decision decision
       ON decision.decision_id=policy.approval_decision_id
     WHERE policy.policy_id=$1 AND policy.environment=$2::"OutcomeEnvironment"
     FOR SHARE OF policy,decision`,
    [policyId, environment]
  );
  const row = current.rows[0];
  if (
    !row ||
    row.decision !== 'approved' ||
    row.has_successor ||
    canonicalizeAflTradeJson(row.policy_json) !== canonicalizeAflTradeJson(candidate)
  ) {
    throw new AflTradePlayerPavObservationError(
      'POLICY_NOT_CURRENT',
      'Player-PAV policy approval is absent, withdrawn, or superseded.'
    );
  }
  return candidate;
}

function reviewedPredictionSeasons(policy: AflTradePlayerPavPolicy): number[] {
  return [
    ...new Set(
      policy.content.partitions.flatMap(({ fromPredictionSeason, throughPredictionSeason }) =>
        Array.from(
          { length: throughPredictionSeason - fromPredictionSeason + 1 },
          (_, index) => fromPredictionSeason + index
        )
      )
    ),
  ].sort((left, right) => left - right);
}

function partitionFor(
  policy: AflTradePlayerPavPolicy,
  predictionSeason: number
): AflTradeReleasedPlayerSpellPrediction['partition'] {
  const partition = policy.content.partitions.find(
    ({ fromPredictionSeason, throughPredictionSeason }) =>
      predictionSeason >= fromPredictionSeason && predictionSeason <= throughPredictionSeason
  );
  if (!partition) {
    throw new AflTradePlayerPavObservationError(
      'SPELL_MEMBERSHIP_INCOMPLETE',
      `Prediction season ${predictionSeason} is outside the reviewed player-PAV policy.`
    );
  }
  return partition.role;
}

async function loadPredictions(
  transaction: AflOutcomeSqlTransaction,
  releaseId: string,
  environment: AflTradePlayerPavExecutionContext['environment'],
  policy: AflTradePlayerPavPolicy
): Promise<AflTradeReleasedPlayerSpellPrediction[]> {
  const seasons = reviewedPredictionSeasons(policy);
  const result = await transaction.query<SpellRow>(
    `SELECT spell.spell_version_id,spell.spell_id,spell.player_id,spell.club_id,
       spell.start_date,spell.end_date,spell.recorded_at,reviewed.prediction_season
     FROM outcome_active_release active
     JOIN outcome_release_manifest release ON release.release_id=active.release_id
     JOIN outcome_release_acquisition_spell member ON member.release_id=release.release_id
     JOIN outcome_acquisition_spell_version spell
       ON spell.spell_version_id=member.spell_version_id
     CROSS JOIN unnest($4::integer[]) AS reviewed(prediction_season)
     WHERE active.release_id=$1 AND release.environment=$2::TEXT
       AND release.manifest_json#>>'{content,competition}'=$3
       AND spell.status='approved'::"OutcomeRecordStatus"
       AND spell.start_date<=make_date(reviewed.prediction_season,12,31)
       AND (spell.end_date IS NULL OR spell.end_date>=make_date(reviewed.prediction_season,12,31))
     ORDER BY reviewed.prediction_season,spell.player_id,spell.spell_version_id
     FOR SHARE OF active,release,member,spell`,
    [releaseId, environment, policy.content.competition, seasons]
  );
  const representedPartitions = new Set(
    result.rows.map(({ prediction_season }) => partitionFor(policy, prediction_season))
  );
  if (
    result.rows.length < 4 ||
    policy.content.partitions.some(({ role }) => !representedPartitions.has(role))
  ) {
    throw new AflTradePlayerPavObservationError(
      'SPELL_MEMBERSHIP_INCOMPLETE',
      'The active factual release does not contain reviewed acquisition-spell coverage for every model partition.'
    );
  }
  return result.rows.map((row) => ({
    releaseId,
    partition: partitionFor(policy, row.prediction_season),
    predictionSeason: row.prediction_season,
    playerId: row.player_id,
    acquisitionSpell: {
      spellId: row.spell_id,
      spellVersionId: row.spell_version_id,
      clubId: row.club_id,
      effectiveFrom: dateOnly(row.start_date),
      effectiveThrough: row.end_date === null ? null : dateOnly(row.end_date),
      recordedAt: iso(row.recorded_at),
    },
  }));
}

async function loadCalculations(
  transaction: AflOutcomeSqlTransaction,
  policy: AflTradePlayerPavPolicy,
  predictions: readonly AflTradeReleasedPlayerSpellPrediction[],
  knowledgeCutoffAt: string
): Promise<AflTradePlayerPavCalculationEvidence[]> {
  const seasons = [
    ...new Set(
      predictions.flatMap(({ predictionSeason }) => [
        ...Array.from(
          { length: policy.content.featureHistorySeasons },
          (_, offset) => predictionSeason - policy.content.featureHistorySeasons + 1 + offset
        ),
        ...Array.from(
          { length: policy.content.fixedHorizonSeasons },
          (_, offset) => predictionSeason + 1 + offset
        ),
      ])
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
      throw new AflTradePlayerPavObservationError(
        'CALCULATION_EVIDENCE_INCOMPLETE',
        'A selected player-PAV calculation has incomplete durable membership.'
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
        effectiveThrough: calculation.content.effectiveThrough,
        calculatedAt: calculation.content.calculatedAt,
        spellVersionId: player.spellVersionId,
        playerId: player.playerId,
        playerSha256: sha256AflTradeCanonicalJson(player),
        clubId: player.teamId,
        sourceRowIds: player.source.sourceRowIds,
        gamesPlayed: player.source.gamesPlayed,
        offensivePav: player.offensivePav,
        midfieldPav: player.midfieldPav,
        defensivePav: player.defensivePav,
        totalPav: player.totalPav,
      })),
    };
  });
}

async function findReplay(
  transaction: AflOutcomeSqlTransaction,
  environment: AflTradePlayerPavExecutionContext['environment'],
  releaseId: string,
  policyId: string,
  knowledgeCutoffAt: string
): Promise<AflTradePlayerPavObservationSet | null> {
  const result = await transaction.query<ObservationSetRow>(
    `SELECT parent.observation_set_json,parent.finalized_at,parent.calculation_count,
       parent.observation_count,
       (SELECT count(*)::integer FROM outcome_player_pav_calculation_member child
         WHERE child.observation_set_id=parent.observation_set_id) AS actual_calculation_count,
       (SELECT count(*)::integer FROM outcome_player_pav_observation child
         WHERE child.observation_set_id=parent.observation_set_id) AS actual_observation_count
     FROM outcome_player_pav_observation_set parent
     WHERE parent.environment=$1::"OutcomeEnvironment" AND parent.release_id=$2
       AND parent.policy_id=$3 AND parent.knowledge_cutoff_at=$4::timestamptz
     FOR SHARE OF parent`,
    [environment, releaseId, policyId, knowledgeCutoffAt]
  );
  const row = result.rows[0];
  if (!row) return null;
  try {
    const set = aflTradePlayerPavObservationSetSchema.parse(row.observation_set_json);
    if (
      !row.finalized_at ||
      row.calculation_count !== row.actual_calculation_count ||
      row.observation_count !== row.actual_observation_count
    ) {
      throw new Error('incomplete');
    }
    return set;
  } catch {
    throw new AflTradePlayerPavObservationError(
      'REPLAY_CONFLICT',
      'The logical player-PAV scope contains incomplete or unauthenticated immutable content.'
    );
  }
}

async function requireCurrentAuthority(
  transaction: AflOutcomeSqlTransaction,
  set: AflTradePlayerPavObservationSet,
  suppliedPolicy?: AflTradePlayerPavPolicy,
  suppliedPredictions?: readonly AflTradeReleasedPlayerSpellPrediction[]
): Promise<void> {
  const policy =
    suppliedPolicy ??
    (await loadPolicy(transaction, set.content.policy.policyId, set.content.environment));
  if (canonicalizeAflTradeJson(policy) !== canonicalizeAflTradeJson(set.content.policy)) {
    throw new AflTradePlayerPavObservationError(
      'POLICY_NOT_CURRENT',
      'The observation set is not bound to the exact current player-PAV policy.'
    );
  }
  const predictions =
    suppliedPredictions ??
    (await loadPredictions(transaction, set.content.releaseId, set.content.environment, policy));
  const expected = predictions.map((prediction) => canonicalizeAflTradeJson(prediction)).sort();
  const actual = set.content.observations
    .map((observation) =>
      canonicalizeAflTradeJson({
        releaseId: observation.releaseId,
        partition: observation.partition,
        predictionSeason: observation.predictionSeason,
        playerId: observation.playerId,
        acquisitionSpell: observation.acquisitionSpell,
      })
    )
    .sort();
  if (canonicalizeAflTradeJson(actual) !== canonicalizeAflTradeJson(expected)) {
    throw new AflTradePlayerPavObservationError(
      'RELEASE_NOT_CURRENT',
      'The observation set no longer matches the exact active factual release spell membership.'
    );
  }
  const current = await transaction.query<{ calculation_id: string }>(
    `SELECT member.calculation_id
     FROM outcome_player_pav_calculation_member member
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
  const expectedCalculationIds = set.content.calculations
    .map(({ calculationId }) => calculationId)
    .sort();
  if (
    canonicalizeAflTradeJson(current.rows.map(({ calculation_id }) => calculation_id)) !==
    canonicalizeAflTradeJson(expectedCalculationIds)
  ) {
    throw new AflTradePlayerPavObservationError(
      'CALCULATION_EVIDENCE_INCOMPLETE',
      'The observation set references an HPN calculation that is no longer current.'
    );
  }
}

async function persistSet(
  transaction: AflOutcomeSqlTransaction,
  set: AflTradePlayerPavObservationSet
): Promise<void> {
  const content = set.content;
  await transaction.query(
    `INSERT INTO outcome_player_pav_observation_set
      (observation_set_id,observation_set_sha256,environment,competition,release_id,policy_id,
       created_at,knowledge_cutoff_at,status,calculation_count,observation_count,
       observation_set_json,finalized_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'building',$9,$10,$11::jsonb,NULL)`,
    [
      set.observationSetId,
      digestFromId(set.observationSetId, 'player-pav-observation-set'),
      content.environment,
      content.competition,
      content.releaseId,
      content.policy.policyId,
      content.createdAt,
      content.knowledgeCutoffAt,
      content.calculations.length,
      content.observations.length,
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
    `INSERT INTO outcome_player_pav_calculation_member
      (observation_set_id,calculation_id,ordinal,calculation_sha256,membership_json)
     SELECT "observationSetId","calculationId",ordinal,"calculationSha256","membershipJson"
     FROM jsonb_to_recordset($1::jsonb) AS value(
       "observationSetId" text,"calculationId" text,ordinal integer,
       "calculationSha256" text,"membershipJson" jsonb)`,
    [canonicalizeAflTradeJson(calculations)]
  );
  const observations = content.observations.map((observation) => ({
    observationSetId: set.observationSetId,
    observationId: observation.observationId,
    ordinal: observation.ordinal,
    partition: observation.partition,
    predictionSeason: observation.predictionSeason,
    playerId: observation.playerId,
    spellVersionId: observation.acquisitionSpell.spellVersionId,
    outcomeState: observation.outcome.state,
    featureValueCount: observation.featureValues.length,
    targetValueCount: observation.targetValues.length,
    observationSha256: digestFromId(observation.observationId, 'player-pav-observation'),
    observationJson: observation,
  }));
  await transaction.query(
    `INSERT INTO outcome_player_pav_observation
      (observation_set_id,observation_id,ordinal,partition,prediction_season,player_id,
       spell_version_id,outcome_state,feature_value_count,target_value_count,
       observation_sha256,observation_json)
     SELECT "observationSetId","observationId",ordinal,partition,"predictionSeason","playerId",
       "spellVersionId","outcomeState","featureValueCount","targetValueCount",
       "observationSha256","observationJson"
     FROM jsonb_to_recordset($1::jsonb) AS value(
       "observationSetId" text,"observationId" text,ordinal integer,partition text,
       "predictionSeason" integer,"playerId" text,"spellVersionId" text,"outcomeState" text,
       "featureValueCount" integer,"targetValueCount" integer,"observationSha256" text,
       "observationJson" jsonb)`,
    [canonicalizeAflTradeJson(observations)]
  );
  const values = content.observations.flatMap((observation) =>
    [
      ...observation.featureValues.map((value, ordinal) => ({
        role: 'feature',
        ordinal,
        value,
      })),
      ...observation.targetValues.map((value, ordinal) => ({
        role: 'target',
        ordinal,
        value,
      })),
    ].map(({ role, ordinal, value }) => ({
      observationSetId: set.observationSetId,
      observationId: observation.observationId,
      role,
      ordinal,
      ...value,
      valueJson: value,
    }))
  );
  await transaction.query(
    `INSERT INTO outcome_player_pav_value
      (observation_set_id,observation_id,value_role,ordinal,calculation_id,spell_version_id,
       player_id,club_id,player_sha256,games_played,total_pav,value_json)
     SELECT "observationSetId","observationId",role,ordinal,"calculationId","spellVersionId",
       "playerId","clubId","playerSha256","gamesPlayed","totalPav","valueJson"
     FROM jsonb_to_recordset($1::jsonb) AS value(
       "observationSetId" text,"observationId" text,role text,ordinal integer,
       "calculationId" text,"spellVersionId" text,"playerId" text,"clubId" text,
       "playerSha256" text,"gamesPlayed" integer,"totalPav" double precision,"valueJson" jsonb)`,
    [canonicalizeAflTradeJson(values)]
  );
  const finalized = await transaction.query(
    `UPDATE outcome_player_pav_observation_set
        SET status='finalized',finalized_at=created_at
      WHERE observation_set_id=$1 AND status='building'`,
    [set.observationSetId]
  );
  if (finalized.rowCount !== 1) {
    throw new AflTradePlayerPavObservationError(
      'PERSISTENCE_REJECTED',
      'Player-PAV observation set did not finalize.'
    );
  }
}

export class PostgresAflTradePlayerPavObservationRepository implements AflTradePlayerPavObservationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async registerPolicy(input: unknown, execution: AflTradePlayerPavExecutionContext) {
    let policy: AflTradePlayerPavPolicy;
    try {
      policy = aflTradePlayerPavPolicySchema.parse(input);
    } catch (error) {
      throw new AflTradePlayerPavObservationError(
        'INVALID_POLICY',
        error instanceof Error ? error.message : 'Invalid player-PAV policy.'
      );
    }
    if (policy.content.environment !== execution.environment) {
      throw new AflTradePlayerPavObservationError(
        'ENVIRONMENT_MISMATCH',
        'Player-PAV policy execution environment mismatch.'
      );
    }
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `outcome-player-pav-policy:${policy.policyId}`,
        ]);
        const existing = await transaction.query<{ policy_json: unknown }>(
          `SELECT policy_json FROM outcome_player_pav_policy WHERE policy_id=$1 FOR SHARE`,
          [policy.policyId]
        );
        if (existing.rows[0]) {
          const stored = aflTradePlayerPavPolicySchema.parse(existing.rows[0].policy_json);
          if (canonicalizeAflTradeJson(stored) !== canonicalizeAflTradeJson(policy)) {
            throw new AflTradePlayerPavObservationError(
              'REPLAY_CONFLICT',
              'Stored player-PAV policy differs.'
            );
          }
          return stored;
        }
        await transaction.query(
          `INSERT INTO outcome_player_pav_policy
            (policy_id,policy_sha256,environment,competition,policy_version,method_id,
             approval_decision_id,created_at,policy_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            policy.policyId,
            digestFromId(policy.policyId, 'player-pav-policy'),
            policy.content.environment,
            policy.content.competition,
            policy.content.policyVersion,
            policy.content.methodId,
            policy.content.approvalDecision.id,
            policy.content.createdAt,
            canonicalizeAflTradeJson(policy),
          ]
        );
        return policy;
      });
    } catch (error) {
      if (error instanceof AflTradePlayerPavObservationError) throw error;
      throw new AflTradePlayerPavObservationError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected the player-PAV policy.'
      );
    }
  }

  async materializeAndPersist(input: unknown, execution: AflTradePlayerPavExecutionContext) {
    let request: ReturnType<typeof aflTradePlayerPavMaterializationRequestSchema.parse>;
    try {
      request = aflTradePlayerPavMaterializationRequestSchema.parse(input);
    } catch (error) {
      throw new AflTradePlayerPavObservationError(
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid player-PAV materialization request.'
      );
    }
    if (request.environment !== execution.environment) {
      throw new AflTradePlayerPavObservationError(
        'ENVIRONMENT_MISMATCH',
        'Player-PAV materialization environment mismatch.'
      );
    }
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `outcome-player-pav-set:${request.environment}:${request.releaseId}:${request.policyId}:${request.knowledgeCutoffAt}`,
        ]);
        const policy = await loadPolicy(transaction, request.policyId, request.environment);
        if (policy.content.competition !== request.competition) {
          throw new AflTradePlayerPavObservationError(
            'POLICY_NOT_CURRENT',
            'The requested competition does not match the current player-PAV policy.'
          );
        }
        const predictions = await loadPredictions(
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
          await requireCurrentAuthority(transaction, replay, policy, predictions);
          return { observationSet: replay, idempotentReplay: true };
        }
        const createdAt = await trustedNow(transaction);
        const calculations = await loadCalculations(
          transaction,
          policy,
          predictions,
          request.knowledgeCutoffAt
        );
        const observationSet = materializeAflTradePlayerPavObservationSet({
          environment: request.environment,
          competition: request.competition,
          createdAt,
          knowledgeCutoffAt: request.knowledgeCutoffAt,
          releaseId: request.releaseId,
          policy,
          predictions,
          calculations,
        });
        await persistSet(transaction, observationSet);
        return { observationSet, idempotentReplay: false };
      });
    } catch (error) {
      if (error instanceof AflTradePlayerPavObservationError) throw error;
      throw new AflTradePlayerPavObservationError(
        'PERSISTENCE_REJECTED',
        error instanceof Error ? error.message : 'PostgreSQL rejected player-PAV materialization.'
      );
    }
  }

  async loadFinalized(input: unknown, execution: AflTradePlayerPavExecutionContext) {
    let request: ReturnType<typeof aflTradeFinalizedPlayerPavObservationSetRequestSchema.parse>;
    try {
      request = aflTradeFinalizedPlayerPavObservationSetRequestSchema.parse(input);
    } catch (error) {
      throw new AflTradePlayerPavObservationError(
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid finalized player-PAV request.'
      );
    }
    if (request.environment !== execution.environment) {
      throw new AflTradePlayerPavObservationError(
        'ENVIRONMENT_MISMATCH',
        'Player-PAV load environment mismatch.'
      );
    }
    return this.client.transaction(async (transaction) => {
      const result = await transaction.query<ObservationSetRow>(
        `SELECT parent.observation_set_json,parent.finalized_at,parent.calculation_count,
           parent.observation_count,
           (SELECT count(*)::integer FROM outcome_player_pav_calculation_member child
             WHERE child.observation_set_id=parent.observation_set_id) AS actual_calculation_count,
           (SELECT count(*)::integer FROM outcome_player_pav_observation child
             WHERE child.observation_set_id=parent.observation_set_id) AS actual_observation_count
         FROM outcome_player_pav_observation_set parent
         WHERE parent.observation_set_id=$1 AND parent.environment=$2::"OutcomeEnvironment"
         FOR SHARE OF parent`,
        [request.observationSetId, request.environment]
      );
      const row = result.rows[0];
      if (!row || !row.finalized_at) {
        throw new AflTradePlayerPavObservationError(
          'NOT_FINALIZED',
          'Player-PAV observation set is absent or not finalized.'
        );
      }
      let set: AflTradePlayerPavObservationSet;
      try {
        set = aflTradePlayerPavObservationSetSchema.parse(row.observation_set_json);
      } catch {
        throw new AflTradePlayerPavObservationError(
          'NOT_FINALIZED',
          'Stored player-PAV observation-set content failed authentication.'
        );
      }
      if (
        row.calculation_count !== row.actual_calculation_count ||
        row.observation_count !== row.actual_observation_count
      ) {
        throw new AflTradePlayerPavObservationError(
          'NOT_FINALIZED',
          'Player-PAV observation-set child counts drifted.'
        );
      }
      await requireCurrentAuthority(transaction, set);
      return set;
    });
  }
}

export function createPostgresAflTradePlayerPavObservationRepository(
  client: AflOutcomeSqlClient
): AflTradePlayerPavObservationRepository {
  return new PostgresAflTradePlayerPavObservationRepository(client);
}
