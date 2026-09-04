import { describe, expect, it, vi } from 'vitest';

import { aflTradeSourceSnapshotManifestContentSchema } from '@/server/aflTradeIntelligence/artifacts/sourceSnapshotManifest';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFitzRoyFieldMapSha256 } from '@/server/aflTradeIntelligence/source/fitzRoyObservationContracts';
import {
  AFL_TRADE_FITZROY_DECODED_TABLE_SCHEMA_VERSION,
  AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
  assertAflTradeFitzRoyFieldMapMatchesTable,
  createDecodedFieldSchemaSha256,
  parseAflTradeFitzRoyDecodedTable,
  parseAflTradeFitzRoyFieldMap,
  type AflTradeDecodedScalar,
  type AflTradeFitzRoyFieldMap,
} from '@/server/aflTradeIntelligence/source/fitzRoyObservationContracts';
import { normalizeAflTradeFitzRoyDecodedTable as normalizeAflTradeFitzRoyDecodedTableRaw } from '@/server/aflTradeIntelligence/source/fitzRoyObservationNormalizer';
import {
  AflTradeProviderObservationPersistenceError,
  PostgresAflTradeProviderObservationRepository,
} from '@/server/aflTradeIntelligence/source/postgresProviderObservationRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const digest = (character: string) => character.repeat(64);
const fields = [
  { name: 'season', storageType: 'integer', classes: ['integer'], levels: null, timezone: null },
  {
    name: 'match_id',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'player_id',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'player_name',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'player_surname',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'observed_at',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  { name: 'home', storageType: 'character', classes: ['character'], levels: null, timezone: null },
  { name: 'away', storageType: 'character', classes: ['character'], levels: null, timezone: null },
  { name: 'round', storageType: 'character', classes: ['character'], levels: null, timezone: null },
  { name: 'goals', storageType: 'integer', classes: ['integer'], levels: null, timezone: null },
];

const integer = (value: number): AflTradeDecodedScalar => ({
  kind: 'integer',
  value: String(value),
});
const text = (value: string): AflTradeDecodedScalar => ({ kind: 'text', value });

function sourceRow(input: {
  playerId: string;
  playerName: string | null;
  playerSurname?: string | null;
  observedAt?: string;
  home?: string;
  away?: string;
  goals?: AflTradeDecodedScalar;
}): AflTradeDecodedScalar[] {
  return [
    integer(2026),
    text('provider-match-1'),
    text(input.playerId),
    input.playerName === null ? { kind: 'missing' } : text(input.playerName),
    input.playerSurname == null ? { kind: 'missing' } : text(input.playerSurname),
    text(input.observedAt ?? '2026-03-08T02:15:00Z'),
    text(input.home ?? 'Carlton'),
    text(input.away ?? 'Fremantle'),
    text('Round 1'),
    input.goals ?? integer(0),
  ];
}

function decodedTable(
  rows: AflTradeDecodedScalar[][],
  capabilityId = 'official-afl-player-stats',
  overrides: Record<string, unknown> = {}
) {
  return parseAflTradeFitzRoyDecodedTable({
    schemaVersion: AFL_TRADE_FITZROY_DECODED_TABLE_SCHEMA_VERSION,
    captureReceiptSha256: digest('a'),
    capabilityId,
    fitzRoyVersion: '1.7.0',
    authorizationCompetition: 'AFLM',
    authorizationSeason: 2026,
    invocationSha256: digest('b'),
    invocationArgumentsSha256: digest('c'),
    diagnosticsSha256: digest('d'),
    sourceRdsSha256: digest('e'),
    sourceSchemaSha256: createDecodedFieldSchemaSha256(fields),
    decoderRuntime: {
      decoderVersion: 'afl-trade-fitzroy-rds-decoder/v1',
      rVersion: '4.5.1',
      dependencyLockSha256: digest('f'),
      imageDigest: `sha256:${digest('1')}`,
    },
    frame: { classes: ['data.frame'], rowNames: rows.map((_, index) => String(index + 1)) },
    fields,
    rows,
    ...overrides,
  });
}

function fieldMap(overrides: Partial<AflTradeFitzRoyFieldMap> = {}) {
  return parseAflTradeFitzRoyFieldMap({ ...baseFieldMap(), ...overrides });
}

function normalizeAflTradeFitzRoyDecodedTable(
  input: Omit<Parameters<typeof normalizeAflTradeFitzRoyDecodedTableRaw>[0], 'decodedSha256'>
) {
  return normalizeAflTradeFitzRoyDecodedTableRaw({ ...input, decodedSha256: digest('8') });
}

function authenticatedManifestFixture() {
  const invocationArguments = { season: 2026, roundNumber: null };
  const captureReceipt = {
    captureReceiptId: 'fitzroy-capture:fixture',
    content: {
      invocation: {
        capabilityId: 'official-afl-player-stats',
        fitzRoyVersion: '1.7.0',
        provider: 'official_afl',
        arguments: invocationArguments,
      },
      authorizationReceipt: {
        content: { request: { competition: 'AFLM', season: 2026 } },
      },
      invocationCustody: { artifact: { contentSha256: digest('b') } },
      diagnosticsCustody: { artifact: { contentSha256: digest('d') } },
      sourceCustody: { artifact: { contentSha256: digest('e') } },
      schemaFingerprint: `sha256:${createDecodedFieldSchemaSha256(fields)}`,
    },
  };
  return {
    captureReceipt,
    captureReceiptSha256: sha256AflTradeCanonicalJson(captureReceipt),
    invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocationArguments),
    parsedManifest: {
      capture: {
        kind: 'fitzroy',
        upstreamProvider: 'Official AFL data via fitzRoy',
        packageVersion: '1.7.0',
      },
      fitzRoyCaptureReceipt: captureReceipt,
    },
  };
}

