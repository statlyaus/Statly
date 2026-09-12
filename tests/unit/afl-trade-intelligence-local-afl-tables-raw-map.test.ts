import { describe, expect, it } from 'vitest';
import { createLocalAflTradeAflTablesRawEvidenceFieldMap } from '@/server/aflTradeIntelligence/development/localAflTablesRawEvidenceFieldMap';
import {
  createLocalAflTradeFiveSeasonAflTablesAuthority,
  LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createAflTradeFitzRoyInvocation } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import {
  createDecodedFieldSchemaSha256,
  parseAflTradeFitzRoyDecodedTable,
  parseAflTradeFitzRoyFieldMap,
  type AflTradeDecodedScalar,
} from '@/server/aflTradeIntelligence/source/fitzRoyObservationContracts';
import { normalizeAflTradeFitzRoyDecodedTable } from '@/server/aflTradeIntelligence/source/fitzRoyObservationNormalizer';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';

const invocation = createAflTradeFitzRoyInvocation(
  createLocalAflTradeFiveSeasonAflTablesAuthority(2025).capture.captureRequest
);
const review = {
  mapId: 'reviewed-raw-afl-tables-2025',
  approvalDecisionId: 'actual-map-review',
  approvedAt: '2026-09-08T00:00:00.000Z',
};
function table(overrides: Record<string, AflTradeDecodedScalar> = {}) {
  const values: Record<string, AflTradeDecodedScalar> = {
    Season: { kind: 'integer', value: '2025' },
    Round: { kind: 'text', value: '8' },
    Date: { kind: 'date', value: '2025-05-02', rawDays: '20210' },
    Player: { kind: 'text', value: 'Unresolved Test Player' },
    'First.name': { kind: 'text', value: 'Unresolved Test' },
    Surname: { kind: 'text', value: 'Player' },
    'Playing.for': { kind: 'text', value: 'St Kilda' },
    'Home.team': { kind: 'text', value: 'St Kilda' },
    'Away.team': { kind: 'text', value: 'Fremantle' },
    url: { kind: 'text', value: 'https://afltables.com/afl/stats/players/T/Test_Player.html' },
    ID: { kind: 'missing' },
    Goals: { kind: 'integer', value: '0' },
    'Brownlow.Votes': { kind: 'integer', value: '0' },
    ...overrides,
  };
  return parseAflTradeFitzRoyDecodedTable({
    schemaVersion: 'afl-trade-fitzroy-decoded-table/v1',
    captureReceiptSha256: 'a'.repeat(64),
    capabilityId: 'afl-tables-player-stats',
    fitzRoyVersion: '1.7.0',
    authorizationCompetition: 'AFLM',
    authorizationSeason: 2025,
    invocationSha256: sha256AflTradeCanonicalJson(invocation),
    invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
    diagnosticsSha256: 'b'.repeat(64),
    sourceRdsSha256: 'c'.repeat(64),
    sourceSchemaSha256: createDecodedFieldSchemaSha256(LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA),
    decoderRuntime: {
      decoderVersion: 'afl-trade-fitzroy-rds-decoder/v1',
      rVersion: '4.5.1',
      dependencyLockSha256: 'd'.repeat(64),
      imageDigest: `sha256:${'e'.repeat(64)}`,
    },
    frame: { classes: ['data.frame'], rowNames: ['1'] },
    fields: LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA,
    rows: [
      LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA.map(
        ({ name }) => values[name] ?? { kind: 'missing' }
      ),
    ],
  });
}
const normalize = (input = table()) =>
  normalizeAflTradeFitzRoyDecodedTable({
    table: input,
    fieldMap: createLocalAflTradeAflTablesRawEvidenceFieldMap({ invocation, ...review }),
    decodedSha256: 'f'.repeat(64),
  });

