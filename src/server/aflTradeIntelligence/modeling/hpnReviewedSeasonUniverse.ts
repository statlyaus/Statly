import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_TRADE_HPN_REVIEWED_SEASON_MEMBERSHIP_SCHEMA_VERSION =
  'afl-trade-hpn-reviewed-season-membership/v1' as const;
export const AFL_TRADE_HPN_REVIEWED_SEASON_CANDIDATE_SCHEMA_VERSION =
  'afl-trade-hpn-reviewed-season-candidate/v1' as const;
export const AFL_TRADE_HPN_REVIEWED_SEASON_DECISION_SCHEMA_VERSION =
  'afl-trade-hpn-reviewed-season-decision/v1' as const;
export const AFL_TRADE_HPN_REVIEWED_SEASON_SCHEMA_VERSION =
  'afl-trade-hpn-reviewed-season/v1' as const;

const publicIdSchema = z.string().trim().min(1).max(300);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const seasonSchema = z.number().int().min(1998).max(2200);
const instantSchema = z.iso.datetime({ offset: true });
const countSchema = z.number().int().nonnegative().max(1_000_000);
const statsSchema = z
  .object({
    totalPoints: countSchema,
    hitOuts: countSchema,
    goalAssists: countSchema,
    inside50s: countSchema,
    marks: countSchema,
    marksInside50: countSchema,
    freeKicksFor: countSchema,
    freeKicksAgainst: countSchema,
    rebound50s: countSchema,
    onePercenters: countSchema,
    clearances: countSchema,
    tackles: countSchema,
  })
  .strict();
const identitySchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('resolved'),
      canonicalPlayerId: publicIdSchema,
      identityDecisionId: publicIdSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal('quarantined'),
      reason: z.literal('missing_source_identity'),
      recordedName: z.string().trim().min(1).max(240).nullable(),
    })
    .strict(),
]);
const memberSchema = z
  .object({
    providerDecodedRowId: publicIdSchema,
    sourceRowSha256: sha256Schema,
    typedPayloadSha256: sha256Schema,
    matchId: publicIdSchema,
    matchDate: z.iso.date(),
    homeClubId: publicIdSchema,
    awayClubId: publicIdSchema,
    homePoints: countSchema,
    awayPoints: countSchema,
    playingForClubId: publicIdSchema,
    playerIdentity: identitySchema,
    stats: statsSchema,
  })
  .strict()
  .superRefine((row, context) => {
    if (
      row.homeClubId === row.awayClubId ||
      (row.playingForClubId !== row.homeClubId &&
        row.playingForClubId !== row.awayClubId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A reviewed HPN row must belong to one side of a match with distinct clubs.',
      });
    }
  });

const countsSchema = z
  .object({
    sourceRows: z.number().int().positive().max(100_000),
    completedMatches: z.number().int().positive().max(1_000),
    resolvedIdentityRows: z.number().int().nonnegative().max(100_000),
    quarantinedIdentityRows: z.number().int().nonnegative().max(100_000),
  })
  .strict();

const membershipContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_HPN_REVIEWED_SEASON_MEMBERSHIP_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    competition: z.literal('AFLM'),
    seasonYear: seasonSchema,
    rows: z.array(memberSchema).min(2).max(100_000),
    createdAt: instantSchema,
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
  })
  .strict();
export const aflTradeHpnReviewedSeasonMembershipSchema = z
  .object({
    membershipId: aflTradeContentAddressedIdSchema('hpn-reviewed-season-membership'),
    content: membershipContentSchema,
  })
  .strict()
  .superRefine((membership, context) => {
    addAflTradeContentAddressIssue(
      'hpn-reviewed-season-membership',
      membership.membershipId,
      membership.content,
      context,
      ['membershipId']
    );
  });

const candidateContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_HPN_REVIEWED_SEASON_CANDIDATE_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    competition: z.literal('AFLM'),
    seasonYear: seasonSchema,
    captureId: publicIdSchema,
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    resultFieldMapId: aflTradeContentAddressedIdSchema('hpn-pav-field-map'),
    playerFieldMapId: aflTradeContentAddressedIdSchema('hpn-pav-field-map'),
    resolvedReviewSetSha256: sha256Schema,
    normalizationReview: z
      .object({
        status: z.enum(['staged', 'needs_review']),
        sourceRowCount: z.number().int().positive().max(100_000),
        acceptedRowCount: z.number().int().nonnegative().max(100_000),
        issueCount: z.number().int().nonnegative().max(100_000),
        issueBoundary: z.literal(
          'legacy_normalization_issues_do_not_approve_or_remove_hpn_fields'
        ),
      })
      .strict()
      .superRefine((review, context) => {
        if (
          review.acceptedRowCount > review.sourceRowCount ||
          review.issueCount < review.sourceRowCount - review.acceptedRowCount
        ) {
          context.addIssue({
            code: 'custom',
            message:
              'Normalization issues must cover every unaccepted row and may record multiple issues per row.',
          });
        }
      }),
    membershipId: aflTradeContentAddressedIdSchema('hpn-reviewed-season-membership'),
    membershipArtifact: aflTradeArtifactRefSchema,
    counts: countsSchema,
    numericalCoverage: z.literal('complete'),
    identityCoverage: z.enum(['complete', 'partial_with_explicit_quarantine']),
    createdAt: instantSchema,
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Private non-production numerical review only; quarantined identities remain unavailable and this candidate grants no publication or production authority.'
    ),
  })
  .strict();
export const aflTradeHpnReviewedSeasonUniverseCandidateSchema = z
  .object({
    candidateId: aflTradeContentAddressedIdSchema('hpn-reviewed-season-candidate'),
    content: candidateContentSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    addAflTradeContentAddressIssue(
      'hpn-reviewed-season-candidate',
      candidate.candidateId,
      candidate.content,
      context,
      ['candidateId']
    );
  });

const decisionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_HPN_REVIEWED_SEASON_DECISION_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    candidateId: aflTradeContentAddressedIdSchema('hpn-reviewed-season-candidate'),
    candidateArtifact: aflTradeArtifactRefSchema,
    membershipId: aflTradeContentAddressedIdSchema('hpn-reviewed-season-membership'),
    membershipArtifact: aflTradeArtifactRefSchema,
    decision: z.enum(['approved', 'rejected']),
    reviewerId: publicIdSchema,
    rationale: z.string().trim().min(1).max(2_000),
    decidedAt: instantSchema,
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
  })
  .strict();
export const aflTradeHpnReviewedSeasonDecisionSchema = z
  .object({
    decisionId: aflTradeContentAddressedIdSchema('hpn-reviewed-season-decision'),
    content: decisionContentSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    addAflTradeContentAddressIssue(
      'hpn-reviewed-season-decision',
      decision.decisionId,
      decision.content,
      context,
      ['decisionId']
    );
  });

const reviewedContentSchema = candidateContentSchema.extend({
  schemaVersion: z.literal(AFL_TRADE_HPN_REVIEWED_SEASON_SCHEMA_VERSION),
  sourceCandidateId: aflTradeContentAddressedIdSchema('hpn-reviewed-season-candidate'),
  sourceCandidateArtifact: aflTradeArtifactRefSchema,
  approvalDecisionId: aflTradeContentAddressedIdSchema('hpn-reviewed-season-decision'),
  approvalDecisionArtifact: aflTradeArtifactRefSchema,
  reviewedAt: instantSchema,
});
export const aflTradeHpnReviewedSeasonUniverseSchema = z
  .object({
    reviewedSeasonId: aflTradeContentAddressedIdSchema('hpn-reviewed-season'),
    content: reviewedContentSchema,
  })
  .strict()
  .superRefine((reviewed, context) => {
    addAflTradeContentAddressIssue(
      'hpn-reviewed-season',
      reviewed.reviewedSeasonId,
      reviewed.content,
      context,
      ['reviewedSeasonId']
    );
  });

export type AflTradeHpnReviewedSeasonMember = z.infer<typeof memberSchema>;
export type AflTradeHpnReviewedSeasonMembership = z.infer<
  typeof aflTradeHpnReviewedSeasonMembershipSchema
>;
export type AflTradeHpnReviewedSeasonUniverseCandidate = z.infer<
  typeof aflTradeHpnReviewedSeasonUniverseCandidateSchema
>;
export type AflTradeHpnReviewedSeasonDecision = z.infer<
  typeof aflTradeHpnReviewedSeasonDecisionSchema
>;
export type AflTradeHpnReviewedSeasonUniverse = z.infer<
  typeof aflTradeHpnReviewedSeasonUniverseSchema
>;

