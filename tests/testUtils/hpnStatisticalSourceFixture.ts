import { vi } from 'vitest';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { aflTradeHpnProjectedFieldMapSchema } from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '@/server/aflTradeIntelligence/modeling/postgresHpnProjectedFieldMapAuthority';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeHpnPavFieldMap } from '@/server/aflTradeIntelligence/modeling/hpnPavInputContracts';
import { createAflTradeHpnStatisticalCell } from '@/server/aflTradeIntelligence/modeling/hpnStatisticalAdjudication';
import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { fixture } from './hpnStatisticalAdjudicationFixture';

export function setup(
  statistic = 'clearances',
  projected = false,
  mapCreatedAt = '2026-09-15T00:00:00.000Z'
) {
  const original = fixture().candidate;
  const legacyMaps = [original.primary, original.corroborating].map((observation) =>
    createAflTradeHpnPavFieldMap({
      environment: 'non_production',
      competition: 'AFLM',
      provider: observation.provider,
      capabilityId: observation.capabilityId,
      sourceSchemaSha256: 'c'.repeat(64),
      inputKind: 'player_match_stats',
      validFromSeason: 2018,
      validThroughSeason: 2018,
      approvalDecision: { id: `review-decision:${'d'.repeat(64)}`, sha256: 'd'.repeat(64) },
      bindings: {
        player: 'Player',
        match: 'Match',
        club: 'Club',
        totalPoints: { kind: 'goals_plus_behinds', goals: 'Goals', behinds: 'Behinds' },
        hitOuts: 'HO',
        goalAssists: 'GA',
        inside50s: 'I50',
        marks: 'M',
        marksInside50: 'MI50',
        freeKicksFor: 'FF',
        freeKicksAgainst: 'FA',
        rebound50s: 'R50',
        onePercenters: 'OP',
        clearances: 'Clearances',
        tackles: 'Tackles',
      },
    })
  );
  const maps = projected
    ? legacyMaps.map((legacy) => {
        if (legacy.content.inputKind !== 'player_match_stats')
          throw new Error('Expected player fixture.');
        const artifact = createAflTradeCanonicalJsonArtifactRef(
          { provider: legacy.content.provider },
          mapCreatedAt
        );
        const content = {
          schemaVersion: 'afl-trade-hpn-projected-field-map/v1',
          environment: 'non_production',
          purpose: 'private_confirmed_realized_hpn_pav',
          competition: 'AFLM',
          provider: legacy.content.provider,
          capabilityId: legacy.content.capabilityId,
          sourceSchemaSha256: legacy.content.sourceSchemaSha256,
          inputKind: 'player_match_stats',
          validFromSeason: 2018,
          validThroughSeason: 2018,
          candidateId: `hpn-field-map-candidate:${'e'.repeat(64)}`,
          candidateArtifact: artifact,
          approvalDecisionId: `hpn-field-map-review-decision:${'f'.repeat(64)}`,
          approvalDecisionArtifact: artifact,
          semanticBindings: Object.entries(legacy.content.bindings).map(
            ([semanticField, field]) => ({
              semanticField,
              mapping: typeof field === 'string' ? { kind: 'direct', sourceField: field } : field,
            })
          ),
          completionRule: null,
          createdAt: mapCreatedAt,
          publicationEligible: false,
          publicationProhibited: true,
          limitation:
            'Private non-production projection map only; it grants no factual release, model training, publication, production, activation, or live-capture authority.',
        };
        return aflTradeHpnProjectedFieldMapSchema.parse({
          fieldMapId: createAflTradeContentAddress('hpn-pav-field-map', content),
          content,
        });
      })
    : legacyMaps;
  // Unit-test the caller after the separately tested projected-map loader authenticates its map.
  if (projected)
    vi.spyOn(
      PostgresAflTradeHpnProjectedFieldMapAuthority.prototype,
      'loadCurrentExact'
    ).mockImplementation(async (id) => {
      const map = maps.find((candidate) => candidate.fieldMapId === id);
      return map ? aflTradeHpnProjectedFieldMapSchema.parse(map) : null;
    });
  const rows = [original.primary, original.corroborating].map((observation, index) => ({
    provider_decoded_row_id: observation.providerDecodedRowId,
    normalization_run_id: observation.normalizationRunId,
    capture_id: observation.captureId,
    competition: 'AFLM',
    season_year: 2018,
    row_status: 'staged',
    source_row_sha256: observation.sourceRowSha256,
    typed_payload: {
      values: {
        Clearances: { kind: 'integer', value: String(observation.value) },
        Club: { kind: 'text', value: 'HomeClub' },
        Goals: { kind: 'integer', value: String(index + 1) },
        Behinds: { kind: 'integer', value: '1' },
      },
    },
    recorded_at: '2026-09-15T01:00:00.000Z',
  }));
  const observations = [original.primary, original.corroborating].map((observation, index) => ({
    ...observation,
    typedPayloadSha256: sha256AflTradeCanonicalJson(rows[index].typed_payload),
    fieldMapId: maps[index].fieldMapId,
    fieldMapSha256: sha256AflTradeCanonicalJson(maps[index].content),
    sourceFields: statistic === 'totalPoints' ? ['Goals', 'Behinds'] : ['Clearances'],
    value: statistic === 'totalPoints' ? (index + 1) * 6 + 1 : observation.value,
  }));
  const { candidateId: _candidateId, ...originalBody } = original;
  const cell = createAflTradeHpnStatisticalCell({
    ...originalBody,
    scope: { ...original.scope, competitionId: 'AFLM', statistic },
    primary: observations[0],
    corroborating: observations[1],
  });
  const runs = observations.map((observation, index) => ({
    normalization_run_id: observation.normalizationRunId,
    capture_id: observation.captureId,
    source_snapshot_id: observation.sourceSnapshotId,
    source_artifact_id: observation.sourceArtifactId,
    capture_environment: 'non_production',
    capture_provider: observation.provider,
    capture_capability_id: observation.capabilityId,
    capture_status: projected ? 'staged' : 'approved',
    captured_at: '2026-09-15T00:00:00.000Z',
    finalized_at: '2026-09-15T02:00:00.000Z',
    staging_sha256: observation.stagingSha256,
    source_row_count: 1,
    accepted_row_count: 1,
    quarantined_row_count: 0,
    issue_count: 0,
    run_status: 'staged',
    capability_id: observation.capabilityId,
    source_schema_sha256: maps[index].content.sourceSchemaSha256,
  }));
  const resolution = (canonicalId: string) => {
    const id = createAflTradeContentAddress('provider-resolution-decision', { canonicalId });
    return {
      canonicalId,
      revision: 1,
      decisionId: id,
      assignmentDecisionId: id,
      assignmentStatus: 'active',
    };
  };
  const identities = observations.map(() => ({
    player_resolution: resolution(cell.scope.playerId),
    match_resolution: resolution(cell.scope.matchId),
    home_club_resolutions: [resolution(cell.scope.clubId)],
    away_club_resolutions: [resolution('opponent')],
    home_club_native_id: 'HomeClub',
    home_club_name: 'Home Name',
    away_club_native_id: 'AwayClub',
    away_club_name: 'Away Name',
    competition: 'AFLM',
    season_year: 2018,
    home_club_id: cell.scope.clubId,
    away_club_id: 'opponent',
  }));
  const state = {
    currentApproval: true,
    stagedAuthority: true,
    statisticalSupport: true,
    statisticalSource: true,
    rows,
    runs,
    identities,
  };
  const statements: string[] = [];
  const transaction: AflOutcomeSqlTransaction = {
    async query<Row>(sql: string, parameters?: readonly unknown[]) {
      statements.push(sql);
      let result: unknown[];
      if (sql.includes('AS checked_at'))
        result = [{ checked_at: new Date('2026-09-16T03:00:00Z') }];
      else if (sql.includes('AS authorized')) result = [{ authorized: state.statisticalSource }];
      else if (sql.includes('outcome_hpn_statistical_support_is_current'))
        result = [{ current: state.statisticalSupport }];
      else if (sql.includes('FROM jsonb_to_recordset')) result = state.runs;
      else if (sql.includes('pg_advisory_xact_lock')) result = [];
      else if (sql.includes('SELECT legacy.map_json'))
        result = [
          {
            legacy_map_json: projected
              ? null
              : maps.find((map) => map.fieldMapId === parameters?.[0]),
            current_approval: state.currentApproval,
          },
        ];
      else if (sql.includes('SELECT candidate.candidate_json')) result = [];
      else if (sql.includes('AS staged_source_authority'))
        result = [{ staged_source_authority: state.stagedAuthority }];
      else if (sql.includes('AS player_resolution')) {
        const index = state.rows.findIndex(
          (row) => row.provider_decoded_row_id === parameters?.[0]
        );
        result = index < 0 ? [] : [state.identities[index]];
      } else if (sql.includes('FROM outcome_provider_decoded_row')) result = state.rows;
      else throw new Error(`Unexpected SQL: ${sql}`);
      return { rows: result as Row[], rowCount: result.length };
    },
  };
  return { cell, state, transaction, statements, maps };
}