describe('exact AFL Tables raw-evidence-only map', () => {
  it('binds historical raw staging to its exact season without metric or appearance claims', () => {
    const historicalInvocation = createAflTradeFitzRoyInvocation({
      schemaVersion: 'afl-trade-fitzroy-capture-request/v1',
      capabilityId: 'afl-tables-player-stats',
      competition: 'AFLM',
      authorizationSeason: 2008,
      parameters: { season: 2008, rescrape: false, rescrapeStartSeason: null },
    });
    const fieldMap = createLocalAflTradeAflTablesRawEvidenceFieldMap({
      ...review,
      mapId: 'synthetic-reviewed-raw-2008',
      invocation: historicalInvocation,
    });
    expect(fieldMap).toMatchObject({
      validFromSeason: 2008,
      validThroughSeason: 2008,
      statisticalInterpretation: 'raw_evidence_only',
      appearanceEvidence: 'requires_independent_review',
      metrics: [],
    });
    const source = table({
      Season: { kind: 'integer', value: '2008' },
      Date: { kind: 'date', value: '2008-05-02', rawDays: '14001' },
    });
    source.authorizationSeason = 2008;
    source.invocationSha256 = sha256AflTradeCanonicalJson(historicalInvocation);
    source.invocationArgumentsSha256 = sha256AflTradeCanonicalJson(historicalInvocation.arguments);
    const normalized = normalizeAflTradeFitzRoyDecodedTable({
      table: source,
      fieldMap,
      decodedSha256: 'f'.repeat(64),
    });
    expect(normalized.rows[0]).toMatchObject({
      rowStatus: 'staged',
      metricCandidates: [],
      appearanceCandidate: false,
      typedPayload: {
        Season: { kind: 'integer', value: '2008' },
        ID: { kind: 'missing' },
        Goals: { kind: 'integer', value: '0' },
      },
    });
    expect(() =>
      normalizeAflTradeFitzRoyDecodedTable({
        table: table(),
        fieldMap,
        decodedSha256: 'f'.repeat(64),
      })
    ).toThrow();
  });

  it('retains missing identity and ambiguous zeros without asserting metrics or appearance', () => {
    const row = normalize().rows[0]!;
    expect(row.rowStatus).toBe('staged');
    expect(row.identityCandidate).toMatchObject({
      nativeEntityId: null,
      recordedName: 'Unresolved Test Player',
    });
    expect(row.metricCandidates).toEqual([]);
    expect(row.appearanceCandidate).toBe(false);
    expect(row.typedPayload.ID).toEqual({ kind: 'missing' });
    expect(row.typedPayload.Goals).toEqual({ kind: 'integer', value: '0' });
    expect(row.typedPayload['Brownlow.Votes']).toEqual({ kind: 'integer', value: '0' });
  });
  it('preserves the original factual interpretation and exact source bytes', () => {
    const source = table();
    const original = createLocalAflTradeFiveSeasonAflTablesAuthority(2025).fieldMap;
    const factual = normalizeAflTradeFitzRoyDecodedTable({
      table: source,
      fieldMap: original,
      decodedSha256: 'f'.repeat(64),
    });
    const raw = normalize(source);
    expect(factual.rows[0]!.rowStatus).toBe('needs_review');
    expect(factual.rows[0]!.metricCandidates).toHaveLength(2);
    expect(raw.rows[0]!.sourceRowSha256).toBe(factual.rows[0]!.sourceRowSha256);
    expect(raw.rows[0]!.typedPayload).toEqual(factual.rows[0]!.typedPayload);
    expect(() => parseAflTradeFitzRoyFieldMap({ ...original, metrics: [] })).toThrow();
  });
  it('uses explicit source name components when combined Player metadata is missing', () => {
    const source = table({ Player: { kind: 'missing' } });
    const row = normalize(source).rows[0]!;
    expect(row.rowStatus).toBe('staged');
    expect(row.identityCandidate).toMatchObject({
      nativeEntityId: null,
      recordedName: 'Unresolved Test Player',
    });
    expect(row.typedPayload.Player).toEqual({ kind: 'missing' });
    expect(row.typedPayload.ID).toEqual({ kind: 'missing' });
    expect(row.metricCandidates).toEqual([]);
    expect(row.appearanceCandidate).toBe(false);
    const original = normalizeAflTradeFitzRoyDecodedTable({
      table: source,
      fieldMap: createLocalAflTradeFiveSeasonAflTablesAuthority(2025).fieldMap,
      decodedSha256: 'f'.repeat(64),
    }).rows[0]!;
    expect(original.rowStatus).toBe('needs_review');
    expect(row.typedPayload).toEqual(original.typedPayload);
    expect(row.sourceRowSha256).toBe(original.sourceRowSha256);
  });
  it.each(['First.name', 'Surname', 'url', 'Playing.for', 'Home.team'])(
    'quarantines missing occurrence context %s',
    (field) => {
      expect(normalize(table({ [field]: { kind: 'missing' } })).rows[0]!.rowStatus).toBe(
        'needs_review'
      );
    }
  );
  it('quarantines duplicate source occurrences rather than choosing one', () => {
    const source = table();
    source.rows.push([...source.rows[0]!]);
    source.frame.rowNames.push('2');
    expect(normalize(source).rows.map((row) => row.rowStatus)).toEqual([
      'needs_review',
      'needs_review',
    ]);
  });
  it('rejects metric or participation claims in explicit raw-only mode', () => {
    const map = createLocalAflTradeAflTablesRawEvidenceFieldMap({ invocation, ...review });
    expect(() => parseAflTradeFitzRoyFieldMap({ ...map, appearanceEvidence: undefined })).toThrow();
    expect(() =>
      parseAflTradeFitzRoyFieldMap({
        ...map,
        metrics: createLocalAflTradeFiveSeasonAflTablesAuthority(2025).fieldMap.metrics,
      })
    ).toThrow();
    expect(() =>
      parseAflTradeFitzRoyFieldMap({ ...map, observationKind: 'match_universe' })
    ).toThrow();
  });
  it('rejects invocation and schema drift', () => {
    expect(() =>
      createLocalAflTradeAflTablesRawEvidenceFieldMap({
        ...review,
        invocation: { ...invocation, authorizationSeason: 2024 },
      })
    ).toThrow();
    const changed = table();
    changed.fields[0] = { ...changed.fields[0]!, name: 'UnexpectedSeason' };
    expect(() => normalize(changed)).toThrow();
  });
  it('does not silently extend a reviewed raw map to a live rescrape invocation', () => {
    const rescrape = createAflTradeFitzRoyInvocation({
      schemaVersion: 'afl-trade-fitzroy-capture-request/v1',
      capabilityId: 'afl-tables-player-stats',
      competition: 'AFLM',
      authorizationSeason: 2008,
      parameters: { season: 2008, rescrape: true, rescrapeStartSeason: 2008 },
    });
    expect(() =>
      createLocalAflTradeAflTablesRawEvidenceFieldMap({ ...review, invocation: rescrape })
    ).toThrow('full-season cache-first invocation');
  });
});
