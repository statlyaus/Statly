import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION =
  'afl-trade-provider-resolution-proposal/v2' as const;
export const AFL_TRADE_PROVIDER_RESOLUTION_SCHEMA_VERSION =
  'afl-trade-provider-resolution/v2' as const;

const publicIdSchema = z.string().trim().min(1).max(300);
const recordedTextSchema = z.string().trim().min(1).max(500);
const isoInstantSchema = z.string().datetime({ offset: true, precision: 3 });
const utcIsoInstantSchema = z
  .string()
  .datetime({ offset: true, precision: 3 })
  .regex(/Z$/, 'Canonical match instants must use UTC Z notation.');
const seasonSchema = z.number().int().min(1897).max(2200);

function immutableReferenceSchema(prefix: string) {
  return z
    .object({
      id: aflTradeContentAddressedIdSchema(prefix),
      sha256: aflTradeSha256Schema,
    })
    .strict()
    .superRefine((reference, context) =>
      addDigestIssue(reference.id, reference.sha256, context, ['sha256'])
    );
}

const resolutionEvidenceReferenceSchema = immutableReferenceSchema('provider-resolution-evidence');
const authorityEvidenceReferenceSchema = immutableReferenceSchema('reviewer-authority-evidence');
const methodReferenceSchema = immutableReferenceSchema('provider-resolution-method');
const evidencePolicyReferenceSchema = immutableReferenceSchema('provider-resolution-policy');
const targetSnapshotReferenceSchema = immutableReferenceSchema('canonical-target-snapshot');
const normalizationFinalizationReferenceSchema = immutableReferenceSchema(
  'provider-normalization-finalization'
);
const issueSetReferenceSchema = immutableReferenceSchema('provider-resolution-issue-set');
const issueClosureReferenceSchema = immutableReferenceSchema('provider-resolution-issue-closure');
const blockingIssueClosureSchema = z
  .object({
    issueId: publicIdSchema,
    decision: issueClosureReferenceSchema,
  })
  .strict();
const namespaceApprovalReferenceSchema = immutableReferenceSchema(
  'provider-namespace-approval-decision'
);

const namespaceScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z
    .object({
      kind: z.literal('competition'),
      competition: z.enum(['AFLM', 'AFLW']),
    })
    .strict(),
]);

const nativeIdNamespaceSchema = z
  .object({
    namespaceId: aflTradeContentAddressedIdSchema('provider-native-id-namespace'),
    definitionSha256: aflTradeSha256Schema,
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    provider: publicIdSchema,
    capabilityId: publicIdSchema,
    entityKind: z.enum(['player', 'club', 'match']),
    namespaceVersion: publicIdSchema,
    identityScope: namespaceScopeSchema,
    validFromSeason: seasonSchema,
    validThroughSeason: seasonSchema,
    approvalDecision: namespaceApprovalReferenceSchema,
  })
  .strict()
  .superRefine((namespace, context) => {
    if (namespace.validThroughSeason < namespace.validFromSeason) {
      context.addIssue({
        code: 'custom',
        path: ['validThroughSeason'],
        message: 'Native-ID namespace validity cannot run backwards.',
      });
    }
    addDerivedIdentityIssue(
      'provider-native-id-namespace',
      namespace.namespaceId,
      {
        environment: namespace.environment,
        provider: namespace.provider,
        capabilityId: namespace.capabilityId,
        entityKind: namespace.entityKind,
        namespaceVersion: namespace.namespaceVersion,
        identityScope: namespace.identityScope,
        definitionSha256: namespace.definitionSha256,
      },
      context,
      ['namespaceId']
    );
  });

