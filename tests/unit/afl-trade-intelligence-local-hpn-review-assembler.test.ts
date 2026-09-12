import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createLocalAflTradeAflTablesResultsAuthority,
  createLocalAflTradeFiveSeasonAflTablesAuthority,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { assembleLocalAflTradeHpnLeagueSeasonReviewPacket } from '@/server/aflTradeIntelligence/development/localHpnLeagueSeasonReviewAssembler';
import type { LocalAflTradeHpnReviewSnapshot } from '@/server/aflTradeIntelligence/development/localHpnReviewSnapshot';
import { createLocalAflTradeOfficialAfl2026Authority } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Authority';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';
import {
  createAflTradePrivateReviewedEvidenceBundle,
  createAflTradePrivateReviewedEvidenceEvaluationDecision,
} from '@/server/aflTradeIntelligence/valuation/privateReviewedEvidenceEvaluation';

const trustedAt = '2026-08-16T05:00:00.000Z';
const methodRegisteredAt = '2026-08-16T04:30:00.000Z';
const methodBytes = new TextEncoder().encode('<html>retained HPN method</html>');
const method = createAflTradeHpnPavMethod({
  sourceArtifact: createAflTradeByteArtifactRef(
    methodBytes,
    'text/html',
    '2026-08-16T02:00:00.000Z'
  ),
  sourceBytes: methodBytes,
  capturedAt: '2026-08-16T02:00:00.000Z',
});

type SnapshotSource = LocalAflTradeHpnReviewSnapshot['sources'][number];

function footywireSource(seasonYear = 2025) {
  const exactOrderedFields = [
    'Player', 'Match_id', 'Team', 'HO', 'GA', 'I50', 'M', 'MI5', 'FF', 'FA',
    'R50', 'One.Percenters', 'CL', 'T', 'G', 'B',
  ];
  const baseRights = createLocalAflTradeFiveSeasonAflTablesAuthority(seasonYear)
    .capture.sourceRights.content;
  const rightsContent = {
    ...baseRights,
    provider: 'footywire',
    dataset: 'FootyWire player statistics fixture',
    acquisition: {
      ...baseRights.acquisition,
      capabilities: [{
        capabilityId: 'footywire-player-stats',
        provider: 'footywire',
        directFunction: 'fetch_player_stats_footywire',
      }],
    },
    fields: exactOrderedFields.map((sourceField) => ({
      ...baseRights.fields[0]!, sourceField, normalizedField: sourceField,
    })),
  };
  const rights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  return {
    seasonYear,
    captureId: `capture:footywire:${seasonYear}`,
    provider: 'footywire',
    capabilityId: 'footywire-player-stats',
    normalizationRunId: `provider-normalization-run:${'6'.repeat(64)}`,
    providerDecodeMap: {
      mapId: `footywire-player-stats-fixture-${seasonYear}`,
      capabilityId: 'footywire-player-stats',
      sourceSchemaSha256: 'a'.repeat(64),
      exactOrderedFields,
      validFromSeason: seasonYear,
      validThroughSeason: seasonYear,
    },
    rights,
    rightsArtifact: createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt),
    hpnResultProjection: null,
    hpnPlayerProjection: null,
    factualRunId: null,
    hpnResolutionsCurrent: false,
  } as const;
}