function baseFieldMap(): AflTradeFitzRoyFieldMap {
  return parseAflTradeFitzRoyFieldMap({
    schemaVersion: AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
    mapId: 'official-afl-player-stats-fixture-map',
    capabilityId: 'official-afl-player-stats',
    fitzRoyVersion: '1.7.0',
    sourceSchemaSha256: createDecodedFieldSchemaSha256(fields),
    exactOrderedFields: fields.map(({ name }) => name),
    observationKind: 'player_stat',
    competition: 'AFLM',
    invocationArgumentsSha256: digest('c'),
    validFromSeason: 2026,
    validThroughSeason: 2026,
    seasonField: { sourceField: 'season', required: true },
    roundLabelField: { sourceField: 'round', required: true },
    observedDateField: null,
    naturalKeyFields: ['match_id', 'player_id'],
    approvedAt: '2026-08-07T00:00:00.000Z',
    approvalDecisionId: 'fixture-field-map-decision',
    identity: {
      nativeId: { sourceField: 'player_id', required: true },
      recordedName: { sourceField: 'player_name', required: true },
      recordedClubNativeId: null,
      recordedClubName: null,
    },
    match: {
      nativeMatchId: { sourceField: 'match_id', required: true },
      season: { sourceField: 'season', required: true },
      roundLabel: { sourceField: 'round', required: true },
      matchDate: null,
      homeClubNativeId: null,
      homeClubName: { sourceField: 'home', required: true },
      awayClubNativeId: null,
      awayClubName: { sourceField: 'away', required: true },
      status: null,
    },
    metrics: [
      {
        metricCode: 'goals',
        sourceField: 'goals',
        definitionVersion: 'goals/v1',
        unit: 'goals',
        zeroSemantics: 'measured_zero',
      },
    ],
    achievement: null,
  });
}

