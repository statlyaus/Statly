import { describe, expect, it } from 'vitest';
import {
  createLocalAflTradeFootywire2025FieldMap,
  LOCAL_FOOTYWIRE_2025_FIELD_SCHEMA,
} from '@/server/aflTradeIntelligence/development/localFootywire2025FieldMap';
import {
  parseAflTradeFitzRoyDecodedTable,
  parseAflTradeFitzRoyFieldMap,
  type AflTradeDecodedScalar,
} from '@/server/aflTradeIntelligence/source/fitzRoyObservationContracts';
import { normalizeAflTradeFitzRoyDecodedTable } from '@/server/aflTradeIntelligence/source/fitzRoyObservationNormalizer';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';

const invocation = {
  schemaVersion: 'afl-trade-fitzroy-invocation/v1',
  capabilityId: 'footywire-player-stats',
  fitzRoyVersion: '1.7.0',
  provider: 'footywire',
  directFunction: 'fetch_player_stats_footywire',
  authorizationSeason: 2025,
  expectedCaptureOrigin: 'cached_then_live_delta',
  arguments: { season: 2025, round_number: null, check_existing: true },
};
const review = {
  mapId: 'footywire-2025-reviewed-map',
  approvalDecisionId: 'retained-review-2025',
  approvedAt: '2026-09-08T00:00:00.000Z',
};

function decoded(overrides: Record<string, AflTradeDecodedScalar> = {}) {
  const values: Record<string, AflTradeDecodedScalar> = {
    Date: { kind: 'date', value: '2025-05-02', rawDays: '20210' },
    Season: { kind: 'finite_number', value: '2025' },
    Round: { kind: 'text', value: 'Round 8' },
    Venue: { kind: 'text', value: 'Docklands' },
    Player: { kind: 'text', value: 'Tobie Travaglia ↙' },
    Team: { kind: 'text', value: 'St Kilda' },
    Opposition: { kind: 'text', value: 'Fremantle' },
    Status: { kind: 'text', value: 'Home' },
    Match_id: { kind: 'finite_number', value: '11251' },
    ...overrides,
  };
  return parseAflTradeFitzRoyDecodedTable({
    schemaVersion: 'afl-trade-fitzroy-decoded-table/v1',
    captureReceiptSha256: 'a'.repeat(64),
    capabilityId: 'footywire-player-stats',
    fitzRoyVersion: '1.7.0',
    authorizationCompetition: 'AFLM',
    authorizationSeason: 2025,
    invocationSha256: sha256AflTradeCanonicalJson(invocation),
    invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
    diagnosticsSha256: 'b'.repeat(64),
    sourceRdsSha256: 'c'.repeat(64),
    sourceSchemaSha256: '13b0277a1b8d709f30b6b9ca83b79edbd470fabdaa4ab2e6cf1c101a692f64ae',
    decoderRuntime: {
      decoderVersion: 'afl-trade-fitzroy-rds-decoder/v1',
      rVersion: '4.5.1',
      dependencyLockSha256: 'd'.repeat(64),
      imageDigest: `sha256:${'e'.repeat(64)}`,
    },
    frame: { classes: ['data.frame'], rowNames: ['1'] },
    fields: LOCAL_FOOTYWIRE_2025_FIELD_SCHEMA,
    rows: [
      LOCAL_FOOTYWIRE_2025_FIELD_SCHEMA.map(({ name }) => values[name] ?? { kind: 'missing' }),
    ],
  });
}

