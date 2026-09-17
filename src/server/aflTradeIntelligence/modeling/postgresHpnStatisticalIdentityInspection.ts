import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  choosePlayerClub,
  currentPlayerResolution,
  currentResolution,
} from './hpnCurrentResolution';
import { clubResolutionSql, resolutionSql } from './hpnCurrentResolutionSql';
import { decodedScalar } from './hpnDecodedScalar';
import type { AflTradeHpnPavInputFieldMap } from './hpnPavInputContracts';
import type { AflTradeHpnStatisticalCell } from './hpnStatisticalAdjudication';

interface IdentityRow {
  player_resolution: unknown;
  match_resolution: unknown;
  home_club_resolutions: unknown;
  away_club_resolutions: unknown;
  home_club_native_id: string | null;
  home_club_name: string | null;
  away_club_native_id: string | null;
  away_club_name: string | null;
  competition: string | null;
  season_year: number | null;
  home_club_id: string | null;
  away_club_id: string | null;
}

/**
 * Read-only inspection of current resolutions, using the input repository's existing predicates.
 * Call only after this transaction authenticates the row/map/value for the parsed cell. Returned
 * snapshots are not durable authorization: promotion/consumption must lock and recheck them.
 */
export async function inspectAflTradeHpnStatisticalIdentity(
  transaction: AflOutcomeSqlTransaction,
  cell: AflTradeHpnStatisticalCell,
  rowId: string,
  map: AflTradeHpnPavInputFieldMap,
  typedPayload: unknown
) {
  if (map.content.inputKind !== 'player_match_stats')
    throw new Error('Expected a player-stat map.');
  let clubField: string;
  if (map.content.schemaVersion === 'afl-trade-hpn-projected-field-map/v1') {
    const binding = map.content.semanticBindings.find((item) => item.semanticField === 'club');
    if (binding?.mapping.kind !== 'direct')
      throw new Error('Club requires a reviewed direct field.');
    clubField = binding.mapping.sourceField;
  } else clubField = map.content.bindings.club;
  const result = await transaction.query<IdentityRow>(
    `SELECT player_resolution.value AS player_resolution,match_resolution.value AS match_resolution,
            home_club.values AS home_club_resolutions,away_club.values AS away_club_resolutions,
            match_candidate.home_club_native_id,match_candidate.home_club_name,
            match_candidate.away_club_native_id,match_candidate.away_club_name,
            canonical_match.competition,canonical_match.season_year,
            canonical_match.home_club_id,canonical_match.away_club_id
       FROM outcome_provider_decoded_row decoded
       LEFT JOIN outcome_provider_identity_candidate identity_candidate
         ON identity_candidate.provider_decoded_row_id=decoded.provider_decoded_row_id
       LEFT JOIN outcome_provider_match_candidate match_candidate
         ON match_candidate.provider_decoded_row_id=decoded.provider_decoded_row_id
       LEFT JOIN LATERAL (${resolutionSql('player', 'identity_candidate')}) player_resolution ON TRUE
       LEFT JOIN LATERAL (${resolutionSql('match', 'match_candidate')}) match_resolution ON TRUE
       LEFT JOIN outcome_match canonical_match ON canonical_match.match_id=match_resolution.value->>'canonicalId'
       LEFT JOIN LATERAL (${clubResolutionSql('home')}) home_club ON TRUE
       LEFT JOIN LATERAL (${clubResolutionSql('away')}) away_club ON TRUE
      WHERE decoded.provider_decoded_row_id=$1`,
    [rowId]
  );
  if (result.rows.length !== 1)
    throw new Error('Exact statistical identity context is unavailable.');
  const row = result.rows[0];
  const sourceClub = decodedScalar(typedPayload, clubField);
  const player = currentPlayerResolution(row.player_resolution);
  const match = currentResolution('match', row.match_resolution);
  const club = choosePlayerClub(row, sourceClub);
  const home = sourceClub === row.home_club_native_id || sourceClub === row.home_club_name;
  if (
    player.canonicalId !== cell.scope.playerId ||
    match.canonicalId !== cell.scope.matchId ||
    club.canonicalId !== cell.scope.clubId ||
    row.competition !== cell.scope.competitionId ||
    row.season_year !== cell.scope.season ||
    row.home_club_id === row.away_club_id ||
    club.canonicalId !== (home ? row.home_club_id : row.away_club_id)
  ) {
    throw new Error(
      'Statistical cell does not match the current canonical player, match, club and season.'
    );
  }
  return { player, match, club };
}