function snapshot(input: {
  withMethod?: boolean;
  withResults?: boolean;
  additionalPlayerSources?: readonly SnapshotSource[];
} = {}) {
  const withResults = input.withResults ?? true;
  const additionalPlayerSources = input.additionalPlayerSources ?? [];
  const authority2024 = createLocalAflTradeFiveSeasonAflTablesAuthority(2024);
  const authority2025 = createLocalAflTradeFiveSeasonAflTablesAuthority(2025);
  const results2024 = createLocalAflTradeAflTablesResultsAuthority(2024);
  const results2025 = createLocalAflTradeAflTablesResultsAuthority(2025);
  const rights = authority2025.capture.sourceRights;
  const rightsArtifact = createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt);
  const resultsRights = results2025.capture.sourceRights;
  const resultsRightsArtifact = createAflTradeCanonicalJsonArtifactRef(
    resultsRights,
    resultsRights.content.proposedAt
  );
  const sourceArtifact = (seasonYear: number) =>
    createAflTradeCanonicalJsonArtifactRef(
      { kind: 'retained-source', seasonYear },
      '2026-08-14T00:00:00.000Z'
    );
  const evidenceBundle = createAflTradePrivateReviewedEvidenceBundle({
    evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
    reviewSets: [
      {
        reviewSetId: '1'.repeat(64),
        reviewSetDecisionId: 'local-review-set:2024-2025',
        reviewerId: 'local-reviewer',
        candidateCount: 2,
        decisionCount: 6,
        reviewSetArtifact: createAflTradeCanonicalJsonArtifactRef(
          { kind: 'review-set' },
          '2026-08-16T03:00:00.000Z'
        ),
      },
    ],
    sourceCaptures: [
      {
        captureId: 'capture:afl-tables:2024',
        provider: 'afl_tables',
        capabilityId: 'afl-tables-player-stats',
        seasonYear: 2024,
        sourceArtifact: sourceArtifact(2024),
      },
      {
        captureId: 'capture:afl-tables:2025',
        provider: 'afl_tables',
        capabilityId: 'afl-tables-player-stats',
        seasonYear: 2025,
        sourceArtifact: sourceArtifact(2025),
      },
      ...(withResults
        ? [
            {
              captureId: 'capture:afl-tables-results:2024',
              provider: 'afl_tables' as const,
              capabilityId: 'afl-tables-results',
              seasonYear: 2024,
              sourceArtifact: sourceArtifact(2024),
            },
            {
              captureId: 'capture:afl-tables-results:2025',
              provider: 'afl_tables' as const,
              capabilityId: 'afl-tables-results',
              seasonYear: 2025,
              sourceArtifact: sourceArtifact(2025),
            },
          ]
        : []),
      ...additionalPlayerSources.map(({ captureId, provider, capabilityId, seasonYear }) => ({
        captureId, provider, capabilityId, seasonYear, sourceArtifact: sourceArtifact(seasonYear),
      })),
    ],
    sourceRightsEvidenceRefs: [
      rightsArtifact,
      ...(withResults ? [resultsRightsArtifact] : []),
      ...additionalPlayerSources.map(({ rightsArtifact: artifact }) => artifact),
    ],
    createdAt: '2026-08-16T03:30:00.000Z',
  });
  const evidenceBundleArtifact = createAflTradeCanonicalJsonArtifactRef(
    evidenceBundle,
    evidenceBundle.content.createdAt
  );
  const decision = createAflTradePrivateReviewedEvidenceEvaluationDecision({
    status: 'authorized',
    valuationScopeKey: 'workbook:2025',
    evidenceBundle,
    evidenceBundleArtifact,
    revision: 1,
    supersedesDecisionId: null,
    reviewerId: 'local-reviewer',
    rationale: 'Private local calculation evaluation only.',
    decidedAt: '2026-08-16T04:00:00.000Z',
  });
  const playerSource = (
    seasonYear: number,
    fieldMap: typeof authority2025.fieldMap,
    character: string
  ) => ({
    seasonYear,
    captureId: `capture:afl-tables:${seasonYear}`,
    provider: 'afl_tables',
    capabilityId: 'afl-tables-player-stats',
    normalizationRunId: `provider-normalization-run:${character.repeat(64)}`,
    providerDecodeMap: fieldMap,
    rights,
    rightsArtifact,
    hpnResultProjection: null,
    hpnPlayerProjection: null,
    factualRunId: null,
    hpnResolutionsCurrent: false,
  });
  const resultSource = (
    seasonYear: number,
    fieldMap: typeof results2025.fieldMap,
    character: string
  ) => ({
    seasonYear,
    captureId: `capture:afl-tables-results:${seasonYear}`,
    provider: 'afl_tables',
    capabilityId: 'afl-tables-results',
    normalizationRunId: `provider-normalization-run:${character.repeat(64)}`,
    providerDecodeMap: fieldMap,
    rights: resultsRights,
    rightsArtifact: resultsRightsArtifact,
    hpnResultProjection: null,
    hpnPlayerProjection: null,
    factualRunId: null,
    hpnResolutionsCurrent: false,
  });
  return {
    trusted_at: trustedAt,
    reviewed_evidence_bundle_json: evidenceBundle,
    reviewed_evaluation_decision_json: decision,
    evidence_current: true,
    method_count: input.withMethod ? 1 : 0,
    method_json: input.withMethod ? method : null,
    method_registered_at: input.withMethod ? methodRegisteredAt : null,
    sources_json: [
      ...(withResults ? [resultSource(2024, results2024.fieldMap, '2')] : []),
      playerSource(2024, authority2024.fieldMap, '4'),
      ...(withResults ? [resultSource(2025, results2025.fieldMap, '3')] : []),
      playerSource(2025, authority2025.fieldMap, '5'),
      ...additionalPlayerSources,
    ],
  };
}

