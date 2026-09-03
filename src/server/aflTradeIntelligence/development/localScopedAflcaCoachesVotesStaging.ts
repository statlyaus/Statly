import { generateKeyPairSync } from 'node:crypto';
import { resolve } from 'node:path';

import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import { aflTradeSourceSnapshotManifestSchema } from '../artifacts/sourceSnapshotManifest';
import type { AflTradeGateDecisionRecord } from '../governance/gateDecisionTypes';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeEd25519EgressExecutionVerifier } from '../source/fitzRoyHttpEgressExecutor';
import {
  createAflTradeFitzRoyFieldMapSha256,
  type AflTradeFitzRoyFieldMap,
} from '../source/fitzRoyObservationContracts';
import { ingestAuthorizedAflTradeFitzRoyProviderSeason } from '../source/fitzRoyProviderIngestion';
import { PostgresAflTradeProviderObservationRepository } from '../source/postgresProviderObservationRepository';
import { PostgresAflTradeSourceCaptureRepository } from '../source/postgresSourceCaptureRepository';
import { LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256 } from './localFiveSeasonAflTablesReview';
import { createLocalAflTradeDockerFitzRoyCaptureExecutor } from './localDockerFitzRoyCaptureExecutor';
import { createLocalAflTradeDockerFitzRoyDecodeExecutor } from './localDockerFitzRoyDecodeExecutor';
import { createLocalAflTradeNonProductionArtifactRepository } from './localFileConditionalObjectStore';
import {
  assertLocalAflTradeOutcomesRuntimeIdentity,
  requireLocalAflTradeOutcomesRuntimeNonce,
} from './localOutcomesRuntimeIdentity';
import {
  LOCAL_SCOPED_AFLCA_FITZROY_RUNTIME,
  createLocalAflTradeScopedAflcaCoachesVotesAuthority,
} from './localScopedAflcaCoachesVotesAuthority';
import {
  reconcileLocalScopedAflcaVotes,
  type LocalScopedAflTablesParticipant,
  type LocalScopedAflcaVote,
} from './localScopedAflcaReconciliation';

export const LOCAL_SCOPED_AFLCA_SEASONS = [2021, 2022, 2023, 2024, 2025] as const;
const EXPECTED_HOME_AND_AWAY_MATCHES = new Map<number, number>([
  [2021, 198],
  [2022, 198],
  [2023, 207],
  [2024, 207],
  [2025, 207],
]);
const REVIEWER = 'local-scoped-aflca-evidence-reviewer';
const DECIDED_AT = '2026-09-02T00:20:00.000Z';
const REVIEWED_2025_AFLCA_IDENTITY_MAPPINGS = [
  {
    aflTablesNativePlayerId: '12576',
    aflTablesRecordedName: 'Jack Graham',
    aflTablesRecordedClub: 'Richmond',
    aflcaRecordedPlayer: 'Jack Graham (WCE)',
    canonicalClubName: 'West Coast',
  },
  {
    aflTablesNativePlayerId: '12712',
    aflTablesRecordedName: 'Jack Ross',
    aflTablesRecordedClub: 'Richmond',
    aflcaRecordedPlayer: 'Jack Ross (RICH)',
    canonicalClubName: 'Richmond',
  },
].map((review) => {
  const reviewContent = {
    schemaVersion: 'local-scoped-aflca-reviewed-identity/v1',
    decision: 'approved',
    decidedAt: DECIDED_AT,
    decidedBy: 'statly-product-owner',
    aflTablesNativePlayerId: review.aflTablesNativePlayerId,
    aflTablesSeasons: [2021, 2022, 2023, 2024],
    aflTablesRecordedName: review.aflTablesRecordedName,
    aflTablesRecordedClub: review.aflTablesRecordedClub,
    aflcaSeason: 2025,
    aflcaRecordedPlayer: review.aflcaRecordedPlayer,
    rationale:
      'Human-reviewed continuation of one exact historical AFL Tables player into the 2025 AFLCA club context; automatic name-only continuation remains prohibited.',
  } as const;
  const reviewSha256 = sha256AflTradeCanonicalJson(reviewContent);
  return {
    seasonYear: 2025,
    recordedPlayerName: review.aflcaRecordedPlayer,
    canonicalClubName: review.canonicalClubName,
    canonicalPlayerClubId:
      `local_player_club:reconciled-aflca:${review.aflTablesNativePlayerId}:` +
      review.canonicalClubName.toLowerCase().replace(/[^a-z0-9]+/gu, '-'),
    evidenceId: `artifact:${reviewSha256}`,
    reviewDecisionId: `local-scoped-aflca-identity-mapping:${reviewSha256}`,
    reviewContent,
  };
});