const reviewerAuthoritySchema = z
  .object({
    principalRef: publicIdSchema,
    authorityEvidence: authorityEvidenceReferenceSchema,
    role: z.literal('afl_trade_identity_reviewer'),
    scopeKey: publicIdSchema,
    provider: publicIdSchema,
    capabilityId: publicIdSchema,
    competition: z.enum(['AFLM', 'AFLW']),
    validFromSeason: seasonSchema,
    validThroughSeason: seasonSchema,
  })
  .strict()
  .refine((authority) => authority.validThroughSeason >= authority.validFromSeason, {
    message: 'Reviewer authority season range must be ordered.',
    path: ['validThroughSeason'],
  });

const stagingEvidenceSchema = z
  .object({
    normalizationRunId: publicIdSchema,
    stagingSha256: aflTradeSha256Schema,
    providerDecodedRowId: publicIdSchema,
    sourceRowSha256: aflTradeSha256Schema,
    candidateSha256: aflTradeSha256Schema,
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    provider: publicIdSchema,
    capabilityId: publicIdSchema,
    fieldMapSha256: aflTradeSha256Schema,
    normalizationFinalization: normalizationFinalizationReferenceSchema,
    rowStatus: z.enum(['staged', 'needs_review']),
    issueSet: issueSetReferenceSchema,
    blockingIssueCount: z.number().int().nonnegative(),
    openBlockingIssueCount: z.number().int().nonnegative(),
    blockingIssueClosures: z.array(blockingIssueClosureSchema).max(1000),
    nativeIdNamespace: nativeIdNamespaceSchema.nullable(),
    competition: z.enum(['AFLM', 'AFLW']),
    seasonYear: seasonSchema,
  })
  .strict()
  .superRefine((staging, context) => {
    validateUnique(
      staging.blockingIssueClosures.map(({ decision }) => decision.id),
      context,
      ['blockingIssueClosures']
    );
    validateUnique(
      staging.blockingIssueClosures.map(({ issueId }) => issueId),
      context,
      ['blockingIssueClosures']
    );
    if (
      staging.openBlockingIssueCount > staging.blockingIssueCount ||
      staging.blockingIssueClosures.length !==
        staging.blockingIssueCount - staging.openBlockingIssueCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['blockingIssueClosures'],
        message: 'Issue closures must account for every resolved blocking issue exactly once.',
      });
    }
  });

const proposalBaseSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION),
    resolutionCaseId: aflTradeContentAddressedIdSchema('provider-resolution-case'),
    method: methodReferenceSchema,
    staging: stagingEvidenceSchema,
    canonicalTargetSnapshot: targetSnapshotReferenceSchema,
    supportingEvidence: z.array(resolutionEvidenceReferenceSchema).min(1).max(100),
    proposedAt: isoInstantSchema,
  })
  .strict();

const playerTargetSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('provider_identity'),
      playerIdentityId: aflTradeContentAddressedIdSchema('provider-player-identity'),
      assignmentCaseId: aflTradeContentAddressedIdSchema('provider-identity-assignment-case'),
      playerId: publicIdSchema,
    })
    .strict(),
  z
    .object({
      scope: z.literal('candidate_only'),
      playerId: publicIdSchema,
      evidencePolicy: evidencePolicyReferenceSchema,
    })
    .strict(),
]);

