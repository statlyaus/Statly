import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { aflTradeHpnProjectedFieldMapSchema } from '@/server/aflTradeIntelligence/modeling/hpnProjectedFieldMap';
import { PostgresAflTradeHpnProjectedFieldMapAuthority } from '@/server/aflTradeIntelligence/modeling/postgresHpnProjectedFieldMapAuthority';

afterEach(() => vi.restoreAllMocks());
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeHpnPavFieldMap } from '@/server/aflTradeIntelligence/modeling/hpnPavInputContracts';
import { createAflTradeHpnStatisticalCell } from '@/server/aflTradeIntelligence/modeling/hpnStatisticalAdjudication';
import { authenticateAflTradeHpnStatisticalSources } from '@/server/aflTradeIntelligence/modeling/postgresHpnStatisticalSourceAuthentication';
import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { fixture } from '../testUtils/hpnStatisticalAdjudicationFixture';

function setup(
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
  const state = { currentApproval: true, stagedAuthority: true, rows, runs };
  const statements: string[] = [];
  const transaction: AflOutcomeSqlTransaction = {
    async query<Row>(sql: string, parameters?: readonly unknown[]) {
      statements.push(sql);
      let result: unknown[];
      if (sql.includes('AS checked_at'))
        result = [{ checked_at: new Date('2026-09-16T03:00:00Z') }];
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
      else if (sql.includes('FROM outcome_provider_decoded_row')) result = state.rows;
      else throw new Error(`Unexpected SQL: ${sql}`);
      return { rows: result as Row[], rowCount: result.length };
    },
  };
  return { cell, state, transaction, statements };
}

describe('HPN retained source authentication', () => {
  it.each(['clearances', 'totalPoints'])(
    'authenticates staged projected %s through exact source authority',
    async (statistic) => {
      const f = setup(statistic, true);
      expect(await authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).toMatchObject({
        status: 'retained_sources_match',
      });
      expect(f.statements.filter((sql) => sql.includes('AS staged_source_authority'))).toHaveLength(
        2
      );
    }
  );
  it('rejects a projected map created after the candidate', async () => {
    const f = setup('clearances', true, '2026-09-16T02:00:00.000Z');
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'exact retained'
    );
  });
  it('rejects staged source authority withdrawal', async () => {
    const f = setup('clearances', true);
    f.state.stagedAuthority = false;
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'exact clean reviewed source'
    );
  });

  it.each(['clearances', 'totalPoints'])(
    'authenticates %s without granting decision authority',
    async (statistic) => {
      const f = setup(statistic);
      expect(await authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).toMatchObject({
        candidateId: f.cell.candidateId,
        status: 'retained_sources_match',
        calculationEligible: false,
        publicationEligible: false,
      });
      expect(
        f.statements.find((sql) => sql.includes('FROM outcome_provider_decoded_row'))
      ).toContain('FOR SHARE');
    }
  );
  it.each([
    'staging_sha256',
    'source_artifact_id',
    'capture_id',
    'source_snapshot_id',
    'capture_provider',
    'capture_capability_id',
  ])('rejects retained run drift: %s', async (field) => {
    const f = setup();
    Object.assign(f.state.runs[0], { [field]: 'changed' });
    await expect(
      authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)
    ).rejects.toThrow();
  });
  it.each([
    { season_year: 2019 },
    { competition: 'other' },
    { row_status: 'quarantined' },
    { normalization_run_id: 'wrong-run' },
    { source_row_sha256: 'f'.repeat(64) },
    { recorded_at: '2026-09-16T02:00:00Z' },
    { capture_id: 'wrong-capture' },
  ])('rejects retained row drift: %j', async (change) => {
    const f = setup();
    Object.assign(f.state.rows[0], change);
    await expect(
      authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)
    ).rejects.toThrow();
  });
  it('rejects missing source rows and superseded map approval', async () => {
    const f = setup();
    f.state.rows.pop();
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'Both exact'
    );
    f.state.currentApproval = false;
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'superseded'
    );
  });
  it('rejects changed values and source field substitution even with valid candidate hashes', async () => {
    const f = setup();
    for (const change of [{ value: 99 }, { sourceFields: ['Tackles'] }]) {
      const { candidateId: _id, ...body } = f.cell;
      const candidate = createAflTradeHpnStatisticalCell({
        ...body,
        primary: { ...body.primary, ...change },
      });
      await expect(
        authenticateAflTradeHpnStatisticalSources(f.transaction, candidate)
      ).rejects.toThrow('reviewed fields or retained value');
    }
  });
  it.each([
    { kind: 'missing' },
    { kind: 'integer', value: '9007199254740992' },
    { kind: 'integer', value: '-1' },
  ])('rejects missing or unsafe retained scalars: %j', async (scalar) => {
    const f = setup();
    Object.assign(f.state.rows[0].typed_payload.values, { Clearances: scalar });
    const { candidateId: _id, ...body } = f.cell;
    const candidate = createAflTradeHpnStatisticalCell({
      ...body,
      primary: {
        ...body.primary,
        typedPayloadSha256: sha256AflTradeCanonicalJson(f.state.rows[0].typed_payload),
      },
    });
    await expect(
      authenticateAflTradeHpnStatisticalSources(f.transaction, candidate)
    ).rejects.toThrow('measured safe');
  });
  it.each(['measured', 'blank_normalized_zero'] as const)(
    'does not accept unsupported zero provenance labelled %s',
    async (representation) => {
      const f = setup();
      f.state.rows[0].typed_payload.values.Clearances.value = '0';
      const { candidateId: _id, ...body } = f.cell;
      const candidate = createAflTradeHpnStatisticalCell({
        ...body,
        primary: {
          ...body.primary,
          typedPayloadSha256: sha256AflTradeCanonicalJson(f.state.rows[0].typed_payload),
          value: 0,
          representation,
        },
      });
      await expect(
        authenticateAflTradeHpnStatisticalSources(f.transaction, candidate)
      ).rejects.toThrow('governed representation');
    }
  );
  it('requires the retained run to exist when the candidate was created', async () => {
    const f = setup();
    f.state.runs[0].finalized_at = '2026-09-16T02:00:00Z';
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'exact retained'
    );
  });
});