const REVIEWED_AFLCA_MATCH_MAPPINGS = [
  {
    source: [2023, 5, 'Hawthorn', 'Greater Western Sydney'],
    target: [2023, 5, 'Greater Western Sydney', 'Hawthorn'],
    rationale:
      'The retained 2023 round-five sources record the same clubs in opposite home/away order.',
  },
  {
    source: [2023, 5, 'North Melbourne', 'Brisbane Lions'],
    target: [2023, 5, 'Brisbane Lions', 'North Melbourne'],
    rationale:
      'The retained 2023 round-five sources record the same clubs in opposite home/away order.',
  },
  {
    source: [2023, 5, 'St Kilda', 'Collingwood'],
    target: [2023, 5, 'Collingwood', 'St Kilda'],
    rationale:
      'The retained 2023 round-five sources record the same clubs in opposite home/away order.',
  },
  {
    source: [2023, 5, 'Sydney', 'Richmond'],
    target: [2023, 5, 'Richmond', 'Sydney'],
    rationale:
      'The retained 2023 round-five sources record the same clubs in opposite home/away order.',
  },
  {
    source: [2025, 4, 'Brisbane Lions', 'Geelong'],
    target: [2025, 1, 'Brisbane Lions', 'Geelong'],
    rationale: 'The retained AFLCA source labels the 2025 Opening Round match as round four.',
  },
  {
    source: [2025, 25, 'Gold Coast', 'Essendon'],
    target: [2025, 1, 'Gold Coast', 'Essendon'],
    rationale:
      'The retained AFLCA source labels the 2025 Opening Round match as round twenty-five.',
  },
] as const;

const REVIEWED_AFLCA_MATCH_MAPPING_RECORDS = REVIEWED_AFLCA_MATCH_MAPPINGS.map((mapping) => {
  const [sourceSeason, sourceRound, sourceHome, sourceAway] = mapping.source;
  const [targetSeason, targetRound, targetHome, targetAway] = mapping.target;
  const reviewContent = {
    schemaVersion: 'local-scoped-aflca-reviewed-match/v1',
    decision: 'approved',
    decidedAt: DECIDED_AT,
    decidedBy: 'statly-product-owner',
    source: {
      seasonYear: sourceSeason,
      roundNumber: sourceRound,
      homeClubName: sourceHome,
      awayClubName: sourceAway,
    },
    target: {
      seasonYear: targetSeason,
      roundNumber: targetRound,
      homeClubName: targetHome,
      awayClubName: targetAway,
    },
    rationale: mapping.rationale,
  } as const;
  const reviewSha256 = sha256AflTradeCanonicalJson(reviewContent);
  return {
    source: reviewContent.source,
    target: reviewContent.target,
    evidenceId: `artifact:${reviewSha256}`,
    reviewDecisionId: `local-scoped-aflca-match-mapping:${reviewSha256}`,
    reviewContent,
  };
});

export interface LocalScopedAflcaStagingOptions {
  readonly artifactRootDirectory: string;
  readonly expectedRuntimeNonce: string;
  readonly imageReference?: string;
}

export function resolveLocalScopedAflcaGateRevision(
  currentDecision: AflTradeGateDecisionRecord | undefined,
  rightsArtifactId: string
): { version: number; supersedesDecisionId: string | null } {
  if (currentDecision === undefined) return { version: 1, supersedesDecisionId: null };
  if (currentDecision.content.state !== 'approved') {
    throw new TypeError(
      'Scoped AFLCA staging cannot supersede a withdrawn or rejected source decision.'
    );
  }
  const alreadyPinsRights = currentDecision.content.affectedArtifacts.some(
    ({ kind, artifactId }) => kind === 'source_rights' && artifactId === rightsArtifactId
  );
  return alreadyPinsRights
    ? {
        version: currentDecision.content.version,
        supersedesDecisionId: currentDecision.content.supersedesDecisionId,
      }
    : {
        version: currentDecision.content.version + 1,
        supersedesDecisionId: currentDecision.decisionId,
      };
}

interface ExistingCaptureRow {
  capture_id: string;
  source_snapshot_id: string;
  normalization_run_id: string;
  anchor_season_year: number;
  manifest_json: unknown;
}

interface CaptureReference {
  capture_id: string;
  normalization_run_id: string;
  anchor_season_year: number;
}

interface RunHealthRow {
  normalization_run_id: string;
  source_row_count: number;
  accepted_row_count: number;
  quarantined_row_count: number;
  issue_count: number;
}

interface ParticipantRow {
  season_year: number;
  round_label: string;
  home_club_name: string;
  away_club_name: string;
  recorded_name: string;
  recorded_club_name: string;
  canonical_player_club_id: string;
  canonical_match_id: string;
}

interface VoteRow {
  provider_decoded_row_id: string;
  identity_candidate_id: string;
  match_candidate_id: string;
  season_year: number;
  round_label: string;
  award_scope: string;
  home_club_name: string;
  away_club_name: string;
  recorded_name: string;
  numeric_value: number | string;
}

