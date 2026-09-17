import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  applyAflTradeHpnStatisticalSelections,
  createAflTradeHpnPavFieldMap,
  createAflTradeHpnPavSeasonInputSet,
  createAflTradeHpnStatisticalSelectionSet,
} from '@/server/aflTradeIntelligence/modeling/hpnPavInputContracts';
import { createAflTradeFinalizedHpnPavCalculationService } from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';
import { aflTradeHpnProjectedFieldMapSchema } from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';
import {
  aflTradeHpnStatisticalDecisionSchema,
  createAflTradeHpnStatisticalCell,
} from '@/server/aflTradeIntelligence/modeling/hpnStatisticalAdjudication';
const sha = (character: string) => character.repeat(64);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const decision = (prefix: string, character: string) => ({
  id: `${prefix}:${digest(character)}`,
  sha256: digest(character),
});

const resolution = (
  entityKind: 'player' | 'club' | 'match',
  character: string,
  canonicalId = `${entityKind}:${character}`
) => ({
  entityKind,
  canonicalId,
  revision: 1,
  status: 'current_approved' as const,
  resolutionDecision: decision('provider-resolution-decision', character),
  assignmentDecision: decision('provider-resolution-decision', character),
});

const acquisitionSpell = (playerKey: string, clubId: string) => ({
  spellVersionId: `acquisition-spell-version:${digest(`${playerKey}:${clubId}`)}`,
  spellId: `spell:${playerKey}:${clubId}`,
  version: 1,
  playerId: `player:${playerKey}`,
  clubId,
  startEventVersionId: `event-version:${playerKey}:${clubId}`,
  startAssetVersionId: `asset-version:${playerKey}:${clubId}`,
  startDate: '2025-01-01',
  endDate: null,
  endReason: null,
  ruleId: 'spell-rule:v1',
  status: 'approved' as const,
  supersedesSpellVersionId: null,
  recordedAt: '2025-01-01T00:00:00.000Z',
});

function playerFieldMap(provider: 'afl_tables' | 'footywire', character: string) {
  return createAflTradeHpnPavFieldMap({
    environment: 'test_fixture',
    competition: 'AFLM',
    provider,
    capabilityId: `${provider.replace('_', '-')}-player-stats`,
    sourceSchemaSha256: sha(character),
    inputKind: 'player_match_stats',
    validFromSeason: 1998,
    validThroughSeason: 2200,
    approvalDecision: decision('review-decision', character),
    bindings: {
      player: 'player_id',
      match: 'match_id',
      club: 'team',
      totalPoints: { kind: 'goals_plus_behinds', goals: 'goals', behinds: 'behinds' },
      hitOuts: 'hit_outs',
      goalAssists: 'goal_assists',
      inside50s: 'inside_50s',
      marks: 'marks',
      marksInside50: 'marks_inside_50',
      freeKicksFor: 'free_kicks_for',
      freeKicksAgainst: 'free_kicks_against',
      rebound50s: 'rebound_50s',
      onePercenters: 'one_percenters',
      clearances: 'clearances',
      tackles: 'tackles',
    },
  });
}

function resultFieldMap() {
  return createAflTradeHpnPavFieldMap({
    environment: 'test_fixture',
    competition: 'AFLM',
    provider: 'official_afl',
    capabilityId: 'official-afl-results',
    sourceSchemaSha256: sha('a'),
    inputKind: 'completed_match_result',
    validFromSeason: 1998,
    validThroughSeason: 2200,
    approvalDecision: decision('review-decision', 'a'),
    bindings: {
      match: 'match_id',
      homeClub: 'home_team',
      awayClub: 'away_team',
      homePoints: 'home_points',
      awayPoints: 'away_points',
      completionStatus: 'status',
      completedValues: ['completed'],
    },
  });
}

