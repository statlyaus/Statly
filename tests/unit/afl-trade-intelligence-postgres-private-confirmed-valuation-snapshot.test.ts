import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeHpnReviewedSeasonDecision,
  createAflTradeHpnReviewedSeasonUniverseCandidate,
  sealAflTradeHpnReviewedSeasonUniverse,
} from '@/server/aflTradeIntelligence/modeling/hpnReviewedSeasonUniverse';
import {
  calculateAflTradePrivateReviewedHpnSeason,
  createAflTradePrivateReviewedHpnMethod,
} from '@/server/aflTradeIntelligence/modeling/privateReviewedHpnCalculation';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createLocalWorkbookPlayerIdentityReview } from '@/server/aflTradeIntelligence/development/localWorkbookPlayerIdentityReview';
import type { AflTradeWorkbookTransactionReviewDecisionV2 } from '@/server/aflTradeIntelligence/source/workbookTransactionReviewDecision';
import {
  createAflTradePrivateReviewedEvidenceBundle,
  createAflTradePrivateReviewedEvidenceEvaluationDecision,
} from '@/server/aflTradeIntelligence/valuation/privateReviewedEvidenceEvaluation';
import { createPostgresAflTradePrivateConfirmedValuationSnapshotLoader } from '@/server/aflTradeIntelligence/valuation/postgresPrivateConfirmedTradeValuationSnapshot';

const createdAt = '2026-08-16T00:00:00.000Z';
const trustedAt = '2026-08-17T00:00:00.000Z';
const reviewSetId = '7'.repeat(64);

function localPrivateReviewCanonicalId(kind: string, value: unknown): string {
  return `${kind}:${sha256AflTradeCanonicalJson({ boundary: 'private-local-review', value })}`;
}

function authorityFixture(
  seasonYears: readonly number[] = [2022],
  officialSeasonYear: number | null = null
) {
  const bundle = createAflTradePrivateReviewedEvidenceBundle({
    evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
    reviewSets: [
      {
        reviewSetId,
        reviewSetDecisionId: `local-review:set:${reviewSetId}`,
        reviewerId: 'local-reviewer',
        candidateCount: 2,
        decisionCount: 6,
        reviewSetArtifact: createAflTradeCanonicalJsonArtifactRef({ reviewSetId }, createdAt),
      },
    ],
    sourceCaptures: [
      ...seasonYears.map((seasonYear, index) => ({
        captureId: `source-capture:${String(index + 1).repeat(64)}`,
        provider: 'afl_tables',
        capabilityId: 'afl-tables-player-stats',
        seasonYear,
        sourceArtifact: createAflTradeCanonicalJsonArtifactRef({ capture: seasonYear }, createdAt),
      })),
      ...(officialSeasonYear === null
        ? []
        : [
            {
              captureId: `source-capture:${'f'.repeat(64)}`,
              provider: 'official_afl' as const,
              capabilityId: 'official-afl-player-stats',
              seasonYear: officialSeasonYear,
              sourceArtifact: createAflTradeCanonicalJsonArtifactRef(
                { officialCapture: officialSeasonYear },
                createdAt
              ),
            },
          ]),
    ],
    sourceRightsEvidenceRefs: [
      createAflTradeCanonicalJsonArtifactRef({ rights: 'private-evaluation' }, createdAt),
    ],
    createdAt,
  });
  const decision = createAflTradePrivateReviewedEvidenceEvaluationDecision({
    status: 'authorized',
    valuationScopeKey: 'afl-men:2021-trades',
    evidenceBundle: bundle,
    evidenceBundleArtifact: createAflTradeCanonicalJsonArtifactRef(bundle, createdAt),
    revision: 1,
    supersedesDecisionId: null,
    reviewerId: 'local-authority-reviewer',
    rationale: 'Authorize exact reviewed evidence for private local calculation.',
    decidedAt: createdAt,
  });
  return { bundle, decision };
}

