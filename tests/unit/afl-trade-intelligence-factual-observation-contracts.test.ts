import { describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_APPEARANCE_CANDIDATE_SCHEMA_VERSION,
  AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
  AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION,
  AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
  aflTradeSourceFactContentSchema,
  createAflTradeProviderAppearanceCandidate,
  createAflTradeSourceFact,
  createAflTradeSourceFactBatch,
  type AflTradeSourceFact,
} from '@/server/aflTradeIntelligence/outcomes/factualObservationContracts';
import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

const digest = (character: string) => character.repeat(64);

function immutableReference(prefix: string, marker: string) {
  const id = createAflTradeContentAddress(prefix, { fixture: marker });
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

function activeAssignment(
  entityKind: 'player' | 'club' | 'club_alias' | 'match',
  decisionId: string,
  marker: string
) {
  return {
    assignmentCaseId: createAflTradeContentAddress('provider-identity-assignment-case', {
      entityKind,
      marker,
    }),
    entityKind,
    revision: 1,
    decisionId,
    status: 'active' as const,
  };
}

function playerResolution(playerId = 'afl-player:fixture') {
  const decision = immutableReference('provider-resolution-decision', `player:${playerId}`);
  return {
    mappingScope: 'provider_identity' as const,
    resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
      fixture: `player:${playerId}`,
    }),
    revision: 1,
    decision,
    canonicalTargetSnapshot: immutableReference('canonical-target-snapshot', `player:${playerId}`),
    identityCandidateId: 'identity-candidate:fixture',
    playerIdentityId: createAflTradeContentAddress('provider-player-identity', {
      fixture: playerId,
    }),
    playerId,
    assignment: activeAssignment('player', decision.id, playerId),
  };
}

function clubResolution(clubId: string, marker = clubId) {
  const decision = immutableReference('provider-resolution-decision', `club:${marker}`);
  return {
    mappingScope: 'provider_identity' as const,
    resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
      fixture: `club:${marker}`,
    }),
    revision: 1,
    decision,
    canonicalTargetSnapshot: immutableReference('canonical-target-snapshot', `club:${marker}`),
    occurrence: {
      source: 'player_affiliation' as const,
      identityCandidateId: 'identity-candidate:fixture',
    },
    clubIdentityId: createAflTradeContentAddress('provider-club-identity', { fixture: marker }),
    clubId,
    assignment: activeAssignment('club', decision.id, marker),
  };
}

function matchResolution() {
  const decision = immutableReference('provider-resolution-decision', 'match');
  const homeClub = clubResolution('afl-club:home', 'match-side-home');
  const awayClub = clubResolution('afl-club:away', 'match-side-away');
  return {
    resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
      fixture: 'match',
    }),
    revision: 1,
    decision,
    canonicalTargetSnapshot: immutableReference('canonical-target-snapshot', 'match'),
    matchCandidateId: 'match-candidate:fixture',
    matchIdentityId: createAflTradeContentAddress('provider-match-identity', {
      fixture: 'match',
    }),
    matchId: 'afl-match:fixture',
    canonicalMatchDate: '2026-03-20T08:00:00.000Z',
    canonicalRoundLabel: 'Round 1',
    homeClub: {
      clubId: homeClub.clubId,
      resolutionDecision: homeClub.decision,
      assignment: homeClub.assignment,
    },
    awayClub: {
      clubId: awayClub.clubId,
      resolutionDecision: awayClub.decision,
      assignment: awayClub.assignment,
    },
    assignment: activeAssignment('match', decision.id, 'match'),
  };
}

const normalizationRunId = createAflTradeContentAddress('provider-normalization-run', {
  fixture: 'run',
});
const stagingSha256 = digest('5');
const normalizationFinalizedAt = '2026-03-21T07:00:00.000Z';
const normalizationFinalizationId = createAflTradeContentAddress(
  'provider-normalization-finalization',
  {
    normalizationRunId,
    stagingSha256,
    finalizedAt: normalizationFinalizedAt,
  }
);
const normalizationFinalization = {
  id: normalizationFinalizationId,
  sha256: normalizationFinalizationId.slice(normalizationFinalizationId.indexOf(':') + 1),
};
const issueSet = immutableReference('provider-resolution-issue-set', 'run');

