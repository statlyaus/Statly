import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFinalizedHpnPavCalculationService } from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { PostgresAflTradeHpnPavCalculationRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavCalculationRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeHpnPavSeasonInputSetSchema,
  createAflTradeHpnPavFieldMap,
} from '@/server/aflTradeIntelligence/modeling/hpnPavInputContracts';
import type { AflTradeHpnPavInputError } from '@/server/aflTradeIntelligence/modeling/hpnPavInputRepository';
import { aflTradeHpnProjectedFieldMapSchema } from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';
import { PostgresAflTradeHpnPavInputRepository } from '@/server/aflTradeIntelligence/modeling/postgresHpnPavInputRepository';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '@/server/aflTradeIntelligence/modeling/postgresHpnProjectedFieldMapAuthority';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const addressed = (prefix: string, value: string) => `${prefix}:${sha(value)}`;
const scalar = (value: string | number) =>
  typeof value === 'number' ? { kind: 'integer', value: String(value) } : { kind: 'text', value };
const decision = (value: string) => addressed('provider-resolution-decision', value);
const methodBytes = new TextEncoder().encode('<html><body>HPN PAV method</body></html>');
const method = createAflTradeHpnPavMethod({
  sourceArtifact: createAflTradeByteArtifactRef(
    methodBytes,
    'text/html',
    '2026-08-08T00:00:00.000Z'
  ),
  sourceBytes: methodBytes,
  capturedAt: '2026-08-08T00:00:00.000Z',
});
const resolution = (canonicalId: string, value: string) => ({
  canonicalId,
  revision: 1,
  decisionId: decision(value),
  assignmentDecisionId: decision(value),
  assignmentStatus: 'active',
});