function projectedFieldMap(
  fieldMap: ReturnType<typeof resultFieldMap> | ReturnType<typeof playerFieldMap>,
  character: string
) {
  const createdAt = '2026-08-09T00:00:00.000Z';
  const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(
    { candidate: character },
    createdAt
  );
  const approvalDecisionArtifact = createAflTradeCanonicalJsonArtifactRef(
    { decision: character },
    createdAt
  );
  const semanticBindings =
    fieldMap.content.inputKind === 'completed_match_result'
      ? [
          {
            semanticField: 'awayClub',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.awayClub },
          },
          {
            semanticField: 'awayPoints',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.awayPoints },
          },
          {
            semanticField: 'completionStatus',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.completionStatus },
          },
          {
            semanticField: 'homeClub',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.homeClub },
          },
          {
            semanticField: 'homePoints',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.homePoints },
          },
          {
            semanticField: 'match',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.match },
          },
        ]
      : [
          {
            semanticField: 'clearances',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.clearances },
          },
          {
            semanticField: 'club',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.club },
          },
          {
            semanticField: 'freeKicksAgainst',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.freeKicksAgainst },
          },
          {
            semanticField: 'freeKicksFor',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.freeKicksFor },
          },
          {
            semanticField: 'goalAssists',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.goalAssists },
          },
          {
            semanticField: 'hitOuts',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.hitOuts },
          },
          {
            semanticField: 'inside50s',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.inside50s },
          },
          {
            semanticField: 'marks',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.marks },
          },
          {
            semanticField: 'marksInside50',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.marksInside50 },
          },
          {
            semanticField: 'match',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.match },
          },
          {
            semanticField: 'onePercenters',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.onePercenters },
          },
          {
            semanticField: 'player',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.player },
          },
          {
            semanticField: 'rebound50s',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.rebound50s },
          },
          {
            semanticField: 'tackles',
            mapping: { kind: 'direct', sourceField: fieldMap.content.bindings.tackles },
          },
          { semanticField: 'totalPoints', mapping: fieldMap.content.bindings.totalPoints },
        ];
  const content = {
    schemaVersion: 'afl-trade-hpn-projected-field-map/v1' as const,
    environment: 'non_production' as const,
    purpose: 'private_confirmed_realized_hpn_pav' as const,
    competition: 'AFLM' as const,
    provider: fieldMap.content.provider,
    capabilityId: fieldMap.content.capabilityId,
    sourceSchemaSha256: fieldMap.content.sourceSchemaSha256,
    inputKind: fieldMap.content.inputKind,
    validFromSeason: fieldMap.content.validFromSeason,
    validThroughSeason: fieldMap.content.validThroughSeason,
    candidateId: `hpn-field-map-candidate:${sha(character)}`,
    candidateArtifact,
    approvalDecisionId: `hpn-field-map-review-decision:${sha(character)}`,
    approvalDecisionArtifact,
    semanticBindings,
    completionRule:
      fieldMap.content.inputKind === 'completed_match_result'
        ? {
            kind: 'source_status' as const,
            completedValues: fieldMap.content.bindings.completedValues,
          }
        : null,
    createdAt,
    publicationEligible: false as const,
    publicationProhibited: true as const,
    limitation:
      'Private non-production projection map only; it grants no factual release, model training, publication, production, activation, or live-capture authority.' as const,
  };
  return aflTradeHpnProjectedFieldMapSchema.parse({
    fieldMapId: createAflTradeContentAddress('hpn-pav-field-map', content),
    content,
  });
}

function source(
  normalizationRunId: string,
  providerDecodedRowId: string,
  character: string,
  sourceValues: Record<string, string | number | boolean | null>
) {
  return {
    normalizationRunId,
    providerDecodedRowId,
    sourceRowSha256: digest(`row:${character}`),
    typedPayloadSha256: digest(`payload:${character}`),
    sourceFields: Object.keys(sourceValues).sort(),
    sourceValues,
  };
}