const playerProposalSchema = proposalBaseSchema
  .extend({
    subjectType: z.literal('provider_player_candidate'),
    identityCandidateId: publicIdSchema,
    candidate: z
      .object({
        nativePlayerId: recordedTextSchema.nullable(),
        recordedName: recordedTextSchema,
        recordedClubId: recordedTextSchema.nullable(),
        recordedClubName: recordedTextSchema.nullable(),
      })
      .strict(),
    proposedTarget: playerTargetSchema.nullable(),
    alternativePlayerIds: z.array(publicIdSchema).max(20),
  })
  .strict()
  .superRefine((proposal, context) => {
    validateUnique(
      proposal.supportingEvidence.map(({ id }) => id),
      context,
      ['supportingEvidence']
    );
    validateUnique(proposal.alternativePlayerIds, context, ['alternativePlayerIds']);
    addDerivedIdentityIssue(
      'provider-resolution-case',
      proposal.resolutionCaseId,
      { subjectType: proposal.subjectType, identityCandidateId: proposal.identityCandidateId },
      context,
      ['resolutionCaseId']
    );
    validateNamespaceForProposal(proposal, 'player', context);
    if (proposal.proposedTarget?.scope === 'provider_identity') {
      if (
        proposal.candidate.nativePlayerId === null ||
        proposal.staging.nativeIdNamespace === null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['proposedTarget', 'scope'],
          message: 'Reusable player identity requires a native ID and governed namespace.',
        });
      } else {
        addDerivedIdentityIssue(
          'provider-player-identity',
          proposal.proposedTarget.playerIdentityId,
          {
            nativeIdNamespaceId: proposal.staging.nativeIdNamespace.namespaceId,
            nativePlayerId: proposal.candidate.nativePlayerId,
          },
          context,
          ['proposedTarget', 'playerIdentityId']
        );
        addAssignmentCaseIssue(
          proposal.proposedTarget.assignmentCaseId,
          'player',
          proposal.proposedTarget.playerIdentityId,
          context,
          ['proposedTarget', 'assignmentCaseId']
        );
      }
    }
  });

const clubOccurrenceSchema = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('match_side'),
      matchCandidateId: publicIdSchema,
      side: z.enum(['home', 'away']),
    })
    .strict(),
  z
    .object({
      source: z.literal('player_affiliation'),
      identityCandidateId: publicIdSchema,
    })
    .strict(),
]);

const clubTargetSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('provider_identity'),
      clubIdentityId: aflTradeContentAddressedIdSchema('provider-club-identity'),
      assignmentCaseId: aflTradeContentAddressedIdSchema('provider-identity-assignment-case'),
      clubId: publicIdSchema,
    })
    .strict(),
  z
    .object({
      scope: z.literal('temporal_alias'),
      clubId: publicIdSchema,
      validFromSeason: seasonSchema,
      validThroughSeason: seasonSchema,
      normalizedName: recordedTextSchema,
      aliasId: aflTradeContentAddressedIdSchema('provider-club-alias'),
      assignmentCaseId: aflTradeContentAddressedIdSchema('provider-identity-assignment-case'),
      normalizationPolicy: evidencePolicyReferenceSchema,
    })
    .strict(),
]);

