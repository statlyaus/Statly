import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { assembleLocalAflTradeHpnLeagueSeasonReviewPacket } from '@/server/aflTradeIntelligence/development/localHpnLeagueSeasonReviewAssembler';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
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

function snapshot(input: { withMethod?: boolean } = {}) {
  const authority2024 = createLocalAflTradeFiveSeasonAflTablesAuthority(2024);
  const authority2025 = createLocalAflTradeFiveSeasonAflTablesAuthority(2025);
  const rights = authority2025.capture.sourceRights;
  const rightsArtifact = createAflTradeCanonicalJsonArtifactRef(
    rights,
    rights.content.proposedAt
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
    ],
    sourceRightsEvidenceRefs: [rightsArtifact],
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
  const source = (
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
    hpnFieldMap: null,
    hpnFieldMapCreatedAt: null,
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
      source(2024, authority2024.fieldMap, '4'),
      source(2025, authority2025.fieldMap, '5'),
    ],
  };
}

class FixtureClient implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  readonly statements: string[] = [];
  constructor(private readonly row = snapshot()) {}

  async query<Row = Record<string, unknown>>(
    sql: string
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.statements.push(sql);
    return { rows: [this.row as Row], rowCount: 1 };
  }

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('local HPN league-season review assembler', () => {
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
    expect(assembled.packet.content).toMatchObject({
      state: 'blocked',
      methodSelection: { state: 'missing', methodId: null },
      blockerCounts: expect.arrayContaining([
        { blocker: 'method_not_authenticated', count: 2 },
      ]),
      counts: {
        seasonCount: 2,
        eligibleSeasons: 0,
        blockedSeasons: 2,
        sourceSlots: 6,
        missingSourceSlots: 4,
        totalFields: 72,
        eligibleFields: 0,
        blockedFields: 72,
      },
    });
    expect(assembled.fieldMapCandidates).toHaveLength(2);
    expect(assembled.sourceUseAssessments).toHaveLength(2);
    expect(
      assembled.sourceUseAssessments.map(({ assessment }) => assessment.content.reasons)
    ).toEqual([
      ['derived_feature_operation_blocked', 'derived_source_field_blocked'],
      ['derived_feature_operation_blocked', 'derived_source_field_blocked'],
    ]);
    const primary = assembled.eligibilityReports[0]!.report.content.sources.find(
      ({ role }) => role === 'primary'
    )!;
    expect(primary.selectionState).toBe('selected');
    expect(primary.fields.every(({ state }) => state === 'blocked')).toBe(true);
    expect(primary.fields[0]!.fieldMapReview.state).toBe('missing');
    expect(primary.fields[0]!.sourceUse.state).toBe('not_permitted');
    expect(primary.fields[0]!.factualReview.state).toBe('missing');
    expect(assembled.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifactRef: assembled.packetArtifact }),
      ])
    );
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
      expect.arrayContaining([
        expect.objectContaining({ document: method }),
      ])
    );
  });
});