function fixture() {
  const resultMap = resultFieldMap();
  const primaryMap = playerFieldMap('afl_tables', 'b');
  const corroboratingMap = playerFieldMap('footywire', 'c');
  const resultRunId = `provider-normalization-run:${sha('1')}`;
  const primaryRunId = `provider-normalization-run:${sha('2')}`;
  const corroboratingRunId = `provider-normalization-run:${sha('3')}`;
  const matchId = 'match:2025-1';
  const homeClub = resolution('club', 'a');
  const awayClub = resolution('club', 'b');
  const universePlayers = ['a1', 'a2', 'b1', 'b2'] as const;
  const rows = [
    {
      kind: 'completed_match_result' as const,
      source: source(resultRunId, 'provider-row:result', 'd', {
        away_points: 80,
        away_team: 'club:b',
        home_points: 100,
        home_team: 'club:a',
        match_id: matchId,
        status: 'completed',
      }),
      match: resolution('match', 'm', matchId),
      effectiveAt: '2025-03-20T10:00:00.000Z',
      homeClub,
      awayClub,
      homePoints: 100,
      awayPoints: 80,
      completionStatus: 'completed' as const,
    },
    ...(['a1', 'a2', 'b1', 'b2'] as const).flatMap((playerKey, playerIndex) => {
      const club = playerKey.startsWith('a') ? homeClub : awayClub;
      return (['primary', 'corroborating'] as const).map((role, providerIndex) => ({
        kind: 'player_match_stats' as const,
        role,
        source: source(
          role === 'primary' ? primaryRunId : corroboratingRunId,
          `provider-row:${role}:${playerKey}`,
          String.fromCharCode(101 + playerIndex * 2 + providerIndex),
          {
            behinds: 2 + playerIndex,
            clearances: 4,
            free_kicks_against: 1,
            free_kicks_for: 2,
            goal_assists: 1,
            goals: 3,
            hit_outs: playerIndex,
            inside_50s: 10 + playerIndex,
            marks: 5,
            marks_inside_50: 1,
            match_id: matchId,
            one_percenters: 2,
            player_id: `player:${playerKey}`,
            rebound_50s: 3,
            tackles: 5,
            team: club.canonicalId,
          }
        ),
        match: resolution('match', 'm', matchId),
        player: resolution('player', playerKey),
        club,
        acquisitionSpell: acquisitionSpell(playerKey, club.canonicalId),
        stats: {
          totalPoints: 20 + playerIndex,
          hitOuts: playerIndex,
          goalAssists: 1,
          inside50s: 10 + playerIndex,
          marks: 5,
          marksInside50: 1,
          freeKicksFor: 2,
          freeKicksAgainst: 1,
          rebound50s: 3,
          onePercenters: 2,
          clearances: 4,
          tackles: 5,
        },
      }));
    }),
  ];
  const run = (
    normalizationRunId: string,
    provider: string,
    capabilityId: string,
    fieldMapId: string,
    rowCount: number
  ) => ({
    normalizationRunId,
    captureId: `capture:${provider}:2025`,
    sourceSnapshotId: `source-snapshot:${sha(provider === 'official_afl' ? '4' : provider === 'afl_tables' ? '5' : '6')}`,
    sourceArtifactId: `artifact:${sha(provider === 'official_afl' ? '7' : provider === 'afl_tables' ? '8' : '9')}`,
    provider,
    capabilityId,
    fieldMapId,
    competition: 'AFLM' as const,
    seasonYear: 2025,
    stagingSha256: sha(provider === 'official_afl' ? 'a' : provider === 'afl_tables' ? 'b' : 'c'),
    sourceRowCount: rowCount,
    acceptedRowCount: rowCount,
    issueCount: 0 as const,
    status: 'staged' as const,
    capturedAt: '2025-09-27T00:00:00.000Z',
    finalizedAt: '2026-08-09T00:00:00.000Z',
  });
  return {
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    seasonYear: 2025,
    effectiveThrough: '2025-09-27T00:00:00.000Z',
    createdAt: '2026-08-10T00:00:00.000Z',
    methodId: `hpn-pav-method:${sha('f')}`,
    factualUniverse: {
      factualRunId: `factual-reconciliation-run:${sha('0')}`,
      policyId: `factual-reconciliation-policy:${sha('d')}`,
      inputSetSha256: sha('e'),
      status: 'approved' as const,
      finalizedAt: '2026-08-09T00:00:00.000Z',
      completedMatchFacts: [
        {
          factIds: [`source-fact:${digest('match-universe:2025-1')}`],
          matchId,
          effectiveAt: '2025-03-20T10:00:00.000Z',
          homeClubId: homeClub.canonicalId,
          awayClubId: awayClub.canonicalId,
        },
      ],
      playerAppearanceFacts: universePlayers.map((playerKey) => ({
        factIds: [`source-fact:${digest(`appearance:${playerKey}`)}`],
        matchId,
        playerId: `player:${playerKey}`,
        clubId: playerKey.startsWith('a') ? homeClub.canonicalId : awayClub.canonicalId,
      })),
    },
    fieldMaps: [resultMap, primaryMap, corroboratingMap],
    sourceRuns: [
      run(resultRunId, 'official_afl', 'official-afl-results', resultMap.fieldMapId, 1),
      run(primaryRunId, 'afl_tables', 'afl-tables-player-stats', primaryMap.fieldMapId, 4),
      run(
        corroboratingRunId,
        'footywire',
        'footywire-player-stats',
        corroboratingMap.fieldMapId,
        4
      ),
    ],
    completedMatches: [
      {
        matchId,
        effectiveAt: '2025-03-20T10:00:00.000Z',
        homeClubId: homeClub.canonicalId,
        awayClubId: awayClub.canonicalId,
      },
    ],
    rows,
  };
}