function sourceEvidence(
  candidateDigests: Record<
    'identity' | 'match' | 'metric' | 'achievement' | 'appearance',
    string | null
  > = {
    identity: digest('7'),
    match: digest('8'),
    metric: digest('3'),
    achievement: null,
    appearance: null,
  }
) {
  return {
    captureId: 'source-capture:fixture',
    normalizationRunId,
    normalizationFinalization,
    normalizationFinalizedAt,
    stagingSha256,
    providerDecodedRowId: 'provider-row:fixture',
    sourceRowNumber: 1,
    sourceRowSha256: digest('1'),
    semanticNaturalKeySha256: digest('2'),
    candidateDigests,
    rowStatus: 'staged' as const,
    issueSet,
    blockingIssueCount: 0,
    openBlockingIssueCount: 0,
    blockingIssueClosures: [],
    consumedSourceFields: ['goals', 'player_id'],
  };
}

function factBase() {
  return {
    schemaVersion: AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
    publicationEligible: false as const,
    environment: 'test_fixture' as const,
    provider: 'official_afl',
    capabilityId: 'official-afl-player-stats',
    competition: 'AFLM' as const,
    seasonYear: 2026,
    fieldMapSha256: digest('4'),
    effectiveAt: '2026-03-20T08:00:00.000Z',
    recordedAt: '2026-03-21T08:00:00.000Z',
    source: sourceEvidence(),
  };
}

function appearanceCandidate() {
  return createAflTradeProviderAppearanceCandidate({
    schemaVersion: AFL_TRADE_APPEARANCE_CANDIDATE_SCHEMA_VERSION,
    environment: 'test_fixture',
    provider: 'official_afl',
    capabilityId: 'official-afl-player-stats',
    competition: 'AFLM',
    seasonYear: 2026,
    captureId: 'source-capture:fixture',
    normalizationRunId,
    normalizationFinalization,
    normalizationFinalizedAt,
    stagingSha256,
    providerDecodedRowId: 'provider-row:fixture',
    sourceRowNumber: 1,
    sourceRowSha256: digest('1'),
    semanticNaturalKeySha256: digest('2'),
    fieldMapSha256: digest('4'),
    identityCandidateId: 'identity-candidate:fixture',
    identityCandidateSha256: digest('7'),
    matchCandidateId: 'match-candidate:fixture',
    matchCandidateSha256: digest('8'),
    appearanceState: 'observed',
    sourceFields: ['goals', 'player_id'],
    derivationPolicy: immutableReference('player-appearance-policy', 'v1'),
  });
}

function appearanceContent(overrides: Record<string, unknown> = {}) {
  const candidate = appearanceCandidate();
  return {
    ...factBase(),
    source: sourceEvidence({
      identity: digest('7'),
      match: digest('8'),
      metric: null,
      achievement: null,
      appearance: candidate.candidateSha256,
    }),
    factKind: 'player_appearance' as const,
    player: playerResolution(),
    representedClub: clubResolution('afl-club:home'),
    match: matchResolution(),
    appearanceCandidate: candidate,
    appearanceState: 'observed' as const,
    ...overrides,
  };
}

function metricContent(appearanceFactId: string, overrides: Record<string, unknown> = {}) {
  return {
    ...factBase(),
    factKind: 'player_match_metric' as const,
    player: playerResolution(),
    representedClub: clubResolution('afl-club:home'),
    match: matchResolution(),
    appearanceFactId,
    metricCode: 'goals' as const,
    definitionVersion: 'goals/v1',
    definition: immutableReference('metric-definition', 'goals/v1'),
    unit: 'goals',
    availability: {
      state: 'measured' as const,
      numericValue: '0',
      reasonCode: null,
    },
    ...overrides,
  };
}

