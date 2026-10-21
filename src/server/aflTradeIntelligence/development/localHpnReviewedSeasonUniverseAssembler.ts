import { z } from 'zod';

import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import {
  createAflTradeHpnReviewedSeasonUniverseCandidate,
  type AflTradeHpnReviewedSeasonMember,
} from '../modeling/hpnReviewedSeasonUniverse';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256 } from './localFiveSeasonAflTablesReview';
import { loadExactLocalReviewedProviderEvidenceBundle } from './localReviewedProviderEvidence';

interface MapRow extends Record<string, unknown> {
  input_kind: 'completed_match_result' | 'player_match_stats';
  field_map_id: string;
}

interface RunRow extends Record<string, unknown> {
  trusted_at: Date | string;
  capture_id: string;
  normalization_run_id: string;
  source_row_count: number | string;
  accepted_row_count: number | string;
  issue_count: number | string;
  status: 'staged' | 'needs_review';
}

interface DecodedRow extends Record<string, unknown> {
  provider_decoded_row_id: string;
  source_row_sha256: string;
  typed_payload: unknown;
  native_entity_id: string | null;
  identity_candidate_id: string | null;
  identity_decision_id: string | null;
}

type TypedCell = Readonly<{ kind: string; value?: string }>;

function values(payload: unknown): Record<string, TypedCell> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new TypeError('An HPN decoded row has no typed payload.');
  }
  const retained = (payload as Record<string, unknown>).values;
  if (typeof retained !== 'object' || retained === null || Array.isArray(retained)) {
    throw new TypeError('An HPN decoded row has no typed values.');
  }
  return retained as Record<string, TypedCell>;
}

function text(cells: Record<string, TypedCell>, field: string): string {
  const cell = cells[field];
  if (!cell || !['text', 'date', 'integer', 'finite_number'].includes(cell.kind)) {
    throw new TypeError(`HPN field ${field} is unavailable.`);
  }
  return z.string().min(1).parse(cell.value);
}

function optionalText(cells: Record<string, TypedCell>, field: string): string | null {
  const cell = cells[field];
  if (!cell || cell.kind === 'missing') return null;
  return text(cells, field);
}

function integer(cells: Record<string, TypedCell>, field: string): number {
  const value = Number(text(cells, field));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`HPN field ${field} is not a non-negative integer.`);
  }
  return value;
}

function slug(value: string): string {
  const result = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
  if (result === '') throw new TypeError('An HPN club name cannot form a canonical identifier.');
  return result;
}

function member(row: DecodedRow): AflTradeHpnReviewedSeasonMember {
  const cells = values(row.typed_payload);
  const matchDate = text(cells, 'Date');
  const homeClubId = `local-afl-club:${slug(text(cells, 'Home.team'))}`;
  const awayClubId = `local-afl-club:${slug(text(cells, 'Away.team'))}`;
  const playingForClubId = `local-afl-club:${slug(text(cells, 'Playing.for'))}`;
  if (
    row.native_entity_id !== null &&
    (row.identity_candidate_id === null || row.identity_decision_id === null)
  ) {
    throw new TypeError('A source player identity exists without its exact current review.');
  }
  return {
    providerDecodedRowId: row.provider_decoded_row_id,
    sourceRowSha256: row.source_row_sha256,
    typedPayloadSha256: sha256AflTradeCanonicalJson(row.typed_payload),
    matchId: `local-afl-match:${matchDate}:${slug(text(cells, 'Home.team'))}:${slug(
      text(cells, 'Away.team')
    )}`,
    matchDate,
    homeClubId,
    awayClubId,
    homePoints: integer(cells, 'Home.score'),
    awayPoints: integer(cells, 'Away.score'),
    playingForClubId,
    playerIdentity:
      row.native_entity_id === null
        ? {
            state: 'quarantined',
            reason: 'missing_source_identity',
            recordedName: optionalText(cells, 'Player'),
          }
        : {
            state: 'resolved',
            canonicalPlayerId: `local-afl-player:afl-tables:${row.native_entity_id}`,
            identityDecisionId: row.identity_decision_id!,
          },
    stats: {
      totalPoints: integer(cells, 'Goals') * 6 + integer(cells, 'Behinds'),
      hitOuts: integer(cells, 'Hit.Outs'),
      goalAssists: integer(cells, 'Goal.Assists'),
      inside50s: integer(cells, 'Inside.50s'),
      marks: integer(cells, 'Marks'),
      marksInside50: integer(cells, 'Marks.Inside.50'),
      freeKicksFor: integer(cells, 'Frees.For'),
      freeKicksAgainst: integer(cells, 'Frees.Against'),
      rebound50s: integer(cells, 'Rebounds'),
      onePercenters: integer(cells, 'One.Percenters'),
      clearances: integer(cells, 'Clearances'),
      tackles: integer(cells, 'Tackles'),
    },
  };
}

