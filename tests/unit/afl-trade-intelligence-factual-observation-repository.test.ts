import { describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
  AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION,
  AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
  createAflTradeSourceFact,
  createAflTradeSourceFactBatch,
} from '@/server/aflTradeIntelligence/outcomes/factualObservationContracts';
import {
  AflTradeFactualObservationPersistenceError,
  PostgresAflTradeFactualObservationRepository,
} from '@/server/aflTradeIntelligence/outcomes/postgresFactualObservationRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

function reference(prefix: string, marker: string) {
  const id = createAflTradeContentAddress(prefix, { marker });
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

const normalizationRunId = createAflTradeContentAddress('provider-normalization-run', {
  fixture: 'factual-repository',
});
const rowId = 'provider-row:factual-repository';
const rowSha = '1'.repeat(64);
const matchSha = '2'.repeat(64);
const stagingSha = '3'.repeat(64);
const fieldMapSha = '4'.repeat(64);
const finalizedAt = '2026-03-21T08:00:00.000Z';
const finalizationId = createAflTradeContentAddress('provider-normalization-finalization', {
  normalizationRunId,
  stagingSha256: stagingSha,
  finalizedAt,
});
const issueSetId = createAflTradeContentAddress('provider-resolution-issue-set', {
  normalizationRunId,
  providerDecodedRowId: rowId,
  issues: [],
});

function decision(marker: string) {
  return reference('provider-resolution-decision', marker);
}

function assignment(entityKind: 'club' | 'match', decisionId: string, marker: string) {
  return {
    assignmentCaseId: createAflTradeContentAddress('provider-identity-assignment-case', {
      marker,
    }),
    entityKind,
    revision: 1,
    decisionId,
    status: 'active' as const,
  };
}

function clubSide(marker: string, clubId: string) {
  const resolutionDecision = decision(`club-${marker}`);
  return {
    clubId,
    resolutionDecision,
    assignment: assignment('club', resolutionDecision.id, `club-${marker}`),
  };
}

function validBatch() {
  const matchDecision = decision('match');
  const fact = createAflTradeSourceFact({
    schemaVersion: AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: 'test_fixture',
    provider: 'official_afl',
    capabilityId: 'official-afl-player-stats',
    competition: 'AFLM',
    seasonYear: 2026,
    fieldMapSha256: fieldMapSha,
    effectiveAt: '2026-03-20T08:00:00.000Z',
    recordedAt: '2026-03-22T08:00:00.000Z',
    source: {
      captureId: 'source-capture:factual-repository',
      normalizationRunId,
      normalizationFinalization: {
        id: finalizationId,
        sha256: finalizationId.slice(finalizationId.indexOf(':') + 1),
      },
      normalizationFinalizedAt: finalizedAt,
      stagingSha256: stagingSha,
      providerDecodedRowId: rowId,
      sourceRowNumber: 1,
      sourceRowSha256: rowSha,
      semanticNaturalKeySha256: '5'.repeat(64),
      candidateDigests: {
        identity: null,
        match: matchSha,
        metric: null,
        achievement: null,
        appearance: null,
      },
      rowStatus: 'staged',
      issueSet: { id: issueSetId, sha256: issueSetId.slice(issueSetId.indexOf(':') + 1) },
      blockingIssueCount: 0,
      openBlockingIssueCount: 0,
      blockingIssueClosures: [],
      consumedSourceFields: ['match_status'],
    },
    factKind: 'match_universe',
    matchCandidateId: 'match-candidate:factual-repository',
    match: {
      resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
        marker: 'match',
      }),
      revision: 1,
      decision: matchDecision,
      canonicalTargetSnapshot: reference('canonical-target-snapshot', 'match'),
      matchCandidateId: 'match-candidate:factual-repository',
      matchIdentityId: createAflTradeContentAddress('provider-match-identity', {
        marker: 'match',
      }),
      matchId: 'afl-match:factual-repository',
      canonicalMatchDate: '2026-03-20T08:00:00.000Z',
      canonicalRoundLabel: 'Round 1',
      homeClub: clubSide('home', 'afl-club:home'),
      awayClub: clubSide('away', 'afl-club:away'),
      assignment: assignment('match', matchDecision.id, 'match'),
    },
    completionPolicy: reference('match-universe-policy', 'v1'),
    completion: { state: 'completed', providerStatus: 'Final' },
  });
  const rowAccounting = [
    {
      providerDecodedRowId: rowId,
      sourceRowSha256: rowSha,
      disposition: 'normalized' as const,
      factIds: [fact.factId],
      issueSet: { id: issueSetId, sha256: issueSetId.slice(issueSetId.indexOf(':') + 1) },
      issueIds: [],
      blockingIssueIds: [],
      blockingIssueClosures: [],
      reasonCode: null,
    },
  ];
  return createAflTradeSourceFactBatch({
    schemaVersion: AFL_TRADE_SOURCE_FACT_BATCH_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: 'test_fixture',
    provider: 'official_afl',
    capabilityId: 'official-afl-player-stats',
    competition: 'AFLM',
    seasonYear: 2026,
    captureId: 'source-capture:factual-repository',
    normalizationRunId,
    normalizationFinalization: {
      id: finalizationId,
      sha256: finalizationId.slice(finalizationId.indexOf(':') + 1),
    },
    normalizationFinalizedAt: finalizedAt,
    fieldMapSha256: fieldMapSha,
    stagingSha256: stagingSha,
    sourceRowSetSha256: sha256AflTradeCanonicalJson([
      { providerDecodedRowId: rowId, sourceRowSha256: rowSha },
    ]),
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
    createdAt: '2026-03-23T08:00:00.000Z',
    sourceRowCount: 1,
    sourceIssueCount: 0,
    facts: [fact],
    rowAccounting,
    counts: {
      matchUniverse: 1,
      playerAppearances: 0,
      playerMatchMetrics: 0,
      playerSeasonMetrics: 0,
      playerAchievements: 0,
      normalizedRows: 1,
      nonNormalizedRows: 0,
    },
  });
}