describe('fitzRoy provider observation staging', () => {
  it('retains every row and does not mistake repeated match context for a duplicate', () => {
    const result = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable([
        sourceRow({ playerId: 'p1', playerName: 'Player One' }),
        sourceRow({ playerId: 'p2', playerName: 'Player Two', goals: integer(2) }),
      ]),
      fieldMap: fieldMap(),
    });

    expect(result.rows).toHaveLength(2);
    expect(result.issues).toEqual([]);
    expect(result.rows.every(({ appearanceCandidate }) => appearanceCandidate)).toBe(true);
    expect(result.rows[0]?.matchCandidate?.orderIndependentSha256).toBe(
      result.rows[1]?.matchCandidate?.orderIndependentSha256
    );
    expect(result.rows[0]?.semanticNaturalKeySha256).not.toBe(
      result.rows[1]?.semanticNaturalKeySha256
    );
    expect(result.receipt.publicationEligible).toBe(false);
    expect(result.receipt.canonicalIdentityResolutionPerformed).toBe(false);
  });

  it('creates the same unresolved match fingerprint when club order is reversed', () => {
    const first = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable([sourceRow({ playerId: 'p1', playerName: 'Player One' })]),
      fieldMap: fieldMap(),
    });
    const reversed = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable([
        sourceRow({
          playerId: 'p1',
          playerName: 'Player One',
          home: 'Fremantle',
          away: 'Carlton',
        }),
      ]),
      fieldMap: fieldMap(),
    });

    expect(first.rows[0]?.matchCandidate?.resolutionState).toBe('unresolved');
    expect(first.rows[0]?.matchCandidate?.orderIndependentSha256).toBe(
      reversed.rows[0]?.matchCandidate?.orderIndependentSha256
    );
  });

  it('preserves an invalid row and marks it for review instead of dropping it', () => {
    const result = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable([sourceRow({ playerId: 'p1', playerName: null })]),
      fieldMap: fieldMap(),
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.rowStatus).toBe('needs_review');
    expect(result.rows[0]?.identityCandidate).toBeNull();
    expect(result.rows[0]?.typedPayload.player_name).toEqual({ kind: 'missing' });
    expect(result.receipt.quarantinedRowCount).toBe(1);
  });

  it('distinguishes measured zero, missing, and invalid non-finite metric evidence', () => {
    const result = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable([
        sourceRow({ playerId: 'p1', playerName: 'One', goals: integer(0) }),
        sourceRow({ playerId: 'p2', playerName: 'Two', goals: { kind: 'missing' } }),
        sourceRow({ playerId: 'p3', playerName: 'Three', goals: { kind: 'nan' } }),
      ]),
      fieldMap: fieldMap(),
    });

    expect(result.rows[0]?.metricCandidates[0]).toMatchObject({
      availability: 'exact',
      numericValue: '0',
    });
    expect(result.rows[1]?.metricCandidates[0]).toMatchObject({
      availability: 'missing',
      numericValue: null,
    });
    expect(result.rows[2]?.metricCandidates[0]).toMatchObject({
      availability: 'quarantined',
      numericValue: null,
    });
  });

  it('parses only explicitly reviewed integer-text metrics', () => {
    const integerTextMap = fieldMap({
      capabilityId: 'aflca-coaches-votes',
      mapId: 'aflca-coaches-votes-fixture-map',
      metrics: [
        {
          metricCode: 'coaches_votes',
          sourceField: 'goals',
          definitionVersion: 'coaches-votes/v1',
          unit: 'votes',
          zeroSemantics: 'measured_zero',
          sourceRepresentation: 'integer_text',
        },
      ],
    });
    const result = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable(
        [
          sourceRow({ playerId: 'p1', playerName: 'One', goals: text('7') }),
          sourceRow({ playerId: 'p2', playerName: 'Two', goals: text('7.5') }),
        ],
        'aflca-coaches-votes'
      ),
      fieldMap: integerTextMap,
    });

    expect(result.rows[0]?.metricCandidates[0]).toMatchObject({
      metricCode: 'coaches_votes',
      availability: 'exact',
      numericValue: '7',
    });
    expect(result.rows[1]?.metricCandidates[0]).toMatchObject({
      metricCode: 'coaches_votes',
      availability: 'quarantined',
      numericValue: null,
      missingReason: 'invalid_text',
    });
  });

  it('rejects an AFL Tables map that claims returned zeros are measured', () => {
    const table = decodedTable(
      [sourceRow({ playerId: 'p1', playerName: 'One' })],
      'afl-tables-player-stats'
    );
    const map = fieldMap({
      capabilityId: 'afl-tables-player-stats',
      mapId: 'afl-tables-player-stats-fixture-map',
    });

    expect(() => assertAflTradeFitzRoyFieldMapMatchesTable({ table, fieldMap: map })).toThrow(
      /zero values must remain quarantinable/
    );
  });

  it('rejects schema, invocation-mode, and competition relabelling', () => {
    const table = decodedTable([sourceRow({ playerId: 'p1', playerName: 'One' })]);
    expect(() =>
      assertAflTradeFitzRoyFieldMapMatchesTable({
        table,
        fieldMap: fieldMap({ invocationArgumentsSha256: digest('9') }),
      })
    ).toThrow(/competition/);
    expect(() =>
      parseAflTradeFitzRoyDecodedTable({
        ...table,
        sourceSchemaSha256: digest('9'),
      })
    ).toThrow(/schema fingerprint/);
  });

  it('detects duplicates using the reviewed provider natural key', () => {
    const duplicate = sourceRow({ playerId: 'p1', playerName: 'Player One' });
    const result = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable([duplicate, duplicate]),
      fieldMap: fieldMap(),
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows.every(({ rowStatus }) => rowStatus === 'needs_review')).toBe(true);
    expect(result.issues.filter(({ code }) => code === 'duplicate_natural_key')).toHaveLength(2);
  });

  it('quarantines rows missing a required provider identifier and natural-key component', () => {
    for (const invalid of [{ kind: 'missing' }, { kind: 'nan' }] as const) {
      const row = sourceRow({ playerId: 'p1', playerName: 'Player One' });
      row[2] = invalid;
      const result = normalizeAflTradeFitzRoyDecodedTable({
        table: decodedTable([row]),
        fieldMap: fieldMap(),
      });

      expect(result.rows[0]?.rowStatus).toBe('needs_review');
      expect(result.issues.map(({ code }) => code)).toEqual(
        expect.arrayContaining(['required_field_missing', 'natural_key_component_missing'])
      );
    }
  });

  it('supports reviewed identity-only player-detail rows without inventing a season field', () => {
    const map = fieldMap({
      mapId: 'official-afl-player-details-fixture-map',
      capabilityId: 'official-afl-player-details',
      observationKind: 'player_identity',
      seasonField: null,
      roundLabelField: null,
      naturalKeyFields: ['player_id'],
      match: null,
      metrics: [],
    });
    const result = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable(
        [sourceRow({ playerId: 'p1', playerName: 'Player One' })],
        'official-afl-player-details'
      ),
      fieldMap: map,
    });

    expect(result.rows[0]).toMatchObject({
      rowStatus: 'staged',
      observedSeasonText: null,
      matchCandidate: null,
      metricCandidates: [],
    });
    expect(result.rows[0]?.identityCandidate).not.toBeNull();
  });

  it('uses the authorized official season and composes split official player names', () => {
    const map = fieldMap({
      seasonField: null,
      observedDateField: { sourceField: 'observed_at', required: true },
      identity: {
        nativeId: { sourceField: 'player_id', required: true },
        recordedName: { sourceField: 'player_name', required: true },
        recordedSurname: { sourceField: 'player_surname', required: true },
        recordedClubNativeId: null,
        recordedClubName: null,
      },
    });
    const result = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable([
        sourceRow({ playerId: 'CD_I1000074', playerName: 'Sam', playerSurname: 'Flanders' }),
      ]),
      fieldMap: map,
    });

    expect(result.rows[0]).toMatchObject({
      seasonYear: 2026,
      observedSeasonText: null,
      rowStatus: 'staged',
      identityCandidate: { recordedName: 'Sam Flanders' },
    });

    const wrongSeason = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable([
        sourceRow({
          playerId: 'CD_I1000074',
          playerName: 'Sam',
          playerSurname: 'Flanders',
          observedAt: '2025-03-08T02:15:00Z',
        }),
      ]),
      fieldMap: map,
    });
    expect(wrongSeason.rows[0]?.rowStatus).toBe('needs_review');
    expect(wrongSeason.issues).toContainEqual(
      expect.objectContaining({ code: 'source_season_mismatch', field: 'observed_at' })
    );
  });

  it('versions interpreted row and candidate identities by the exact approved field map', () => {
    const table = decodedTable([sourceRow({ playerId: 'p1', playerName: 'Player One' })]);
    const first = normalizeAflTradeFitzRoyDecodedTable({ table, fieldMap: fieldMap() });
    const corrected = normalizeAflTradeFitzRoyDecodedTable({
      table,
      fieldMap: fieldMap({
        mapId: 'official-afl-player-stats-corrected-map',
        approvalDecisionId: 'fixture-field-map-corrected-decision',
      }),
    });

    expect(first.rows[0]?.sourceRowSha256).toBe(corrected.rows[0]?.sourceRowSha256);
    expect(first.rows[0]?.providerDecodedRowId).not.toBe(corrected.rows[0]?.providerDecodedRowId);
    expect(first.rows[0]?.identityCandidate?.candidateId).not.toBe(
      corrected.rows[0]?.identityCandidate?.candidateId
    );
  });
});