const clubProposalSchema = proposalBaseSchema
  .extend({
    subjectType: z.literal('provider_club_candidate'),
    occurrence: clubOccurrenceSchema,
    candidate: z
      .object({
        nativeClubId: recordedTextSchema.nullable(),
        recordedName: recordedTextSchema,
      })
      .strict(),
    proposedTarget: clubTargetSchema.nullable(),
    alternativeClubIds: z.array(publicIdSchema).max(20),
  })
  .strict()
  .superRefine((proposal, context) => {
    validateUnique(
      proposal.supportingEvidence.map(({ id }) => id),
      context,
      ['supportingEvidence']
    );
    validateUnique(proposal.alternativeClubIds, context, ['alternativeClubIds']);
    addDerivedIdentityIssue(
      'provider-resolution-case',
      proposal.resolutionCaseId,
      { subjectType: proposal.subjectType, occurrence: proposal.occurrence },
      context,
      ['resolutionCaseId']
    );
    validateNamespaceForProposal(proposal, 'club', context);
    if (proposal.proposedTarget?.scope === 'provider_identity') {
      if (proposal.candidate.nativeClubId === null || proposal.staging.nativeIdNamespace === null) {
        context.addIssue({
          code: 'custom',
          path: ['proposedTarget', 'scope'],
          message: 'Reusable club identity requires a native ID and governed namespace.',
        });
      } else {
        addDerivedIdentityIssue(
          'provider-club-identity',
          proposal.proposedTarget.clubIdentityId,
          {
            nativeIdNamespaceId: proposal.staging.nativeIdNamespace.namespaceId,
            nativeClubId: proposal.candidate.nativeClubId,
          },
          context,
          ['proposedTarget', 'clubIdentityId']
        );
        addAssignmentCaseIssue(
          proposal.proposedTarget.assignmentCaseId,
          'club',
          proposal.proposedTarget.clubIdentityId,
          context,
          ['proposedTarget', 'assignmentCaseId']
        );
      }
    }
    if (
      proposal.proposedTarget?.scope === 'temporal_alias' &&
      (proposal.proposedTarget.validThroughSeason < proposal.proposedTarget.validFromSeason ||
        proposal.staging.seasonYear < proposal.proposedTarget.validFromSeason ||
        proposal.staging.seasonYear > proposal.proposedTarget.validThroughSeason)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['proposedTarget'],
        message: 'A temporal club alias must contain the observed season.',
      });
    }
    if (proposal.proposedTarget?.scope === 'temporal_alias') {
      const normalizedName = normalizeAflTradeProviderClubAlias(proposal.candidate.recordedName);
      if (proposal.proposedTarget.normalizedName !== normalizedName) {
        context.addIssue({
          code: 'custom',
          path: ['proposedTarget', 'normalizedName'],
          message: 'Temporal alias normalized name must follow the canonical alias policy.',
        });
      }
      addDerivedIdentityIssue(
        'provider-club-alias',
        proposal.proposedTarget.aliasId,
        {
          provider: proposal.staging.provider,
          competition: proposal.staging.competition,
          normalizationPolicyId: proposal.proposedTarget.normalizationPolicy.id,
          normalizedName,
          validFromSeason: proposal.proposedTarget.validFromSeason,
          validThroughSeason: proposal.proposedTarget.validThroughSeason,
        },
        context,
        ['proposedTarget', 'aliasId']
      );
      addAssignmentCaseIssue(
        proposal.proposedTarget.assignmentCaseId,
        'club_alias',
        proposal.proposedTarget.aliasId,
        context,
        ['proposedTarget', 'assignmentCaseId']
      );
    }
  });

const matchTargetSchema = z
  .object({
    matchIdentityKind: z.enum(['provider_native', 'reviewed_fixture_fingerprint']),
    matchIdentityId: aflTradeContentAddressedIdSchema('provider-match-identity'),
    assignmentCaseId: aflTradeContentAddressedIdSchema('provider-identity-assignment-case'),
    matchId: publicIdSchema,
    canonicalMatchDate: utcIsoInstantSchema,
    canonicalRoundLabel: recordedTextSchema,
    homeClubId: publicIdSchema,
    awayClubId: publicIdSchema,
    fixtureFingerprintSha256: aflTradeSha256Schema,
    homeClubResolutionDecisionId: aflTradeContentAddressedIdSchema('provider-resolution-decision'),
    awayClubResolutionDecisionId: aflTradeContentAddressedIdSchema('provider-resolution-decision'),
  })
  .strict();

