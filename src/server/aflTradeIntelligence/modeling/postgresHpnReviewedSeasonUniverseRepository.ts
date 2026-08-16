import {
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeHpnReviewedSeasonDecisionSchema,
  aflTradeHpnReviewedSeasonMembershipSchema,
  aflTradeHpnReviewedSeasonUniverseCandidateSchema,
  aflTradeHpnReviewedSeasonUniverseSchema,
  sealAflTradeHpnReviewedSeasonUniverse,
  type AflTradeHpnReviewedSeasonDecision,
  type AflTradeHpnReviewedSeasonMembership,
  type AflTradeHpnReviewedSeasonUniverse,
  type AflTradeHpnReviewedSeasonUniverseCandidate,
} from './hpnReviewedSeasonUniverse';

export type AflTradeHpnReviewedSeasonRegistration = Readonly<{
  candidate: AflTradeHpnReviewedSeasonUniverseCandidate;
  candidateArtifact: AflTradeArtifactRef;
  membership: AflTradeHpnReviewedSeasonMembership;
  membershipArtifact: AflTradeArtifactRef;
  decision: AflTradeHpnReviewedSeasonDecision;
  reviewedSeason: AflTradeHpnReviewedSeasonUniverse;
}>;

interface StoredRow {
  candidate_json: unknown;
  candidate_artifact_json: unknown;
  membership_json: unknown;
  membership_artifact_json: unknown;
  decision_json: unknown;
  reviewed_json: unknown;
}

function authenticateRegistration(
  input: AflTradeHpnReviewedSeasonRegistration
): AflTradeHpnReviewedSeasonRegistration & { decisionArtifact: AflTradeArtifactRef } {
  const candidate = aflTradeHpnReviewedSeasonUniverseCandidateSchema.parse(input.candidate);
  const membership = aflTradeHpnReviewedSeasonMembershipSchema.parse(input.membership);
  const decision = aflTradeHpnReviewedSeasonDecisionSchema.parse(input.decision);
  const reviewedSeason = aflTradeHpnReviewedSeasonUniverseSchema.parse(input.reviewedSeason);
  if (
    !doesAflTradeArtifactRefMatchCanonicalJson(input.candidateArtifact, candidate) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(input.membershipArtifact, membership)
  ) {
    throw new TypeError('Reviewed HPN season registration requires exact artifact ancestry.');
  }
  const reconstructed = sealAflTradeHpnReviewedSeasonUniverse({
    candidate,
    candidateArtifact: input.candidateArtifact,
    membership,
    membershipArtifact: input.membershipArtifact,
    decision,
  });
  if (
    canonicalizeAflTradeJson(reconstructed) !== canonicalizeAflTradeJson(reviewedSeason)
  ) {
    throw new TypeError('The reviewed HPN season is not the exact approved candidate output.');
  }
  return {
    candidate,
    candidateArtifact: input.candidateArtifact,
    membership,
    membershipArtifact: input.membershipArtifact,
    decision,
    reviewedSeason,
    decisionArtifact: createAflTradeCanonicalJsonArtifactRef(
      decision,
      decision.content.decidedAt
    ),
  };
}

async function assertExactParentReplay(
  transaction: AflOutcomeSqlTransaction,
  registration: ReturnType<typeof authenticateRegistration>
): Promise<void> {
  const exact = await transaction.query(
    `SELECT reviewed_season_id FROM outcome_hpn_reviewed_season_universe
      WHERE reviewed_season_id=$1
        AND candidate_canonical_json=$2
        AND membership_canonical_json=$3
        AND decision_canonical_json=$4
        AND reviewed_canonical_json=$5
        AND candidate_artifact_json=$6::jsonb
        AND membership_artifact_json=$7::jsonb
        AND decision_artifact_json=$8::jsonb FOR KEY SHARE`,
    [
      registration.reviewedSeason.reviewedSeasonId,
      canonicalizeAflTradeJson(registration.candidate),
      canonicalizeAflTradeJson(registration.membership),
      canonicalizeAflTradeJson(registration.decision),
      canonicalizeAflTradeJson(registration.reviewedSeason),
      canonicalizeAflTradeJson(registration.candidateArtifact),
      canonicalizeAflTradeJson(registration.membershipArtifact),
      canonicalizeAflTradeJson(registration.decisionArtifact),
    ]
  );
  if (exact.rows.length !== 1) {
    throw new Error('The reviewed HPN season conflicts with durable authority.');
  }
}

