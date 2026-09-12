import { describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress as address,
  sha256AflTradeCanonicalJson as digest,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeRetainedFitzRoyPlayerFactBatch,
  type AflTradeRetainedFitzRoyPlayerFactBatchInput,
} from '@/server/aflTradeIntelligence/outcomes/retainedFitzRoyPlayerFactualBatch';

function ref(prefix: string, value: unknown) {
  const id = address(prefix, value);
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

function syntheticTables(): AflTradeRetainedFitzRoyPlayerFactBatchInput {
  const normalizationRunId = address('provider-normalization-run', { synthetic: 'players' });
  const stagingSha256 = digest({ synthetic: 'staging' });
  const finalizedAt = '2026-09-01T00:00:00.000Z';
  const rows = [1, 2].map((number) => {
    const id = `synthetic-${number}`;
    const identityCandidateId = `identity-candidate:${id}`;
    const matchCandidateId = `match-candidate:${id}`;
    const resolution = (role: string) => ({
      resolutionCaseId: address('provider-resolution-case', { id, role }),
      revision: 1,
      decision: ref('provider-resolution-decision', { id, role }),
      canonicalTargetSnapshot: ref('canonical-target-snapshot', { id, role }),
    });
    const assignment = <Kind extends 'club' | 'match'>(role: string, entityKind: Kind) => ({
      assignmentCaseId: address('provider-identity-assignment-case', { id, role }),
      entityKind,
      revision: 1,
      decisionId: resolution(role).decision.id,
      status: 'active' as const,
    });
    const row = {
      providerDecodedRowId: `provider-row:${id}`,
      competition: 'AFLM' as const,
      seasonYear: 2025,
      observedSeasonText: '2025',
      roundLabel: 'R1',
      observedDateText: '2025-03-20',
      sourceRowNumber: number,
      sourceRowSha256: digest({ id }),
      rowStatus: 'staged' as const,
      typedPayload: {
        'Time.on.Ground': { kind: 'integer' as const, value: number === 1 ? '80' : '0' },
        Date: { kind: 'text' as const, value: '2025-03-20' },
      },
      identityCandidate: {
        candidateId: identityCandidateId,
        provider: 'afl_tables',
        entityKind: 'player' as const,
        nativeEntityId: null,
        recordedName: 'Synthetic Player',
        recordedClubId: null,
        recordedClubName: 'Synthetic Home',
        locatorSha256: digest({ id }),
        resolutionState: 'unresolved' as const,
      },
      matchCandidate: {
        candidateId: matchCandidateId,
        provider: 'afl_tables',
        nativeMatchId: null,
        roundLabel: 'R1',
        matchDateText: '2025-03-20',
        homeClubNativeId: null,
        homeClubName: 'Synthetic Home',
        awayClubNativeId: null,
        awayClubName: 'Synthetic Away',
        providerStatus: null,
        orderIndependentSha256: digest({ id, match: true }),
        resolutionState: 'unresolved' as const,
      },
      metricCandidates: [],
      achievementCandidate: null,
      appearanceCandidate: false,
      semanticNaturalKeySha256: digest({ id, key: true }),
    };
    return {
      row,
      match: {
        ...resolution('match'),
        matchCandidateId,
        matchIdentityId: address('provider-match-identity', { id }),
        matchId: `afl-match:${id}`,
        canonicalMatchDate: '2025-03-20T00:00:00.000Z',
        canonicalRoundLabel: 'R1',
        homeClub: {
          clubId: 'afl-club:home',
          resolutionDecision: resolution('home').decision,
          assignment: assignment('home', 'club'),
        },
        awayClub: {
          clubId: 'afl-club:away',
          resolutionDecision: resolution('away').decision,
          assignment: assignment('away', 'club'),
        },
        assignment: assignment('match', 'match'),
      },
      player: {
        ...resolution('player'),
        mappingScope: 'candidate_only' as const,
        identityCandidateId,
        playerIdentityId: null,
        playerId: `afl-player:${id}`,
        assignment: null,
      },
      representedClub: {
        ...resolution('affiliation'),
        mappingScope: 'provider_identity' as const,
        occurrence: { source: 'player_affiliation' as const, identityCandidateId },
        clubIdentityId: address('provider-club-identity', { id }),
        clubId: 'afl-club:home',
        assignment: assignment('affiliation', 'club'),
      },
      issues: {
        issueSet: ref('provider-resolution-issue-set', {
          normalizationRunId,
          providerDecodedRowId: row.providerDecodedRowId,
          issues: [],
        }),
        issueIds: [],
        blockingIssueIds: [],
        blockingIssueClosures: [],
      },
      effectiveAt: '2025-03-20T00:00:00.000Z',
      matchSourceFields: ['Date'],
      completion: {
        state: 'quarantined' as const,
        providerStatus: null,
        reasonCode: 'status_missing' as const,
      },
      appearance:
        number === 1
          ? {
              state: 'observed' as const,
              sourceFields: ['Time.on.Ground'],
              derivationPolicy: ref('player-appearance-policy', {
                synthetic: 'paired-positive-tog',
              }),
            }
          : { state: 'no_appearance_fact' as const },
    };
  });
  return {
    source: {
      environment: 'test_fixture',
      provider: 'afl_tables',
      capabilityId: 'afl-tables-player-stats',
      competition: 'AFLM',
      seasonYear: 2025,
      captureId: 'source-capture:synthetic',
      normalizationRunId,
      stagingSha256,
      normalizationFinalizedAt: finalizedAt,
      normalizationFinalization: ref('provider-normalization-finalization', {
        normalizationRunId,
        stagingSha256,
        finalizedAt,
      }),
      fieldMapSha256: digest({ synthetic: 'raw-map' }),
      sourceRowCount: 2,
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
    completionPolicy: ref('match-universe-policy', { synthetic: 'missing-status' }),
    createdAt: '2026-09-01T00:01:00.000Z',
    rows,
  };
}

describe('retained Tables player factual assembly (synthetic only)', () => {
  it('uses explicit appearance choices despite false raw flags, retaining every quarantined match and no metrics', () => {
    const input = syntheticTables();
    const before = structuredClone(input);
    const batch = createAflTradeRetainedFitzRoyPlayerFactBatch(input);
    expect(batch.content.counts).toEqual({
      matchUniverse: 2,
      playerAppearances: 1,
      playerMatchMetrics: 0,
      playerSeasonMetrics: 0,
      playerAchievements: 0,
      normalizedRows: 2,
      nonNormalizedRows: 0,
    });
    expect(
      batch.content.facts
        .filter((f) => f.content.factKind === 'match_universe')
        .every(
          (f) =>
            f.content.factKind === 'match_universe' && f.content.completion.state === 'quarantined'
        )
    ).toBe(true);
    const appearance = batch.content.facts.find((f) => f.content.factKind === 'player_appearance')!;
    expect(appearance.content.source.providerDecodedRowId).toBe('provider-row:synthetic-1');
    expect(appearance.content.source.consumedSourceFields).toEqual(['Time.on.Ground']);
    expect(
      batch.content.rowAccounting.find(
        (row) => row.providerDecodedRowId === 'provider-row:synthetic-2'
      )?.factIds
    ).toHaveLength(1);
    expect(input).toEqual(before);
  });

  it('rejects a foreign player-affiliation occurrence even for a no-appearance row', () => {
    const input = syntheticTables();
    input.rows[1]!.representedClub.occurrence = {
      source: 'player_affiliation',
      identityCandidateId: 'identity-candidate:another',
    };
    expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(input)).toThrow(/affiliation/);
  });

  it.each(['player', 'club', 'both'] as const)(
    'requires complete %s resolution receipts even when no appearance fact is requested',
    (missing) => {
      const input = syntheticTables();
      const row = input.rows[1]!;
      expect(row.appearance.state).toBe('no_appearance_fact');
      if (missing !== 'club') Reflect.deleteProperty(row.player, 'decision');
      if (missing !== 'player') Reflect.deleteProperty(row.representedClub, 'decision');
      expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(input)).toThrow();
    }
  );

  it('does not infer an appearance from positive TOG when the explicit choice is no fact', () => {
    const input = syntheticTables();
    input.rows[0]!.appearance = { state: 'no_appearance_fact' };
    const batch = createAflTradeRetainedFitzRoyPlayerFactBatch(input);
    expect(batch.content.counts.playerAppearances).toBe(0);
    expect(batch.content.facts).toHaveLength(2);
  });

  it('rejects a missing choice rather than applying a participation default', () => {
    const input = syntheticTables();
    input.rows[0]!.appearance = undefined as unknown as (typeof input.rows)[number]['appearance'];
    expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(input)).toThrow(
      /explicit appearance/
    );
  });

  it('rejects another player or match candidate', () => {
    const input = syntheticTables();
    input.rows[0]!.player.identityCandidateId = 'identity-candidate:another';
    expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(input)).toThrow(
      /exact player\/match/
    );
    const other = syntheticTables();
    other.rows[0]!.match.matchCandidateId = 'match-candidate:another';
    expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(other)).toThrow(
      /exact player\/match/
    );
  });

  it('rejects Tables metric candidates instead of promoting or silently dropping them', () => {
    const input = syntheticTables();
    input.rows[0]!.row.metricCandidates = [
      {
        metricCode: 'goals',
        definitionVersion: 'goals/v1',
        availability: 'exact',
        numericValue: '0',
        unit: 'goals',
        sourceField: 'G',
        missingReason: null,
      },
    ];
    expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(input)).toThrow(
      /no metric candidates/
    );
  });

  it('rejects incomplete accounting and produces the same batch when row order changes', () => {
    const input = syntheticTables();
    const expected = createAflTradeRetainedFitzRoyPlayerFactBatch(input).batchId;
    input.rows = [...input.rows].reverse();
    expect(createAflTradeRetainedFitzRoyPlayerFactBatch(input).batchId).toBe(expected);
    input.rows = input.rows.slice(1);
    expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(input)).toThrow(/Source row count/);
  });
});