function seasonMetricContent(overrides: Record<string, unknown> = {}) {
  return {
    ...factBase(),
    source: sourceEvidence({
      identity: digest('7'),
      match: null,
      metric: digest('3'),
      achievement: null,
      appearance: null,
    }),
    factKind: 'player_season_metric' as const,
    player: playerResolution(),
    seasonClubScope: {
      kind: 'resolved_single_club' as const,
      club: clubResolution('afl-club:home'),
    },
    metricCode: 'goals' as const,
    definitionVersion: 'goals/v1',
    definition: immutableReference('metric-definition', 'goals/v1'),
    unit: 'goals',
    availability: {
      state: 'measured' as const,
      numericValue: '1',
      reasonCode: null,
    },
    ...overrides,
  };
}

function batchContent(facts: readonly AflTradeSourceFact[]) {
  const sortedFacts = [...facts].sort((left, right) => left.factId.localeCompare(right.factId));
  const rowFactIds = sortedFacts.map(({ factId }) => factId).sort();
  const count = (factKind: AflTradeSourceFact['content']['factKind']) =>
    sortedFacts.filter(({ content }) => content.factKind === factKind).length;
  const rowAccounting = [
    {
      providerDecodedRowId: 'provider-row:fixture',
      sourceRowSha256: digest('1'),
      disposition: 'normalized' as const,
      factIds: rowFactIds,
      issueSet,
      issueIds: [],
      blockingIssueIds: [],
      blockingIssueClosures: [],
      reasonCode: null,
    },
  ];
  return {
    schemaVersion: AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
    publicationEligible: false as const,
    environment: 'test_fixture' as const,
    provider: 'official_afl',
    capabilityId: 'official-afl-player-stats',
    competition: 'AFLM' as const,
    seasonYear: 2026,
    captureId: 'source-capture:fixture',
    normalizationRunId,
    normalizationFinalization,
    normalizationFinalizedAt,
    fieldMapSha256: digest('4'),
    stagingSha256,
    sourceRowSetSha256: sha256AflTradeCanonicalJson(
      rowAccounting.map(({ providerDecodedRowId, sourceRowSha256 }) => ({
        providerDecodedRowId,
        sourceRowSha256,
      }))
    ),
    sourceIssueSetSha256: sha256AflTradeCanonicalJson(
      rowAccounting.map(
        ({
          providerDecodedRowId,
          issueSet,
          issueIds,
          blockingIssueIds,
          blockingIssueClosures,
        }) => ({
          providerDecodedRowId,
          issueSet,
          issueIds,
          blockingIssueIds,
          blockingIssueClosures,
        })
      )
    ),
    createdAt: '2026-03-22T08:00:00.000Z',
    sourceRowCount: 1,
    sourceIssueCount: 0,
    facts: sortedFacts,
    rowAccounting,
    counts: {
      matchUniverse: count('match_universe'),
      playerAppearances: count('player_appearance'),
      playerMatchMetrics: count('player_match_metric'),
      playerSeasonMetrics: count('player_season_metric'),
      playerAchievements: count('player_achievement'),
      normalizedRows: 1,
      nonNormalizedRows: 0,
    },
  };
}