describe('PostgreSQL provider observation staging', () => {
  it('binds failure evidence to the exact authenticated capture receipt', async () => {
    const authenticatedManifest = authenticatedManifestFixture();
    const manifestSpy = vi
      .spyOn(aflTradeSourceSnapshotManifestContentSchema, 'safeParse')
      .mockReturnValue({
        success: true,
        data: authenticatedManifest.parsedManifest,
      } as never);
    const transaction: AflOutcomeSqlTransaction = {
      async query<Row>(sql: string) {
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
        if (sql.includes('SELECT manifest_json FROM outcome_source_capture')) {
          return { rows: [{ manifest_json: { fixture: true } }] as Row[], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO outcome_provider_normalization_attempt')) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected normalization-failure SQL: ${sql}`);
      },
    };
    const client: AflOutcomeSqlClient = {
      query: transaction.query,
      transaction: async <T>(work: (scope: AflOutcomeSqlTransaction) => Promise<T>) =>
        work(transaction),
    };
    const repository = new PostgresAflTradeProviderObservationRepository(client);
    const request = {
      captureId: 'fitzroy-capture-fixture',
      fieldMapId: null,
      failureCode: 'decoder_failed' as const,
      publicSafeReason: 'Fixture decoder failure.',
      captureReceiptSha256: authenticatedManifest.captureReceiptSha256,
      startedAt: '2026-08-07T00:00:00.000Z',
      completedAt: '2026-08-07T00:00:01.000Z',
    };

    await expect(repository.recordFailure(request)).resolves.toMatch(
      /^provider-normalization-attempt:/
    );
    await expect(
      repository.recordFailure({ ...request, captureReceiptSha256: digest('9') })
    ).rejects.toMatchObject({ code: 'CAPTURE_MISMATCH' });
    manifestSpy.mockRestore();
  });

  it('writes only provider staging rows and replays content-identically across retry timestamps', async () => {
    const authenticatedManifest = authenticatedManifestFixture();
    const manifestSpy = vi
      .spyOn(aflTradeSourceSnapshotManifestContentSchema, 'safeParse')
      .mockReturnValue({
        success: true,
        data: authenticatedManifest.parsedManifest,
      } as never);
    const map = fieldMap({
      invocationArgumentsSha256: authenticatedManifest.invocationArgumentsSha256,
    });
    const batch = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable(
        [sourceRow({ playerId: 'p1', playerName: 'Player One' })],
        'official-afl-player-stats',
        {
          captureReceiptSha256: authenticatedManifest.captureReceiptSha256,
          invocationArgumentsSha256: authenticatedManifest.invocationArgumentsSha256,
        }
      ),
      fieldMap: map,
    });
    let run:
      | {
          normalization_run_id: string;
          decoded_sha256: string;
          receipt_sha256: string;
          staging_sha256: string;
          normalizer_version: string;
          source_row_count: number;
          issue_count: number;
          identity_candidate_count: number;
          match_candidate_count: number;
          metric_candidate_count: number;
          achievement_candidate_count: number;
          status: 'staged' | 'needs_review';
          finalized_at: string | null;
        }
      | undefined;
    const executedSql: string[] = [];
    const transaction: AflOutcomeSqlTransaction = {
      async query<Row>(sql: string, parameters: readonly unknown[] = []) {
        executedSql.push(sql);
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
        if (sql.includes('FROM outcome_source_capture capture')) {
          return {
            rows: [
              {
                provider: 'Official AFL data via fitzRoy',
                manifest_json: { fixture: true },
                capability_id: 'official-afl-player-stats',
                competition: 'AFLM',
                status: 'approved',
                content_sha256: digest('e'),
                field_capability_id: 'official-afl-player-stats',
                field_fitzroy_version: '1.7.0',
                source_schema_sha256: createDecodedFieldSchemaSha256(fields),
                field_map_sha256: createAflTradeFitzRoyFieldMapSha256(map),
                field_map_approval_current: true,
                map_json: map,
              },
            ] as Row[],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT EXISTS')) {
          return { rows: [{ found: true }] as Row[], rowCount: 1 };
        }
        if (sql.includes('FROM outcome_provider_normalization_run') && sql.includes('FOR SHARE')) {
          return { rows: (run === undefined ? [] : [run]) as Row[], rowCount: run ? 1 : 0 };
        }
        if (sql.startsWith('INSERT INTO outcome_provider_normalization_run')) {
          run = {
            normalization_run_id: String(parameters[0]),
            normalizer_version: String(parameters[4]),
            decoded_sha256: String(parameters[6]),
            receipt_sha256: String(parameters[7]),
            staging_sha256: String(parameters[8]),
            source_row_count: Number(parameters[10]),
            issue_count: Number(parameters[13]),
            identity_candidate_count: Number(parameters[14]),
            match_candidate_count: Number(parameters[15]),
            metric_candidate_count: Number(parameters[16]),
            achievement_candidate_count: Number(parameters[17]),
            status: parameters[9] as 'staged' | 'needs_review',
            finalized_at: null,
          };
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE outcome_provider_normalization_run')) {
          if (run !== undefined) run.finalized_at = String(parameters[1]);
          return { rows: [], rowCount: run === undefined ? 0 : 1 };
        }
        if (sql.startsWith('INSERT INTO outcome_provider_')) {
          return { rows: [], rowCount: Array.isArray(parameters[0]) ? parameters[0].length : 1 };
        }
        throw new Error(`Unexpected provider staging SQL: ${sql}`);
      },
    };
    const client: AflOutcomeSqlClient = {
      query: transaction.query,
      async transaction<T>(work: (scope: AflOutcomeSqlTransaction) => Promise<T>) {
        return work(transaction);
      },
    };
    const repository = new PostgresAflTradeProviderObservationRepository(client);
    const request = {
      captureId: 'fitzroy-capture-fixture',
      fieldMapId: 'field-map-fixture',
      fieldMap: map,
      decodedSha256: digest('8'),
      batch,
      startedAt: '2026-08-07T01:00:00.000Z',
      completedAt: '2026-08-07T01:00:01.000Z',
    };

    const transactionCallbacks: AflOutcomeSqlTransaction[] = [];
    const callbackSqlCounts: number[] = [];
    const afterPersist = async ({
      transaction: callbackTransaction,
    }: {
      transaction: AflOutcomeSqlTransaction;
    }) => {
      transactionCallbacks.push(callbackTransaction);
      callbackSqlCounts.push(executedSql.length);
    };
    const first = await repository.persist(request, { afterPersist });
    const replay = await repository.persist(
      {
        ...request,
        startedAt: '2026-08-07T02:00:00.000Z',
        completedAt: '2026-08-07T02:00:01.000Z',
      },
      { afterPersist }
    );
    expect(first).toMatchObject({ status: 'staged', idempotentReplay: false, rowCount: 1 });
    expect(replay).toEqual({ ...first, idempotentReplay: true });
    expect(executedSql.join('\n')).not.toMatch(
      /INSERT INTO (?:outcome_player\b|outcome_club\b|outcome_match\b|outcome_release_|outcome_projection_)/i
    );
    expect(executedSql.join('\n')).toContain('SET finalized_at');
    expect(transactionCallbacks).toEqual([transaction, transaction]);
    expect(callbackSqlCounts[0]).toBeGreaterThan(
      executedSql.findIndex((sql) => sql.includes('SET finalized_at'))
    );
    manifestSpy.mockRestore();
  });

  it('rejects a conflicting decoded artifact under the same capture and field-map key', async () => {
    const authenticatedManifest = authenticatedManifestFixture();
    const manifestSpy = vi
      .spyOn(aflTradeSourceSnapshotManifestContentSchema, 'safeParse')
      .mockReturnValue({
        success: true,
        data: authenticatedManifest.parsedManifest,
      } as never);
    const map = fieldMap({
      invocationArgumentsSha256: authenticatedManifest.invocationArgumentsSha256,
    });
    const batch = normalizeAflTradeFitzRoyDecodedTable({
      table: decodedTable(
        [sourceRow({ playerId: 'p1', playerName: 'Player One' })],
        'official-afl-player-stats',
        {
          captureReceiptSha256: authenticatedManifest.captureReceiptSha256,
          invocationArgumentsSha256: authenticatedManifest.invocationArgumentsSha256,
        }
      ),
      fieldMap: map,
    });
    const transaction: AflOutcomeSqlTransaction = {
      async query<Row>(sql: string) {
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
        if (sql.includes('FROM outcome_source_capture capture')) {
          return {
            rows: [
              {
                provider: 'Official AFL data via fitzRoy',
                manifest_json: { fixture: true },
                capability_id: 'official-afl-player-stats',
                competition: 'AFLM',
                status: 'approved',
                content_sha256: digest('e'),
                field_capability_id: 'official-afl-player-stats',
                field_fitzroy_version: '1.7.0',
                source_schema_sha256: createDecodedFieldSchemaSha256(fields),
                field_map_sha256: createAflTradeFitzRoyFieldMapSha256(map),
                field_map_approval_current: true,
                map_json: map,
              },
            ] as Row[],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT EXISTS')) return { rows: [{ found: true }] as Row[], rowCount: 1 };
        if (sql.includes('FROM outcome_provider_normalization_run')) {
          return {
            rows: [
              {
                normalization_run_id: 'different-run',
                decoded_sha256: digest('7'),
                receipt_sha256: digest('6'),
                source_row_count: 1,
                issue_count: 0,
                status: 'staged',
              },
            ] as Row[],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected provider conflict SQL: ${sql}`);
      },
    };
    const client: AflOutcomeSqlClient = {
      query: transaction.query,
      async transaction<T>(work: (scope: AflOutcomeSqlTransaction) => Promise<T>) {
        return work(transaction);
      },
    };

    await expect(
      new PostgresAflTradeProviderObservationRepository(client).persist({
        captureId: 'fitzroy-capture-fixture',
        fieldMapId: 'field-map-fixture',
        fieldMap: map,
        decodedSha256: digest('8'),
        batch,
        startedAt: '2026-08-07T01:00:00.000Z',
        completedAt: '2026-08-07T01:00:01.000Z',
      })
    ).rejects.toBeInstanceOf(AflTradeProviderObservationPersistenceError);
    manifestSpy.mockRestore();
  });
});