class FixtureSqlClient implements AflOutcomeSqlClient {
  readonly calls: { sql: string; parameters: readonly unknown[] }[] = [];

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.calls.push({ sql, parameters });
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    expect(Math.max(0, ...placeholders)).toBeLessThanOrEqual(parameters.length);
    if (sql.includes('SELECT finalized_at FROM outcome_provider_fact_batch')) {
      return { rows: [{ finalized_at: '2026-03-23T08:00:00.000Z' }] as Row[], rowCount: 1 };
    }
    if (sql.includes('FROM outcome_provider_fact_batch WHERE fact_batch_id')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM outcome_provider_normalization_run r')) {
      return {
        rows: [
          {
            normalization_run_id: normalizationRunId,
            capture_id: 'source-capture:factual-repository',
            staging_sha256: stagingSha,
            source_row_count: 1,
            issue_count: 0,
            finalized_at: finalizedAt,
            field_map_sha256: fieldMapSha,
            environment: 'test_fixture',
            provider: 'official_afl',
            capability_id: 'official-afl-player-stats',
            competition: 'AFLM',
          },
        ] as Row[],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_provider_decoded_row r')) {
      return {
        rows: [
          {
            provider_decoded_row_id: rowId,
            source_row_number: 1,
            source_row_sha256: rowSha,
            row_status: 'staged',
            identity_candidate_sha256: null,
            match_candidate_sha256: matchSha,
          },
        ] as Row[],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM outcome_provider_normalization_issue')) {
      return { rows: [], rowCount: 0 };
    }
    if (
      sql.includes('FROM outcome_provider_metric_candidate') ||
      sql.includes('FROM outcome_provider_achievement_candidate')
    ) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 1 };
  }
}

describe('Postgres AFL trade factual observation repository', () => {
  it('persists an exhaustive source batch atomically without a public or fantasy write', async () => {
    const client = new FixtureSqlClient();
    const repository = new PostgresAflTradeFactualObservationRepository(client);
    const result = await repository.persistBatch(validBatch(), { environment: 'test_fixture' });

    expect(result).toMatchObject({
      factCount: 1,
      sourceRowCount: 1,
      idempotentReplay: false,
      publicationEligible: false,
    });
    const sql = client.calls.map(({ sql: statement }) => statement).join('\n');
    expect(sql).toContain('INSERT INTO outcome_provider_match_universe_fact');
    expect(sql).toContain("SET status = 'approved'");
    expect(sql).not.toMatch(/outcome_release_|outcome_projection_|\buser\b|\bleague\b|fantasy/i);
  });

  it('rejects an execution environment mismatch before opening a transaction', async () => {
    const client = new FixtureSqlClient();
    const repository = new PostgresAflTradeFactualObservationRepository(client);
    await expect(
      repository.persistBatch(validBatch(), { environment: 'non_production' })
    ).rejects.toMatchObject({
      code: 'ENVIRONMENT_MISMATCH',
    } satisfies Partial<AflTradeFactualObservationPersistenceError>);
    expect(client.calls).toHaveLength(0);
  });
});