function playerMap(provider: 'afl_tables' | 'footywire', suffix: string) {
  return createAflTradeHpnPavFieldMap({
    environment: 'test_fixture',
    competition: 'AFLM',
    provider,
    capabilityId: `${provider}-player-stats`,
    sourceSchemaSha256: sha(`schema:${suffix}`),
    inputKind: 'player_match_stats',
    validFromSeason: 1998,
    validThroughSeason: 2200,
    approvalDecision: {
      id: addressed('review-decision', `map:${suffix}`),
      sha256: sha(`map:${suffix}`),
    },
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

function resultMap() {
  return createAflTradeHpnPavFieldMap({
    environment: 'test_fixture',
    competition: 'AFLM',
    provider: 'official_afl',
    capabilityId: 'official-afl-results',
    sourceSchemaSha256: sha('schema:result'),
    inputKind: 'completed_match_result',
    validFromSeason: 1998,
    validThroughSeason: 2200,
    approvalDecision: {
      id: addressed('review-decision', 'map:result'),
      sha256: sha('map:result'),
    },
    bindings: {
      match: 'match_id',
      homeClub: 'home_team',
      awayClub: 'away_team',
      homePoints: 'home_points',
      awayPoints: 'away_points',
      completionStatus: 'status',
      completedValues: ['CONCLUDED'],
    },
  });
}

function projectedMap(
  fieldMap: ReturnType<typeof resultMap> | ReturnType<typeof playerMap>,
  suffix: string
) {
  const createdAt = '2026-08-09T00:00:00.000Z';
  const candidateArtifact = createAflTradeCanonicalJsonArtifactRef(
    { candidate: suffix },
    createdAt
  );
  const approvalDecisionArtifact = createAflTradeCanonicalJsonArtifactRef(
    { decision: suffix },
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
    candidateId: addressed('hpn-field-map-candidate', suffix),
    candidateArtifact,
    approvalDecisionId: addressed('hpn-field-map-review-decision', suffix),
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

interface FakeOptions {
  omitLastRow?: boolean;
  resultStatus?: string;
  factualStatus?: string;
  omitUniverseAppearance?: boolean;
  membershipDrift?: boolean;
  sourceMembershipDrift?: boolean;
  projectedMaps?: boolean;
}

class FakeHpnPavSqlClient implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  readonly maps;
  readonly resultRunId = addressed('provider-normalization-run', 'result-run');
  readonly primaryRunId = addressed('provider-normalization-run', 'primary-run');
  readonly corroboratingRunId = addressed('provider-normalization-run', 'corroborating-run');
  readonly factualRunId = addressed('factual-reconciliation-run', 'factual-run');
  storedInput: unknown | null = null;
  finalizedAt: string | null = null;
  storedMethod: unknown | null = null;
  storedMethodEnvironment: 'test_fixture' | 'non_production' | 'production' | null = null;
  storedCalculation: unknown | null = null;
  calculationFinalizedAt: string | null = null;
  calculationTeamCount = 0;
  calculationPlayerCount = 0;
  transactionTimestampReads = 0;

  constructor(private readonly options: FakeOptions = {}) {
    const legacyMaps = [
      resultMap(),
      playerMap('afl_tables', 'primary'),
      playerMap('footywire', 'corroborating'),
    ] as const;
    this.maps = options.projectedMaps
      ? legacyMaps.map((map, index) => projectedMap(map, `projected:${index}`))
      : legacyMaps;
  }

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.includes('pg_advisory_xact_lock')) return this.result([]);
    if (sql.includes('SELECT transaction_timestamp() AS created_at')) {
      const day = 10 + this.transactionTimestampReads;
      this.transactionTimestampReads += 1;
      return this.result([{ created_at: `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z` }]);
    }
    if (sql.includes("date_trunc('milliseconds',transaction_timestamp()) AS trusted_at")) {
      return this.result([{ trusted_at: '2026-08-10T00:01:00.000Z' }]);
    }
    if (sql.includes('FROM outcome_hpn_pav_method WHERE method_id')) {
      return this.result(
        this.storedMethod === null
          ? []
          : [{ method_json: this.storedMethod, environment: this.storedMethodEnvironment }]
      );
    }
    if (sql.includes('INSERT INTO outcome_hpn_pav_method')) {
      this.storedMethodEnvironment = parameters[2] as
        'test_fixture' | 'non_production' | 'production';
      this.storedMethod = JSON.parse(String(parameters.at(-1)));
      return this.result([]);
    }
    if (sql.includes('FROM outcome_hpn_pav_calculation calculation')) {
      return this.result(
        this.storedCalculation === null
          ? []
          : [
              {
                calculation_json: this.storedCalculation,
                finalized_at: this.calculationFinalizedAt,
                team_count: this.calculationTeamCount,
                player_count: this.calculationPlayerCount,
                actual_team_count: this.calculationTeamCount,
                actual_player_count: this.calculationPlayerCount,
              },
            ]
      );
    }
    if (sql.includes('INSERT INTO outcome_hpn_pav_calculation\n')) {
      this.storedCalculation = JSON.parse(String(parameters.at(-1)));
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_hpn_pav_calculation_team')) {
      this.calculationTeamCount = (JSON.parse(String(parameters[0])) as unknown[]).length;
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_hpn_pav_calculation_player')) {
      this.calculationPlayerCount = (JSON.parse(String(parameters[0])) as unknown[]).length;
      return this.result([]);
    }
    if (sql.includes("UPDATE outcome_hpn_pav_calculation SET status='finalized'")) {
      this.calculationFinalizedAt = '2026-08-10T00:01:00.000Z';
      return { rows: [] as Row[], rowCount: 1 };
    }
    if (sql.includes('FROM outcome_factual_reconciliation_run run')) {
      return this.result([
        {
          factual_run_id: this.factualRunId,
          policy_id: addressed('factual-reconciliation-policy', 'factual-policy'),
          input_set_sha256: sha('factual-input-set'),
          status: this.options.factualStatus ?? 'approved',
          conflict_count: 0,
          finalized_at: '2026-08-09T00:00:00.000Z',
        },
      ]);
    }
    if (sql.includes('FROM outcome_factual_reconciliation_match_input')) {
      return this.result([
        {
          fact_ids: [addressed('source-fact', 'match-universe:2025-final')],
          match_id: 'match:2025-final',
          effective_at: '2025-09-27T04:30:00.000Z',
          home_club_id: 'club:home',
          away_club_id: 'club:away',
        },
      ]);
    }
    if (sql.includes('FROM outcome_factual_reconciliation_appearance_input')) {
      const players = ['a1', 'a2', 'b1', 'b2'];
      const rows = players.map((player) => ({
        fact_ids: [addressed('source-fact', `appearance:${player}`)],
        match_id: 'match:2025-final',
        player_id: `player:${player}`,
        club_id: player.startsWith('a') ? 'club:home' : 'club:away',
      }));
      return this.result(this.options.omitUniverseAppearance ? rows.slice(0, -1) : rows);
    }
    if (sql.includes('JOIN outcome_acquisition_spell_version spell')) {
      const requested = JSON.parse(String(parameters[0])) as Array<{
        providerDecodedRowId: string;
        playerId: string;
        clubId: string;
      }>;
      return this.result(
        requested.map((row) => ({
          provider_decoded_row_id: row.providerDecodedRowId,
          spell_version_id: addressed('acquisition-spell-version', `${row.playerId}:${row.clubId}`),
          spell_id: `spell:${row.playerId}:${row.clubId}`,
          version: 1,
          player_id: row.playerId,
          club_id: row.clubId,
          start_event_version_id: `event-version:${row.playerId}:${row.clubId}`,
          start_asset_version_id: `asset-version:${row.playerId}:${row.clubId}`,
          start_date: '2025-01-01',
          end_date: null,
          end_reason: null,
          rule_id: 'spell-rule:v1',
          status: 'approved',
          supersedes_spell_version_id: null,
          recorded_at: '2025-01-01T00:00:00.000Z',
        }))
      );
    }
    if (
      sql.includes('FROM outcome_hpn_pav_input_set') &&
      sql.includes('WHERE environment=$1::"OutcomeEnvironment"')
    ) {
      return this.result(
        this.storedInput === null
          ? []
          : [{ input_set_json: this.storedInput, finalized_at: this.finalizedAt }]
      );
    }
    if (sql.includes('FROM outcome_hpn_pav_input_set input_set')) {
      if (this.storedInput === null) return this.result([]);
      const inputSet = aflTradeHpnPavSeasonInputSetSchema.parse(this.storedInput);
      const factualMatchCount = inputSet.content.factualUniverse.completedMatchFacts.reduce(
        (count, member) => count + member.factIds.length,
        0
      );
      const factualAppearanceCount = inputSet.content.factualUniverse.playerAppearanceFacts.reduce(
        (count, member) => count + member.factIds.length,
        0
      );
      return this.result([
        {
          input_set_json: inputSet,
          input_set_canonical_json: canonicalizeAflTradeJson(inputSet.content),
          input_set_sha256: sha256AflTradeCanonicalJson(inputSet.content),
          status: this.finalizedAt === null ? 'building' : 'finalized',
          finalized_at: this.finalizedAt,
          environment: inputSet.content.environment,
          competition: inputSet.content.competition,
          season_year: inputSet.content.seasonYear,
          method_id: inputSet.content.methodId,
          source_run_count: inputSet.content.sourceRuns.length,
          source_row_count: inputSet.content.rows.length,
          completed_match_count: inputSet.content.completedMatches.length,
          actual_source_run_count:
            inputSet.content.sourceRuns.length + (this.options.sourceMembershipDrift ? 1 : 0),
          actual_source_row_count: inputSet.content.rows.length,
          actual_completed_match_count: inputSet.content.completedMatches.length,
          factual_match_count: factualMatchCount,
          factual_appearance_count: factualAppearanceCount + (this.options.membershipDrift ? 1 : 0),
        },
      ]);
    }
    if (sql.includes('FROM outcome_hpn_pav_input_set WHERE input_set_id')) {
      return this.result(
        this.storedInput === null
          ? []
          : [{ input_set_json: this.storedInput, finalized_at: this.finalizedAt }]
      );
    }
    if (
      sql.includes('FROM jsonb_to_recordset($1::jsonb)') &&
      sql.includes('JOIN outcome_provider_normalization_run run')
    ) {
      const requested = JSON.parse(String(parameters[0])) as Array<{
        normalizationRunId: string;
        fieldMapId: string;
      }>;
      return this.result(
        requested.map((source) => {
          const map = this.maps.find(({ fieldMapId }) => fieldMapId === source.fieldMapId)!;
          const rowCount = source.normalizationRunId === this.resultRunId ? 1 : 4;
          return {
            normalization_run_id: source.normalizationRunId,
            capture_id: `capture:${map.content.provider}:2025`,
            source_snapshot_id: addressed('source-snapshot', `snapshot:${map.content.provider}`),
            source_artifact_id: addressed('artifact', `artifact:${map.content.provider}`),
            capture_environment: this.options.projectedMaps ? 'non_production' : 'test_fixture',
            capture_provider: map.content.provider,
            capture_capability_id: map.content.capabilityId,
            capture_status: 'approved',
            captured_at: '2025-09-27T00:00:00.000Z',
            finalized_at: '2026-08-09T00:00:00.000Z',
            staging_sha256: sha(`staging:${map.content.provider}`),
            source_row_count: rowCount,
            accepted_row_count: rowCount,
            quarantined_row_count: 0,
            issue_count: 0,
            run_status: 'staged',
            capability_id: map.content.capabilityId,
            source_schema_sha256: map.content.sourceSchemaSha256,
          };
        })
      );
    }
    if (sql.includes('SELECT legacy.map_json AS legacy_map_json')) {
      const fieldMapId = String(parameters[0]);
      const map = this.maps.find((candidate) => candidate.fieldMapId === fieldMapId);
      return this.result([
        {
          legacy_map_json:
            map?.content.schemaVersion === 'afl-trade-hpn-pav-field-map/v1' ? map : null,
        },
      ]);
    }
    if (sql.includes('SELECT candidate.candidate_json')) return this.result([]);
    if (sql.includes('FROM outcome_provider_decoded_row decoded')) {
      const rows = this.decodedRows();
      return this.result(this.options.omitLastRow ? rows.slice(0, -1) : rows);
    }
    if (sql.includes('INSERT INTO outcome_hpn_pav_input_set')) {
      this.storedInput = JSON.parse(String(parameters.at(-1)));
      return this.result([]);
    }
    if (sql.includes("UPDATE outcome_hpn_pav_input_set SET status='finalized'")) {
      this.finalizedAt = '2026-08-10T00:00:00.000Z';
      return this.result([]);
    }
    if (sql.includes('INSERT INTO outcome_hpn_pav_input_')) return this.result([]);
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  private result<Row>(rows: readonly unknown[]): AflOutcomeSqlQueryResult<Row> {
    return { rows: rows as readonly Row[], rowCount: rows.length };
  }

  private decodedRows() {
    const matchId = 'match:2025-final';
    const homeClubId = 'club:home';
    const awayClubId = 'club:away';
    const common = {
      row_status: 'staged',
      match_resolution: resolution(matchId, 'match'),
      home_club_resolutions: [resolution(homeClubId, 'home-club')],
      away_club_resolutions: [resolution(awayClubId, 'away-club')],
      native_match_id: 'provider-match-1',
      home_club_native_id: 'HOME',
      home_club_name: 'Home Club',
      away_club_native_id: 'AWAY',
      away_club_name: 'Away Club',
      canonical_match_date: '2025-09-27T04:30:00.000Z',
      canonical_home_club_id: homeClubId,
      canonical_away_club_id: awayClubId,
    };
    const resultPayload = {
      match_id: scalar('provider-match-1'),
      home_team: scalar('HOME'),
      away_team: scalar('AWAY'),
      home_points: scalar(100),
      away_points: scalar(80),
      status: scalar(this.options.resultStatus ?? 'CONCLUDED'),
    };
    const result = {
      ...common,
      provider_decoded_row_id: 'provider-row:result',
      normalization_run_id: this.resultRunId,
      source_row_sha256: sha('row:result'),
      typed_payload: resultPayload,
      player_resolution: null,
    };
    const players = ['a1', 'a2', 'b1', 'b2'];
    const playerRows = [this.primaryRunId, this.corroboratingRunId].flatMap(
      (runId, providerIndex) =>
        players.map((player, index) => {
          const home = player.startsWith('a');
          return {
            ...common,
            provider_decoded_row_id: `provider-row:${providerIndex}:${player}`,
            normalization_run_id: runId,
            source_row_sha256: sha(`row:${providerIndex}:${player}`),
            player_resolution: resolution(`player:${player}`, `player:${player}`),
            typed_payload: {
              player_id: scalar(`native:${player}`),
              match_id: scalar('provider-match-1'),
              team: scalar(home ? 'HOME' : 'AWAY'),
              goals: scalar(3),
              behinds: scalar(2 + index),
              hit_outs: scalar(index),
              goal_assists: scalar(1),
              inside_50s: scalar(10 + index),
              marks: scalar(5),
              marks_inside_50: scalar(1),
              free_kicks_for: scalar(2),
              free_kicks_against: scalar(1),
              rebound_50s: scalar(3),
              one_percenters: scalar(2),
              clearances: scalar(4),
              tackles: scalar(5),
            },
          };
        })
    );
    return [result, ...playerRows];
  }
}

function request(client: FakeHpnPavSqlClient) {
  return {
    environment: (client.maps[0]!.content.environment === 'non_production'
      ? 'non_production'
      : 'test_fixture') as 'test_fixture' | 'non_production',
    competition: 'AFLM' as const,
    seasonYear: 2025,
    methodId: method.methodId,
    factualRunId: client.factualRunId,
    effectiveThrough: '2025-09-27T23:59:59.000Z',
    sources: [
      {
        normalizationRunId: client.resultRunId,
        fieldMapId: client.maps[0]!.fieldMapId,
        inputKind: 'completed_match_result' as const,
        role: null,
      },
      {
        normalizationRunId: client.primaryRunId,
        fieldMapId: client.maps[1]!.fieldMapId,
        inputKind: 'player_match_stats' as const,
        role: 'primary' as const,
      },
      {
        normalizationRunId: client.corroboratingRunId,
        fieldMapId: client.maps[2]!.fieldMapId,
        inputKind: 'player_match_stats' as const,
        role: 'corroborating' as const,
      },
    ],
  };
}

describe('PostgresAflTradeHpnPavInputRepository', () => {
  it('builds and replays through the existing seam from approved projected maps', async () => {
    const client = new FakeHpnPavSqlClient({ projectedMaps: true });
    const repository = new PostgresAflTradeHpnPavInputRepository(client);
    const loadCurrentExact = vi
      .spyOn(PostgresAflTradeHpnProjectedFieldMapAuthority.prototype, 'loadCurrentExact')
      .mockImplementation(async (fieldMapId) => {
        const parsed = aflTradeHpnProjectedFieldMapSchema.safeParse(
          client.maps.find((map) => map.fieldMapId === fieldMapId)
        );
        return parsed.success ? parsed.data : null;
      });

    try {
      const first = await repository.buildAndPersistSeasonInputSet(request(client), {
        environment: 'non_production',
      });
      const replay = await repository.buildAndPersistSeasonInputSet(request(client), {
        environment: 'non_production',
      });

      expect(first.idempotentReplay).toBe(false);
      expect(replay).toEqual({ inputSet: first.inputSet, idempotentReplay: true });
      expect(first.inputSet.content.schemaVersion).toBe('afl-trade-hpn-pav-input-set/v2');
      expect(first.inputSet.content.fieldMaps).toEqual(
        [...client.maps].sort((left, right) => left.fieldMapId.localeCompare(right.fieldMapId))
      );
      expect(loadCurrentExact).toHaveBeenCalledTimes(3);
    } finally {
      loadCurrentExact.mockRestore();
    }
  });

  it('derives, persists, and exactly replays a complete cross-provider season input set', async () => {
    const client = new FakeHpnPavSqlClient();
    const repository = new PostgresAflTradeHpnPavInputRepository(client);

    const first = await repository.buildAndPersistSeasonInputSet(request(client), {
      environment: 'test_fixture',
    });
    const replay = await repository.buildAndPersistSeasonInputSet(request(client), {
      environment: 'test_fixture',
    });

    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(client.transactionTimestampReads).toBe(1);
    expect(first.inputSet.content.counts).toEqual({
      completedMatches: 1,
      resultRows: 1,
      primaryPlayerRows: 4,
      corroboratingPlayerRows: 4,
    });
    expect(
      first.inputSet.content.rows.find((row) => row.kind === 'completed_match_result')
    ).toMatchObject({
      completionStatus: 'completed',
      homePoints: 100,
      awayPoints: 80,
    });
  });

  it('rejects a strict subset of finalized source rows', async () => {
    const client = new FakeHpnPavSqlClient({ omitLastRow: true });
    const repository = new PostgresAflTradeHpnPavInputRepository(client);
    await expect(
      repository.buildAndPersistSeasonInputSet(request(client), { environment: 'test_fixture' })
    ).rejects.toMatchObject({ code: 'INCOMPLETE_SOURCE_ROWS' });
  });

  it('loads only the exact finalized durable input set', async () => {
    const client = new FakeHpnPavSqlClient();
    const repository = new PostgresAflTradeHpnPavInputRepository(client);
    const persisted = await repository.buildAndPersistSeasonInputSet(request(client), {
      environment: 'test_fixture',
    });

    await expect(
      repository.loadFinalizedSeasonInputSet(
        {
          inputSetId: persisted.inputSet.inputSetId,
          environment: 'test_fixture',
          competition: 'AFLM',
          seasonYear: 2025,
          methodId: request(client).methodId,
        },
        { environment: 'test_fixture' }
      )
    ).resolves.toEqual(persisted.inputSet);

    client.finalizedAt = null;
    await expect(
      repository.loadFinalizedSeasonInputSet(
        {
          inputSetId: persisted.inputSet.inputSetId,
          environment: 'test_fixture',
          competition: 'AFLM',
          seasonYear: 2025,
          methodId: request(client).methodId,
        },
        { environment: 'test_fixture' }
      )
    ).rejects.toMatchObject({ code: 'INPUT_SET_NOT_FINALIZED' });
  });

  it('rejects finalized input whose durable membership count has drifted', async () => {
    const client = new FakeHpnPavSqlClient({ membershipDrift: true });
    const repository = new PostgresAflTradeHpnPavInputRepository(client);
    const persisted = await repository.buildAndPersistSeasonInputSet(request(client), {
      environment: 'test_fixture',
    });
    await expect(
      repository.loadFinalizedSeasonInputSet(
        {
          inputSetId: persisted.inputSet.inputSetId,
          environment: 'test_fixture',
          competition: 'AFLM',
          seasonYear: 2025,
          methodId: request(client).methodId,
        },
        { environment: 'test_fixture' }
      )
    ).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' });
  });

  it('rejects finalized input whose durable source membership count has drifted', async () => {
    const client = new FakeHpnPavSqlClient({ sourceMembershipDrift: true });
    const repository = new PostgresAflTradeHpnPavInputRepository(client);
    const persisted = await repository.buildAndPersistSeasonInputSet(request(client), {
      environment: 'test_fixture',
    });
    await expect(
      repository.loadFinalizedSeasonInputSet(
        {
          inputSetId: persisted.inputSet.inputSetId,
          environment: 'test_fixture',
          competition: 'AFLM',
          seasonYear: 2025,
          methodId: request(client).methodId,
        },
        { environment: 'test_fixture' }
      )
    ).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' });
  });

  it('calculates only from the finalized repository input and exact retained method', async () => {
    const client = new FakeHpnPavSqlClient();
    const repository = new PostgresAflTradeHpnPavInputRepository(client);
    const persisted = await repository.buildAndPersistSeasonInputSet(request(client), {
      environment: 'test_fixture',
    });
    const service = createAflTradeFinalizedHpnPavCalculationService({
      inputRepository: repository,
      methodAuthority: {
        loadExact: async () => ({ method, sourceBytes: methodBytes }),
      },
      clock: { now: () => '2026-08-10T00:01:00.000Z' },
    });

    const calculation = await service.calculate(
      {
        inputSetId: persisted.inputSet.inputSetId,
        environment: 'test_fixture',
        competition: 'AFLM',
        seasonYear: 2025,
        methodId: method.methodId,
      },
      { environment: 'test_fixture' }
    );

    expect(calculation.content.inputSetId).toBe(persisted.inputSet.inputSetId);
    expect(calculation.content.inputSetSha256).toBe(
      persisted.inputSet.inputSetId.replace('hpn-pav-input-set:', '')
    );
    expect(calculation.content.league.totalPav).toBe(600);
    expect(calculation.content.players).toHaveLength(4);
    expect(calculation.content.teams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          teamId: 'club:home',
          source: expect.objectContaining({ inside50sFor: 21, inside50sAgainst: 25 }),
        }),
      ])
    );
  });

  it('atomically persists, exactly replays, and reloads the finalized PAV calculation', async () => {
    const client = new FakeHpnPavSqlClient();
    const inputRepository = new PostgresAflTradeHpnPavInputRepository(client);
    const persistedInput = await inputRepository.buildAndPersistSeasonInputSet(request(client), {
      environment: 'test_fixture',
    });
    const repository = new PostgresAflTradeHpnPavCalculationRepository(client, {
      loadExact: async () => ({ method, sourceBytes: methodBytes }),
    });
    const calculationRequest = {
      inputSetId: persistedInput.inputSet.inputSetId,
      environment: 'test_fixture' as const,
      competition: 'AFLM' as const,
      seasonYear: 2025,
      methodId: method.methodId,
    };

    const first = await repository.calculateAndPersist(calculationRequest, {
      environment: 'test_fixture',
    });
    const replay = await repository.calculateAndPersist(calculationRequest, {
      environment: 'test_fixture',
    });
    const loaded = await repository.loadFinalizedCalculation(
      { calculationId: first.calculation.calculationId, environment: 'test_fixture' },
      { environment: 'test_fixture' }
    );

    expect(first.idempotentReplay).toBe(false);
    expect(replay).toEqual({ calculation: first.calculation, idempotentReplay: true });
    expect(loaded).toEqual(first.calculation);
    expect(first.calculation.content.players).toHaveLength(4);
    expect(client.calculationTeamCount).toBe(2);
    expect(client.calculationPlayerCount).toBe(4);
  });

  it('rejects method replay across execution environments', async () => {
    const client = new FakeHpnPavSqlClient();
    const repository = new PostgresAflTradeHpnPavCalculationRepository(client, {
      loadExact: async () => ({ method, sourceBytes: methodBytes }),
    });

    await repository.registerMethod(method, { environment: 'test_fixture' });

    await expect(
      repository.registerMethod(method, { environment: 'production' })
    ).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' });
  });

  it('rejects an unreviewed terminal-status token', async () => {
    const client = new FakeHpnPavSqlClient({ resultStatus: 'POSTPONED' });
    const repository = new PostgresAflTradeHpnPavInputRepository(client);
    await expect(
      repository.buildAndPersistSeasonInputSet(request(client), { environment: 'test_fixture' })
    ).rejects.toMatchObject({ code: 'INCOMPLETE_SOURCE_ROWS' });
  });

  it('rejects stale or incomplete factual-universe authority', async () => {
    const stale = new FakeHpnPavSqlClient({ factualStatus: 'withdrawn' });
    await expect(
      new PostgresAflTradeHpnPavInputRepository(stale).buildAndPersistSeasonInputSet(
        request(stale),
        { environment: 'test_fixture' }
      )
    ).rejects.toMatchObject({ code: 'FACTUAL_UNIVERSE_MISMATCH' });

    const incomplete = new FakeHpnPavSqlClient({ omitUniverseAppearance: true });
    await expect(
      new PostgresAflTradeHpnPavInputRepository(incomplete).buildAndPersistSeasonInputSet(
        request(incomplete),
        { environment: 'test_fixture' }
      )
    ).rejects.toMatchObject({ code: 'FACTUAL_UNIVERSE_MISMATCH' });
  });

  it('rejects execution in another environment before reading SQL', async () => {
    const client = new FakeHpnPavSqlClient();
    const repository = new PostgresAflTradeHpnPavInputRepository(client);
    const expectedError = {
      code: 'ENVIRONMENT_MISMATCH',
    } satisfies Pick<AflTradeHpnPavInputError, 'code'>;

    await expect(
      repository.buildAndPersistSeasonInputSet(request(client), { environment: 'production' })
    ).rejects.toMatchObject(expectedError);
  });

  it('rejects conflicting durable replay content', async () => {
    const client = new FakeHpnPavSqlClient();
    const repository = new PostgresAflTradeHpnPavInputRepository(client);
    await repository.buildAndPersistSeasonInputSet(request(client), {
      environment: 'test_fixture',
    });
    client.storedInput = { corrupted: true };
    await expect(
      repository.buildAndPersistSeasonInputSet(request(client), { environment: 'test_fixture' })
    ).rejects.toMatchObject({ code: 'REPLAY_CONFLICT' });
  });
});