function validateCompleteMembership(rows: readonly AflTradeHpnReviewedSeasonMember[]): void {
  const rowIds = rows.map(({ providerDecodedRowId }) => providerDecodedRowId);
  const matches = new Map<string, AflTradeHpnReviewedSeasonMember[]>();
  for (const row of rows) {
    const retained = matches.get(row.matchId) ?? [];
    retained.push(row);
    matches.set(row.matchId, retained);
  }
  const invalidMatch = [...matches.values()].some((members) => {
    const first = members[0]!;
    const clubs = new Set(members.map(({ playingForClubId }) => playingForClubId));
    return (
      clubs.size !== 2 ||
      !clubs.has(first.homeClubId) ||
      !clubs.has(first.awayClubId) ||
      members.some(
        (member) =>
          member.matchDate !== first.matchDate ||
          member.homeClubId !== first.homeClubId ||
          member.awayClubId !== first.awayClubId ||
          member.homePoints !== first.homePoints ||
          member.awayPoints !== first.awayPoints
      )
    );
  });
  if (new Set(rowIds).size !== rowIds.length || invalidMatch) {
    throw new TypeError(
      'The reviewed season universe must conserve unique rows and one exact two-sided result per match.'
    );
  }
}

export function createAflTradeHpnReviewedSeasonUniverseCandidate(input: Readonly<{
  environment: 'non_production';
  competition: 'AFLM';
  seasonYear: number;
  captureId: string;
  normalizationRunId: string;
  resultFieldMapId: string;
  playerFieldMapId: string;
  resolvedReviewSetSha256: string;
  normalizationReview: {
    status: 'staged' | 'needs_review';
    sourceRowCount: number;
    acceptedRowCount: number;
    issueCount: number;
  };
  rows: readonly AflTradeHpnReviewedSeasonMember[];
  createdAt: string;
}>): Readonly<{
  candidate: AflTradeHpnReviewedSeasonUniverseCandidate;
  candidateArtifact: AflTradeArtifactRef;
  membership: AflTradeHpnReviewedSeasonMembership;
  membershipArtifact: AflTradeArtifactRef;
}> {
  const rows = input.rows.map((row) => memberSchema.parse(row)).sort((left, right) =>
    left.providerDecodedRowId.localeCompare(right.providerDecodedRowId)
  );
  validateCompleteMembership(rows);
  const membershipContent = membershipContentSchema.parse({
    schemaVersion: AFL_TRADE_HPN_REVIEWED_SEASON_MEMBERSHIP_SCHEMA_VERSION,
    environment: input.environment,
    competition: input.competition,
    seasonYear: input.seasonYear,
    rows,
    createdAt: input.createdAt,
    publicationEligible: false,
    publicationProhibited: true,
  });
  const membership = aflTradeHpnReviewedSeasonMembershipSchema.parse({
    membershipId: createAflTradeContentAddress(
      'hpn-reviewed-season-membership',
      membershipContent
    ),
    content: membershipContent,
  });
  const membershipArtifact = createAflTradeCanonicalJsonArtifactRef(
    membership,
    input.createdAt
  );
  const resolvedIdentityRows = rows.filter(
    ({ playerIdentity }) => playerIdentity.state === 'resolved'
  ).length;
  const counts = {
    sourceRows: rows.length,
    completedMatches: new Set(rows.map(({ matchId }) => matchId)).size,
    resolvedIdentityRows,
    quarantinedIdentityRows: rows.length - resolvedIdentityRows,
  };
  const content = candidateContentSchema.parse({
    schemaVersion: AFL_TRADE_HPN_REVIEWED_SEASON_CANDIDATE_SCHEMA_VERSION,
    environment: input.environment,
    competition: input.competition,
    seasonYear: input.seasonYear,
    captureId: input.captureId,
    normalizationRunId: input.normalizationRunId,
    resultFieldMapId: input.resultFieldMapId,
    playerFieldMapId: input.playerFieldMapId,
    resolvedReviewSetSha256: input.resolvedReviewSetSha256,
    normalizationReview: {
      ...input.normalizationReview,
      issueBoundary: 'legacy_normalization_issues_do_not_approve_or_remove_hpn_fields',
    },
    membershipId: membership.membershipId,
    membershipArtifact,
    counts,
    numericalCoverage: 'complete',
    identityCoverage:
      counts.quarantinedIdentityRows === 0
        ? 'complete'
        : 'partial_with_explicit_quarantine',
    createdAt: input.createdAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private non-production numerical review only; quarantined identities remain unavailable and this candidate grants no publication or production authority.',
  });
  const candidate = aflTradeHpnReviewedSeasonUniverseCandidateSchema.parse({
    candidateId: createAflTradeContentAddress('hpn-reviewed-season-candidate', content),
    content,
  });
  if (candidate.content.normalizationReview.sourceRowCount !== rows.length) {
    throw new TypeError(
      'The reviewed season universe must retain every normalization source row.'
    );
  }
  return {
    candidate,
    candidateArtifact: createAflTradeCanonicalJsonArtifactRef(candidate, input.createdAt),
    membership,
    membershipArtifact,
  };
}