class FixtureClient implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  readonly statements: string[] = [];
  constructor(private readonly row = snapshot()) {}

  async query<Row = Record<string, unknown>>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.statements.push(sql);
    return { rows: [this.row as Row], rowCount: 1 };
  }

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('local HPN league-season review assembler', () => {
  it('selects FootyWire corroboration while retaining field-map and identity review blockers', async () => {
    const source = footywireSource();
    const client = new FixtureClient(snapshot({
      withMethod: true, additionalPlayerSources: [source],
    }));
    const assembled = await assembleLocalAflTradeHpnLeagueSeasonReviewPacket(
      client,
      { valuationScopeKey: 'workbook:2025', fromSeason: 2025, throughSeason: 2025 }
    );

    expect(client.statements[0]).toContain("'footywire-player-stats'");
    const corroborating = assembled.eligibilityReports[0]!.report.content.sources.find(
      ({ role }) => role === 'corroborating'
    )!;
    expect(corroborating).toMatchObject({
      selectionState: 'selected',
      provider: 'footywire',
      normalizationRunId: source.normalizationRunId,
      fields: expect.arrayContaining([
        expect.objectContaining({
          semanticField: 'player',
          sourceFields: ['Player'],
          state: 'blocked',
          fieldMapReview: expect.objectContaining({ state: 'missing' }),
          factualReview: expect.objectContaining({ state: 'missing' }),
          canonicalIdentity: expect.objectContaining({ state: 'incomplete' }),
          sourceUse: expect.objectContaining({ state: 'permitted_private_calculation' }),
        }),
      ]),
    });
    const footywireCandidate = assembled.fieldMapCandidates.find(
      ({ candidate }) => candidate.content.provider === 'footywire'
    );
    expect(footywireCandidate?.candidate.content).toMatchObject({
      provider: 'footywire',
      capabilityId: 'footywire-player-stats',
      reviewState: 'requires_review',
      publicationProhibited: true,
    });
    expect(assembled.packet.content).toMatchObject({ state: 'blocked', publicationProhibited: true });
  });

  it('derives one immutable blocked packet from the exact database snapshot', async () => {
    const client = new FixtureClient();
    const assembled = await assembleLocalAflTradeHpnLeagueSeasonReviewPacket(client, {
      valuationScopeKey: 'workbook:2025',
      fromSeason: 2024,
      throughSeason: 2025,
    });

    expect(client.statements).toHaveLength(1);
    expect(client.statements[0]).toContain('transaction_timestamp()');
    expect(client.statements[0]).toContain('outcome_private_reviewed_evidence_is_current()');
    expect(client.statements[0]).toContain('outcome_hpn_pav_method');
    expect(client.statements[0]).toContain("'afl-tables-results'");
    expect(assembled.packet.content).toMatchObject({
      state: 'blocked',
      methodSelection: { state: 'missing', methodId: null },
      blockerCounts: expect.arrayContaining([{ blocker: 'method_not_authenticated', count: 2 }]),
      counts: {
        seasonCount: 2,
        eligibleSeasons: 0,
        blockedSeasons: 2,
        sourceSlots: 6,
        missingSourceSlots: 2,
        totalFields: 42,
        eligibleFields: 0,
        blockedFields: 42,
      },
    });
    expect(assembled.fieldMapCandidates).toHaveLength(4);
    expect(assembled.sourceUseAssessments).toHaveLength(4);
    expect(
      assembled.sourceUseAssessments.map(({ assessment }) => assessment.content.reasons)
    ).toEqual(Array.from({ length: 4 }, () => []));
    for (const { report } of assembled.eligibilityReports) {
      expect(report.content.sources).toMatchObject([
        {
          selectionState: 'selected',
          inputKind: 'completed_match_result',
          role: null,
        },
        {
          selectionState: 'selected',
          inputKind: 'player_match_stats',
          role: 'primary',
        },
        {
          selectionState: 'missing',
          inputKind: 'player_match_stats',
          role: 'corroborating',
        },
      ]);
      expect(report.content.sources[0]!.normalizationRunId).not.toBe(
        report.content.sources[1]!.normalizationRunId
      );
    }
    const primary = assembled.eligibilityReports[0]!.report.content.sources.find(
      ({ role }) => role === 'primary'
    )!;
    if (primary.selectionState !== 'selected') {
      throw new Error('Expected a selected primary source report.');
    }
    expect(primary.fields.every(({ state }) => state === 'blocked')).toBe(true);
    expect(primary.fields[0]!.fieldMapReview.state).toBe('missing');
    expect(primary.fields[0]!.sourceUse.state).toBe('permitted_private_calculation');
    expect(primary.fields[0]!.factualReview.state).toBe('missing');
    expect(assembled.documents).toEqual(
      expect.arrayContaining([expect.objectContaining({ artifactRef: assembled.packetArtifact })])
    );
  });

  it.each([
    ['official_afl', 'footywire-player-stats'],
    ['afl_tables', 'footywire-player-stats'],
    ['footywire', 'official-afl-player-stats'],
    ['footywire', 'afl-tables-player-stats'],
    ['footywire', 'afl-tables-results'],
  ] as const)('rejects mismatched provider %s and capability %s', async (provider, capabilityId) => {
    const row = snapshot({ additionalPlayerSources: [footywireSource()] });
    row.sources_json[4] = { ...row.sources_json[4]!, provider, capabilityId };

    await expect(assembleLocalAflTradeHpnLeagueSeasonReviewPacket(new FixtureClient(row), {
      valuationScopeKey: 'workbook:2025', fromSeason: 2025, throughSeason: 2025,
    })).rejects.toThrow(/provider.*capability/i);
  });

  it('rejects ambiguous FootyWire and official AFL corroborating captures', async () => {
    const source = footywireSource(2026);
    const official = createLocalAflTradeOfficialAfl2026Authority();
    const rights = official.capture.sourceRights;
    const row = snapshot({ additionalPlayerSources: [
      source,
      {
        ...source,
        captureId: 'capture:official-afl:2026',
        provider: 'official_afl',
        capabilityId: 'official-afl-player-stats',
        normalizationRunId: `provider-normalization-run:${'7'.repeat(64)}`,
        providerDecodeMap: official.fieldMap,
        rights,
        rightsArtifact: createAflTradeCanonicalJsonArtifactRef(rights, rights.content.proposedAt),
      },
    ] });

    await expect(assembleLocalAflTradeHpnLeagueSeasonReviewPacket(new FixtureClient(row), {
      valuationScopeKey: 'workbook:2025', fromSeason: 2026, throughSeason: 2026,
    })).rejects.toThrow(/corroborating player-stat source selection is ambiguous/i);
  });

  it('does not use FootyWire evidence from another season for corroboration', async () => {
    const assembled = await assembleLocalAflTradeHpnLeagueSeasonReviewPacket(
      new FixtureClient(snapshot({ additionalPlayerSources: [footywireSource(2024)] })),
      { valuationScopeKey: 'workbook:2025', fromSeason: 2025, throughSeason: 2025 }
    );

    expect(assembled.eligibilityReports[0]!.report.content.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'corroborating', selectionState: 'missing', provider: null }),
    ]));
    expect(assembled.fieldMapCandidates.every(({ candidate }) =>
      candidate.content.provider === 'afl_tables'
    )).toBe(true);
  });

  it('rejects a stale reviewed-evidence head before constructing reports', async () => {
    const client = new FixtureClient({ ...snapshot(), evidence_current: false });
    await expect(
      assembleLocalAflTradeHpnLeagueSeasonReviewPacket(client, {
        valuationScopeKey: 'workbook:2025',
        fromSeason: 2024,
        throughSeason: 2025,
      })
    ).rejects.toThrow(/reviewed evidence is not current/i);
  });

  it('authenticates one exact registered method from the same database snapshot', async () => {
    const assembled = await assembleLocalAflTradeHpnLeagueSeasonReviewPacket(
      new FixtureClient(snapshot({ withMethod: true })),
      {
        valuationScopeKey: 'workbook:2025',
        fromSeason: 2024,
        throughSeason: 2025,
      }
    );

    expect(assembled.packet.content.methodSelection).toMatchObject({
      state: 'authenticated',
      methodId: method.methodId,
      methodArtifact: createAflTradeCanonicalJsonArtifactRef(method, methodRegisteredAt),
    });
    expect(assembled.documents).toEqual(
      expect.arrayContaining([expect.objectContaining({ document: method })])
    );
  });

  it('preserves historical result and player mappings from one AFL Tables source', async () => {
    const assembled = await assembleLocalAflTradeHpnLeagueSeasonReviewPacket(
      new FixtureClient(snapshot({ withResults: false })),
      {
        valuationScopeKey: 'workbook:2025',
        fromSeason: 2024,
        throughSeason: 2025,
      }
    );

    expect(assembled.fieldMapCandidates).toHaveLength(4);
    expect(assembled.sourceUseAssessments).toHaveLength(4);
    for (const { report } of assembled.eligibilityReports) {
      expect(report.content.sources).toMatchObject([
        { selectionState: 'selected', inputKind: 'completed_match_result', role: null },
        { selectionState: 'selected', inputKind: 'player_match_stats', role: 'primary' },
        { selectionState: 'missing', inputKind: 'player_match_stats', role: 'corroborating' },
      ]);
      expect(report.content.sources[0]!.normalizationRunId).toBe(
        report.content.sources[1]!.normalizationRunId
      );
    }
  });
});
