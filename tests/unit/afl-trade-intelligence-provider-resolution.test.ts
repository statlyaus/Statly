import { describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradeProviderResolutionRepository } from '@/server/aflTradeIntelligence/source/postgresProviderResolutionRepository';
import {
  AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION,
  AFL_TRADE_PROVIDER_RESOLUTION_SCHEMA_VERSION,
  aflTradeProviderResolutionDecisionSchema,
  createAflTradeProviderResolutionDecision,
  createAflTradeProviderResolutionProposal,
  createAflTradeReviewedFixtureFingerprint,
  normalizeAflTradeProviderClubAlias,
} from '@/server/aflTradeIntelligence/source/providerResolutionContracts';

const digest = (character: string) => character.repeat(64);

function immutableReference(prefix: string, marker: string) {
  const id = createAflTradeContentAddress(prefix, { fixture: marker });
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

function resolutionCaseId(subject: unknown) {
  return createAflTradeContentAddress('provider-resolution-case', subject);
}

function nativeIdNamespace(entityKind: 'player' | 'club' | 'match') {
  const capabilityId = 'official-afl-player-stats';
  const definitionSha256 = digest(
    entityKind === 'player' ? '7' : entityKind === 'club' ? '8' : '6'
  );
  const namespaceVersion = `official-afl-${entityKind}/v1`;
  const identityScope = { kind: 'competition' as const, competition: 'AFLM' as const };
  const namespaceId = createAflTradeContentAddress('provider-native-id-namespace', {
    environment: 'test_fixture',
    provider: 'official_afl',
    capabilityId,
    entityKind,
    namespaceVersion,
    identityScope,
    definitionSha256,
  });
  return {
    namespaceId,
    definitionSha256,
    environment: 'test_fixture' as const,
    provider: 'official_afl',
    capabilityId,
    entityKind,
    namespaceVersion,
    identityScope,
    validFromSeason: 2026,
    validThroughSeason: 2026,
    approvalDecision: immutableReference('provider-namespace-approval-decision', entityKind),
  };
}

const playerNamespace = nativeIdNamespace('player');

const staging = {
  normalizationRunId: 'provider-normalization-run:fixture',
  stagingSha256: digest('9'),
  providerDecodedRowId: 'provider-decoded-row:fixture',
  sourceRowSha256: digest('a'),
  candidateSha256: digest('b'),
  environment: 'test_fixture' as const,
  provider: 'official_afl',
  capabilityId: 'official-afl-player-stats',
  fieldMapSha256: digest('c'),
  normalizationFinalization: immutableReference('provider-normalization-finalization', 'fixture'),
  rowStatus: 'needs_review' as const,
  issueSet: immutableReference('provider-resolution-issue-set', 'fixture'),
  blockingIssueCount: 1,
  openBlockingIssueCount: 0,
  blockingIssueClosures: [
    {
      issueId: 'normalization-issue:fixture',
      decision: immutableReference('provider-resolution-issue-closure', 'fixture'),
    },
  ],
  nativeIdNamespace: playerNamespace,
  competition: 'AFLM' as const,
  seasonYear: 2026,
};

const proposalBase = {
  schemaVersion: AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION,
  method: immutableReference('provider-resolution-method', 'method-v1'),
  staging,
  canonicalTargetSnapshot: immutableReference('canonical-target-snapshot', 'fixture'),
  supportingEvidence: [immutableReference('provider-resolution-evidence', 'fixture')],
  proposedAt: '2026-08-08T00:00:00.000Z',
};

function playerProposal(overrides: Record<string, unknown> = {}) {
  const nativePlayerId = 'provider-player-1';
  const playerIdentityId = createAflTradeContentAddress('provider-player-identity', {
    nativeIdNamespaceId: playerNamespace.namespaceId,
    nativePlayerId,
  });
  return createAflTradeProviderResolutionProposal({
    ...proposalBase,
    subjectType: 'provider_player_candidate',
    identityCandidateId: 'identity-candidate:fixture',
    resolutionCaseId: resolutionCaseId({
      subjectType: 'provider_player_candidate',
      identityCandidateId: 'identity-candidate:fixture',
    }),
    candidate: {
      nativePlayerId,
      recordedName: 'Player One',
      recordedClubId: 'provider-club-1',
      recordedClubName: 'Carlton',
    },
    proposedTarget: {
      scope: 'provider_identity',
      playerIdentityId,
      assignmentCaseId: createAflTradeContentAddress('provider-identity-assignment-case', {
        entityKind: 'player',
        identityId: playerIdentityId,
      }),
      playerId: 'afl-player:fixture',
    },
    alternativePlayerIds: [],
    ...overrides,
  });
}

function decisionBase(proposal = playerProposal()) {
  const target = proposal.content.proposedTarget;
  const assignmentSubject =
    target && 'assignmentCaseId' in target
      ? {
          assignmentCaseId: target.assignmentCaseId,
          entityKind:
            'playerIdentityId' in target
              ? ('player' as const)
              : 'matchIdentityId' in target
                ? ('match' as const)
                : target.scope === 'provider_identity'
                  ? ('club' as const)
                  : ('club_alias' as const),
          identityId:
            'playerIdentityId' in target
              ? target.playerIdentityId
              : 'matchIdentityId' in target
                ? target.matchIdentityId
                : target.scope === 'provider_identity'
                  ? target.clubIdentityId
                  : target.aliasId,
        }
      : null;
  return {
    schemaVersion: AFL_TRADE_PROVIDER_RESOLUTION_SCHEMA_VERSION,
    proposal,
    expectedRevision: 0,
    supersedesDecisionId: null,
    assignmentRevision:
      assignmentSubject === null
        ? null
        : {
            ...assignmentSubject,
            expectedRevision: 0,
            supersedesDecisionId: null,
            nextStatus: 'active' as const,
          },
    outcome: 'approved' as const,
    rationale: 'The exact staged evidence and canonical target snapshot were reviewed.',
    reviewerAuthority: {
      principalRef: 'operator:fixture-reviewer',
      authorityEvidence: immutableReference('reviewer-authority-evidence', 'fixture'),
      role: 'afl_trade_identity_reviewer' as const,
      scopeKey: 'public-afl-draft-trade-outcomes' as const,
      provider: staging.provider,
      capabilityId: staging.capabilityId,
      competition: staging.competition,
      validFromSeason: staging.seasonYear,
      validThroughSeason: staging.seasonYear,
    },
    effectiveAt: '2026-08-08T00:00:00.000Z',
    decidedAt: '2026-08-08T00:00:00.000Z',
  };
}

describe('AFL trade provider resolution contracts', () => {
  it('content-addresses the exact proposal and final decision independently', () => {
    const proposal = playerProposal();
    const decision = createAflTradeProviderResolutionDecision(decisionBase(proposal));
    expect(proposal.proposalId).toMatch(/^provider-resolution-proposal:[a-f0-9]{64}$/);
    expect(decision.decisionId).toMatch(/^provider-resolution-decision:[a-f0-9]{64}$/);
    expect(createAflTradeProviderResolutionDecision(structuredClone(decision.content))).toEqual(
      decision
    );
    expect(proposal.content.candidate).toMatchObject({
      recordedClubId: 'provider-club-1',
      recordedClubName: 'Carlton',
    });
  });

  it('requires reviewer authority to cover the exact provider capability and season', () => {
    const proposal = playerProposal();
    const content = decisionBase(proposal);
    expect(() =>
      createAflTradeProviderResolutionDecision({
        ...content,
        reviewerAuthority: {
          ...content.reviewerAuthority,
          capabilityId: 'different-provider-capability',
        },
      })
    ).toThrow(/must cover the exact provider, capability, competition, and season/);
  });

  it('accepts bounded private reviewer scopes while rejecting blank scopes', () => {
    const content = decisionBase();
    const scopeKey = 'afl-men:genuine-player-contribution:2021-2024';
    const decision = createAflTradeProviderResolutionDecision({
      ...content,
      reviewerAuthority: {
        ...content.reviewerAuthority,
        scopeKey,
      },
    });

    expect(decision.content.reviewerAuthority.scopeKey).toBe(scopeKey);
    expect(() =>
      aflTradeProviderResolutionDecisionSchema.parse({
        ...decision,
        content: {
          ...decision.content,
          reviewerAuthority: {
            ...decision.content.reviewerAuthority,
            scopeKey: '   ',
          },
        },
      })
    ).toThrow();
  });

  it('derives reusable player identities from a governed native-ID namespace', () => {
    expect(() =>
      playerProposal({
        staging: { ...staging, nativeIdNamespace: null },
      })
    ).toThrow(/governed namespace/);
    expect(() =>
      playerProposal({
        proposedTarget: {
          scope: 'provider_identity',
          playerIdentityId: createAflTradeContentAddress('provider-player-identity', {
            wrong: true,
          }),
          assignmentCaseId: createAflTradeContentAddress('provider-identity-assignment-case', {
            wrong: true,
          }),
          playerId: 'afl-player:fixture',
        },
      })
    ).toThrow(/Identifier must equal/);
  });

  it('keeps name-only player approvals candidate-scoped and policy-backed', () => {
    expect(() =>
      playerProposal({
        staging: { ...staging, nativeIdNamespace: null },
        candidate: {
          nativePlayerId: null,
          recordedName: 'Alex Smith',
          recordedClubId: null,
          recordedClubName: 'Carlton',
        },
        proposedTarget: {
          scope: 'candidate_only',
          playerId: 'afl-player:alex-smith',
          evidencePolicy: immutableReference('provider-resolution-policy', 'name-only-v1'),
        },
      })
    ).not.toThrow();
  });

  it('preserves player-affiliation club occurrences and temporal limits', () => {
    const occurrence = {
      source: 'player_affiliation' as const,
      identityCandidateId: 'identity-candidate:fixture',
    };
    const normalizationPolicy = immutableReference('provider-resolution-policy', 'club-alias-v1');
    const normalizedName = normalizeAflTradeProviderClubAlias('North Melbourne');
    const club = {
      ...proposalBase,
      staging: { ...staging, nativeIdNamespace: null },
      subjectType: 'provider_club_candidate' as const,
      occurrence,
      resolutionCaseId: resolutionCaseId({
        subjectType: 'provider_club_candidate',
        occurrence,
      }),
      candidate: { nativeClubId: null, recordedName: 'North Melbourne' },
      proposedTarget: {
        scope: 'temporal_alias' as const,
        clubId: 'afl-club:north-melbourne',
        validFromSeason: 2026,
        validThroughSeason: 2026,
        normalizedName,
        normalizationPolicy,
        aliasId: createAflTradeContentAddress('provider-club-alias', {
          provider: staging.provider,
          competition: staging.competition,
          normalizationPolicyId: normalizationPolicy.id,
          normalizedName,
          validFromSeason: 2026,
          validThroughSeason: 2026,
        }),
        assignmentCaseId: createAflTradeContentAddress('provider-identity-assignment-case', {
          entityKind: 'club_alias',
          identityId: createAflTradeContentAddress('provider-club-alias', {
            provider: staging.provider,
            competition: staging.competition,
            normalizationPolicyId: normalizationPolicy.id,
            normalizedName,
            validFromSeason: 2026,
            validThroughSeason: 2026,
          }),
        }),
      },
      alternativeClubIds: [],
    };
    const parsedClub = createAflTradeProviderResolutionProposal(club);
    if (parsedClub.content.subjectType !== 'provider_club_candidate') {
      throw new Error('Fixture did not create a club proposal.');
    }
    expect(parsedClub.content.occurrence.source).toBe('player_affiliation');
    expect(() =>
      createAflTradeProviderResolutionProposal({
        ...club,
        proposedTarget: { ...club.proposedTarget, validThroughSeason: 2025 },
      })
    ).toThrow(/must contain the observed season/);
  });

  it('keeps raw match evidence nullable until approved club-bound interpretation', () => {
    const matchCandidateId = 'match-candidate:fixture';
    const proposal = createAflTradeProviderResolutionProposal({
      ...proposalBase,
      staging: { ...staging, nativeIdNamespace: null },
      subjectType: 'provider_match_candidate',
      matchCandidateId,
      resolutionCaseId: resolutionCaseId({
        subjectType: 'provider_match_candidate',
        matchCandidateId,
      }),
      candidate: {
        nativeMatchId: null,
        roundLabel: 'Round 1',
        matchDateText: null,
        homeClubNativeId: null,
        homeClubName: 'Carlton',
        awayClubNativeId: null,
        awayClubName: 'Fremantle',
        orderIndependentSha256: digest('e'),
      },
      proposedTarget: null,
      alternativeMatchIds: [],
    });
    expect(() =>
      createAflTradeProviderResolutionDecision({
        ...decisionBase(proposal),
        outcome: 'deferred',
        assignmentRevision: null,
        rationale: 'The source lacks enough date and club identity evidence for resolution.',
      })
    ).not.toThrow();
    expect(() =>
      createAflTradeProviderResolutionDecision({
        ...decisionBase(proposal),
        outcome: 'ambiguous',
        assignmentRevision: {
          assignmentCaseId: createAflTradeContentAddress('provider-identity-assignment-case', {
            entityKind: 'player',
            identityId: 'provider-player-identity:unrelated',
          }),
          entityKind: 'player',
          identityId: 'provider-player-identity:unrelated',
          expectedRevision: 1,
          supersedesDecisionId: createAflTradeContentAddress('provider-resolution-decision', {
            fixture: 'prior-assignment',
          }),
          nextStatus: 'inactive',
        },
      })
    ).toThrow(/must match the proposal identity/);
  });

  it('derives order-independent fixture fingerprints and rejects caller-selected values', () => {
    const fingerprint = createAflTradeReviewedFixtureFingerprint({
      competition: 'AFLM',
      seasonYear: 2026,
      canonicalRoundLabel: 'Round 1',
      canonicalMatchDate: '2026-03-19T08:10:00.000Z',
      clubIds: ['afl-club:carlton', 'afl-club:fremantle'],
    });
    expect(
      createAflTradeReviewedFixtureFingerprint({
        competition: 'AFLM',
        seasonYear: 2026,
        canonicalRoundLabel: 'Round 1',
        canonicalMatchDate: '2026-03-19T08:10:00.000Z',
        clubIds: ['afl-club:fremantle', 'afl-club:carlton'],
      })
    ).toBe(fingerprint);

    const matchCandidateId = 'match-candidate:resolved';
    const clubDecisionA = createAflTradeContentAddress('provider-resolution-decision', {
      fixture: 'club-a',
    });
    const clubDecisionB = createAflTradeContentAddress('provider-resolution-decision', {
      fixture: 'club-b',
    });
    const target = {
      matchIdentityKind: 'reviewed_fixture_fingerprint' as const,
      matchId: 'afl-match:fixture',
      canonicalMatchDate: '2026-03-19T08:10:00.000Z',
      canonicalRoundLabel: 'Round 1',
      homeClubId: 'afl-club:carlton',
      awayClubId: 'afl-club:fremantle',
      fixtureFingerprintSha256: fingerprint,
      homeClubResolutionDecisionId: clubDecisionA,
      awayClubResolutionDecisionId: clubDecisionB,
      matchIdentityId: createAflTradeContentAddress('provider-match-identity', {
        provider: staging.provider,
        competition: staging.competition,
        seasonYear: staging.seasonYear,
        fixtureFingerprintSha256: fingerprint,
      }),
      assignmentCaseId: createAflTradeContentAddress('provider-identity-assignment-case', {
        entityKind: 'match',
        identityId: createAflTradeContentAddress('provider-match-identity', {
          provider: staging.provider,
          competition: staging.competition,
          seasonYear: staging.seasonYear,
          fixtureFingerprintSha256: fingerprint,
        }),
      }),
    };
    const proposal = {
      ...proposalBase,
      staging: { ...staging, nativeIdNamespace: null },
      subjectType: 'provider_match_candidate' as const,
      matchCandidateId,
      resolutionCaseId: resolutionCaseId({
        subjectType: 'provider_match_candidate',
        matchCandidateId,
      }),
      candidate: {
        nativeMatchId: null,
        roundLabel: 'Round 1',
        matchDateText: '2026-03-19',
        homeClubNativeId: null,
        homeClubName: 'Carlton',
        awayClubNativeId: null,
        awayClubName: 'Fremantle',
        orderIndependentSha256: digest('e'),
      },
      proposedTarget: target,
      alternativeMatchIds: [],
    };
    expect(() => createAflTradeProviderResolutionProposal(proposal)).not.toThrow();
    expect(() =>
      createAflTradeProviderResolutionProposal({
        ...proposal,
        proposedTarget: { ...target, fixtureFingerprintSha256: digest('f') },
      })
    ).toThrow(/canonical resolved fixture fingerprint/);
  });

  it('requires exact revision parity and proposal-before-decision chronology', () => {
    const proposal = playerProposal();
    expect(() =>
      createAflTradeProviderResolutionDecision({
        ...decisionBase(proposal),
        expectedRevision: 1,
        supersedesDecisionId: null,
      })
    ).toThrow(/every later revision requires one/);
    expect(() =>
      createAflTradeProviderResolutionDecision({
        ...decisionBase(proposal),
        decidedAt: '2026-08-07T23:59:59.000Z',
      })
    ).toThrow(/cannot predate/);
  });

  it('blocks approval while quarantine issues remain open', () => {
    const proposal = playerProposal({
      staging: {
        ...staging,
        blockingIssueClosures: [],
        openBlockingIssueCount: 1,
      },
    });
    expect(() => createAflTradeProviderResolutionDecision(decisionBase(proposal))).toThrow(
      /current closure evidence/
    );
  });

  it('uses one reusable assignment case across repeated candidate occurrences', () => {
    const first = playerProposal();
    const second = playerProposal({
      identityCandidateId: 'identity-candidate:second',
      resolutionCaseId: resolutionCaseId({
        subjectType: 'provider_player_candidate',
        identityCandidateId: 'identity-candidate:second',
      }),
    });
    if (
      first.content.subjectType !== 'provider_player_candidate' ||
      second.content.subjectType !== 'provider_player_candidate'
    ) {
      throw new Error('Fixture did not create player proposals.');
    }
    expect(first.content.proposedTarget?.scope).toBe('provider_identity');
    expect(second.content.proposedTarget?.scope).toBe('provider_identity');
    if (
      first.content.proposedTarget?.scope !== 'provider_identity' ||
      second.content.proposedTarget?.scope !== 'provider_identity'
    ) {
      throw new Error('Fixture did not create reusable provider identities.');
    }
    expect(second.content.proposedTarget.assignmentCaseId).toBe(
      first.content.proposedTarget.assignmentCaseId
    );
  });

  it('can deactivate a previously approved reusable assignment', () => {
    const proposal = playerProposal({ alternativePlayerIds: ['afl-player:one', 'afl-player:two'] });
    if (proposal.content.subjectType !== 'provider_player_candidate') {
      throw new Error('Fixture did not create a player proposal.');
    }
    const reusable = proposal.content.proposedTarget;
    if (reusable?.scope !== 'provider_identity') {
      throw new Error('Fixture did not create a reusable provider identity.');
    }
    expect(() =>
      createAflTradeProviderResolutionDecision({
        ...decisionBase(proposal),
        outcome: 'ambiguous',
        assignmentRevision: {
          assignmentCaseId: reusable.assignmentCaseId,
          entityKind: 'player',
          identityId: reusable.playerIdentityId,
          expectedRevision: 1,
          supersedesDecisionId: createAflTradeContentAddress('provider-resolution-decision', {
            fixture: 'prior-assignment',
          }),
          nextStatus: 'inactive',
        },
      })
    ).not.toThrow();
  });

  it('canonicalizes equivalent timestamp offsets before fingerprinting', () => {
    const base = {
      competition: 'AFLM' as const,
      seasonYear: 2026,
      canonicalRoundLabel: 'Round 1',
      clubIds: ['afl-club:carlton', 'afl-club:fremantle'] as const,
    };
    expect(
      createAflTradeReviewedFixtureFingerprint({
        ...base,
        canonicalMatchDate: '2026-03-19T08:10:00.000Z',
      })
    ).toBe(
      createAflTradeReviewedFixtureFingerprint({
        ...base,
        canonicalMatchDate: '2026-03-19T19:10:00.000+11:00',
      })
    );
  });

  it('requires ambiguity evidence and detects decision digest tampering', () => {
    const proposal = playerProposal({
      proposedTarget: null,
      alternativePlayerIds: ['afl-player:one', 'afl-player:two'],
    });
    const decision = createAflTradeProviderResolutionDecision({
      ...decisionBase(proposal),
      outcome: 'ambiguous',
    });
    expect(() =>
      aflTradeProviderResolutionDecisionSchema.parse({
        ...decision,
        decisionSha256: digest('f'),
      })
    ).toThrow(/Digest must match/);
  });
});

describe('PostgreSQL AFL trade provider resolution repository', () => {
  it('rejects a self-asserted reviewer before opening a transaction', async () => {
    const decision = createAflTradeProviderResolutionDecision(decisionBase());
    let transactions = 0;
    const client = {
      query: async () => ({ rows: [], rowCount: 0 }),
      transaction: async () => {
        transactions += 1;
        throw new Error('The transaction must not start.');
      },
    } as AflOutcomeSqlClient;
    const repository = new PostgresAflTradeProviderResolutionRepository(client);

    await expect(
      repository.persistDecision(decision, {
        principalRef: 'operator:not-the-reviewer',
        environment: 'test_fixture',
      })
    ).rejects.toMatchObject({
      code: 'AUTHORITY_MISMATCH',
    });
    expect(transactions).toBe(0);
  });

  it('rejects a cross-environment execution before replay lookup', async () => {
    const decision = createAflTradeProviderResolutionDecision(decisionBase());
    let transactions = 0;
    const client = {
      query: async () => ({ rows: [], rowCount: 0 }),
      transaction: async () => {
        transactions += 1;
        throw new Error('The transaction must not start.');
      },
    } as AflOutcomeSqlClient;

    await expect(
      new PostgresAflTradeProviderResolutionRepository(client).persistDecision(decision, {
        principalRef: decision.content.reviewerAuthority.principalRef,
        environment: 'non_production',
      })
    ).rejects.toMatchObject({ code: 'AUTHORITY_MISMATCH' });
    expect(transactions).toBe(0);
  });

  it('returns a stable stale-revision error after the serialized head check', async () => {
    const decision = createAflTradeProviderResolutionDecision(decisionBase());
    const transaction = {
      query: async (sql: string) => {
        if (sql.includes('FROM outcome_provider_player_resolution_head')) {
          return {
            rows: [{ revision: 1, resolution_id: 'provider-resolution-decision:advanced' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const client = {
      query: transaction.query,
      transaction: async <Result>(callback: (value: typeof transaction) => Promise<Result>) =>
        callback(transaction),
    } as AflOutcomeSqlClient;

    await expect(
      new PostgresAflTradeProviderResolutionRepository(client).persistDecision(decision, {
        principalRef: decision.content.reviewerAuthority.principalRef,
        environment: 'test_fixture',
      })
    ).rejects.toMatchObject({ code: 'STALE_REVISION' });
  });

  it('rejects evidence execution in an environment different from the finalized capture', async () => {
    const candidateJson = {
      candidateId: 'identity-candidate:fixture',
      provider: staging.provider,
      entityKind: 'player',
      nativeEntityId: 'provider-player-1',
      recordedName: 'Fixture Player',
      recordedClubId: 'provider-club-1',
      recordedClubName: 'Fixture Club',
    };
    const exactStaging = {
      ...staging,
      candidateSha256: sha256AflTradeCanonicalJson(candidateJson),
    };
    const proposal = playerProposal({ staging: exactStaging });
    const decision = createAflTradeProviderResolutionDecision(decisionBase(proposal));
    const transaction = {
      query: async (sql: string) => {
        if (sql.includes('SELECT field_map_id FROM outcome_provider_normalization_run')) {
          return { rows: [{ field_map_id: 'provider-field-map:fixture' }], rowCount: 1 };
        }
        if (sql.includes('SELECT decision_json, revision FROM (')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT run.finalized_at, run.staging_sha256')) {
          return {
            rows: [
              {
                finalized_at: '2026-08-08T00:00:00.000Z',
                staging_sha256: exactStaging.stagingSha256,
                field_map_id: 'provider-field-map:fixture',
                field_map_sha256: exactStaging.fieldMapSha256,
                field_map_approval_current: true,
                provider_decoded_row_id: exactStaging.providerDecodedRowId,
                source_row_sha256: exactStaging.sourceRowSha256,
                row_status: exactStaging.rowStatus,
                competition: exactStaging.competition,
                season_year: exactStaging.seasonYear,
                source_row_number: 1,
                environment: 'non_production',
                provider: exactStaging.provider,
                capability_id: exactStaging.capabilityId,
                identity_candidate_id: 'identity-candidate:fixture',
                match_candidate_id: null,
                identity_candidate_json: candidateJson,
                match_candidate_json: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const client = {
      query: transaction.query,
      transaction: async <Result>(callback: (value: typeof transaction) => Promise<Result>) =>
        callback(transaction),
    } as AflOutcomeSqlClient;

    await expect(
      new PostgresAflTradeProviderResolutionRepository(client).persistDecision(decision, {
        principalRef: decision.content.reviewerAuthority.principalRef,
        environment: 'test_fixture',
      })
    ).rejects.toMatchObject({ code: 'STAGING_MISMATCH' });
  });

  it('binds exact staging, issue closures, governed evidence, and identity roots in order', async () => {
    const candidateJson = {
      candidateId: 'identity-candidate:fixture',
      provider: 'official_afl',
      entityKind: 'player',
      nativeEntityId: 'provider-player-1',
      recordedName: 'Player One',
      recordedClubId: 'provider-club-1',
      recordedClubName: 'Carlton',
      locatorSha256: digest('5'),
      resolutionState: 'unresolved',
    };
    const issueRows = [
      {
        issue_id: 'normalization-issue:fixture',
        issue_code: 'identity_requires_review',
        source_field: 'player_name',
        details_json: { reason: 'fixture' },
      },
    ];
    const finalizedAt = '2026-08-08T00:00:00.000Z';
    const normalizationFinalizationId = createAflTradeContentAddress(
      'provider-normalization-finalization',
      {
        normalizationRunId: staging.normalizationRunId,
        stagingSha256: staging.stagingSha256,
        finalizedAt,
      }
    );
    const issueSetId = createAflTradeContentAddress('provider-resolution-issue-set', {
      normalizationRunId: staging.normalizationRunId,
      providerDecodedRowId: staging.providerDecodedRowId,
      issues: issueRows,
    });
    const exactStaging = {
      ...staging,
      candidateSha256: sha256AflTradeCanonicalJson(candidateJson),
      normalizationFinalization: {
        id: normalizationFinalizationId,
        sha256: normalizationFinalizationId.slice(normalizationFinalizationId.indexOf(':') + 1),
      },
      issueSet: {
        id: issueSetId,
        sha256: issueSetId.slice(issueSetId.indexOf(':') + 1),
      },
    };
    const proposal = playerProposal({ staging: exactStaging });
    const decision = createAflTradeProviderResolutionDecision(decisionBase(proposal));
    const sqlCalls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const transaction = {
      query: async <Row>(sql: string, parameters: readonly unknown[] = []) => {
        sqlCalls.push({ sql, parameters });
        let rows: readonly unknown[] = [];
        if (sql.includes('SELECT field_map_id FROM outcome_provider_normalization_run')) {
          rows = [{ field_map_id: 'provider-field-map:fixture' }];
        } else if (sql.includes('SELECT decision_json, revision FROM (')) {
          rows = [];
        } else if (sql.includes('SELECT run.finalized_at, run.staging_sha256')) {
          rows = [
            {
              finalized_at: finalizedAt,
              staging_sha256: staging.stagingSha256,
              field_map_id: 'provider-field-map:fixture',
              field_map_sha256: staging.fieldMapSha256,
              field_map_approval_current: true,
              provider_decoded_row_id: staging.providerDecodedRowId,
              source_row_sha256: staging.sourceRowSha256,
              row_status: staging.rowStatus,
              competition: staging.competition,
              season_year: staging.seasonYear,
              source_row_number: 1,
              environment: staging.environment,
              provider: staging.provider,
              capability_id: staging.capabilityId,
              identity_candidate_id: 'identity-candidate:fixture',
              match_candidate_id: null,
              identity_candidate_json: candidateJson,
              match_candidate_json: null,
            },
          ];
        } else if (sql.includes('FROM outcome_governed_evidence_reference evidence')) {
          rows = [{ ok: 1 }];
        } else if (sql.includes('FROM outcome_operational_principal_authority authority')) {
          rows = [{ ok: 1 }];
        } else if (sql.includes('FROM outcome_provider_normalization_issue')) {
          rows = issueRows;
        } else if (sql.includes('FROM outcome_review_decision decision')) {
          rows = [{ decision_id: exactStaging.blockingIssueClosures[0]!.decision.id }];
        } else if (sql.includes('SELECT namespace.definition_json')) {
          rows = [{ definition_json: { fixture: true } }];
        } else if (sql.includes('FROM outcome_player WHERE player_id')) {
          rows = [{ ok: 1 }];
        } else if (sql.includes('SELECT proposal_sha256, resolution_case_id, proposal_json')) {
          rows = [
            {
              proposal_sha256: proposal.proposalSha256,
              resolution_case_id: proposal.content.resolutionCaseId,
              proposal_json: proposal.content,
            },
          ];
        } else if (sql.includes('SELECT closure_id, closure_sha256')) {
          rows = [
            {
              closure_id: exactStaging.blockingIssueClosures[0]!.decision.id,
              closure_sha256: exactStaging.blockingIssueClosures[0]!.decision.sha256,
            },
          ];
        } else if (sql.includes('FROM outcome_player_identity WHERE identity_id')) {
          rows = [
            {
              provider: staging.provider,
              native_id_namespace_id: playerNamespace.namespaceId,
              native_player_id: 'provider-player-1',
            },
          ];
        }
        return { rows: rows as readonly Row[], rowCount: rows.length };
      },
    };
    const client = {
      ...transaction,
      transaction: async <T>(work: (value: typeof transaction) => Promise<T>) => work(transaction),
    } as AflOutcomeSqlClient;

    await expect(
      new PostgresAflTradeProviderResolutionRepository(client).persistDecision(decision, {
        principalRef: decision.content.reviewerAuthority.principalRef,
        environment: 'test_fixture',
      })
    ).resolves.toMatchObject({ revision: 1, idempotentReplay: false });

    const closureInsert = sqlCalls.find(({ sql }) =>
      sql.includes('INSERT INTO outcome_provider_resolution_issue_closure')
    );
    expect(closureInsert?.parameters.slice(1)).toEqual([
      'normalization-issue:fixture',
      exactStaging.blockingIssueClosures[0]!.decision.id,
      exactStaging.blockingIssueClosures[0]!.decision.sha256,
    ]);
    const identityRoot = sqlCalls.findIndex(({ sql }) =>
      sql.includes('INSERT INTO outcome_player_identity')
    );
    const typedResolution = sqlCalls.findIndex(({ sql }) =>
      sql.includes('INSERT INTO outcome_provider_player_resolution')
    );
    expect(identityRoot).toBeGreaterThan(-1);
    expect(typedResolution).toBeGreaterThan(identityRoot);
    expect(
      sqlCalls.some(({ sql }) => sql.includes('FROM outcome_operational_principal_authority'))
    ).toBe(true);
  });
});