const matchProposalSchema = proposalBaseSchema
  .extend({
    subjectType: z.literal('provider_match_candidate'),
    matchCandidateId: publicIdSchema,
    candidate: z
      .object({
        nativeMatchId: recordedTextSchema.nullable(),
        roundLabel: recordedTextSchema,
        matchDateText: recordedTextSchema.nullable(),
        homeClubNativeId: recordedTextSchema.nullable(),
        homeClubName: recordedTextSchema,
        awayClubNativeId: recordedTextSchema.nullable(),
        awayClubName: recordedTextSchema,
        orderIndependentSha256: aflTradeSha256Schema,
      })
      .strict(),
    proposedTarget: matchTargetSchema.nullable(),
    alternativeMatchIds: z.array(publicIdSchema).max(20),
  })
  .strict()
  .superRefine((proposal, context) => {
    validateUnique(
      proposal.supportingEvidence.map(({ id }) => id),
      context,
      ['supportingEvidence']
    );
    validateUnique(proposal.alternativeMatchIds, context, ['alternativeMatchIds']);
    addDerivedIdentityIssue(
      'provider-resolution-case',
      proposal.resolutionCaseId,
      { subjectType: proposal.subjectType, matchCandidateId: proposal.matchCandidateId },
      context,
      ['resolutionCaseId']
    );
    validateNamespaceForProposal(proposal, 'match', context);
    const target = proposal.proposedTarget;
    if (target === null) return;
    addAssignmentCaseIssue(target.assignmentCaseId, 'match', target.matchIdentityId, context, [
      'proposedTarget',
      'assignmentCaseId',
    ]);
    if (target.homeClubId === target.awayClubId) {
      context.addIssue({
        code: 'custom',
        path: ['proposedTarget', 'awayClubId'],
        message: 'A canonical match must contain two distinct clubs.',
      });
    }
    if (target.homeClubResolutionDecisionId === target.awayClubResolutionDecisionId) {
      context.addIssue({
        code: 'custom',
        path: ['proposedTarget', 'awayClubResolutionDecisionId'],
        message: 'Home and away clubs require distinct current resolution decisions.',
      });
    }
    if (
      target.matchIdentityKind === 'provider_native' &&
      (proposal.candidate.nativeMatchId === null || proposal.staging.nativeIdNamespace === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['proposedTarget', 'matchIdentityKind'],
        message: 'Provider-native match identity requires a native ID and governed namespace.',
      });
      return;
    }
    if (
      target.matchIdentityKind === 'reviewed_fixture_fingerprint' &&
      proposal.candidate.nativeMatchId !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['proposedTarget', 'matchIdentityKind'],
        message: 'Reviewed fixture fallback is reserved for evidence without native match IDs.',
      });
      return;
    }
    const expectedFingerprint = createAflTradeReviewedFixtureFingerprint({
      competition: proposal.staging.competition,
      seasonYear: proposal.staging.seasonYear,
      canonicalRoundLabel: target.canonicalRoundLabel,
      canonicalMatchDate: target.canonicalMatchDate,
      clubIds: [target.homeClubId, target.awayClubId],
    });
    if (target.fixtureFingerprintSha256 !== expectedFingerprint) {
      context.addIssue({
        code: 'custom',
        path: ['proposedTarget', 'fixtureFingerprintSha256'],
        message: 'Fixture fingerprint must equal the canonical resolved fixture fingerprint.',
      });
    }
    const identityContent =
      target.matchIdentityKind === 'provider_native'
        ? {
            nativeIdNamespaceId: proposal.staging.nativeIdNamespace?.namespaceId,
            nativeMatchId: proposal.candidate.nativeMatchId,
          }
        : {
            provider: proposal.staging.provider,
            competition: proposal.staging.competition,
            seasonYear: proposal.staging.seasonYear,
            fixtureFingerprintSha256: target.fixtureFingerprintSha256,
          };
    addDerivedIdentityIssue(
      'provider-match-identity',
      target.matchIdentityId,
      identityContent,
      context,
      ['proposedTarget', 'matchIdentityId']
    );
  });

export const aflTradeProviderResolutionProposalContentSchema = z.discriminatedUnion('subjectType', [
  playerProposalSchema,
  clubProposalSchema,
  matchProposalSchema,
]);

export type AflTradeProviderResolutionProposalContent = z.infer<
  typeof aflTradeProviderResolutionProposalContentSchema
>;

export const aflTradeProviderResolutionProposalSchema = z
  .object({
    proposalId: aflTradeContentAddressedIdSchema('provider-resolution-proposal'),
    proposalSha256: aflTradeSha256Schema,
    content: aflTradeProviderResolutionProposalContentSchema,
  })
  .strict()
  .superRefine((proposal, context) => {
    addAflTradeContentAddressIssue(
      'provider-resolution-proposal',
      proposal.proposalId,
      proposal.content,
      context,
      ['proposalId']
    );
    addDigestIssue(proposal.proposalId, proposal.proposalSha256, context, ['proposalSha256']);
  });