describe('exact FootyWire 2025 decoder map', () => {
  it('orients Home and Away rows to the same clubs without asserting participation', () => {
    const normalize = (overrides: Record<string, AflTradeDecodedScalar>) =>
      normalizeAflTradeFitzRoyDecodedTable({
        table: decoded(overrides),
        fieldMap: createLocalAflTradeFootywire2025FieldMap({ invocation, ...review }),
        decodedSha256: 'f'.repeat(64),
      }).rows[0]!;
    const home = normalize({});
    const away = normalize({
      Team: { kind: 'text', value: 'Fremantle' },
      Opposition: { kind: 'text', value: 'St Kilda' },
      Status: { kind: 'text', value: 'Away' },
    });
    for (const row of [home, away]) {
      expect(row.matchCandidate).toMatchObject({
        homeClubName: 'St Kilda',
        awayClubName: 'Fremantle',
        nativeMatchId: '11251',
        providerStatus: null,
      });
      expect(row.appearanceCandidate).toBe(false);
    }
    expect(home.matchCandidate!.orderIndependentSha256).toBe(
      away.matchCandidate!.orderIndependentSha256
    );
    expect(away.typedPayload.Status).toEqual({ kind: 'text', value: 'Away' });
  });
  it('binds source fields and review without inventing native player identity or participation', () => {
    const map = createLocalAflTradeFootywire2025FieldMap({ invocation, ...review });
    expect(map).toMatchObject({
      ...review,
      validFromSeason: 2025,
      validThroughSeason: 2025,
      naturalKeyFields: ['Match_id', 'Team', 'Player'],
      appearanceEvidence: 'requires_independent_review',
      match: {
        status: null,
        rowClubOrientation: { sourceField: 'Status', homeValue: 'Home', awayValue: 'Away' },
      },
      identity: {
        nativeId: null,
        recordedName: { sourceField: 'Player', required: true },
        recordedClubNativeId: null,
        recordedClubName: { sourceField: 'Team', required: true },
      },
      metrics: [{ metricCode: 'goals', sourceField: 'G', zeroSemantics: 'measured_zero' }],
    });
    expect(map.exactOrderedFields).toHaveLength(42);
    expect(map.sourceSchemaSha256).toBe(
      '13b0277a1b8d709f30b6b9ca83b79edbd470fabdaa4ab2e6cf1c101a692f64ae'
    );
    expect(map.exactOrderedFields.slice(0, 10)).toEqual([
      'Date',
      'Season',
      'Round',
      'Venue',
      'Player',
      'Team',
      'Opposition',
      'Status',
      'Match_id',
      'GA',
    ]);
  });
  it('preserves annotated names and null statistics through the actual normalizer', () => {
    const table = decoded();
    const result = normalizeAflTradeFitzRoyDecodedTable({
      table,
      fieldMap: createLocalAflTradeFootywire2025FieldMap({ invocation, ...review }),
      decodedSha256: 'f'.repeat(64),
    });
    expect(result.rows[0]).toMatchObject({
      identityCandidate: {
        recordedName: 'Tobie Travaglia ↙',
        nativeEntityId: null,
        resolutionState: 'unresolved',
      },
      matchCandidate: { homeClubName: 'St Kilda', awayClubName: 'Fremantle', providerStatus: null },
      appearanceCandidate: false,
      metricCandidates: [{ metricCode: 'goals', availability: 'missing', numericValue: null }],
      typedPayload: {
        G: { kind: 'missing' },
        Player: { kind: 'text', value: 'Tobie Travaglia ↙' },
        Match_id: { kind: 'finite_number', value: '11251' },
      },
    });
    expect(result.rows[0]!.typedPayload).toHaveProperty('T5', { kind: 'missing' });
  });
  it('keeps a missing name unavailable rather than manufacturing a native player identity', () => {
    const result = normalizeAflTradeFitzRoyDecodedTable({
      table: decoded({ Player: { kind: 'missing' } }),
      fieldMap: createLocalAflTradeFootywire2025FieldMap({ invocation, ...review }),
      decodedSha256: 'f'.repeat(64),
    });
    expect(result.rows[0]).toMatchObject({
      rowStatus: 'needs_review',
      identityCandidate: null,
      appearanceCandidate: false,
    });
  });
  it.each([
    { capabilityId: 'afl-tables-player-stats' },
    { authorizationSeason: 2024, arguments: { ...invocation.arguments, season: 2024 } },
    { arguments: { ...invocation.arguments, check_existing: false } },
    { arguments: { ...invocation.arguments, round_number: 1 } },
  ])('rejects a different invocation %j', (change) => {
    expect(() =>
      createLocalAflTradeFootywire2025FieldMap({
        invocation: { ...invocation, ...change },
        ...review,
      })
    ).toThrow();
  });
  it.each(['capability', 'schema', 'invocation', 'competition'] as const)(
    'rejects a substituted decoded %s through the normalizer',
    (kind) => {
      const table = decoded();
      if (kind === 'capability') table.capabilityId = 'afl-tables-player-stats';
      if (kind === 'schema') table.sourceSchemaSha256 = '0'.repeat(64);
      if (kind === 'invocation') table.invocationArgumentsSha256 = '0'.repeat(64);
      if (kind === 'competition') table.authorizationCompetition = 'AFLW';
      expect(() =>
        normalizeAflTradeFitzRoyDecodedTable({
          table,
          fieldMap: createLocalAflTradeFootywire2025FieldMap({ invocation, ...review }),
          decodedSha256: 'f'.repeat(64),
        })
      ).toThrow();
    }
  );
  it('requires caller review metadata', () => {
    expect(() =>
      createLocalAflTradeFootywire2025FieldMap({ invocation, ...review, approvalDecisionId: '' })
    ).toThrow();
  });
  it.each([
    { kind: 'missing' },
    { kind: 'text', value: 'Neutral' },
    { kind: 'text', value: 'home' },
    { kind: 'text', value: ' Home' },
  ] as const)('quarantines an unreviewed orientation %j without guessing', (Status) => {
    const result = normalizeAflTradeFitzRoyDecodedTable({
      table: decoded({ Status }),
      fieldMap: createLocalAflTradeFootywire2025FieldMap({ invocation, ...review }),
      decodedSha256: 'f'.repeat(64),
    });
    expect(result.rows[0]).toMatchObject({
      rowStatus: 'needs_review',
      matchCandidate: null,
      appearanceCandidate: false,
      typedPayload: { Status },
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'Status' })])
    );
  });
  it('swaps native club identifiers with the names and preserves old unoriented maps', () => {
    const base = createLocalAflTradeFootywire2025FieldMap({ invocation, ...review });
    const match = {
      ...base.match!,
      homeClubNativeId: { sourceField: 'G', required: true },
      awayClubNativeId: { sourceField: 'GA', required: true },
    };
    const table = decoded({
      Status: { kind: 'text', value: 'Away' },
      G: { kind: 'finite_number', value: '10' },
      GA: { kind: 'finite_number', value: '20' },
    });
    const normalize = (fieldMap: typeof base) =>
      normalizeAflTradeFitzRoyDecodedTable({
        table,
        fieldMap,
        decodedSha256: 'f'.repeat(64),
      }).rows[0]!;
    expect(
      normalize(parseAflTradeFitzRoyFieldMap({ ...base, match })).matchCandidate
    ).toMatchObject({
      homeClubName: 'Fremantle',
      homeClubNativeId: '20',
      awayClubName: 'St Kilda',
      awayClubNativeId: '10',
    });
    const { rowClubOrientation: _orientation, ...legacyMatch } = match;
    const { appearanceEvidence: _appearance, ...legacyBase } = base;
    const legacy = normalize(parseAflTradeFitzRoyFieldMap({ ...legacyBase, match: legacyMatch }));
    expect(legacy.matchCandidate).toMatchObject({
      homeClubName: 'St Kilda',
      homeClubNativeId: '10',
      awayClubName: 'Fremantle',
      awayClubNativeId: '20',
    });
    expect(legacy.appearanceCandidate).toBe(true);
  });
  it('requires the orientation source in the exact field list and distinct labels', () => {
    const base = createLocalAflTradeFootywire2025FieldMap({ invocation, ...review });
    for (const change of [{ sourceField: 'UnboundStatus' }, { awayValue: 'Home' }]) {
      expect(() =>
        parseAflTradeFitzRoyFieldMap({
          ...base,
          match: {
            ...base.match,
            rowClubOrientation: {
              ...base.match!.rowClubOrientation,
              ...change,
            },
          },
        })
      ).toThrow();
    }
  });
});
