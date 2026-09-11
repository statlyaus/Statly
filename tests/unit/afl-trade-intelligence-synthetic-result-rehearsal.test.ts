import {
  createLocalAflTradeFitzRoyFactualRehearsalFixture,
  LOCAL_FITZROY_REHEARSAL_RUNTIME,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { captureAuthorizedAflTradeFitzRoyProviderSeason } from '@/server/aflTradeIntelligence/source/fitzRoyProviderIngestion';
import { decodeAflTradeFitzRoyCapture } from '@/server/aflTradeIntelligence/source/fitzRoyObservationDecodeRuntime';
import { normalizeAflTradeFitzRoyDecodedTable } from '@/server/aflTradeIntelligence/source/fitzRoyObservationNormalizer';
import { LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { parseAflTradeFitzRoyCaptureRequest } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';

it('captures exact AFL Tables results without any player identity or metric', async () => {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({
    provider: 'afl_tables',
    profile: 'match_only',
  });
  expect(parseAflTradeFitzRoyCaptureRequest(fixture.command.capture.captureRequest).capabilityId).toBe(
    'afl-tables-results'
  );
  const captured = await captureAuthorizedAflTradeFitzRoyProviderSeason(fixture.command, {
    capture: fixture.captureDependencies,
    clock: { now: () => '2026-08-12T00:01:02.000Z' },
  });
  expect(captured.receipt.content.diagnostics.fields.map(({ name }) => name)).toEqual(
    LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA.map(({ name }) => name)
  );
  expect(captured.receipt.content.diagnostics.directFunction).toBe('fetch_results_afltables');
  const bytes = await fixture.rawArtifactRepository.loadExact(
    captured.receipt.content.sourceCustody.artifact,
    1024
  );
  if (!bytes) throw new Error('Missing exact synthetic source bytes');
  const decoded = await decodeAflTradeFitzRoyCapture({
    captureReceipt: captured.receipt,
    sourceRdsBytes: bytes.bytes,
    executor: fixture.decoderExecutor,
    ...LOCAL_FITZROY_REHEARSAL_RUNTIME,
    maximumRows: 10,
    maximumFields: 20,
    maximumCells: 200,
    maximumCellBytes: 1024,
    maximumOutputBytes: 65536,
    timeoutMs: 30000,
  });
  const normalized = normalizeAflTradeFitzRoyDecodedTable({
    ...decoded,
    fieldMap: fixture.command.fieldMap,
  });
  expect(normalized.issues).toEqual([]);
  expect(normalized.rows).toHaveLength(1);
  expect(normalized.rows[0]).toMatchObject({
    identityCandidate: null,
    metricCandidates: [],
    appearanceCandidate: false,
  });
  expect(normalized.rows[0]!.typedPayload['Home.Points']).toEqual({ kind: 'integer', value: '84' });
  expect(normalized.rows[0]!.typedPayload['Away.Points']).toEqual({ kind: 'integer', value: '72' });
  expect(normalized.rows[0]!.matchCandidate?.providerStatus).toBeNull();
});

it.each([
  { provider: 'footywire' as const },
  { provider: 'afl_tables' as const, profile: 'appearance_only' as const },
])(
  'retains actual missing completion status without inventing Final: $provider',
  async (options) => {
    const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({
      ...options,
      missingCompletionStatus: true,
    });
    const captured = await captureAuthorizedAflTradeFitzRoyProviderSeason(fixture.command, {
      capture: fixture.captureDependencies,
      clock: { now: () => '2026-08-12T00:01:02.000Z' },
    });
    expect(
      captured.receipt.content.diagnostics.fields.find((field) => field.name === 'status')
        ?.missingCount
    ).toBe(1);
    const bytes = await fixture.rawArtifactRepository.loadExact(
      captured.receipt.content.sourceCustody.artifact,
      1024
    );
    if (!bytes) throw new Error('Exact synthetic bytes required');
    const decoded = await decodeAflTradeFitzRoyCapture({
      captureReceipt: captured.receipt,
      sourceRdsBytes: bytes.bytes,
      executor: fixture.decoderExecutor,
      ...LOCAL_FITZROY_REHEARSAL_RUNTIME,
      maximumRows: 10,
      maximumFields: 20,
      maximumCells: 200,
      maximumCellBytes: 1024,
      maximumOutputBytes: 65536,
      timeoutMs: 30000,
    });
    const normalized = normalizeAflTradeFitzRoyDecodedTable({
      ...decoded,
      fieldMap: fixture.command.fieldMap,
    });
    expect(normalized.issues).toEqual([]);
    expect(normalized.rows[0]!.typedPayload.status).toEqual({ kind: 'missing' });
    expect(normalized.rows[0]!.matchCandidate?.providerStatus).toBeNull();
    expect(fixture.command.fieldMap.match?.status?.required).toBe(false);
    const original = createLocalAflTradeFitzRoyFactualRehearsalFixture(options);
    expect(original.command.fieldMap.match?.status?.required).toBe(true);
    expect(fixture.command.fieldMap.mapId).not.toBe(original.command.fieldMap.mapId);
  }
);

it('captures the explicit AFL Tables fixture under its own exact rate policy', async () => {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({
    provider: 'afl_tables',
    profile: 'completed_match_result',
  });
  const captured = await captureAuthorizedAflTradeFitzRoyProviderSeason(fixture.command, {
    capture: fixture.captureDependencies,
    clock: { now: () => '2026-08-12T00:01:02.000Z' },
  });
  expect(
    captured.receipt.content.diagnostics.fields.find((field) => field.name === 'status')
      ?.missingCount
  ).toBe(0);
  expect(captured.receipt.content.diagnostics.fields.map((field) => field.name)).toContain(
    'home_points'
  );
  const bytes = await fixture.rawArtifactRepository.loadExact(
    captured.receipt.content.sourceCustody.artifact,
    1024
  );
  if (!bytes) throw new Error('Exact synthetic source bytes are required.');
  const decoded = await decodeAflTradeFitzRoyCapture({
    captureReceipt: captured.receipt,
    sourceRdsBytes: bytes.bytes,
    executor: fixture.decoderExecutor,
    ...LOCAL_FITZROY_REHEARSAL_RUNTIME,
    maximumRows: 10,
    maximumFields: 20,
    maximumCells: 200,
    maximumCellBytes: 1024,
    maximumOutputBytes: 65536,
    timeoutMs: 30000,
  });
  const normalized = normalizeAflTradeFitzRoyDecodedTable({
    ...decoded,
    fieldMap: fixture.command.fieldMap,
  });
  expect(normalized.issues).toHaveLength(0);
});

it('declares explicit synthetic team points independently of player goals, leaving default schema unchanged', () => {
  const original = createLocalAflTradeFitzRoyFactualRehearsalFixture();
  const result = createLocalAflTradeFitzRoyFactualRehearsalFixture({
    profile: 'completed_match_result',
  });
  expect(result.command.fieldMap.exactOrderedFields).toContain('home_points');
  expect(result.command.fieldMap.exactOrderedFields).toContain('away_points');
  expect(original.command.fieldMap.exactOrderedFields).not.toContain('home_points');
  expect(
    result.command.capture.sourceRights.content.fields.find(
      (field) => field.sourceField === 'home_points'
    )?.uses.derived_feature
  ).toBe('allowed');
  expect(result.command.fieldMap.mapId).not.toBe(original.command.fieldMap.mapId);
});

it('captures and normalizes appearance-only AFL Tables without a numeric metric or inferred appearance', async () => {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({
    provider: 'afl_tables',
    profile: 'appearance_only',
  });
  expect(fixture.command.fieldMap.metrics).toEqual([]);
  expect(fixture.command.fieldMap.exactOrderedFields).not.toContain('goals');
  const captured = await captureAuthorizedAflTradeFitzRoyProviderSeason(fixture.command, {
    capture: fixture.captureDependencies,
    clock: { now: () => '2026-08-12T00:01:02.000Z' },
  });
  const bytes = await fixture.rawArtifactRepository.loadExact(
    captured.receipt.content.sourceCustody.artifact,
    1024
  );
  if (!bytes) throw new Error('Exact synthetic source bytes are required.');
  const decoded = await decodeAflTradeFitzRoyCapture({
    captureReceipt: captured.receipt,
    sourceRdsBytes: bytes.bytes,
    executor: fixture.decoderExecutor,
    ...LOCAL_FITZROY_REHEARSAL_RUNTIME,
    maximumRows: 10,
    maximumFields: 20,
    maximumCells: 200,
    maximumCellBytes: 1024,
    maximumOutputBytes: 65536,
    timeoutMs: 30000,
  });
  const normalized = normalizeAflTradeFitzRoyDecodedTable({
    ...decoded,
    fieldMap: fixture.command.fieldMap,
  });
  expect(normalized.issues).toEqual([]);
  expect(normalized.rows).toHaveLength(1);
  expect(normalized.rows[0]).toMatchObject({ metricCandidates: [], appearanceCandidate: false });
  expect(normalized.rows[0]!.typedPayload['Time.on.Ground']).toEqual({
    kind: 'integer',
    value: '76',
  });
});