export type AflTradeProviderResolutionProposal = z.infer<
  typeof aflTradeProviderResolutionProposalSchema
>;

const resolutionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROVIDER_RESOLUTION_SCHEMA_VERSION),
    proposal: aflTradeProviderResolutionProposalSchema,
    expectedRevision: z.number().int().nonnegative(),
    supersedesDecisionId: aflTradeContentAddressedIdSchema(
      'provider-resolution-decision'
    ).nullable(),
    assignmentRevision: z
      .object({
        assignmentCaseId: aflTradeContentAddressedIdSchema('provider-identity-assignment-case'),
        entityKind: z.enum(['player', 'club', 'club_alias', 'match']),
        identityId: publicIdSchema,
        expectedRevision: z.number().int().nonnegative(),
        supersedesDecisionId: aflTradeContentAddressedIdSchema(
          'provider-resolution-decision'
        ).nullable(),
        nextStatus: z.enum(['active', 'inactive']),
      })
      .strict()
      .nullable(),
    outcome: z.enum(['approved', 'ambiguous', 'rejected', 'deferred']),
    rationale: z.string().trim().min(10).max(4000),
    reviewerAuthority: reviewerAuthoritySchema,
    effectiveAt: isoInstantSchema,
    decidedAt: isoInstantSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    const staging = decision.proposal.content.staging;
    const authority = decision.reviewerAuthority;
    if (
      authority.provider !== staging.provider ||
      authority.capabilityId !== staging.capabilityId ||
      authority.competition !== staging.competition ||
      staging.seasonYear < authority.validFromSeason ||
      staging.seasonYear > authority.validThroughSeason
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reviewerAuthority'],
        message:
          'Reviewer authority must cover the exact provider, capability, competition, and season.',
      });
    }
    if ((decision.expectedRevision === 0) !== (decision.supersedesDecisionId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['supersedesDecisionId'],
        message: 'First resolution has no predecessor; every later revision requires one.',
      });
    }
    if (Date.parse(decision.proposal.content.proposedAt) > Date.parse(decision.decidedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['decidedAt'],
        message: 'A decision cannot predate its immutable proposal.',
      });
    }
    if (Date.parse(decision.effectiveAt) > Date.parse(decision.decidedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveAt'],
        message: 'Resolution effective time cannot be later than its knowledge time.',
      });
    }
    if (decision.outcome === 'approved' && decision.proposal.content.proposedTarget === null) {
      context.addIssue({
        code: 'custom',
        path: ['proposal', 'content', 'proposedTarget'],
        message: 'Approval requires one proposed canonical target.',
      });
    }
    if (
      decision.outcome === 'approved' &&
      decision.proposal.content.staging.openBlockingIssueCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['proposal', 'content', 'staging', 'openBlockingIssueCount'],
        message:
          'Approval is blocked until every identity or match issue has current closure evidence.',
      });
    }
    const assignmentSubject = reusableAssignmentSubject(decision.proposal.content);
    if (decision.outcome === 'approved' && assignmentSubject !== null) {
      if (
        decision.assignmentRevision?.assignmentCaseId !== assignmentSubject.assignmentCaseId ||
        decision.assignmentRevision.entityKind !== assignmentSubject.entityKind ||
        decision.assignmentRevision.identityId !== assignmentSubject.identityId ||
        decision.assignmentRevision.nextStatus !== 'active'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assignmentRevision'],
          message: 'Reusable approval must advance the exact identity assignment case.',
        });
      } else if (
        (decision.assignmentRevision.expectedRevision === 0) !==
        (decision.assignmentRevision.supersedesDecisionId === null)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assignmentRevision', 'supersedesDecisionId'],
          message:
            'First identity assignment has no predecessor; every later revision requires one.',
        });
      }
    } else if (decision.outcome === 'approved' && decision.assignmentRevision !== null) {
      context.addIssue({
        code: 'custom',
        path: ['assignmentRevision'],
        message: 'Candidate-only approval cannot advance a reusable identity assignment case.',
      });
    } else if (decision.assignmentRevision !== null) {
      if (
        assignmentSubject === null ||
        decision.assignmentRevision.assignmentCaseId !== assignmentSubject.assignmentCaseId ||
        decision.assignmentRevision.entityKind !== assignmentSubject.entityKind ||
        decision.assignmentRevision.identityId !== assignmentSubject.identityId ||
        decision.assignmentRevision.nextStatus !== 'inactive' ||
        decision.assignmentRevision.expectedRevision === 0 ||
        decision.assignmentRevision.supersedesDecisionId === null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assignmentRevision'],
          message:
            'Withdrawal must match the proposal identity, deactivate it, and supersede its current assignment.',
        });
      }
    }
    const alternatives = alternativeIds(decision.proposal.content);
    if (decision.outcome === 'ambiguous' && alternatives.length < 2) {
      context.addIssue({
        code: 'custom',
        path: ['proposal', 'content'],
        message: 'Ambiguous decisions require at least two recorded alternatives.',
      });
    }
  });