function syntheticFooty() {
  const base = syntheticTables();
  const definitionSha = 'd794a7691ad0c642dfcbeaa0d8e4a2e965d63f5f3916ce1a6d36c139d3822eea';
  const rows = base.rows.map((entry, index) => {
    const row = structuredClone(entry);
    row.row.identityCandidate!.provider = 'footywire';
    row.row.matchCandidate!.provider = 'footywire';
    row.row.typedPayload = {
      ...row.row.typedPayload,
      G: index === 0 ? { kind: 'integer', value: '2' } : { kind: 'missing' },
    };
    const metric = {
      metricCode: 'goals' as const,
      definitionVersion: 'goals/v1',
      unit: 'goals',
      sourceField: 'G',
      zeroSemantics: 'measured_zero' as const,
      availability: index === 0 ? ('exact' as const) : ('missing' as const),
      numericValue: index === 0 ? '2' : null,
      missingReason: index === 0 ? null : 'provider_value_missing',
    };
    row.row.metricCandidates = [metric];
    return { ...row, goalsCandidateSha256: digest(metric) };
  });
  return {
    ...base,
    source: { ...base.source, provider: 'footywire', capabilityId: 'footywire-player-stats' },
    goalsDefinition: { id: `metric-definition:${definitionSha}`, sha256: definitionSha },
    rows,
  };
}