export async function assembleLocalAflTradeHpnReviewedSeasonUniverseCandidate(
  client: AflOutcomeSqlClient,
  seasonYear: number
) {
  return client.transaction(async (transaction) => {
    const runResult = await transaction.query<RunRow>(
      `SELECT transaction_timestamp() AS trusted_at,capture.capture_id,
              run.normalization_run_id,run.source_row_count,run.accepted_row_count,
              run.issue_count,run.status
         FROM outcome_source_capture capture
         JOIN LATERAL (
           SELECT candidate.* FROM outcome_provider_normalization_run candidate
            WHERE candidate.capture_id=capture.capture_id
              AND candidate.finalized_at IS NOT NULL
            ORDER BY candidate.finalized_at DESC,candidate.normalization_run_id DESC LIMIT 1
         ) run ON true
        WHERE capture.environment='non_production' AND capture.status='staged'
          AND capture.provider='afl_tables'
          AND capture.capability_id='afl-tables-player-stats'
          AND capture.anchor_season_year=$1
        FOR KEY SHARE OF capture`,
      [seasonYear]
    );
    const run = runResult.rows[0];
    if (
      runResult.rows.length !== 1 ||
      !run ||
      Number(run.accepted_row_count) > Number(run.source_row_count) ||
      Number(run.issue_count) <
        Number(run.source_row_count) - Number(run.accepted_row_count)
    ) {
      throw new TypeError('The exact finalized HPN source run is unavailable or incomplete.');
    }
    const trustedAt = new Date(run.trusted_at).toISOString();
    await loadExactLocalReviewedProviderEvidenceBundle(transaction, trustedAt);

    const maps = await transaction.query<MapRow>(
      `SELECT map.input_kind,map.field_map_id
         FROM outcome_hpn_projected_field_map map
         JOIN outcome_hpn_field_map_review_decision review
           ON review.decision_id=map.approval_decision_id
        WHERE map.environment='non_production' AND map.competition='AFLM'
          AND map.provider='afl_tables' AND map.capability_id='afl-tables-player-stats'
          AND $1 BETWEEN map.valid_from_season AND map.valid_through_season
          AND review.decision='approved'
          AND NOT EXISTS (
            SELECT 1 FROM outcome_hpn_field_map_review_decision successor
             WHERE successor.candidate_id=review.candidate_id
               AND (successor.registered_at,successor.decision_id)>
                   (review.registered_at,review.decision_id)
          )
        ORDER BY map.input_kind,map.field_map_id`,
      [seasonYear]
    );
    if (
      maps.rows.length !== 2 ||
      new Set(maps.rows.map(({ input_kind }) => input_kind)).size !== 2
    ) {
      throw new TypeError('The exact current result and player HPN maps are unavailable.');
    }
    const resultMap = maps.rows.find(
      ({ input_kind }) => input_kind === 'completed_match_result'
    )!;
    const playerMap = maps.rows.find(({ input_kind }) => input_kind === 'player_match_stats')!;
    const decoded = await transaction.query<DecodedRow>(
      `SELECT decoded.provider_decoded_row_id,decoded.source_row_sha256,
              decoded.typed_payload,identity.native_entity_id,
              identity.identity_candidate_id,identity_review.decision_id AS identity_decision_id
         FROM outcome_provider_decoded_row decoded
         LEFT JOIN outcome_provider_identity_candidate identity
           USING (provider_decoded_row_id)
         LEFT JOIN outcome_review_decision identity_review
           ON identity_review.decision_id=
                'local-afl-tables-review:identity:'||identity.identity_candidate_id
          AND identity_review.subject_type='provider_identity_candidate'
          AND identity_review.subject_id=identity.identity_candidate_id
          AND identity_review.decision='approved'
          AND identity_review.decided_by='local-five-season-evidence-reviewer'
          AND identity_review.evidence_json->>'evidenceSetSha256'=$2
          AND NOT EXISTS (
            SELECT 1 FROM outcome_review_decision successor
             WHERE successor.supersedes_decision_id=identity_review.decision_id
          )
        WHERE decoded.normalization_run_id=$1 AND decoded.season_year=$3
        ORDER BY decoded.provider_decoded_row_id`,
      [
        run.normalization_run_id,
        LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
        seasonYear,
      ]
    );
    if (decoded.rows.length !== Number(run.source_row_count)) {
      throw new TypeError('The HPN reviewed universe does not conserve every finalized row.');
    }
    return createAflTradeHpnReviewedSeasonUniverseCandidate({
      environment: 'non_production',
      competition: 'AFLM',
      seasonYear,
      captureId: run.capture_id,
      normalizationRunId: run.normalization_run_id,
      resultFieldMapId: resultMap.field_map_id,
      playerFieldMapId: playerMap.field_map_id,
      resolvedReviewSetSha256: LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
      normalizationReview: {
        status: run.status,
        sourceRowCount: Number(run.source_row_count),
        acceptedRowCount: Number(run.accepted_row_count),
        issueCount: Number(run.issue_count),
      },
      rows: decoded.rows.map(member),
      createdAt: trustedAt,
    });
  });
}