export type AflTradeProviderResolutionContent = z.infer<typeof resolutionContentSchema>;

export const aflTradeProviderResolutionDecisionSchema = z
  .object({
    decisionId: aflTradeContentAddressedIdSchema('provider-resolution-decision'),
    decisionSha256: aflTradeSha256Schema,
    content: resolutionContentSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    addAflTradeContentAddressIssue(
      'provider-resolution-decision',
      decision.decisionId,
      decision.content,
      context,
      ['decisionId']
    );
    addDigestIssue(decision.decisionId, decision.decisionSha256, context, ['decisionSha256']);
  });

export type AflTradeProviderResolutionDecision = z.infer<
  typeof aflTradeProviderResolutionDecisionSchema
>;

export function createAflTradeProviderResolutionProposal(
  content: unknown
): AflTradeProviderResolutionProposal {
  const parsed = aflTradeProviderResolutionProposalContentSchema.parse(content);
  const proposalId = createAflTradeContentAddress('provider-resolution-proposal', parsed);
  return aflTradeProviderResolutionProposalSchema.parse({
    proposalId,
    proposalSha256: digestFromId(proposalId),
    content: parsed,
  });
}

export function createAflTradeProviderResolutionDecision(
  content: unknown
): AflTradeProviderResolutionDecision {
  const parsed = resolutionContentSchema.parse(content);
  const decisionId = createAflTradeContentAddress('provider-resolution-decision', parsed);
  return aflTradeProviderResolutionDecisionSchema.parse({
    decisionId,
    decisionSha256: digestFromId(decisionId),
    content: parsed,
  });
}