export class PostgresAflTradeHpnReviewedSeasonUniverseRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async register(
    input: AflTradeHpnReviewedSeasonRegistration
  ): Promise<AflTradeHpnReviewedSeasonUniverse> {
    const registration = authenticateRegistration(input);
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `hpn-reviewed-season:${registration.reviewedSeason.content.seasonYear}`,
      ]);
      const content = registration.reviewedSeason.content;
      await transaction.query(
        `INSERT INTO outcome_hpn_reviewed_season_universe
          (reviewed_season_id,season_year,candidate_id,decision_id,membership_id,
           normalization_run_id,result_field_map_id,player_field_map_id,source_row_count,
           completed_match_count,resolved_identity_row_count,quarantined_identity_row_count,
           identity_coverage,candidate_artifact_json,membership_artifact_json,
           decision_artifact_json,candidate_canonical_json,candidate_json,
           membership_canonical_json,membership_json,decision_canonical_json,decision_json,
           reviewed_canonical_json,reviewed_json,reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,
                 $16::jsonb,$17::text,$17::jsonb,$18::text,$18::jsonb,$19::text,$19::jsonb,
                 $20::text,$20::jsonb,$21)
         ON CONFLICT (reviewed_season_id) DO NOTHING`,
        [
          registration.reviewedSeason.reviewedSeasonId,
          content.seasonYear,
          registration.candidate.candidateId,
          registration.decision.decisionId,
          registration.membership.membershipId,
          content.normalizationRunId,
          content.resultFieldMapId,
          content.playerFieldMapId,
          content.counts.sourceRows,
          content.counts.completedMatches,
          content.counts.resolvedIdentityRows,
          content.counts.quarantinedIdentityRows,
          content.identityCoverage,
          canonicalizeAflTradeJson(registration.candidateArtifact),
          canonicalizeAflTradeJson(registration.membershipArtifact),
          canonicalizeAflTradeJson(registration.decisionArtifact),
          canonicalizeAflTradeJson(registration.candidate),
          canonicalizeAflTradeJson(registration.membership),
          canonicalizeAflTradeJson(registration.decision),
          canonicalizeAflTradeJson(registration.reviewedSeason),
          content.reviewedAt,
        ]
      );
      await assertExactParentReplay(transaction, registration);
      const members = registration.membership.content.rows.map((member, ordinal) => ({
        reviewedSeasonId: registration.reviewedSeason.reviewedSeasonId,
        ordinal,
        providerDecodedRowId: member.providerDecodedRowId,
        matchId: member.matchId,
        playingForClubId: member.playingForClubId,
        identityState: member.playerIdentity.state,
        canonicalPlayerId:
          member.playerIdentity.state === 'resolved'
            ? member.playerIdentity.canonicalPlayerId
            : null,
        member,
      }));
      await transaction.query(
        `INSERT INTO outcome_hpn_reviewed_season_member
          (reviewed_season_id,ordinal,provider_decoded_row_id,match_id,playing_for_club_id,
           identity_state,canonical_player_id,member_json)
         SELECT "reviewedSeasonId",ordinal,"providerDecodedRowId","matchId",
                "playingForClubId","identityState","canonicalPlayerId",member
           FROM jsonb_to_recordset($1::jsonb) AS value(
             "reviewedSeasonId" text,ordinal integer,"providerDecodedRowId" text,
             "matchId" text,"playingForClubId" text,"identityState" text,
             "canonicalPlayerId" text,member jsonb)
         ON CONFLICT (reviewed_season_id,provider_decoded_row_id) DO NOTHING`,
        [canonicalizeAflTradeJson(members)]
      );
      const exactMembers = await transaction.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM outcome_hpn_reviewed_season_member stored
           JOIN jsonb_to_recordset($2::jsonb) AS expected(
             "providerDecodedRowId" text,ordinal integer,member jsonb)
             ON expected."providerDecodedRowId"=stored.provider_decoded_row_id
            AND expected.ordinal=stored.ordinal AND expected.member=stored.member_json
          WHERE stored.reviewed_season_id=$1`,
        [registration.reviewedSeason.reviewedSeasonId, canonicalizeAflTradeJson(members)]
      );
      if (exactMembers.rows[0]?.count !== members.length) {
        throw new Error('The reviewed HPN season member set conflicts with durable authority.');
      }
      return registration.reviewedSeason;
    });
  }

  async loadLatest(seasonYear: number): Promise<Readonly<{
    reviewedSeason: AflTradeHpnReviewedSeasonUniverse;
    membership: AflTradeHpnReviewedSeasonMembership;
  }> | null> {
    const result = await this.client.query<StoredRow>(
      `SELECT candidate_json,candidate_artifact_json,membership_json,
              membership_artifact_json,decision_json,reviewed_json
         FROM outcome_hpn_reviewed_season_universe
        WHERE season_year=$1
        ORDER BY registered_at DESC,reviewed_season_id DESC LIMIT 1`,
      [seasonYear]
    );
    const row = result.rows[0];
    if (!row) return null;
    const candidate = aflTradeHpnReviewedSeasonUniverseCandidateSchema.parse(
      row.candidate_json
    );
    const membership = aflTradeHpnReviewedSeasonMembershipSchema.parse(row.membership_json);
    const decision = aflTradeHpnReviewedSeasonDecisionSchema.parse(row.decision_json);
    const reviewedSeason = aflTradeHpnReviewedSeasonUniverseSchema.parse(row.reviewed_json);
    const authenticated = authenticateRegistration({
      candidate,
      candidateArtifact: row.candidate_artifact_json as AflTradeArtifactRef,
      membership,
      membershipArtifact: row.membership_artifact_json as AflTradeArtifactRef,
      decision,
      reviewedSeason,
    });
    if (
      !doAflTradeArtifactRefsExactlyMatch(
        authenticated.reviewedSeason.content.membershipArtifact,
        authenticated.membershipArtifact
      )
    ) {
      throw new Error('The current reviewed HPN season failed exact authentication.');
    }
    return { reviewedSeason, membership };
  }
}