function promotionFixture() {
  const content: AflTradeWorkbookTransactionReviewDecisionV2['content'] = {
    schemaVersion: 'afl-trade-workbook-transaction-review-decision/v2',
    reviewSetId: `workbook-transaction-review-set:${'1'.repeat(64)}`,
    reviewSubjectId: `workbook-transaction-review-subject:${'2'.repeat(64)}`,
    reviewSubjectSha256: '3'.repeat(64),
    workbookTradeId: 'workbook-2021-e7f7d1484744f855',
    occurredOn: '2021-10-12',
    occurrencePrecision: 'date',
    revision: 1,
    supersedesDecisionId: null,
    outcome: 'approved',
    parties: [
      {
        stagingRowId: `workbook-row:${'4'.repeat(64)}`,
        canonicalClubId: 'local-afl-club:adelaide',
        assets: [
          {
            assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
            sourceAssetText: 'Jordan Dawson',
            assetKind: 'player',
            sendingClubId: 'local-afl-club:sydney',
            receivingClubId: 'local-afl-club:adelaide',
            canonicalPlayerId: 'local-afl-player:100',
            selection: null,
          },
        ],
      },
      {
        stagingRowId: `workbook-row:${'5'.repeat(64)}`,
        canonicalClubId: 'local-afl-club:sydney',
        assets: [
          {
            assetId: 'workbook-2021-e7f7d1484744f855-sydney-2',
            sourceAssetText: 'Future 2022 R1 (Melbourne)',
            assetKind: 'future_pick',
            sendingClubId: 'local-afl-club:adelaide',
            receivingClubId: 'local-afl-club:sydney',
            canonicalPlayerId: null,
            selection: {
              seasonYear: 2022,
              round: 1,
              number: null,
              originalClubId: 'local-afl-club:melbourne',
            },
          },
        ],
      },
    ],
    reviewerId: 'local-reviewer:robert',
    rationale: 'Confirmed from the pinned private workbook transaction.',
    decidedAt: createdAt,
    authority: 'private_workbook_canonical_transaction_review',
    publicationEligible: false,
    publicationProhibited: true,
  };
  const decision: AflTradeWorkbookTransactionReviewDecisionV2 = {
    decisionId: createAflTradeContentAddress('workbook-transaction-review-decision', content),
    content,
  };
  const eventId = createAflTradeContentAddress('event', { tradeId: content.workbookTradeId });
  const eventVersionId = createAflTradeContentAddress('event-version', { eventId, version: 1 });
  const playerAssetVersionId = createAflTradeContentAddress('event-asset-version', {
    eventVersionId,
    assetId: content.parties[0]!.assets[0]!.assetId,
  });
  const pickAssetVersionId = createAflTradeContentAddress('event-asset-version', {
    eventVersionId,
    assetId: content.parties[1]!.assets[0]!.assetId,
  });
  const spellId = createAflTradeContentAddress('acquisition-spell', {
    assetId: content.parties[0]!.assets[0]!.assetId,
  });
  const ruleId = createAflTradeContentAddress('acquisition-spell-rule', { version: 1 });
  const spellVersionId = createAflTradeContentAddress('acquisition-spell-version', {
    spellId,
    version: 1,
  });
  const canonicalTransaction = {
    eventId,
    eventVersionId,
    assets: [
      {
        assetId: content.parties[0]!.assets[0]!.assetId,
        assetVersionId: playerAssetVersionId,
        acquisitionSpell: {
          spellId,
          spellVersionId,
          ruleId,
          startEventVersionId: eventVersionId,
          startAssetVersionId: playerAssetVersionId,
          startDate: content.occurredOn,
          endDate: null,
        },
      },
      {
        assetId: content.parties[1]!.assets[0]!.assetId,
        assetVersionId: pickAssetVersionId,
        acquisitionSpell: null,
      },
    ],
  } as const;
  const receipt = {
    schemaVersion: 'afl-trade-private-workbook-transaction-promotion/v2',
    workbookTradeId: content.workbookTradeId,
    reviewSetId: content.reviewSetId,
    decisionId: decision.decisionId,
    decisionSha256: sha256AflTradeCanonicalJson(decision),
    canonicalTransaction,
    status: 'active',
    publicationEligible: false,
    publicationProhibited: true,
  } as const;
  return {
    decision,
    receipt,
    promotionId: createAflTradeContentAddress('private-workbook-transaction-promotion', receipt),
    canonicalRows: [
      {
        event_id: eventId,
        event_version_id: eventVersionId,
        event_date: content.occurredOn,
        asset_key: content.parties[0]!.assets[0]!.assetId,
        asset_version_id: playerAssetVersionId,
        kind: 'player',
        player_id: content.parties[0]!.assets[0]!.canonicalPlayerId,
        from_club_id: content.parties[0]!.assets[0]!.sendingClubId,
        to_club_id: content.parties[0]!.assets[0]!.receivingClubId,
        spell_id: spellId,
        spell_version_id: spellVersionId,
        rule_id: ruleId,
        start_date: content.occurredOn,
        end_date: null,
      },
      {
        event_id: eventId,
        event_version_id: eventVersionId,
        event_date: content.occurredOn,
        asset_key: content.parties[1]!.assets[0]!.assetId,
        asset_version_id: pickAssetVersionId,
        kind: 'future_pick',
        player_id: null,
        from_club_id: content.parties[1]!.assets[0]!.sendingClubId,
        to_club_id: content.parties[1]!.assets[0]!.receivingClubId,
        spell_id: null,
        spell_version_id: null,
        rule_id: null,
        start_date: null,
        end_date: null,
      },
    ],
  };
}