function statisticalSelectionFixture(options: { staleObservation?: boolean; uncovered?: boolean } = {}) {
  const input = fixture();
  const fieldMaps = input.fieldMaps.map((fieldMap, index) =>
    projectedFieldMap(fieldMap, String(index + 1))
  );
  const sourceRuns = input.sourceRuns.map((run, index) => ({
    ...run,
    fieldMapId: fieldMaps[index]!.fieldMapId,
  }));
  const primary = input.rows.find(
    (row) =>
      row.kind === 'player_match_stats' &&
      row.role === 'primary' &&
      row.player.canonicalId === 'player:a1'
  );
  const corroborating = input.rows.find(
    (row) =>
      row.kind === 'player_match_stats' &&
      row.role === 'corroborating' &&
      row.player.canonicalId === 'player:a1'
  );
  if (
    !primary ||
    primary.kind !== 'player_match_stats' ||
    !corroborating ||
    corroborating.kind !== 'player_match_stats'
  ) {
    throw new Error('Missing statistical selection fixture rows');
  }
  corroborating.stats.tackles = 6;
  corroborating.source.sourceValues.tackles = 6;
  if (options.uncovered) {
    const other = input.rows.find(
      (row) =>
        row.kind === 'player_match_stats' &&
        row.role === 'corroborating' &&
        row.player.canonicalId === 'player:a2'
    );
    if (!other || other.kind !== 'player_match_stats') throw new Error('Missing second fixture row');
    other.stats.marks = 6;
    other.source.sourceValues.marks = 6;
  }
  const observation = (
    row: typeof primary,
    role: 'primary' | 'corroborating'
  ) => {
    const run = sourceRuns.find(
      ({ normalizationRunId }) => normalizationRunId === row.source.normalizationRunId
    )!;
    const map = fieldMaps.find(({ fieldMapId }) => fieldMapId === run.fieldMapId)!;
    return {
      normalizationRunId: row.source.normalizationRunId,
      stagingSha256: run.stagingSha256,
      provider: run.provider,
      capabilityId: run.capabilityId,
      captureId: run.captureId,
      sourceSnapshotId: run.sourceSnapshotId,
      sourceArtifactId: run.sourceArtifactId,
      providerDecodedRowId: row.source.providerDecodedRowId,
      sourceRowSha256:
        options.staleObservation && role === 'primary' ? sha('0') : row.source.sourceRowSha256,
      typedPayloadSha256: row.source.typedPayloadSha256,
      fieldMapId: map.fieldMapId,
      fieldMapSha256: sha256AflTradeCanonicalJson(map.content),
      sourceFields: ['tackles'],
      value: row.stats.tackles,
      representation: 'measured' as const,
    };
  };
  const candidate = createAflTradeHpnStatisticalCell({
    schemaVersion: 'afl-trade-hpn-statistical-cell/v1',
    scope: {
      environment: 'non_production',
      competitionId: 'AFLM',
      season: input.seasonYear,
      playerId: primary.player.canonicalId,
      matchId: primary.match.canonicalId,
      clubId: primary.club.canonicalId,
      statistic: 'tackles',
    },
    primary: observation(primary, 'primary'),
    corroborating: observation(corroborating, 'corroborating'),
    createdAt: '2026-08-09T01:00:00.000Z',
  });
  const evidenceArtifact = createAflTradeCanonicalJsonArtifactRef(
    { reviewedTackles: 6 },
    '2026-08-09T02:00:00.000Z'
  );
  const decisionBody = {
    schemaVersion: 'afl-trade-hpn-statistical-decision/v1' as const,
    candidate,
    selectedSource: 'corroborating' as const,
    selectedValue: 6,
    evidence: [
      {
        artifact: evidenceArtifact,
        locator: 'reviewed-tackles',
        observedValue: 6,
        representation: 'measured' as const,
      },
    ],
    reviewerId: 'reviewer:test',
    rationale: 'Reviewed retained discrepancy.',
    decidedAt: '2026-08-09T03:00:00.000Z',
    supersedesDecisionId: null,
    authority: 'requires_repository_verification' as const,
    publicationEligible: false as const,
  };
  const statisticalDecision = aflTradeHpnStatisticalDecisionSchema.parse({
    ...decisionBody,
    decisionId: createAflTradeContentAddress('hpn-statistical-decision', decisionBody),
  });
  const statisticalSelections = createAflTradeHpnStatisticalSelectionSet(
    [statisticalDecision],
    [
      {
        scopeKey: createAflTradeContentAddress('hpn-statistical-scope', candidate.scope),
        candidateId: candidate.candidateId,
        decisionId: statisticalDecision.decisionId,
        supportReviewId: `hpn-statistical-support:${sha('7')}`,
        revision: 1,
        appliedAt: '2026-08-09T04:00:00.000Z',
        identitySha256: sha('8'),
      },
    ]
  );
  return {
    input,
    primary,
    statisticalDecision,
    request: {
      ...input,
      environment: 'non_production' as const,
      knowledgePolicy: 'retrospective_as_recorded_by_input_creation' as const,
      knowledgeCutoffAt: input.createdAt,
      fieldMaps,
      sourceRuns,
      excludedSourceRows: [],
      statisticalSelections,
    },
  };
}