describe('retained Footy player goals assembly (synthetic only)', () => {
  it('links observed goals to the exact appearance while accounting for missing no-appearance rows', () => {
    const input = syntheticFooty(),
      before = structuredClone(input);
    const batch = createAflTradeRetainedFitzRoyPlayerFactBatch(input);
    expect(batch.content.counts).toMatchObject({
      matchUniverse: 2,
      playerAppearances: 1,
      playerMatchMetrics: 1,
      normalizedRows: 2,
    });
    const goals = batch.content.facts.find((f) => f.content.factKind === 'player_match_metric')!;
    const appearance = batch.content.facts.find((f) => f.content.factKind === 'player_appearance')!;
    expect(goals.content).toMatchObject({
      factKind: 'player_match_metric',
      appearanceFactId: appearance.factId,
      metricCode: 'goals',
      definitionVersion: 'goals/v1',
      definition: input.goalsDefinition,
      availability: { state: 'measured', numericValue: '2', reasonCode: null },
    });
    expect(goals.content.source.candidateDigests.metric).toBe(input.rows[0]!.goalsCandidateSha256);
    expect(goals.content.source.consumedSourceFields).toEqual(['G']);
    expect(
      batch.content.rowAccounting.find(
        (r) => r.providerDecodedRowId === input.rows[1]!.row.providerDecodedRowId
      )?.factIds
    ).toHaveLength(1);
    expect(input).toEqual(before);
    input.rows.reverse();
    expect(createAflTradeRetainedFitzRoyPlayerFactBatch(input).batchId).toBe(batch.batchId);
  });

  it('preserves measured zero without changing missing into zero', () => {
    const input = syntheticFooty(),
      entry = input.rows[0]!;
    entry.row.typedPayload = { ...entry.row.typedPayload, G: { kind: 'integer', value: '0' } };
    entry.row.metricCandidates = [{ ...entry.row.metricCandidates[0]!, numericValue: '0' }];
    entry.goalsCandidateSha256 = digest(entry.row.metricCandidates[0]);
    const batch = createAflTradeRetainedFitzRoyPlayerFactBatch(input);
    expect(
      batch.content.facts.find((f) => f.content.factKind === 'player_match_metric')?.content
    ).toMatchObject({ availability: { state: 'measured', numericValue: '0', reasonCode: null } });
    expect(batch.content.counts.playerMatchMetrics).toBe(1);
    expect(input.rows[1]!.row.metricCandidates[0]!.numericValue).toBeNull();
  });

  it.each([
    'digest',
    'version',
    'field',
    'unit',
    'count',
    'missing_as_zero',
    'raw_mismatch',
    'source_representation',
  ] as const)('rejects malformed %s before the no-appearance branch', (fault) => {
    const input = syntheticFooty(),
      entry = input.rows[1]!;
    expect(entry.appearance.state).toBe('no_appearance_fact');
    const metric = { ...entry.row.metricCandidates[0]! };
    if (fault === 'version') metric.definitionVersion = 'goals-v1';
    if (fault === 'field') metric.sourceField = 'Goals';
    if (fault === 'unit') metric.unit = 'points';
    if (fault === 'missing_as_zero') {
      metric.availability = 'exact';
      metric.numericValue = '0';
      metric.missingReason = null;
    }
    if (fault === 'raw_mismatch')
      entry.row.typedPayload = { ...entry.row.typedPayload, G: { kind: 'integer', value: '1' } };
    if (fault === 'source_representation')
      Reflect.set(metric, 'sourceRepresentation', 'integer_text');
    entry.row.metricCandidates = fault === 'count' ? [metric, metric] : [metric];
    entry.goalsCandidateSha256 = fault === 'digest' ? '0'.repeat(64) : digest(metric);
    expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(input)).toThrow();
  });

  it('requires the explicit definition and authenticates it even when every appearance is omitted', () => {
    const input = syntheticFooty();
    for (const row of input.rows) row.appearance = { state: 'no_appearance_fact' };
    input.goalsDefinition.sha256 = '0'.repeat(64);
    expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(input)).toThrow(/definition/);
    Reflect.deleteProperty(input, 'goalsDefinition');
    expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(input)).toThrow(/definition/);
  });

  it.each(['', ' ', '0x0', '0x10', '1_0', '+0'])(
    'rejects malformed numeric text %j before the no-appearance branch',
    (value) => {
      for (const kind of ['integer', 'finite_number'] as const) {
        const input = syntheticFooty(),
          entry = input.rows[1]!;
        entry.row.typedPayload = { ...entry.row.typedPayload, G: { kind, value } };
        entry.row.metricCandidates = [
          {
            ...entry.row.metricCandidates[0]!,
            availability: 'exact',
            numericValue: String(Number(value)),
            missingReason: null,
          },
        ];
        entry.goalsCandidateSha256 = digest(entry.row.metricCandidates[0]);
        expect(entry.appearance.state).toBe('no_appearance_fact');
        expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(input)).toThrow(/representation/);
      }
    }
  );

  it('does not create a numeric claim merely because valid source goals exist', () => {
    const input = syntheticFooty();
    input.rows[0]!.appearance = { state: 'no_appearance_fact' };
    const batch = createAflTradeRetainedFitzRoyPlayerFactBatch(input);
    expect(batch.content.counts).toMatchObject({
      matchUniverse: 2,
      playerAppearances: 0,
      playerMatchMetrics: 0,
    });
  });

  it('keeps exact affiliation validation for the no-appearance Footy row', () => {
    const input = syntheticFooty();
    input.rows[1]!.representedClub.occurrence = {
      source: 'player_affiliation',
      identityCandidateId: 'identity-candidate:foreign',
    };
    expect(() => createAflTradeRetainedFitzRoyPlayerFactBatch(input)).toThrow(/affiliation/);
  });
});