export function normalizeAflTradeProviderClubAlias(recordedName: string): string {
  return recordedName
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function createAflTradeReviewedFixtureFingerprint(input: {
  competition: 'AFLM' | 'AFLW';
  seasonYear: number;
  canonicalRoundLabel: string;
  canonicalMatchDate: string;
  clubIds: readonly [string, string];
}): string {
  const canonicalMatchDate = new Date(input.canonicalMatchDate).toISOString();
  const sortedClubIds = [...input.clubIds].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  return createAflTradeContentAddress('reviewed-fixture-fingerprint', {
    fingerprintVersion: 'reviewed-fixture-fingerprint/v1',
    competition: input.competition,
    seasonYear: input.seasonYear,
    canonicalRoundLabel: input.canonicalRoundLabel,
    canonicalMatchDate,
    sortedClubIds,
  }).slice('reviewed-fixture-fingerprint:'.length);
}

function validateNamespaceForProposal(
  proposal: {
    staging: {
      provider: string;
      environment: 'test_fixture' | 'non_production' | 'production';
      capabilityId: string;
      seasonYear: number;
      competition?: 'AFLM' | 'AFLW';
      nativeIdNamespace: z.infer<typeof nativeIdNamespaceSchema> | null;
    };
  },
  entityKind: 'player' | 'club' | 'match',
  context: z.RefinementCtx
) {
  const namespace = proposal.staging.nativeIdNamespace;
  if (namespace === null) return;
  if (
    namespace.environment !== proposal.staging.environment ||
    namespace.provider !== proposal.staging.provider ||
    namespace.capabilityId !== proposal.staging.capabilityId ||
    namespace.entityKind !== entityKind ||
    (namespace.identityScope.kind === 'competition' &&
      namespace.identityScope.competition !== proposal.staging.competition) ||
    proposal.staging.seasonYear < namespace.validFromSeason ||
    proposal.staging.seasonYear > namespace.validThroughSeason
  ) {
    context.addIssue({
      code: 'custom',
      path: ['staging', 'nativeIdNamespace'],
      message: 'Native-ID namespace does not govern this provider, capability, entity, or season.',
    });
  }
}

function addAssignmentCaseIssue(
  assignmentCaseId: string,
  entityKind: 'player' | 'club' | 'club_alias' | 'match',
  identityId: string,
  context: z.RefinementCtx,
  path: string[]
) {
  addDerivedIdentityIssue(
    'provider-identity-assignment-case',
    assignmentCaseId,
    { entityKind, identityId },
    context,
    path
  );
}

function reusableAssignmentSubject(content: AflTradeProviderResolutionProposalContent): {
  assignmentCaseId: string;
  entityKind: 'player' | 'club' | 'club_alias' | 'match';
  identityId: string;
} | null {
  if (content.subjectType === 'provider_player_candidate') {
    return content.proposedTarget?.scope === 'provider_identity'
      ? {
          assignmentCaseId: content.proposedTarget.assignmentCaseId,
          entityKind: 'player',
          identityId: content.proposedTarget.playerIdentityId,
        }
      : null;
  }
  if (content.subjectType === 'provider_club_candidate') {
    if (content.proposedTarget === null) return null;
    return {
      assignmentCaseId: content.proposedTarget.assignmentCaseId,
      entityKind: content.proposedTarget.scope === 'provider_identity' ? 'club' : 'club_alias',
      identityId:
        content.proposedTarget.scope === 'provider_identity'
          ? content.proposedTarget.clubIdentityId
          : content.proposedTarget.aliasId,
    };
  }
  return content.proposedTarget === null
    ? null
    : {
        assignmentCaseId: content.proposedTarget.assignmentCaseId,
        entityKind: 'match',
        identityId: content.proposedTarget.matchIdentityId,
      };
}

function alternativeIds(content: AflTradeProviderResolutionProposalContent): readonly string[] {
  if (content.subjectType === 'provider_player_candidate') return content.alternativePlayerIds;
  if (content.subjectType === 'provider_club_candidate') return content.alternativeClubIds;
  return content.alternativeMatchIds;
}

function validateUnique(values: readonly string[], context: z.RefinementCtx, path: string[]) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', path, message: 'Evidence and target IDs must be unique.' });
  }
}

function addDerivedIdentityIssue(
  prefix: string,
  identifier: string,
  content: unknown,
  context: z.RefinementCtx,
  path: string[]
) {
  addAflTradeContentAddressIssue(prefix, identifier, content, context, path);
}

function digestFromId(identifier: string): string {
  return identifier.slice(identifier.indexOf(':') + 1);
}

function addDigestIssue(
  identifier: string,
  digest: string,
  context: z.RefinementCtx,
  path: string[]
) {
  if (digest !== digestFromId(identifier)) {
    context.addIssue({
      code: 'custom',
      path,
      message: 'Digest must match the canonical content address.',
    });
  }
}