describe('HPN PAV governed input contracts', () => {
  it('seals complete reviewed discrepancies and overlays selected values without rewriting source rows', () => {
    const fixture = statisticalSelectionFixture();
    const inputSet = createAflTradeHpnPavSeasonInputSet(fixture.request);
    const storedPrimary = inputSet.content.rows.find(
      (row) =>
        row.kind === 'player_match_stats' &&
        row.role === 'primary' &&
        row.player.canonicalId === 'player:a1'
    );
    if (!storedPrimary || storedPrimary.kind !== 'player_match_stats') {
      throw new Error('Missing sealed primary row');
    }
    expect(inputSet.content.schemaVersion).toBe('afl-trade-hpn-pav-input-set/v5');
    expect(storedPrimary.stats.tackles).toBe(5);
    expect(applyAflTradeHpnStatisticalSelections(inputSet, storedPrimary).tackles).toBe(6);
    expect(fixture.primary.stats.tackles).toBe(5);
  });

  it('calculates from selected values and records a selected corroborating row as provenance', async () => {
    const selected = statisticalSelectionFixture();
    const methodBytes = new TextEncoder().encode('<html><body>HPN PAV method</body></html>');
    const method = createAflTradeHpnPavMethod({
      sourceArtifact: createAflTradeByteArtifactRef(
        methodBytes,
        'text/html',
        '2026-08-09T00:00:00.000Z'
      ),
      sourceBytes: methodBytes,
      capturedAt: '2026-08-09T00:00:00.000Z',
    });
    const inputSet = createAflTradeHpnPavSeasonInputSet({
      ...selected.request,
      methodId: method.methodId,
    });
    const service = createAflTradeFinalizedHpnPavCalculationService({
      inputRepository: {
        loadFinalizedSeasonInputSet: async () => inputSet,
      } as never,
      methodAuthority: { loadExact: async () => ({ method, sourceBytes: methodBytes }) },
      clock: { now: () => '2026-08-11T00:00:00.000Z' },
    });

    const calculation = await service.calculate(
      {
        inputSetId: inputSet.inputSetId,
        environment: 'non_production',
        competition: 'AFLM',
        seasonYear: 2025,
        methodId: method.methodId,
      },
      { environment: 'non_production' }
    );
    const player = calculation.content.players.find(({ playerId }) => playerId === 'player:a1');
    expect(player?.source.tackles).toBe(6);
    expect(player?.source.sourceRowIds).toEqual([
      'provider-row:corroborating:a1',
      'provider-row:primary:a1',
    ]);
    const rawPrimary = inputSet.content.rows.find(
      (row) =>
        row.kind === 'player_match_stats' &&
        row.role === 'primary' &&
        row.player.canonicalId === 'player:a1'
    );
    expect(rawPrimary?.kind === 'player_match_stats' && rawPrimary.stats.tackles).toBe(5);
  });

  it('rejects incomplete discrepancy coverage and stale retained observation identity', () => {
    expect(() =>
      createAflTradeHpnPavSeasonInputSet(statisticalSelectionFixture({ uncovered: true }).request)
    ).toThrow(/exactly cover/i);
    expect(() =>
      createAflTradeHpnPavSeasonInputSet(
        statisticalSelectionFixture({ staleObservation: true }).request
      )
    ).toThrow(/retained observations/i);
  });

  it('conserves five reviewed unused substitutes separately without manufacturing measured zeros', () => {
    const input = fixture();
    const template = input.rows.find(
      (row) => row.kind === 'player_match_stats' && row.role === 'corroborating'
    );
    if (!template || template.kind !== 'player_match_stats') throw new Error('Missing fixture row');
    const excludedSourceRows = Array.from({ length: 5 }, (_, index) => ({
      reason: 'reviewed_nonparticipant' as const,
      source: source(
        template.source.normalizationRunId,
        `provider-row:unused-${index}`,
        `unused-${index}`,
        Object.fromEntries(
          Object.keys(template.source.sourceValues).map((field) => [
            field,
            field === 'player_id'
              ? `unused-${index}`
              : field === 'team'
                ? 'club:a'
                : field === 'match_id'
                  ? 'match:2025-1'
                  : null,
          ])
        )
      ),
      player: resolution('player', `unused-${index}`),
      match: template.match,
      club: template.club,
      review: {
        decision: decision('review-decision', `unused-${index}`),
        decidedAt: '2026-08-09T00:00:00.000Z',
        evidenceArtifact: createAflTradeCanonicalJsonArtifactRef(
          { syntheticOfficialReport: `unused-${index}` },
          '2026-08-08T00:00:00.000Z'
        ),
      },
    }));
    const result = createAflTradeHpnPavSeasonInputSet({
      ...input,
      knowledgePolicy: 'retrospective_as_recorded_by_input_creation',
      knowledgeCutoffAt: input.createdAt,
      sourceRuns: input.sourceRuns.map((run) =>
        run.provider === 'footywire' ? { ...run, sourceRowCount: 9, acceptedRowCount: 9 } : run
      ),
      excludedSourceRows,
    });
    expect(result.content.schemaVersion).toBe('afl-trade-hpn-pav-input-set/v4');
    expect(result.content.rows).toHaveLength(9);
    expect('excludedSourceRows' in result.content && result.content.excludedSourceRows).toEqual(
      excludedSourceRows
    );
    expect(() =>
      createAflTradeHpnPavSeasonInputSet({
        ...result.content,
        excludedSourceRows: excludedSourceRows.slice(1),
      })
    ).toThrow(/source row count/i);
    expect(() =>
      createAflTradeHpnPavSeasonInputSet({
        ...result.content,
        excludedSourceRows: excludedSourceRows.map((row, index) =>
          index === 0 ? { ...row, player: resolution('player', 'a1') } : row
        ),
      })
    ).toThrow(/factual absence/i);
    expect(() =>
      createAflTradeHpnPavSeasonInputSet({
        ...result.content,
        excludedSourceRows: excludedSourceRows.map((row, index) =>
          index === 0
            ? {
                ...row,
                source: {
                  ...row.source,
                  providerDecodedRowId: template.source.providerDecodedRowId,
                },
              }
            : row
        ),
      })
    ).toThrow(/exactly once/i);
    expect(() =>
      createAflTradeHpnPavSeasonInputSet({
        ...result.content,
        excludedSourceRows: excludedSourceRows.map((row, index) =>
          index === 0 ? { ...row, club: resolution('club', 'not-in-match') } : row
        ),
      })
    ).toThrow(/nonparticipant context/i);
    expect(
      createAflTradeHpnPavSeasonInputSet({
        ...result.content,
        excludedSourceRows: [...excludedSourceRows].reverse(),
        rows: [...result.content.rows].reverse(),
      }).inputSetId
    ).toBe(result.inputSetId);
  });
  it('retains an exact candidate-only player decision without inventing an assignment', () => {
    const input = fixture();
    const rows = input.rows.map((row) =>
      row.kind === 'player_match_stats'
        ? {
            ...row,
            player: {
              ...row.player,
              entityKind: 'player' as const,
              resolutionScope: 'candidate_only' as const,
              assignmentDecision: null,
            },
          }
        : row
    );
    const result = createAflTradeHpnPavSeasonInputSet({ ...input, rows });
    expect(
      result.content.rows
        .filter((row) => row.kind === 'player_match_stats')
        .every((row) => row.player.assignmentDecision === null)
    ).toBe(true);
  });
  it.each(['club', 'match', 'player_with_assignment'] as const)(
    'rejects candidate-only authority for %s',
    (kind) => {
      const input = fixture();
      const rows = input.rows.map((row) => {
        if (row.kind !== 'player_match_stats') return row;
        const key = kind === 'player_with_assignment' ? 'player' : kind;
        return {
          ...row,
          [key]: {
            ...row[key],
            resolutionScope: 'candidate_only',
            assignmentDecision:
              kind === 'player_with_assignment' ? row.player.assignmentDecision : null,
          },
        };
      });
      expect(() => createAflTradeHpnPavSeasonInputSet({ ...input, rows })).toThrow();
    }
  );
  it('retains late historical capture only under explicit retrospective input custody', () => {
    const original = fixture();
    const late = {
      ...original,
      sourceRuns: original.sourceRuns.map((run) => ({
        ...run,
        capturedAt: '2026-08-08T00:00:00.000Z',
      })),
    };
    expect(() => createAflTradeHpnPavSeasonInputSet(late)).toThrow(/chronology/i);
    const input = createAflTradeHpnPavSeasonInputSet({
      ...late,
      knowledgePolicy: 'retrospective_as_recorded_by_input_creation',
      knowledgeCutoffAt: original.createdAt,
    });
    expect(input.content).toMatchObject({
      schemaVersion: 'afl-trade-hpn-pav-input-set/v3',
      fieldMapAuthority: 'legacy',
      effectiveThrough: original.effectiveThrough,
      sourceRuns: expect.arrayContaining([
        expect.objectContaining({ capturedAt: '2026-08-08T00:00:00.000Z' }),
      ]),
    });
  });

  it('seals one exhaustive, independently corroborated completed season input', () => {
    const inputSet = createAflTradeHpnPavSeasonInputSet(fixture());

    expect(inputSet.inputSetId).toMatch(/^hpn-pav-input-set:[a-f0-9]{64}$/);
    expect(inputSet.content.counts).toEqual({
      completedMatches: 1,
      resultRows: 1,
      primaryPlayerRows: 4,
      corroboratingPlayerRows: 4,
    });
    expect(inputSet.content.publicationEligible).toBe(false);
  });

  it('rejects retrospective custody cutoffs before finalization or after creation', () => {
    const original = fixture();
    for (const knowledgeCutoffAt of ['2026-08-08T00:00:00.000Z', '2026-08-11T00:00:00.000Z']) {
      expect(() =>
        createAflTradeHpnPavSeasonInputSet({
          ...original,
          knowledgePolicy: 'retrospective_as_recorded_by_input_creation',
          knowledgeCutoffAt,
        })
      ).toThrow();
    }
  });

  it('seals projected-map authority without manufacturing legacy field maps', () => {
    const legacy = fixture();
    const projectedMaps = legacy.fieldMaps.map((fieldMap, index) =>
      projectedFieldMap(fieldMap, String(index + 1))
    );
    const sourceRuns = legacy.sourceRuns.map((run, index) => ({
      ...run,
      fieldMapId: projectedMaps[index]!.fieldMapId,
    }));

    const inputSet = createAflTradeHpnPavSeasonInputSet({
      ...legacy,
      environment: 'non_production',
      fieldMaps: projectedMaps,
      sourceRuns,
    });

    expect(inputSet.content.schemaVersion).toBe('afl-trade-hpn-pav-input-set/v2');
    expect(inputSet.content.fieldMaps).toEqual(
      [...projectedMaps].sort((left, right) => left.fieldMapId.localeCompare(right.fieldMapId))
    );
  });

  it('rejects an omitted completed match or a run row that is not conserved', () => {
    const missingMatch = fixture();
    missingMatch.completedMatches = [];
    expect(() => createAflTradeHpnPavSeasonInputSet(missingMatch)).toThrow(/completed.?match/i);

    const missingRunRow = fixture();
    missingRunRow.rows.pop();
    expect(() => createAflTradeHpnPavSeasonInputSet(missingRunRow)).toThrow(/source row count/i);
  });

  it('rejects partial or provider-disagreeing player sets', () => {
    const partialPrimary = fixture();
    partialPrimary.rows = partialPrimary.rows.filter(
      (row) =>
        !(
          row.kind === 'player_match_stats' &&
          row.role === 'primary' &&
          row.player.canonicalId === 'player:a2'
        )
    );
    partialPrimary.sourceRuns[1].sourceRowCount = 3;
    partialPrimary.sourceRuns[1].acceptedRowCount = 3;
    expect(() => createAflTradeHpnPavSeasonInputSet(partialPrimary)).toThrow(/player set/i);

    const substitutedPlayer = fixture();
    const corroborating = substitutedPlayer.rows.find(
      (row) => row.kind === 'player_match_stats' && row.role === 'corroborating'
    );
    if (corroborating?.kind === 'player_match_stats') {
      corroborating.player = resolution('player', 'different');
    }
    expect(() => createAflTradeHpnPavSeasonInputSet(substitutedPlayer)).toThrow(/player set/i);
  });

  it('rejects symmetric provider omissions against the independent appearance universe', () => {
    const symmetricallyIncomplete = fixture();
    symmetricallyIncomplete.rows = symmetricallyIncomplete.rows.filter(
      (row) => !(row.kind === 'player_match_stats' && row.player.canonicalId === 'player:a2')
    );
    symmetricallyIncomplete.sourceRuns[1].sourceRowCount = 3;
    symmetricallyIncomplete.sourceRuns[1].acceptedRowCount = 3;
    symmetricallyIncomplete.sourceRuns[2].sourceRowCount = 3;
    symmetricallyIncomplete.sourceRuns[2].acceptedRowCount = 3;

    expect(() => createAflTradeHpnPavSeasonInputSet(symmetricallyIncomplete)).toThrow(
      /appearance universe/i
    );
  });

  it('rejects a feed-defined match universe that omits an authoritative completed match', () => {
    const omittedAuthoritativeMatch = fixture();
    omittedAuthoritativeMatch.completedMatches = [];

    expect(() => createAflTradeHpnPavSeasonInputSet(omittedAuthoritativeMatch)).toThrow(
      /factual universe/i
    );
  });

  it('rejects unresolved authority, unreviewed fields, and negative source values', () => {
    const stale = fixture();
    const playerRow = stale.rows.find((row) => row.kind === 'player_match_stats');
    if (playerRow?.kind === 'player_match_stats') playerRow.player.status = 'superseded' as never;
    expect(() => createAflTradeHpnPavSeasonInputSet(stale)).toThrow(/current_approved/i);

    const extraField = fixture();
    extraField.rows[0].source.sourceValues.unreviewed_field = 'not reviewed';
    extraField.rows[0].source.sourceFields = Object.keys(
      extraField.rows[0].source.sourceValues
    ).sort();
    expect(() => createAflTradeHpnPavSeasonInputSet(extraField)).toThrow(/reviewed field map/i);

    const negative = fixture();
    const negativeRow = negative.rows.find((row) => row.kind === 'player_match_stats');
    if (negativeRow?.kind === 'player_match_stats') negativeRow.stats.tackles = -1;
    expect(() => createAflTradeHpnPavSeasonInputSet(negative)).toThrow(/>=0/i);
  });

  it('rejects scope, chronology, and content-address tampering', () => {
    const wrongSeason = fixture();
    wrongSeason.sourceRuns[0].seasonYear = 2024;
    expect(() => createAflTradeHpnPavSeasonInputSet(wrongSeason)).toThrow(/season/i);

    const late = fixture();
    late.sourceRuns[0].finalizedAt = '2026-08-11T00:00:00.000Z';
    expect(() => createAflTradeHpnPavSeasonInputSet(late)).toThrow(/chronology/i);

    const map = playerFieldMap('afl_tables', 'e');
    expect(() =>
      createAflTradeHpnPavFieldMap({
        ...map.content,
        approvalDecision: decision('review-decision', '0'),
      })
    ).not.toThrow();
    expect(createAflTradeContentAddress('hpn-pav-field-map', map.content)).toBe(map.fieldMapId);
  });
});