function exactNow(): string {
  return new Date().toISOString();
}

function matchKey(value: {
  seasonYear: number;
  roundNumber: number;
  homeClubName: string;
  awayClubName: string;
}): string {
  return [value.seasonYear, value.roundNumber, value.homeClubName, value.awayClubName].join(
    '\u0000'
  );
}

async function ensureFieldMapReview(
  client: AflOutcomeSqlClient,
  fieldMap: AflTradeFitzRoyFieldMap
): Promise<void> {
  const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(fieldMap);
  const existingReview = await client.query<{ decision_id: string }>(
    `SELECT decision_id FROM outcome_review_decision WHERE decision_id=$1`,
    [fieldMap.approvalDecisionId]
  );
  if (existingReview.rows.length === 0) {
    await client.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'provider_field_map',$2,'approved',$3,
               jsonb_build_object('fieldMapSha256',$4::text),$5,$6)`,
      [
        fieldMap.approvalDecisionId,
        fieldMap.mapId,
        'Approve the exact scoped AFLCA home-and-away schema only for private local evaluation and training.',
        fieldMapSha256,
        REVIEWER,
        fieldMap.approvedAt,
      ]
    );
  }
  await client.query(
    `INSERT INTO outcome_provider_field_map
      (field_map_id,capability_id,fitzroy_version,source_schema_sha256,
       field_map_sha256,approval_decision_id,approved_at,map_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (field_map_id) DO NOTHING`,
    [
      fieldMap.mapId,
      fieldMap.capabilityId,
      fieldMap.fitzRoyVersion,
      fieldMap.sourceSchemaSha256,
      fieldMapSha256,
      fieldMap.approvalDecisionId,
      fieldMap.approvedAt,
      canonicalizeAflTradeJson(fieldMap),
    ]
  );
}

async function loadExpectedParticipants(
  client: AflOutcomeSqlClient
): Promise<LocalScopedAflTablesParticipant[]> {
  const result = await client.query<ParticipantRow>(
    `SELECT DISTINCT decoded.season_year,match.round_label,match.home_club_name,
            match.away_club_name,identity.recorded_name,identity.recorded_club_name,
            identity_review.canonical_record_id AS canonical_player_club_id,
            match_review.canonical_record_id AS canonical_match_id
       FROM outcome_provider_decoded_row decoded
       JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
       JOIN outcome_provider_normalization_run run
         ON run.normalization_run_id=decoded.normalization_run_id
        AND run.capture_id=decoded.capture_id
       JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
       JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
       JOIN outcome_review_decision identity_review
         ON identity_review.decision_id='local-afl-tables-review:identity:'||identity.identity_candidate_id
        AND identity_review.subject_id=identity.identity_candidate_id
       JOIN outcome_review_decision match_review
         ON match_review.decision_id='local-afl-tables-review:match:'||match.match_candidate_id
        AND match_review.subject_id=match.match_candidate_id
      WHERE capture.provider='afl_tables'
        AND capture.capability_id='afl-tables-player-stats'
        AND capture.environment='non_production'
        AND capture.status='staged'
        AND decoded.season_year=ANY($1::smallint[])
        AND match.round_label~'^[0-9]+$'
        AND run.finalized_at IS NOT NULL
        AND identity_review.decision='approved'
        AND identity_review.decided_by='local-five-season-evidence-reviewer'
        AND identity_review.evidence_json->>'evidenceSetSha256'=$2
        AND match_review.decision='approved'
        AND match_review.decided_by='local-five-season-evidence-reviewer'
        AND match_review.evidence_json->>'evidenceSetSha256'=$2
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                         WHERE successor.supersedes_decision_id=identity_review.decision_id)
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                         WHERE successor.supersedes_decision_id=match_review.decision_id)
      ORDER BY decoded.season_year,match.round_label,match.home_club_name,
               match.away_club_name,identity.recorded_club_name,identity.recorded_name`,
    [[...LOCAL_SCOPED_AFLCA_SEASONS], LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256]
  );
  const participants = result.rows.map((row) => ({
    seasonYear: row.season_year,
    roundNumber: Number(row.round_label),
    homeClubName: row.home_club_name,
    awayClubName: row.away_club_name,
    recordedPlayerName: row.recorded_name,
    recordedClubName: row.recorded_club_name,
    canonicalPlayerClubId: row.canonical_player_club_id,
    canonicalMatchId: row.canonical_match_id,
  }));
  const matchesBySeason = new Map<number, Set<string>>();
  for (const participant of participants) {
    const keys = matchesBySeason.get(participant.seasonYear) ?? new Set<string>();
    keys.add(matchKey(participant));
    matchesBySeason.set(participant.seasonYear, keys);
  }
  for (const season of LOCAL_SCOPED_AFLCA_SEASONS) {
    if (matchesBySeason.get(season)?.size !== EXPECTED_HOME_AND_AWAY_MATCHES.get(season)) {
      throw new TypeError(`The reviewed AFL Tables ${season} match universe is incomplete.`);
    }
  }
  return participants;
}

function roundsBySeason(participants: readonly LocalScopedAflTablesParticipant[]) {
  const result = new Map<number, number[]>();
  for (const season of LOCAL_SCOPED_AFLCA_SEASONS) {
    const rounds = [
      ...new Set(
        participants
          .filter((row) => row.seasonYear === season)
          .map(({ roundNumber }) => roundNumber)
      ),
    ].sort((left, right) => left - right);
    if (rounds.length === 0 || rounds.some((round, index) => round !== index + 1)) {
      throw new TypeError(`The reviewed AFL Tables ${season} round universe is not contiguous.`);
    }
    result.set(season, rounds);
  }
  return result;
}

async function loadVotes(
  client: AflOutcomeSqlClient,
  captures: readonly CaptureReference[]
): Promise<LocalScopedAflcaVote[]> {
  const captureIds = captures.map(({ capture_id }) => capture_id);
  const health = await client.query<RunHealthRow>(
    `SELECT normalization_run_id,source_row_count,accepted_row_count,
            quarantined_row_count,issue_count
       FROM outcome_provider_normalization_run
      WHERE capture_id=ANY($1::text[]) AND finalized_at IS NOT NULL`,
    [captureIds]
  );
  if (
    health.rows.length !== captures.length ||
    health.rows.some(
      (row) =>
        row.source_row_count <= 0 ||
        row.accepted_row_count !== row.source_row_count ||
        row.quarantined_row_count !== 0 ||
        row.issue_count !== 0
    )
  ) {
    throw new TypeError('Scoped AFLCA normalization must accept every exact source row cleanly.');
  }
  const result = await client.query<VoteRow>(
    `SELECT decoded.provider_decoded_row_id,identity.identity_candidate_id,
            match.match_candidate_id,decoded.season_year,match.round_label,
            decoded.typed_payload#>>'{values,Award.Scope,value}' AS award_scope,
            match.home_club_name,match.away_club_name,identity.recorded_name,
            metric.numeric_value
       FROM outcome_provider_decoded_row decoded
       JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
       JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
       JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
      WHERE decoded.capture_id=ANY($1::text[])
        AND metric.metric_code='coaches_votes'
        AND metric.definition_version='coaches-votes/v1'
        AND metric.availability='exact'
      ORDER BY decoded.season_year,match.round_label,match.home_club_name,
               match.away_club_name,identity.recorded_name`,
    [captureIds]
  );
  return result.rows.map((row) => ({
    providerDecodedRowId: row.provider_decoded_row_id,
    identityCandidateId: row.identity_candidate_id,
    matchCandidateId: row.match_candidate_id,
    seasonYear: row.season_year,
    roundNumber: Number(row.round_label),
    awardScope: row.award_scope,
    homeClubName: row.home_club_name,
    awayClubName: row.away_club_name,
    recordedPlayerName: row.recorded_name,
    numericVotes: Number(row.numeric_value),
  }));
}

async function retainReviewedIdentityMappings(client: AflOutcomeSqlClient): Promise<void> {
  for (const mapping of REVIEWED_2025_AFLCA_IDENTITY_MAPPINGS) {
    const evidenceJson = canonicalizeAflTradeJson(mapping.reviewContent);
    await client.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,canonical_record_type,
         canonical_record_id,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'local_scoped_aflca_identity_mapping',$2,'approved','local_player_club',
               $3,$4,$5::jsonb,'statly-product-owner',$6)
       ON CONFLICT (decision_id) DO NOTHING`,
      [
        mapping.reviewDecisionId,
        mapping.evidenceId,
        mapping.canonicalPlayerClubId,
        mapping.reviewContent.rationale,
        evidenceJson,
        DECIDED_AT,
      ]
    );
    const retained = await client.query<{
      subject_id: string;
      decision: string;
      canonical_record_id: string;
      rationale: string;
      evidence_json: unknown;
      decided_by: string;
      decided_at: Date | string;
    }>(
      `SELECT subject_id,decision,canonical_record_id,rationale,evidence_json,decided_by,decided_at
         FROM outcome_review_decision WHERE decision_id=$1`,
      [mapping.reviewDecisionId]
    );
    const row = retained.rows[0];
    if (
      retained.rows.length !== 1 ||
      row === undefined ||
      row.subject_id !== mapping.evidenceId ||
      row.decision !== 'approved' ||
      row.canonical_record_id !== mapping.canonicalPlayerClubId ||
      row.rationale !== mapping.reviewContent.rationale ||
      canonicalizeAflTradeJson(row.evidence_json) !== evidenceJson ||
      row.decided_by !== 'statly-product-owner' ||
      new Date(row.decided_at).toISOString() !== DECIDED_AT
    ) {
      throw new TypeError('A retained scoped AFLCA identity mapping differs from its review.');
    }
  }
}