function playerIdentityFixture(evidenceBundleId: string) {
  return createLocalWorkbookPlayerIdentityReview({
    workbookSha256: 'a'.repeat(64),
    tradeId: 'workbook-2021-e7f7d1484744f855',
    assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
    sourcePlayerName: 'Dawson',
    sourceAssetText: 'Jordan Dawson',
    receivingClubName: 'Adelaide',
    canonicalPlayerId: 'local-afl-player:100',
    recordedName: 'Jordan Dawson',
    evidenceBundleId,
    reviewerId: 'local-workbook-player-identity-reviewer',
    rationale: 'Confirm the exact player identity for private local calculation.',
    reviewedAt: createdAt,
  });
}

function seasonFixture() {
  const stats = {
    hitOuts: 1,
    goalAssists: 1,
    marks: 4,
    marksInside50: 1,
    freeKicksFor: 2,
    freeKicksAgainst: 1,
    rebound50s: 2,
    onePercenters: 2,
    clearances: 3,
    tackles: 4,
  };
  const rows = [
    {
      providerDecodedRowId: 'provider-row:2022:dawson',
      sourceRowSha256: 'a'.repeat(64),
      typedPayloadSha256: 'b'.repeat(64),
      matchId: 'local-afl-match:2022:1',
      matchDate: '2022-03-01',
      homeClubId: 'local-afl-club:adelaide',
      awayClubId: 'local-afl-club:melbourne',
      homePoints: 80,
      awayPoints: 70,
      playingForClubId: 'local-afl-club:adelaide',
      playerIdentity: {
        state: 'resolved' as const,
        canonicalPlayerId: 'local-afl-player:100',
        identityDecisionId: 'identity-review:2022:dawson',
      },
      stats: { ...stats, totalPoints: 20, inside50s: 5 },
    },
    {
      providerDecodedRowId: 'provider-row:2022:opponent',
      sourceRowSha256: 'c'.repeat(64),
      typedPayloadSha256: 'd'.repeat(64),
      matchId: 'local-afl-match:2022:1',
      matchDate: '2022-03-01',
      homeClubId: 'local-afl-club:adelaide',
      awayClubId: 'local-afl-club:melbourne',
      homePoints: 80,
      awayPoints: 70,
      playingForClubId: 'local-afl-club:melbourne',
      playerIdentity: {
        state: 'resolved' as const,
        canonicalPlayerId: 'local-afl-player:200',
        identityDecisionId: 'identity-review:2022:opponent',
      },
      stats: { ...stats, totalPoints: 15, inside50s: 4 },
    },
  ];
  const assembled = createAflTradeHpnReviewedSeasonUniverseCandidate({
    environment: 'non_production',
    competition: 'AFLM',
    seasonYear: 2022,
    captureId: 'capture:2022',
    normalizationRunId: `provider-normalization-run:${'6'.repeat(64)}`,
    resultFieldMapId: `hpn-pav-field-map:${'9'.repeat(64)}`,
    playerFieldMapId: `hpn-pav-field-map:${'e'.repeat(64)}`,
    resolvedReviewSetSha256: reviewSetId,
    normalizationReview: {
      status: 'staged',
      sourceRowCount: 2,
      acceptedRowCount: 2,
      issueCount: 0,
    },
    rows,
    createdAt,
  });
  const approval = createAflTradeHpnReviewedSeasonDecision({
    ...assembled,
    decision: 'approved',
    reviewerId: 'local-reviewer',
    rationale: 'Approve exact reviewed season.',
    decidedAt: createdAt,
  });
  const reviewedSeason = sealAflTradeHpnReviewedSeasonUniverse({ ...assembled, decision: approval });
  const calculation = calculateAflTradePrivateReviewedHpnSeason({
    reviewedSeason,
    membership: assembled.membership,
    method: createAflTradePrivateReviewedHpnMethod(),
    calculatedAt: createdAt,
  });
  return { assembled, reviewedSeason, calculation };
}