describe('AFL trade factual source contracts', () => {
  it('content-addresses facts and exhaustive batches deterministically', () => {
    const candidate = appearanceCandidate();
    const replayedCandidate = createAflTradeProviderAppearanceCandidate(
      structuredClone(candidate.content)
    );
    const fact = createAflTradeSourceFact(appearanceContent());
    const replayedFact = createAflTradeSourceFact(structuredClone(fact.content));
    const batch = createAflTradeSourceFactBatch(batchContent([fact]));
    const replayedBatch = createAflTradeSourceFactBatch(structuredClone(batch.content));

    expect(replayedCandidate).toEqual(candidate);
    expect(replayedFact).toEqual(fact);
    expect(replayedBatch).toEqual(batch);
    expect(fact.factId).toMatch(/^source-fact:[a-f0-9]{64}$/);
    expect(batch.batchId).toMatch(/^source-fact-batch:[a-f0-9]{64}$/);
  });

  it('supports distinct authenticated row issue sets in one exhaustive batch', () => {
    const fact = createAflTradeSourceFact(appearanceContent());
    const first = batchContent([fact]);
    const rowAccounting = [
      ...first.rowAccounting,
      {
        providerDecodedRowId: 'provider-row:second',
        sourceRowSha256: digest('6'),
        disposition: 'quarantined' as const,
        factIds: [],
        issueSet: immutableReference('provider-resolution-issue-set', 'second-row'),
        issueIds: ['normalization-issue:second-row'],
        blockingIssueIds: ['normalization-issue:second-row'],
        blockingIssueClosures: [],
        reasonCode: 'identity_unresolved',
      },
    ];
    const content = {
      ...first,
      sourceRowCount: 2,
      sourceIssueCount: 1,
      rowAccounting,
      sourceRowSetSha256: sha256AflTradeCanonicalJson(
        rowAccounting.map(({ providerDecodedRowId, sourceRowSha256 }) => ({
          providerDecodedRowId,
          sourceRowSha256,
        }))
      ),
      sourceIssueSetSha256: sha256AflTradeCanonicalJson(
        rowAccounting.map(
          ({
            providerDecodedRowId,
            issueSet,
            issueIds,
            blockingIssueIds,
            blockingIssueClosures,
          }) => ({
            providerDecodedRowId,
            issueSet,
            issueIds,
            blockingIssueIds,
            blockingIssueClosures,
          })
        )
      ),
      counts: { ...first.counts, nonNormalizedRows: 1 },
    };

    expect(createAflTradeSourceFactBatch(content).content.rowAccounting).toHaveLength(2);
  });

  it('preserves a true measured zero instead of converting it to missing', () => {
    const appearance = createAflTradeSourceFact(appearanceContent());
    const fact = createAflTradeSourceFact(metricContent(appearance.factId));

    expect(fact.content).toMatchObject({
      factKind: 'player_match_metric',
      metricCode: 'goals',
      availability: { state: 'measured', numericValue: '0', reasonCode: null },
    });
  });

  it('requires missing metrics to carry null plus an explicit reason', () => {
    const appearance = createAflTradeSourceFact(appearanceContent());
    const missing = createAflTradeSourceFact(
      metricContent(appearance.factId, {
        availability: {
          state: 'missing',
          numericValue: null,
          reasonCode: 'provider_value_missing',
        },
      })
    );
    expect(missing.content).toMatchObject({
      availability: {
        state: 'missing',
        numericValue: null,
        reasonCode: 'provider_value_missing',
      },
    });
    expect(() =>
      createAflTradeSourceFact(
        metricContent(appearance.factId, {
          availability: { state: 'missing', numericValue: '0', reasonCode: null },
        })
      )
    ).toThrow();
  });

  it('requires every player-bound fact to bind its exact identity candidate digest', () => {
    const content = seasonMetricContent();

    expect(() =>
      createAflTradeSourceFact({
        ...content,
        source: {
          ...content.source,
          candidateDigests: { ...content.source.candidateDigests, identity: null },
        },
      })
    ).toThrow(/player_season_metric fact must bind only its exact required candidate digests/);
  });

  it('admits only an explicit staged appearance claim and never a source games metric', () => {
    const fact = createAflTradeSourceFact(appearanceContent());
    expect(fact.content).toMatchObject({
      factKind: 'player_appearance',
      appearanceState: 'observed',
      appearanceCandidate: {
        content: {
          appearanceState: 'observed',
          providerDecodedRowId: 'provider-row:fixture',
          sourceRowSha256: digest('1'),
        },
      },
    });
    expect('numericValue' in fact.content).toBe(false);
    expect(() =>
      createAflTradeSourceFact({
        ...appearanceContent(),
        appearanceCandidate: undefined,
      })
    ).toThrow();
    const wrongRowCandidate = createAflTradeProviderAppearanceCandidate({
      ...appearanceCandidate().content,
      providerDecodedRowId: 'provider-row:other',
    });
    expect(() =>
      createAflTradeSourceFact(appearanceContent({ appearanceCandidate: wrongRowCandidate }))
    ).toThrow(/exact authenticated run, row, candidates/);
    expect(() =>
      createAflTradeSourceFact({
        ...appearanceContent(),
        appearanceCandidate: {
          ...appearanceCandidate(),
          content: { ...appearanceCandidate().content, sourceRowSha256: digest('9') },
        },
      })
    ).toThrow(/canonical provider-appearance-candidate content address/);
    expect(
      aflTradeSourceFactContentSchema.safeParse({
        ...metricContent(fact.factId),
        metricCode: 'games',
      }).success
    ).toBe(false);
  });

  it('rejects a represented club outside the exact resolved match sides', () => {
    expect(() =>
      createAflTradeSourceFact(
        appearanceContent({ representedClub: clubResolution('afl-club:third', 'third') })
      )
    ).toThrow(/one of the exact resolved match sides/);
  });

  it('rejects row-accounting and exact-count drift', () => {
    const appearance = createAflTradeSourceFact(appearanceContent());
    const fact = createAflTradeSourceFact(metricContent(appearance.factId));
    const valid = batchContent([appearance, fact]);
    expect(() =>
      createAflTradeSourceFactBatch({
        ...valid,
        rowAccounting: [{ ...valid.rowAccounting[0]!, factIds: [] }],
      })
    ).toThrow(/Row accounting must exactly match/);
    expect(() =>
      createAflTradeSourceFactBatch({
        ...valid,
        counts: { ...valid.counts, playerMatchMetrics: 2 },
      })
    ).toThrow(/Batch counts must exactly reconcile/);
    expect(() =>
      createAflTradeSourceFactBatch({ ...valid, sourceRowSetSha256: digest('9') })
    ).toThrow(/Source-row-set digest/);
    expect(() => createAflTradeSourceFactBatch({ ...valid, sourceIssueCount: 1 })).toThrow(
      /Every finalized normalization issue/
    );
    const downgradedIssueRows = [
      {
        ...valid.rowAccounting[0]!,
        issueIds: ['normalization-issue:unclassified'],
        blockingIssueIds: [],
      },
    ];
    const downgradedIssueSetSha256 = sha256AflTradeCanonicalJson(
      downgradedIssueRows.map(
        ({
          providerDecodedRowId,
          issueSet,
          issueIds,
          blockingIssueIds,
          blockingIssueClosures,
        }) => ({
          providerDecodedRowId,
          issueSet,
          issueIds,
          blockingIssueIds,
          blockingIssueClosures,
        })
      )
    );
    expect(() =>
      createAflTradeSourceFactBatch({
        ...valid,
        sourceIssueCount: 1,
        sourceIssueSetSha256: downgradedIssueSetSha256,
        rowAccounting: downgradedIssueRows,
      })
    ).toThrow(/Every normalization issue is blocking in v1/);
    const orphanAppearanceId = createAflTradeContentAddress('source-fact', {
      fixture: 'orphan-appearance',
    });
    const orphanMetric = createAflTradeSourceFact(metricContent(orphanAppearanceId));
    expect(() => createAflTradeSourceFactBatch(batchContent([orphanMetric]))).toThrow(
      /must reference the exact appearance fact/
    );
  });

  it('rejects facts substituted across batch provider scope', () => {
    const appearance = createAflTradeSourceFact(appearanceContent());
    const fact = createAflTradeSourceFact(metricContent(appearance.factId));
    expect(() =>
      createAflTradeSourceFactBatch({
        ...batchContent([appearance, fact]),
        provider: 'afl_tables',
      })
    ).toThrow(/exact batch scope/);
  });

  it('keeps source facts outside publication and fantasy ownership', () => {
    expect(() =>
      createAflTradeSourceFact(appearanceContent({ publicationEligible: true }))
    ).toThrow();
    expect(() =>
      createAflTradeSourceFact(
        appearanceContent({
          player: playerResolution('user:fixture'),
        })
      )
    ).toThrow(/cannot identify fantasy or user-owned state/);
    expect(() =>
      createAflTradeSourceFact(appearanceContent({ authorityBoundary: 'public_factual_release' }))
    ).toThrow();
  });
});