async function retainReviewedMatchMappings(client: AflOutcomeSqlClient): Promise<void> {
  for (const mapping of REVIEWED_AFLCA_MATCH_MAPPING_RECORDS) {
    const evidenceJson = canonicalizeAflTradeJson(mapping.reviewContent);
    await client.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'local_scoped_aflca_match_mapping',$2,'approved',$3,$4::jsonb,
               'statly-product-owner',$5)
       ON CONFLICT (decision_id) DO NOTHING`,
      [
        mapping.reviewDecisionId,
        mapping.evidenceId,
        mapping.reviewContent.rationale,
        evidenceJson,
        DECIDED_AT,
      ]
    );
    const retained = await client.query<{
      subject_id: string;
      decision: string;
      canonical_record_type: string | null;
      canonical_record_id: string | null;
      rationale: string;
      evidence_json: unknown;
      decided_by: string;
      decided_at: Date | string;
    }>(
      `SELECT subject_id,decision,canonical_record_type,canonical_record_id,rationale,
              evidence_json,decided_by,decided_at
         FROM outcome_review_decision WHERE decision_id=$1`,
      [mapping.reviewDecisionId]
    );
    const row = retained.rows[0];
    if (
      retained.rows.length !== 1 ||
      row === undefined ||
      row.subject_id !== mapping.evidenceId ||
      row.decision !== 'approved' ||
      row.canonical_record_type !== null ||
      row.canonical_record_id !== null ||
      row.rationale !== mapping.reviewContent.rationale ||
      canonicalizeAflTradeJson(row.evidence_json) !== evidenceJson ||
      row.decided_by !== 'statly-product-owner' ||
      new Date(row.decided_at).toISOString() !== DECIDED_AT
    ) {
      throw new TypeError('A retained scoped AFLCA match mapping differs from its review.');
    }
  }
}

async function retainReviewSet(
  client: AflOutcomeSqlClient,
  result: ReturnType<typeof reconcileLocalScopedAflcaVotes>
): Promise<void> {
  const rows = result.reconciled.map((row) => ({
    providerDecodedRowId: row.providerDecodedRowId,
    identityCandidateId: row.identityCandidateId,
    matchCandidateId: row.matchCandidateId,
    canonicalPlayerClubId: row.canonicalPlayerClubId,
    canonicalMatchId: row.canonicalMatchId,
    numericVotes: row.numericVotes,
    identityMappingEvidenceId: row.identityMappingEvidenceId,
    identityMappingReviewDecisionId: row.identityMappingReviewDecisionId,
    matchMappingEvidenceId: row.matchMappingEvidenceId,
    matchMappingReviewDecisionId: row.matchMappingReviewDecisionId,
  }));
  const resolvedRows = rows.filter(({ canonicalPlayerClubId }) => canonicalPlayerClubId !== null);
  for (let offset = 0; offset < resolvedRows.length; offset += 500) {
    const batch = resolvedRows.slice(offset, offset + 500);
    await client.transaction(async (transaction) => {
      await transaction.query(
        `WITH reviewed AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS row(
           "providerDecodedRowId" text,"identityCandidateId" text,"matchCandidateId" text,
           "canonicalPlayerClubId" text,"canonicalMatchId" text,"numericVotes" integer,
           "identityMappingEvidenceId" text,"identityMappingReviewDecisionId" text,
           "matchMappingEvidenceId" text,"matchMappingReviewDecisionId" text))
         INSERT INTO outcome_review_decision
           (decision_id,subject_type,subject_id,decision,canonical_record_type,
            canonical_record_id,rationale,evidence_json,decided_by,decided_at)
         SELECT 'local-scoped-aflca-review:identity:'||"identityCandidateId"||':'||$2::text,
                'provider_identity_candidate',"identityCandidateId",'approved',
                'local_player_club',"canonicalPlayerClubId",
                'Resolve the scoped AFLCA player only through its reviewed AFL Tables match lineup.',
                jsonb_build_object('evidenceSetSha256',$2::text,
                  'providerDecodedRowId',"providerDecodedRowId",
                  'identityMappingEvidenceId',"identityMappingEvidenceId",
                  'identityMappingReviewDecisionId',"identityMappingReviewDecisionId",
                  'matchMappingEvidenceId',"matchMappingEvidenceId",
                  'matchMappingReviewDecisionId',"matchMappingReviewDecisionId"),$3,$4::timestamptz
           FROM reviewed ON CONFLICT (decision_id) DO NOTHING`,
        [JSON.stringify(batch), result.evidenceSetSha256, REVIEWER, DECIDED_AT]
      );
      await transaction.query(
        `WITH reviewed AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS row(
           "providerDecodedRowId" text,"identityCandidateId" text,"matchCandidateId" text,
           "canonicalPlayerClubId" text,"canonicalMatchId" text,"numericVotes" integer,
           "identityMappingEvidenceId" text,"identityMappingReviewDecisionId" text,
           "matchMappingEvidenceId" text,"matchMappingReviewDecisionId" text))
         INSERT INTO outcome_review_decision
           (decision_id,subject_type,subject_id,decision,canonical_record_type,
            canonical_record_id,rationale,evidence_json,decided_by,decided_at)
         SELECT 'local-scoped-aflca-review:match:'||"matchCandidateId"||':'||$2::text,
                'provider_match_candidate',"matchCandidateId",'approved','local_afl_match',
                "canonicalMatchId",'Resolve the scoped AFLCA match to the reviewed AFL Tables universe.',
                jsonb_build_object('evidenceSetSha256',$2::text,
                  'providerDecodedRowId',"providerDecodedRowId",
                  'matchMappingEvidenceId',"matchMappingEvidenceId",
                  'matchMappingReviewDecisionId',"matchMappingReviewDecisionId"),$3,$4::timestamptz
           FROM reviewed ON CONFLICT (decision_id) DO NOTHING`,
        [JSON.stringify(batch), result.evidenceSetSha256, REVIEWER, DECIDED_AT]
      );
      await transaction.query(
        `WITH reviewed AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS row(
           "providerDecodedRowId" text,"identityCandidateId" text,"matchCandidateId" text,
           "canonicalPlayerClubId" text,"canonicalMatchId" text,"numericVotes" integer,
           "identityMappingEvidenceId" text,"identityMappingReviewDecisionId" text,
           "matchMappingEvidenceId" text,"matchMappingReviewDecisionId" text))
         INSERT INTO outcome_review_decision
           (decision_id,subject_type,subject_id,decision,canonical_record_type,
            canonical_record_id,rationale,evidence_json,decided_by,decided_at)
         SELECT 'local-scoped-aflca-review:fact:'||"providerDecodedRowId"||':'||$2::text,
                'local_reconciled_player_match_fact',"providerDecodedRowId",'approved',
                'local_player_match_fact','local_player_match_fact:aflca:'||"providerDecodedRowId",
                'Admit one exact home-and-away coaches-vote fact for private model training.',
                jsonb_build_object('evidenceSetSha256',$2::text,
                  'identityCandidateId',"identityCandidateId",'matchCandidateId',"matchCandidateId",
                  'metricCode','coaches_votes','definitionVersion','coaches-votes/v1',
                  'metricAvailability','exact','numericValue',"numericVotes"),$3,$4::timestamptz
           FROM reviewed ON CONFLICT (decision_id) DO NOTHING`,
        [JSON.stringify(batch), result.evidenceSetSha256, REVIEWER, DECIDED_AT]
      );
    });
  }
  await client.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,canonical_record_type,
       canonical_record_id,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,'local_review_set',$2,'approved','local_review_set',$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (decision_id) DO NOTHING`,
    [
      `local-scoped-aflca-review:set:${result.evidenceSetSha256}`,
      result.evidenceSetSha256,
      'Admit the exact scoped AFLCA review set for private non-production model training only.',
      JSON.stringify({
        evidenceSetSha256: result.evidenceSetSha256,
        matchCount: result.matchCount,
        voteRowCount: result.voteRowCount,
        totalVotes: result.totalVotes,
        resolvedVoteRowCount: result.resolvedVoteRowCount,
        unresolvedIdentityRowCount: result.unresolvedIdentityRowCount,
        decisionCount: result.resolvedVoteRowCount * 3,
      }),
      REVIEWER,
      DECIDED_AT,
    ]
  );
}