describe('PostgreSQL private confirmed valuation snapshot loader', () => {
  it('authenticates the exact current authority, promotion, reviewed season and calculation in one snapshot', async () => {
    const { bundle, decision: authorityDecision } = authorityFixture();
    const promotion = promotionFixture();
    const playerIdentity = playerIdentityFixture(bundle.evidenceBundleId);
    const season = seasonFixture();
    const queries: string[] = [];
    const queryParameters: unknown[][] = [];
    const transactionOptions: unknown[] = [];
    let identityMembership: 'exact' | 'missing' | 'duplicate' = 'exact';
    let promotionIdOverride: string | null = null;
    const query = async (sql: string, params: readonly unknown[] = []) => {
      queries.push(sql);
      queryParameters.push([...params]);
      if (sql.includes('transaction_timestamp()')) {
        return { rows: [{ trusted_at: trustedAt }], rowCount: 1 };
      }
      if (sql.includes('outcome_private_reviewed_evaluation_head')) {
        return {
          rows: [{ decision_json: authorityDecision, bundle_json: bundle }],
          rowCount: 1,
        };
      }
      if (sql.includes('outcome_private_workbook_transaction_promotion')) {
        return {
          rows: [
            {
              promotion_id: promotionIdOverride ?? promotion.promotionId,
              review_set_id: promotion.decision.content.reviewSetId,
              decision_id: promotion.decision.decisionId,
              decision_json: promotion.decision,
              receipt_json: promotion.receipt,
              source_artifact_sha256: playerIdentity.content.workbookSha256,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM outcome_event_version event')) {
        return { rows: promotion.canonicalRows, rowCount: promotion.canonicalRows.length };
      }
      if (sql.includes('outcome_local_workbook_player_identity_review')) {
        const identityRow = {
          workbook_sha256: playerIdentity.content.workbookSha256,
          asset_id: playerIdentity.content.assetId,
          decision_json: playerIdentity,
        };
        const rows =
          identityMembership === 'missing'
            ? []
            : identityMembership === 'duplicate'
              ? [identityRow, identityRow]
              : [identityRow];
        return {
          rows,
          rowCount: rows.length,
        };
      }
      if (sql.includes('outcome_hpn_reviewed_season_universe')) {
        return {
          rows: [
            {
              reviewed_json: season.reviewedSeason,
              candidate_json: season.assembled.candidate,
              membership_json: season.assembled.membership,
              actual_member_count: 2,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('outcome_private_reviewed_hpn_calculation')) {
        return {
          rows: [
            {
              calculation_json: season.calculation,
              actual_allocation_count: season.calculation.content.allocations.length,
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    };
    const client: AflOutcomeSqlClient = {
      query,
      transaction: async (work, options) => {
        transactionOptions.push(options);
        return work({ query });
      },
    };

    const loader = createPostgresAflTradePrivateConfirmedValuationSnapshotLoader(client);
    const snapshot = await loader.load({
      valuationScopeKey: 'afl-men:2021-trades',
      tradeId: 'workbook-2021-e7f7d1484744f855',
      knowledgeCutoffAt: null,
    });

    expect(snapshot).toMatchObject({
      trustedAt,
      promotion: {
        promotionId: promotion.promotionId,
        workbookTradeId: 'workbook-2021-e7f7d1484744f855',
        occurredOn: '2021-10-12',
        occurrencePrecision: 'date',
      },
      appearanceRows: [
        {
          providerDecodedRowId: 'provider-row:2022:dawson',
          seasonYear: 2022,
          canonicalPlayerId: 'local-afl-player:100',
          playingForClubId: 'local-afl-club:adelaide',
        },
      ],
      calculations: [
        {
          calculationId: season.calculation.calculationId,
          seasonYear: 2022,
          allocation: {
            canonicalPlayerId: 'local-afl-player:100',
            clubId: 'local-afl-club:adelaide',
            gamesPlayed: 1,
            sourceRowIds: ['provider-row:2022:dawson'],
          },
        },
      ],
    });
    expect(snapshot?.promotion.assets[0]).toMatchObject({
      assetId: 'workbook-2021-e7f7d1484744f855-adelaide-1',
      acquisitionSpell: {
        spellVersionId: promotion.receipt.canonicalTransaction.assets[0]!.acquisitionSpell!
          .spellVersionId,
        startAssetVersionId: promotion.receipt.canonicalTransaction.assets[0]!.assetVersionId,
      },
    });
    expect(transactionOptions[0]).toEqual({
      isolationLevel: 'repeatable_read',
      accessMode: 'read_only',
    });
    expect(queries[0]).toContain('transaction_timestamp()');
    const lineageQuery = queries.find((sql) => sql.includes('FROM outcome_event_version event'));
    expect(lineageQuery).toContain('event.event_date::text AS event_date');
    expect(lineageQuery).toContain('spell.start_date::text AS start_date');
    const identityQueryIndex = queries.findIndex((sql) =>
      sql.includes('outcome_local_workbook_player_identity_review')
    );
    expect(queries[identityQueryIndex]).toContain('workbook_sha256=$3');
    expect(queryParameters[identityQueryIndex]).toEqual([
      'workbook-2021-e7f7d1484744f855',
      bundle.evidenceBundleId,
      playerIdentity.content.workbookSha256,
    ]);
    identityMembership = 'missing';
    await expect(
      loader.load({
        valuationScopeKey: 'afl-men:2021-trades',
        tradeId: 'workbook-2021-e7f7d1484744f855',
        knowledgeCutoffAt: null,
      })
    ).rejects.toThrow('identity review membership is incomplete or ambiguous');
    identityMembership = 'exact';
    promotionIdOverride = `private-workbook-transaction-promotion:${'0'.repeat(64)}`;
    await expect(
      loader.load({
        valuationScopeKey: 'afl-men:2021-trades',
        tradeId: 'workbook-2021-e7f7d1484744f855',
        knowledgeCutoffAt: null,
      })
    ).rejects.toThrow('promotion failed exact authentication');
    promotionIdOverride = null;
    identityMembership = 'duplicate';
    await expect(
      loader.load({
        valuationScopeKey: 'afl-men:2021-trades',
        tradeId: 'workbook-2021-e7f7d1484744f855',
        knowledgeCutoffAt: null,
      })
    ).rejects.toThrow('identity review membership is incomplete or ambiguous');
  });

  it('fails closed when an expected completed evidence season is wholly absent', async () => {
    const { bundle, decision: authorityDecision } = authorityFixture([2022, 2023]);
    const promotion = promotionFixture();
    const playerIdentity = playerIdentityFixture(bundle.evidenceBundleId);
    const season = seasonFixture();
    const query = async (sql: string) => {
      if (sql.startsWith('SET TRANSACTION')) return { rows: [], rowCount: null };
      if (sql.includes('transaction_timestamp()')) {
        return { rows: [{ trusted_at: trustedAt }], rowCount: 1 };
      }
      if (sql.includes('outcome_private_reviewed_evaluation_head')) {
        return { rows: [{ decision_json: authorityDecision, bundle_json: bundle }], rowCount: 1 };
      }
      if (sql.includes('outcome_private_workbook_transaction_promotion')) {
        return {
          rows: [{
            promotion_id: promotion.promotionId,
            review_set_id: promotion.decision.content.reviewSetId,
            decision_id: promotion.decision.decisionId,
            decision_json: promotion.decision,
            receipt_json: promotion.receipt,
            source_artifact_sha256: playerIdentity.content.workbookSha256,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM outcome_event_version event')) {
        return { rows: promotion.canonicalRows, rowCount: promotion.canonicalRows.length };
      }
      if (sql.includes('outcome_local_workbook_player_identity_review')) {
        return {
          rows: [
            {
              workbook_sha256: playerIdentity.content.workbookSha256,
              asset_id: playerIdentity.content.assetId,
              decision_json: playerIdentity,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('outcome_hpn_reviewed_season_universe')) {
        return {
          rows: [{
            reviewed_json: season.reviewedSeason,
            candidate_json: season.assembled.candidate,
            membership_json: season.assembled.membership,
            actual_member_count: 2,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('outcome_private_reviewed_hpn_calculation')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    };
    const client = {
      query,
      transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) =>
        work({ query }),
    } as AflOutcomeSqlClient;

    await expect(
      createPostgresAflTradePrivateConfirmedValuationSnapshotLoader(client).load({
        valuationScopeKey: 'afl-men:2021-trades',
        tradeId: 'workbook-2021-e7f7d1484744f855',
        knowledgeCutoffAt: null,
      })
    ).rejects.toThrow('expected completed-season coverage');
  });

  it('authenticates canonical review targets and rejects overlapping provider seasons', async () => {
    const { bundle, decision: authorityDecision } = authorityFixture([2022], 2022);
    const promotion = promotionFixture();
    const playerIdentity = playerIdentityFixture(bundle.evidenceBundleId);
    const season = seasonFixture();
    let officialSql = '';
    let matchRecordOverride: string | null = null;
    const query = async (sql: string) => {
      if (sql.startsWith('SET TRANSACTION')) return { rows: [], rowCount: null };
      if (sql.includes('transaction_timestamp()')) {
        return { rows: [{ trusted_at: trustedAt }], rowCount: 1 };
      }
      if (sql.includes('outcome_private_reviewed_evaluation_head')) {
        return { rows: [{ decision_json: authorityDecision, bundle_json: bundle }], rowCount: 1 };
      }
      if (sql.includes('outcome_private_workbook_transaction_promotion')) {
        return {
          rows: [{
            promotion_id: promotion.promotionId,
            review_set_id: promotion.decision.content.reviewSetId,
            decision_id: promotion.decision.decisionId,
            decision_json: promotion.decision,
            receipt_json: promotion.receipt,
            source_artifact_sha256: playerIdentity.content.workbookSha256,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM outcome_event_version event')) {
        return { rows: promotion.canonicalRows, rowCount: promotion.canonicalRows.length };
      }
      if (sql.includes('outcome_local_workbook_player_identity_review')) {
        return {
          rows: [{
            workbook_sha256: playerIdentity.content.workbookSha256,
            asset_id: playerIdentity.content.assetId,
            decision_json: playerIdentity,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('outcome_hpn_reviewed_season_universe')) {
        return {
          rows: [{
            reviewed_json: season.reviewedSeason,
            candidate_json: season.assembled.candidate,
            membership_json: season.assembled.membership,
            actual_member_count: 2,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('outcome_private_reviewed_hpn_calculation')) {
        return {
          rows: [{
            calculation_json: season.calculation,
            actual_allocation_count: season.calculation.content.allocations.length,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('WITH requested_player AS MATERIALIZED')) {
        officialSql = sql;
        const identityRecordId = localPrivateReviewCanonicalId('local_canonical_player_club', {
          canonicalPlayerId: 'local-afl-player:100',
          clubName: 'Adelaide',
        });
        const matchRecordId = localPrivateReviewCanonicalId(
          'local_afl_match',
          'CD_M20220100001'
        );
        return {
          rows: [{
            provider_decoded_row_id: 'official-row:2022:dawson',
            season_year: 2022,
            match_date_text: '2022-03-01',
            canonical_player_id: 'local-afl-player:100',
            receiving_club_id: 'local-afl-club:adelaide',
            identity_record_id: identityRecordId,
            native_match_id: 'CD_M20220100001',
            match_record_id: matchRecordOverride ?? matchRecordId,
            metric_code: 'goals',
            definition_version: 'goals/v1',
            numeric_value: 1,
            factual_record_id: localPrivateReviewCanonicalId('local_player_match_fact', {
              playerClubId: identityRecordId,
              matchId: matchRecordId,
              metricCode: 'goals',
              definitionVersion: 'goals/v1',
              numericValue: 1,
            }),
            member_document: { reviewed: true },
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    };
    const client = {
      query,
      transaction: async <T>(work: (transaction: { query: typeof query }) => Promise<T>) =>
        work({ query }),
    } as AflOutcomeSqlClient;

    await expect(
      createPostgresAflTradePrivateConfirmedValuationSnapshotLoader(client).load({
        valuationScopeKey: 'afl-men:2021-trades',
        tradeId: 'workbook-2021-e7f7d1484744f855',
        knowledgeCutoffAt: null,
      })
    ).rejects.toThrow('overlaps completed AFL Tables season 2022');
    expect(officialSql).toContain(
      "identity_review.canonical_record_type='local_canonical_player_club'"
    );
    expect(officialSql).toContain(
      "requested.canonical_player_id=identity_review.evidence_json->>'canonicalPlayerId'"
    );
    expect(officialSql).toContain("match_review.canonical_record_type='local_afl_match'");
    expect(officialSql).toContain("factual_review.canonical_record_type='local_player_match_fact'");

    matchRecordOverride = 'local_afl_match:wrong-target';
    await expect(
      createPostgresAflTradePrivateConfirmedValuationSnapshotLoader(client).load({
        valuationScopeKey: 'afl-men:2021-trades',
        tradeId: 'workbook-2021-e7f7d1484744f855',
        knowledgeCutoffAt: null,
      })
    ).rejects.toThrow('canonical target authentication failed');
  });
});
