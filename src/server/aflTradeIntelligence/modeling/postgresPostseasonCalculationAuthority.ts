import { z } from 'zod';

import { doesAflTradeArtifactRefMatchBytes } from '../artifacts/artifactReference';
import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeFinalizedHpnPavCalculationSchema,
  type AflTradeFinalizedHpnPavCalculation,
  type AflTradeHpnPavMethodAuthority,
} from './hpnPavCalculationService';
import { aflTradeHpnPavMethodSchema } from './hpnPlayerApproximateValue';
import { PostgresAflTradeHpnPavInputRepository } from './postgresHpnPavInputRepository';

const requestSchema = z
  .object({
    calculationId: aflTradeContentAddressedIdSchema('hpn-pav-season'),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    environment: z.enum(['test_fixture', 'non_production']),
    competition: z.literal('AFLM'),
    seasonYear: z.number().int().min(1998).max(2200),
    knowledgeCutoffAt: z.iso.datetime({ offset: true }),
  })
  .strict();

type Calculation = AflTradeFinalizedHpnPavCalculation;
interface RetainedRow {
  calculation_json: unknown;
  calculation_canonical_json: string;
  method_json: unknown;
  teams: unknown;
  players: unknown;
}

/** Exact child values as persisted by the calculation owner, including order and row digests. */
function expectedTeams(calculation: Calculation) {
  return calculation.content.teams.map((team, ordinal) => ({
    team_id: team.teamId,
    ordinal,
    team_sha256: sha256AflTradeCanonicalJson(team),
    offensive_pav: team.offensivePav,
    midfield_pav: team.midfieldPav,
    defensive_pav: team.defensivePav,
    total_pav: team.totalPav,
    team_canonical_json: canonicalizeAflTradeJson(team),
  }));
}

function expectedPlayers(calculation: Calculation) {
  return calculation.content.players.map((player, ordinal) => ({
    spell_version_id: player.spellVersionId,
    player_id: player.playerId,
    team_id: player.teamId,
    ordinal,
    player_sha256: sha256AflTradeCanonicalJson(player),
    offensive_pav: player.offensivePav,
    midfield_pav: player.midfieldPav,
    defensive_pav: player.defensivePav,
    total_pav: player.totalPav,
    player_canonical_json: canonicalizeAflTradeJson(player),
  }));
}

/**
 * Runs inside the materialization transaction so its head/source locks survive until persistence.
 * A retained finalized calculation alone is insufficient: its current inputs are reauthenticated.
 */
export async function loadCurrentAflTradePostseasonCalculation(
  transaction: AflOutcomeSqlTransaction,
  input: unknown,
  methodAuthority: AflTradeHpnPavMethodAuthority
) {
  const request = requestSchema.parse(input);
  const result = await transaction.query<RetainedRow>(
    `SELECT calculation.calculation_json,calculation.calculation_canonical_json,method.method_json,
       (SELECT jsonb_agg(to_jsonb(team)-'calculation_id' ORDER BY ordinal)
        FROM outcome_hpn_pav_calculation_team team
        WHERE team.calculation_id=calculation.calculation_id) AS teams,
       (SELECT jsonb_agg(to_jsonb(player)-'calculation_id' ORDER BY ordinal)
        FROM outcome_hpn_pav_calculation_player player
        WHERE player.calculation_id=calculation.calculation_id) AS players
     FROM outcome_hpn_pav_calculation calculation
     JOIN outcome_hpn_pav_calculation_head head
       ON head.calculation_id=calculation.calculation_id
       AND head.environment=calculation.environment AND head.competition=calculation.competition
       AND head.method_id=calculation.method_id AND head.season_year=calculation.season_year
     JOIN outcome_hpn_pav_method method ON method.method_id=calculation.method_id
       AND method.environment=calculation.environment
     WHERE calculation.calculation_id=$1 AND calculation.method_id=$2
       AND calculation.environment=$3::"OutcomeEnvironment" AND calculation.competition=$4
       AND calculation.season_year=$5 AND calculation.status='finalized'
       AND calculation.finalized_at>=calculation.calculated_at
       AND calculation.finalized_at<=$6::timestamptz
       AND calculation.effective_through<=$6::timestamptz
       AND $6::timestamptz<=transaction_timestamp()
       AND calculation.calculation_sha256=substring(calculation.calculation_id FROM 16)
       AND calculation.input_set_id=calculation.calculation_json#>>'{content,inputSetId}'
       AND calculation.schema_version=calculation.calculation_json#>>'{content,schemaVersion}'
       AND calculation.value_unit=calculation.calculation_json#>>'{content,valueUnit}'
       AND calculation.calculated_at=(calculation.calculation_json#>>'{content,calculatedAt}')::timestamptz
       AND calculation.effective_through=(calculation.calculation_json#>>'{content,effectiveThrough}')::timestamptz
       AND calculation.team_count=jsonb_array_length(calculation.calculation_json#>'{content,teams}')
       AND calculation.player_count=jsonb_array_length(calculation.calculation_json#>'{content,players}')
     FOR SHARE OF calculation,head,method`,
    [
      request.calculationId,
      request.methodId,
      request.environment,
      request.competition,
      request.seasonYear,
      request.knowledgeCutoffAt,
    ]
  );
  if (result.rows.length !== 1)
    throw new Error('Postseason calculation is not current and finalized.');
  const row = result.rows[0]!;
  const calculation = aflTradeFinalizedHpnPavCalculationSchema.parse(row.calculation_json);
  const content = calculation.content;
  if (
    calculation.calculationId !== request.calculationId ||
    content.methodId !== request.methodId ||
    content.environment !== request.environment ||
    content.competition !== request.competition ||
    content.seasonYear !== request.seasonYear ||
    canonicalizeAflTradeJson(content) !== row.calculation_canonical_json ||
    canonicalizeAflTradeJson(expectedTeams(calculation)) !== canonicalizeAflTradeJson(row.teams) ||
    canonicalizeAflTradeJson(expectedPlayers(calculation)) !== canonicalizeAflTradeJson(row.players)
  )
    throw new Error('Postseason calculation content differs from exact persisted membership.');

  const retainedMethod = await methodAuthority.loadExact(request.methodId);
  const method = aflTradeHpnPavMethodSchema.parse(retainedMethod.method);
  if (
    method.methodId !== request.methodId ||
    canonicalizeAflTradeJson(method) !== canonicalizeAflTradeJson(row.method_json) ||
    !doesAflTradeArtifactRefMatchBytes(
      method.content.sourceArtifact,
      retainedMethod.sourceBytes,
      'text/html'
    )
  ) {
    throw new Error('Postseason calculation method custody differs.');
  }
  const inputSet = await new PostgresAflTradeHpnPavInputRepository({
    query: transaction.query.bind(transaction),
    transaction: async (work) => work(transaction),
  }).loadCurrentFinalizedSeasonInputSet(
    {
      inputSetId: content.inputSetId,
      environment: request.environment,
      competition: request.competition,
      seasonYear: request.seasonYear,
      methodId: request.methodId,
    },
    { environment: request.environment }
  );
  if (
    inputSet.content.effectiveThrough !== content.effectiveThrough ||
    inputSet.content.factualUniverse.factualRunId !== content.factualRunId ||
    inputSet.content.factualUniverse.inputSetSha256 !== content.factualInputSetSha256 ||
    Date.parse(inputSet.content.createdAt) > Date.parse(content.calculatedAt)
  ) {
    throw new Error('Postseason calculation input ancestry differs.');
  }
  return { calculation, inputSet };
}