export function createAflTradeHpnReviewedSeasonDecision(input: Readonly<{
  candidate: unknown;
  candidateArtifact: AflTradeArtifactRef;
  membership: unknown;
  membershipArtifact: AflTradeArtifactRef;
  decision: 'approved' | 'rejected';
  reviewerId: string;
  rationale: string;
  decidedAt: string;
}>): AflTradeHpnReviewedSeasonDecision {
  const candidate = aflTradeHpnReviewedSeasonUniverseCandidateSchema.parse(input.candidate);
  const membership = aflTradeHpnReviewedSeasonMembershipSchema.parse(input.membership);
  if (
    !doesAflTradeArtifactRefMatchCanonicalJson(input.candidateArtifact, candidate) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(input.membershipArtifact, membership) ||
    candidate.content.membershipId !== membership.membershipId ||
    !doAflTradeArtifactRefsExactlyMatch(
      candidate.content.membershipArtifact,
      input.membershipArtifact
    ) ||
    Date.parse(input.decidedAt) < Date.parse(candidate.content.createdAt)
  ) {
    throw new TypeError('Reviewed-season approval requires exact candidate membership ancestry.');
  }
  const content = decisionContentSchema.parse({
    schemaVersion: AFL_TRADE_HPN_REVIEWED_SEASON_DECISION_SCHEMA_VERSION,
    environment: 'non_production',
    candidateId: candidate.candidateId,
    candidateArtifact: input.candidateArtifact,
    membershipId: membership.membershipId,
    membershipArtifact: input.membershipArtifact,
    decision: input.decision,
    reviewerId: input.reviewerId,
    rationale: input.rationale,
    decidedAt: input.decidedAt,
    publicationEligible: false,
    publicationProhibited: true,
  });
  return aflTradeHpnReviewedSeasonDecisionSchema.parse({
    decisionId: createAflTradeContentAddress('hpn-reviewed-season-decision', content),
    content,
  });
}

export function sealAflTradeHpnReviewedSeasonUniverse(input: Readonly<{
  candidate: unknown;
  candidateArtifact: AflTradeArtifactRef;
  membership: unknown;
  membershipArtifact: AflTradeArtifactRef;
  decision: unknown;
}>) {
  const candidate = aflTradeHpnReviewedSeasonUniverseCandidateSchema.parse(input.candidate);
  const membership = aflTradeHpnReviewedSeasonMembershipSchema.parse(input.membership);
  const decision = aflTradeHpnReviewedSeasonDecisionSchema.parse(input.decision);
  const decisionArtifact = createAflTradeCanonicalJsonArtifactRef(
    decision,
    decision.content.decidedAt
  );
  if (
    decision.content.decision !== 'approved' ||
    decision.content.candidateId !== candidate.candidateId ||
    decision.content.membershipId !== membership.membershipId ||
    !doAflTradeArtifactRefsExactlyMatch(
      decision.content.candidateArtifact,
      input.candidateArtifact
    ) ||
    !doAflTradeArtifactRefsExactlyMatch(
      decision.content.membershipArtifact,
      input.membershipArtifact
    )
  ) {
    throw new TypeError('A reviewed HPN season requires its exact approved candidate.');
  }
  const content = reviewedContentSchema.parse({
    ...candidate.content,
    schemaVersion: AFL_TRADE_HPN_REVIEWED_SEASON_SCHEMA_VERSION,
    sourceCandidateId: candidate.candidateId,
    sourceCandidateArtifact: input.candidateArtifact,
    approvalDecisionId: decision.decisionId,
    approvalDecisionArtifact: decisionArtifact,
    reviewedAt: decision.content.decidedAt,
  });
  return aflTradeHpnReviewedSeasonUniverseSchema.parse({
    reviewedSeasonId: createAflTradeContentAddress('hpn-reviewed-season', content),
    content,
  });
}
