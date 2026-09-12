import { describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress as address,
  sha256AflTradeCanonicalJson as digest,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeRetainedFitzRoyResultsFactBatch,
  type AflTradeRetainedFitzRoyResultsFactBatchInput,
} from '@/server/aflTradeIntelligence/outcomes/retainedFitzRoyFactualBatch';

function reference(prefix: string, value: unknown) {
  const id = address(prefix, value);
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

function syntheticResults(): AflTradeRetainedFitzRoyResultsFactBatchInput {
  const normalizationRunId = address('provider-normalization-run', { synthetic: 'results' });
  const stagingSha256 = digest({ synthetic: 'staging' });
  const normalizationFinalizedAt = '2026-09-01T00:00:00.000Z';
  const rows = Array.from({ length: 216 }, (_, index) => {
    const key = String(index + 1).padStart(3, '0');
    const matchCandidateId = `provider-match-candidate:synthetic-${key}`;
    const decision = reference('provider-resolution-decision', { synthetic: key });
    const assignment = <Kind extends 'match' | 'club'>(
      entityKind: Kind,
      decisionId: string,
      side: string
    ) => ({
      assignmentCaseId: address('provider-identity-assignment-case', { synthetic: key, side }),
      entityKind,
      revision: 1,
      decisionId,
      status: 'active' as const,
    });
    const club = (side: string) => {
      const resolutionDecision = reference('provider-resolution-decision', { key, side });
      return {
        clubId: `afl-club:synthetic-${side}`,
        resolutionDecision,
        assignment: assignment('club', resolutionDecision.id, side),
      };
    };
    const providerDecodedRowId = `provider-decoded-row:synthetic-${key}`;
    return {
      row: {
        providerDecodedRowId,
        competition: 'AFLM' as const,
        seasonYear: 2025,
        observedSeasonText: '2025',
        roundLabel: 'Round 1',
        observedDateText: '2025-03-20',
        sourceRowNumber: index + 1,
        sourceRowSha256: digest({ syntheticRow: key }),
        rowStatus: 'staged' as const,
        typedPayload: {
          Date: { kind: 'text' as const, value: '2025-03-20' },
          Game: { kind: 'integer' as const, value: String(index + 1) },
          'Home.Points': { kind: 'integer' as const, value: '84' },
          'Away.Points': { kind: 'integer' as const, value: '72' },
        },
        identityCandidate: null,
        matchCandidate: {
          candidateId: matchCandidateId,
          provider: 'afl_tables',
          nativeMatchId: String(index + 1),
          roundLabel: 'Round 1',
          matchDateText: '2025-03-20',
          homeClubNativeId: null,
          homeClubName: 'Synthetic Home',
          awayClubNativeId: null,
          awayClubName: 'Synthetic Away',
          providerStatus: null,
          orderIndependentSha256: digest({ syntheticMatch: key }),
          resolutionState: 'unresolved' as const,
        },
        metricCandidates: [],
        achievementCandidate: null,
        appearanceCandidate: false,
        semanticNaturalKeySha256: digest({ syntheticKey: key }),
      },
      match: {
        resolutionCaseId: address('provider-resolution-case', { synthetic: key }),
        revision: 1,
        decision,
        canonicalTargetSnapshot: reference('canonical-target-snapshot', { synthetic: key }),
        matchCandidateId,
        matchIdentityId: address('provider-match-identity', { synthetic: key }),
        matchId: `afl-match:synthetic-${key}`,
        canonicalMatchDate: '2025-03-20T08:00:00.000Z',
        canonicalRoundLabel: 'Round 1',
        homeClub: club('home'),
        awayClub: club('away'),
        assignment: assignment('match', decision.id, 'match'),
      },
      issues: {
        issueSet: reference('provider-resolution-issue-set', {
          normalizationRunId,
          providerDecodedRowId,
          issues: [],
        }),
        issueIds: [],
        blockingIssueIds: [],
        blockingIssueClosures: [],
      },
      consumedSourceFields: ['Away.Points', 'Date', 'Game', 'Home.Points'],
      effectiveAt: '2025-03-20T08:00:00.000Z',
      completion: { state: 'completed' as const, providerStatus: null },
    };
  });
  return {
    source: {
      environment: 'test_fixture',
      provider: 'afl_tables',
      capabilityId: 'afl-tables-results',
      competition: 'AFLM',
      seasonYear: 2025,
      captureId: 'source-capture:synthetic-results',
      normalizationRunId,
      stagingSha256,
      normalizationFinalizedAt,
      normalizationFinalization: reference('provider-normalization-finalization', {
        normalizationRunId,
        stagingSha256,
        finalizedAt: normalizationFinalizedAt,
      }),
      fieldMapSha256: digest({ synthetic: 'results-map' }),
      sourceRowCount: 216,
      sourceIssueCount: 0,
      sourceRowSetSha256: digest(
        rows.map(({ row }) => ({
          providerDecodedRowId: row.providerDecodedRowId,
          sourceRowSha256: row.sourceRowSha256,
        }))
      ),
      sourceIssueSetSha256: digest(
        rows.map(({ row, issues }) => ({
          providerDecodedRowId: row.providerDecodedRowId,
          ...issues,
        }))
      ),
    },
    completionPolicy: reference('match-universe-policy', {
      synthetic: 'explicit-reviewed-final-scores-v1',
    }),
    createdAt: '2026-09-01T00:01:00.000Z',
    rows,
  };
}

describe('retained fitzRoy results factual assembly (synthetic evidence only)', () => {
  it('assembles every one of 216 retained results into match facts without player or metric facts', () => {
    const input = syntheticResults();
    const before = structuredClone(input);
    const batch = createAflTradeRetainedFitzRoyResultsFactBatch(input);
    expect(batch.content.counts).toEqual({
      matchUniverse: 216,
      playerAppearances: 0,
      playerMatchMetrics: 0,
      playerSeasonMetrics: 0,
      playerAchievements: 0,
      normalizedRows: 216,
      nonNormalizedRows: 0,
    });
    expect(batch.content.rowAccounting).toHaveLength(216);
    expect(
      batch.content.facts.every(
        (fact) =>
          fact.content.factKind === 'match_universe' &&
          fact.content.completion.state === 'completed' &&
          fact.content.completion.providerStatus === null
      )
    ).toBe(true);
    expect(batch.content.facts[0]?.content.publicationEligible).toBe(false);
    expect(createAflTradeRetainedFitzRoyResultsFactBatch(input).batchId).toBe(batch.batchId);
    expect(input).toEqual(before);
  });

  it('preserves missing raw dates and status while retaining an explicit quarantine outcome', () => {
    const input = syntheticResults();
    const entry = input.rows[0]!;
    entry.row.observedDateText = null;
    entry.row.matchCandidate!.matchDateText = null;
    entry.row.typedPayload = { ...entry.row.typedPayload, Date: { kind: 'missing' } };
    entry.row.sourceRowSha256 = digest({ synthetic: 'missing-date-result' });
    entry.completion = { state: 'quarantined', providerStatus: null, reasonCode: 'status_missing' };
    input.source.sourceRowSetSha256 = digest(
      input.rows.map(({ row }) => ({
        providerDecodedRowId: row.providerDecodedRowId,
        sourceRowSha256: row.sourceRowSha256,
      }))
    );
    const before = structuredClone(input);
    const batch = createAflTradeRetainedFitzRoyResultsFactBatch(input);
    const fact = batch.content.facts.find(
      (value) => value.content.source.providerDecodedRowId === entry.row.providerDecodedRowId
    )!;
    expect(fact.content.factKind === 'match_universe' && fact.content.completion).toEqual({
      state: 'quarantined',
      providerStatus: null,
      reasonCode: 'status_missing',
    });
    expect(fact.content.effectiveAt).toBe('2025-03-20T08:00:00.000Z');
    expect(input).toEqual(before);
    expect(entry.row.observedDateText).toBeNull();
    expect(entry.row.matchCandidate!.matchDateText).toBeNull();
    expect(entry.row.typedPayload.Date).toEqual({ kind: 'missing' });
  });

  it('does not infer completed from staged when completion evidence is absent', () => {
    const input = syntheticResults();
    input.rows[0]!.completion = undefined as unknown as (typeof input.rows)[number]['completion'];
    expect(() => createAflTradeRetainedFitzRoyResultsFactBatch(input)).toThrow(
      /Explicit completion evidence/
    );
  });

  it('rejects an omitted row against the retained complete-normalization header', () => {
    const input = syntheticResults();
    input.rows = input.rows.slice(1);
    expect(() => createAflTradeRetainedFitzRoyResultsFactBatch(input)).toThrow(/Source row count/);
  });

  it('rejects duplicate retained rows rather than counting them twice', () => {
    const input = syntheticResults();
    input.rows = [input.rows[0]!, input.rows[0]!, ...input.rows.slice(2)];
    expect(() => createAflTradeRetainedFitzRoyResultsFactBatch(input)).toThrow(/unique/);
  });

  it('rejects a resolution for another match candidate', () => {
    const input = syntheticResults();
    input.rows[0]!.match.matchCandidateId = 'provider-match-candidate:another';
    expect(() => createAflTradeRetainedFitzRoyResultsFactBatch(input)).toThrow(
      /exact match candidate/
    );
  });

  it('requires the explicit immutable completion policy', () => {
    const input = syntheticResults();
    input.completionPolicy = undefined as unknown as typeof input.completionPolicy;
    expect(() => createAflTradeRetainedFitzRoyResultsFactBatch(input)).toThrow(/completionPolicy/);
  });

  it('rejects player-stat capability input rather than relabelling it as results', () => {
    const input = syntheticResults();
    input.source.capabilityId = 'afl-tables-player-stats';
    expect(() => createAflTradeRetainedFitzRoyResultsFactBatch(input)).toThrow(
      /exact AFL Tables results capability/
    );
  });
});