export async function stageLocalScopedAflcaCoachesVotes(
  client: AflOutcomeSqlClient,
  options: LocalScopedAflcaStagingOptions
) {
  await assertLocalAflTradeOutcomesRuntimeIdentity(
    client,
    requireLocalAflTradeOutcomesRuntimeNonce(options.expectedRuntimeNonce)
  );
  const imageReference = options.imageReference ?? LOCAL_SCOPED_AFLCA_FITZROY_RUNTIME.imageDigest;
  if (imageReference !== LOCAL_SCOPED_AFLCA_FITZROY_RUNTIME.imageDigest) {
    throw new TypeError('Scoped AFLCA staging requires the exact reviewed patched image.');
  }
  const participants = await loadExpectedParticipants(client);
  const seasonRounds = roundsBySeason(participants);
  const artifactRootDirectory = resolve(options.artifactRootDirectory);
  const rawArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: artifactRootDirectory,
    repositoryId: 'scoped-aflca-coaches-votes-raw',
    artifactClass: 'raw_source',
    maximumObjectBytes: 32 * 1024 * 1024,
  });
  const metadataArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: artifactRootDirectory,
    repositoryId: 'scoped-aflca-coaches-votes-metadata',
    artifactClass: 'capture_metadata',
    maximumObjectBytes: 4 * 1024 * 1024,
  });
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(client);
  let firstAuthority = createLocalAflTradeScopedAflcaCoachesVotesAuthority(
    2021,
    seasonRounds.get(2021)!
  );
  let gateLedger = await gateRepository.load();
  const decisionKey = firstAuthority.capture.ledger.decisions[0]!.content.decisionKey;
  const currentDecision = gateLedger.ledger.decisions
    .filter(
      (decision) =>
        decision.content.gate === 'gate_0a_permission_to_evaluate' &&
        decision.content.environment === 'non_production' &&
        decision.content.decisionKey === decisionKey
    )
    .sort((left, right) => left.content.version - right.content.version)
    .at(-1);
  const gateRevision = resolveLocalScopedAflcaGateRevision(
    currentDecision,
    firstAuthority.capture.sourceRights.rightsArtifactId
  );
  if (gateRevision.version !== 1 || gateRevision.supersedesDecisionId !== null) {
    firstAuthority = createLocalAflTradeScopedAflcaCoachesVotesAuthority(
      2021,
      seasonRounds.get(2021)!,
      gateRevision
    );
  }
  if (
    currentDecision !== undefined &&
    gateRevision.version === currentDecision.content.version &&
    firstAuthority.gateDecisionId !== currentDecision.decisionId
  ) {
    throw new TypeError('The current scoped AFLCA decision differs from its exact authority.');
  }
  if (
    !gateLedger.ledger.decisions.some(
      ({ decisionId }) => decisionId === firstAuthority.gateDecisionId
    )
  ) {
    gateLedger = await gateRepository.append({
      expectedRevision: gateLedger.revision,
      sourceRights: firstAuthority.capture.sourceRights,
      proposal: firstAuthority.capture.ledger.proposals[0]!,
      decision: firstAuthority.capture.ledger.decisions[0]!,
    });
  }
  const egressPolicyEvidenceId = firstAuthority.capture.sourceRights.content.conditions.find(
    ({ conditionId }) => conditionId === 'provider-egress-control'
  )?.verificationEvidenceIds[0];
  const rate = firstAuthority.capture.sourceRights.content.automatedAccess.rateLimit;
  if (egressPolicyEvidenceId === undefined || rate === null) {
    throw new TypeError('Scoped AFLCA staging is missing exact egress authority.');
  }
  const signingKeyId = 'local-scoped-aflca-capture';
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const egressExecutionVerifier = createAflTradeEd25519EgressExecutionVerifier({
    [signingKeyId]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  const captureExecutor = createLocalAflTradeDockerFitzRoyCaptureExecutor({
    imageReference,
    runtimeIdentity: LOCAL_SCOPED_AFLCA_FITZROY_RUNTIME,
    admittedPolicy: { upstreamRate: rate, cacheSeconds: 86_400, egressPolicyEvidenceId },
    signingKey: { keyId: signingKeyId, privateKey },
  });
  const sourceCaptureRepository = new PostgresAflTradeSourceCaptureRepository(client);
  const providerObservationRepository = new PostgresAflTradeProviderObservationRepository(client);
  const decoderExecutor = createLocalAflTradeDockerFitzRoyDecodeExecutor({ imageReference });
  const existingCandidates = await client.query<ExistingCaptureRow>(
    `SELECT DISTINCT ON (capture.anchor_season_year) capture.capture_id,
            capture.source_snapshot_id,run.normalization_run_id,capture.anchor_season_year,
            capture.manifest_json
       FROM outcome_source_capture capture
       JOIN outcome_provider_normalization_run run USING (capture_id)
      WHERE capture.environment='non_production'
        AND capture.provider='afl_coaches_association'
        AND capture.capability_id='aflca-coaches-votes-scoped'
        AND capture.anchor_season_year=ANY($1::smallint[])
        AND capture.status='staged' AND run.finalized_at IS NOT NULL
        AND run.field_map_id='aflca-coaches-votes-scoped-local-'||capture.anchor_season_year||'-v1'
        AND capture.manifest_json->'gate0aReceipt'->'content'->'request'->>'rightsArtifactId'=$2
        AND capture.manifest_json->'gate0aReceipt'->'content'->'result'->>'decisionId'=$3
        AND capture.manifest_json->'gate0aDecision'->>'decisionId'=$3
        AND capture.manifest_json->'sourceRightsProposal'->>'rightsArtifactId'=$2
        AND capture.manifest_json->'fitzRoyCaptureReceipt'->'content'->'egressExecutionReceipt'
              ->'content'->'runtime'->>'imageDigest'=$4
        AND capture.manifest_json->'fitzRoyCaptureReceipt'->'content'->'egressExecutionReceipt'
              ->'content'->'runtime'->>'dependencyLockSha256'=$5
      ORDER BY capture.anchor_season_year,capture.captured_at DESC`,
    [
      [...LOCAL_SCOPED_AFLCA_SEASONS],
      firstAuthority.capture.sourceRights.rightsArtifactId,
      firstAuthority.gateDecisionId,
      LOCAL_SCOPED_AFLCA_FITZROY_RUNTIME.imageDigest,
      LOCAL_SCOPED_AFLCA_FITZROY_RUNTIME.dependencyLockSha256,
    ]
  );
  const gateDecision = firstAuthority.capture.ledger.decisions[0]!;
  const captures: CaptureReference[] = existingCandidates.rows
    .filter((row) => {
      const authority = createLocalAflTradeScopedAflcaCoachesVotesAuthority(
        row.anchor_season_year,
        seasonRounds.get(row.anchor_season_year)!,
        {
          version: gateDecision.content.version,
          supersedesDecisionId: gateDecision.content.supersedesDecisionId,
        }
      );
      const snapshot = aflTradeSourceSnapshotManifestSchema.parse({
        snapshotId: row.source_snapshot_id,
        content: row.manifest_json,
      });
      const { evaluatedAt: _evaluatedAt, ...retainedRequest } =
        snapshot.content.gate0aReceipt.content.request;
      return (
        canonicalizeAflTradeJson(retainedRequest) ===
        canonicalizeAflTradeJson(authority.capture.gateRequest)
      );
    })
    .map(({ capture_id, normalization_run_id, anchor_season_year }) => ({
      capture_id,
      normalization_run_id,
      anchor_season_year,
    }));
  for (const season of LOCAL_SCOPED_AFLCA_SEASONS) {
    if (captures.some(({ anchor_season_year }) => anchor_season_year === season)) continue;
    const authority = createLocalAflTradeScopedAflcaCoachesVotesAuthority(
      season,
      seasonRounds.get(season)!,
      {
        version: gateDecision.content.version,
        supersedesDecisionId: gateDecision.content.supersedesDecisionId,
      }
    );
    await ensureFieldMapReview(client, authority.fieldMap);
    const ingestion = await ingestAuthorizedAflTradeFitzRoyProviderSeason(
      {
        capture: authority.capture,
        fieldMapId: authority.fieldMap.mapId,
        fieldMap: authority.fieldMap,
        effectiveAt: exactNow(),
      },
      {
        capture: {
          rawArtifactRepository,
          metadataArtifactRepository,
          executor: captureExecutor,
          egressExecutionVerifier,
          authorizationResolver: gateRepository,
          clock: { now: exactNow },
          runtimeIdentity: LOCAL_SCOPED_AFLCA_FITZROY_RUNTIME,
          timeoutMs: 240_000,
          maximumSourceBytes: 32 * 1024 * 1024,
          maximumDiagnosticsBytes: 4 * 1024 * 1024,
        },
        staging: {
          rawArtifactRepository,
          sourceCaptureRepository,
          providerObservationRepository,
          decoderExecutor,
          clock: { now: exactNow },
          dependencyLockSha256: LOCAL_SCOPED_AFLCA_FITZROY_RUNTIME.dependencyLockSha256,
          imageDigest: LOCAL_SCOPED_AFLCA_FITZROY_RUNTIME.imageDigest,
          timeoutMs: 180_000,
          maximumSourceBytes: 32 * 1024 * 1024,
          maximumRows: 10_000,
          maximumFields: 20,
          maximumCells: 200_000,
          maximumCellBytes: 4_096,
          maximumOutputBytes: 64 * 1024 * 1024,
          egressExecutionVerifier,
        },
        clock: { now: exactNow },
      }
    );
    captures.push({
      anchor_season_year: season,
      capture_id: ingestion.staging.capture.captureId,
      normalization_run_id: ingestion.staging.normalization.normalizationRunId,
    });
  }
  if (captures.length !== LOCAL_SCOPED_AFLCA_SEASONS.length) {
    throw new TypeError('Scoped AFLCA staging requires exactly one capture per reviewed season.');
  }
  await retainReviewedIdentityMappings(client);
  await retainReviewedMatchMappings(client);
  const reconciliation = reconcileLocalScopedAflcaVotes({
    expectedParticipants: participants,
    votes: await loadVotes(client, captures),
    reviewedIdentityMappings: REVIEWED_2025_AFLCA_IDENTITY_MAPPINGS,
    reviewedMatchMappings: REVIEWED_AFLCA_MATCH_MAPPING_RECORDS,
  });
  await retainReviewSet(client, reconciliation);
  return { captures, reconciliation } as const;
}
