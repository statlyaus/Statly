import { createHash } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';

import { AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION } from '../../src/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import { calculateAflTradeStructuralWeightedDistribution } from '../../src/server/aflTradeIntelligence/valuation/structuralWeightedDistribution';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION,
  type AflTradeStructuralWeightedDistribution,
  type AflTradeStructuralWeightedDistributionInput,
  type AflTradeStructuralWeightedDistributionObservation,
  type AflTradeStructuralWeightedDistributionPolicy,
} from '../../src/server/aflTradeIntelligence/valuation/structuralWeightedDistributionContracts';

const BENCHMARK_RECORD_SCHEMA_VERSION =
  'afl-trade-structural-weighted-distribution-benchmark-record/v1' as const;
const WORKLOAD_MODES = [
  'fixture_only',
  'fully_available',
  'partially_unavailable',
  'fully_unavailable',
] as const;
const VALUE_SCOPE = 'universal_football_value_cross_club_comparable' as const;
const VALUE_UNIT_ID = 'afl-list-value-points';
const UNAVAILABLE_REASON_CODE = 'benchmark-source-unavailable';
const LOW_RETURN_THRESHOLD = -25;
const ELITE_OUTCOME_THRESHOLD = 100;
const WARM_UP_DRAW_LIMIT = 1_000;
const VALUE_CATALOG = [
  -1e300,
  -1e150,
  -1e30,
  -1_000_000,
  -25,
  -25,
  -Number.MIN_VALUE,
  0,
  0,
  Number.MIN_VALUE,
  100,
  100,
  1_000_000,
  1e30,
  1e150,
  1e300,
] as const;

type WorkloadMode = (typeof WORKLOAD_MODES)[number];

interface BenchmarkConfig {
  drawCount: number;
  mode: WorkloadMode;
  trial: number;
}

interface BenchmarkFixture {
  input: AflTradeStructuralWeightedDistributionInput;
  observations: AflTradeStructuralWeightedDistributionObservation[];
}

interface MemorySnapshot {
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  maxRssKilobytes: number;
}

interface CorrectnessSummary {
  generatedDrawCount: number;
  generatedAvailableDrawCount: number;
  generatedUnavailableDrawCount: number;
  generatedAvailableValueMinimum: number | null;
  generatedAvailableValueMaximum: number | null;
  resultStatus: 'not_run' | AflTradeStructuralWeightedDistribution['status'];
  resultDrawCount: number | null;
  availableProbabilityMass: number | null;
  unavailableProbabilityMass: number | null;
  reportedReasonCodeCount: number | null;
}

function parseBoundedInteger({
  flag,
  rawValue,
  minimum,
  maximum,
}: {
  flag: string;
  rawValue: string | undefined;
  minimum: number;
  maximum: number;
}): number {
  if (rawValue === undefined || !/^\d+$/.test(rawValue)) {
    throw new Error(`${flag} must be an integer from ${minimum} to ${maximum}.`);
  }
  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function parseBenchmarkConfig(argv: readonly string[]): BenchmarkConfig {
  const values = new Map<string, string>();
  for (const argument of argv) {
    const match = /^(--[a-z-]+)=(.*)$/.exec(argument);
    if (match === null) throw new Error(`Unsupported benchmark argument: ${argument}`);
    const [, flag, value] = match;
    if (!['--draws', '--mode', '--trial'].includes(flag)) {
      throw new Error(`Unsupported benchmark flag: ${flag}`);
    }
    if (values.has(flag)) throw new Error(`Duplicate benchmark flag: ${flag}`);
    values.set(flag, value);
  }

  if (values.size !== 3) {
    throw new Error('Required flags: --draws, --mode, and --trial.');
  }
  const mode = values.get('--mode');
  if (!WORKLOAD_MODES.includes(mode as WorkloadMode)) {
    throw new Error(`--mode must be one of: ${WORKLOAD_MODES.join(', ')}.`);
  }
  const drawCount = parseBoundedInteger({
    flag: '--draws',
    rawValue: values.get('--draws'),
    minimum: 1,
    maximum: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT,
  });
  if (mode === 'partially_unavailable' && drawCount < 2) {
    throw new Error('--draws must be at least 2 for partially_unavailable mode.');
  }

  return {
    drawCount,
    mode: mode as WorkloadMode,
    trial: parseBoundedInteger({
      flag: '--trial',
      rawValue: values.get('--trial'),
      minimum: 1,
      maximum: 1_000,
    }),
  };
}

function createPolicy(): AflTradeStructuralWeightedDistributionPolicy {
  return {
    probabilityMeasureDefinitionVersion: AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION,
    completenessDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION,
    normalizationDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION,
    conditionalMeasureDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION,
    quantileDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
    eventDefinitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION,
    boundsDefinitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION,
    dispersionDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
    statisticsArithmeticDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION,
    measureScope: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE,
    quantiles: {
      downside: 0.1,
      median: 0.5,
      upside: 0.9,
      centralIntervalLevel: 0.8,
    },
    lowReturnEvent: {
      operator: 'less_than_or_equal',
      threshold: LOW_RETURN_THRESHOLD,
    },
    eliteOutcomeEvent: {
      operator: 'greater_than_or_equal',
      threshold: ELITE_OUTCOME_THRESHOLD,
    },
  };
}

function isUnavailableDraw(config: BenchmarkConfig, drawIndex: number): boolean {
  if (config.mode === 'fully_unavailable') return true;
  if (config.mode !== 'partially_unavailable') return false;
  return drawIndex === 0 || (drawIndex % 7 === 0 && drawIndex !== config.drawCount - 1);
}

function createBenchmarkFixture(config: BenchmarkConfig): BenchmarkFixture {
  const probabilityWeight = 1 / config.drawCount;
  const observations = Array.from({ length: config.drawCount }, (_, drawIndex) => {
    const drawKey = `afl-simulation-draw-${String(drawIndex).padStart(6, '0')}`;
    if (isUnavailableDraw(config, drawIndex)) {
      return {
        drawKey,
        probabilityWeight,
        status: 'unavailable' as const,
        reasonCodes: [UNAVAILABLE_REASON_CODE],
      };
    }
    return {
      drawKey,
      probabilityWeight,
      status: 'available' as const,
      value: VALUE_CATALOG[drawIndex % VALUE_CATALOG.length],
    };
  });

  return {
    observations,
    input: {
      inputSchemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
      publicAssetBoundary: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
      valueScope: VALUE_SCOPE,
      valueUnitId: VALUE_UNIT_ID,
      policy: createPolicy(),
      drawCount: config.drawCount,
      observations,
    },
  };
}

function executeWorkload(
  config: BenchmarkConfig,
  input: AflTradeStructuralWeightedDistributionInput
): AflTradeStructuralWeightedDistribution | null {
  return config.mode === 'fixture_only'
    ? null
    : calculateAflTradeStructuralWeightedDistribution(input);
}

function warmUp(config: BenchmarkConfig): void {
  const warmUpConfig: BenchmarkConfig = {
    ...config,
    drawCount: Math.min(config.drawCount, WARM_UP_DRAW_LIMIT),
    trial: 0,
  };
  if (warmUpConfig.mode === 'partially_unavailable' && warmUpConfig.drawCount < 2) return;
  const warmUpFixture = createBenchmarkFixture(warmUpConfig);
  executeWorkload(warmUpConfig, warmUpFixture.input);
}

function exposedGarbageCollector(): (() => void) | null {
  const candidate = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  return typeof candidate === 'function' ? candidate : null;
}

function captureMemory(): MemorySnapshot {
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapTotalBytes: memory.heapTotal,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
    maxRssKilobytes: process.resourceUsage().maxRSS,
  };
}

function captureResourceUsage() {
  const usage = process.resourceUsage();
  return {
    userCpuMicroseconds: usage.userCPUTime,
    systemCpuMicroseconds: usage.systemCPUTime,
    maxRssKilobytes: usage.maxRSS,
    minorPageFaults: usage.minorPageFault,
    majorPageFaults: usage.majorPageFault,
    voluntaryContextSwitches: usage.voluntaryContextSwitches,
    involuntaryContextSwitches: usage.involuntaryContextSwitches,
  };
}

function memoryDelta(after: MemorySnapshot, before: MemorySnapshot) {
  return {
    rssBytes: after.rssBytes - before.rssBytes,
    heapTotalBytes: after.heapTotalBytes - before.heapTotalBytes,
    heapUsedBytes: after.heapUsedBytes - before.heapUsedBytes,
    externalBytes: after.externalBytes - before.externalBytes,
    arrayBuffersBytes: after.arrayBuffersBytes - before.arrayBuffersBytes,
    maxRssKilobytes: after.maxRssKilobytes - before.maxRssKilobytes,
  };
}

function generatedShape(fixture: BenchmarkFixture) {
  let availableDrawCount = 0;
  let unavailableDrawCount = 0;
  let minimum: number | null = null;
  let maximum: number | null = null;
  for (const observation of fixture.observations) {
    if (observation.status === 'unavailable') {
      unavailableDrawCount += 1;
      continue;
    }
    availableDrawCount += 1;
    minimum = minimum === null ? observation.value : Math.min(minimum, observation.value);
    maximum = maximum === null ? observation.value : Math.max(maximum, observation.value);
  }
  return { availableDrawCount, unavailableDrawCount, minimum, maximum };
}

function assertValidBounds(result: AflTradeStructuralWeightedDistribution): void {
  for (const bounds of [
    result.unconditionalEventProbabilityBounds.lowReturn,
    result.unconditionalEventProbabilityBounds.eliteOutcome,
  ]) {
    if (bounds.lower < 0 || bounds.upper > 1 || bounds.lower > bounds.upper) {
      throw new Error('Calculated benchmark event bounds are invalid.');
    }
  }
}

function validateMeasurement(
  config: BenchmarkConfig,
  fixture: BenchmarkFixture,
  result: AflTradeStructuralWeightedDistribution | null
): CorrectnessSummary {
  const shape = generatedShape(fixture);
  if (
    fixture.observations.length !== config.drawCount ||
    shape.availableDrawCount + shape.unavailableDrawCount !== config.drawCount ||
    fixture.input.drawCount !== config.drawCount ||
    fixture.input.observations !== fixture.observations ||
    fixture.input.publicAssetBoundary !==
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY ||
    fixture.input.valueScope !== VALUE_SCOPE ||
    fixture.input.policy.lowReturnEvent.threshold !== LOW_RETURN_THRESHOLD ||
    fixture.input.policy.eliteOutcomeEvent.threshold !== ELITE_OUTCOME_THRESHOLD
  ) {
    throw new Error('Generated benchmark workload does not match its requested shape and policy.');
  }

  const summaryBase = {
    generatedDrawCount: fixture.observations.length,
    generatedAvailableDrawCount: shape.availableDrawCount,
    generatedUnavailableDrawCount: shape.unavailableDrawCount,
    generatedAvailableValueMinimum: shape.minimum,
    generatedAvailableValueMaximum: shape.maximum,
  };
  if (config.mode === 'fixture_only') {
    if (result !== null || shape.unavailableDrawCount !== 0) {
      throw new Error('Fixture-only workload shape or execution boundary is invalid.');
    }
    return {
      ...summaryBase,
      resultStatus: 'not_run',
      resultDrawCount: null,
      availableProbabilityMass: null,
      unavailableProbabilityMass: null,
      reportedReasonCodeCount: null,
    };
  }
  if (result === null) throw new Error('Calculated workload did not return a result.');
  if (
    result.drawCount !== config.drawCount ||
    result.availableDrawCount !== shape.availableDrawCount ||
    result.unavailableDrawCount !== shape.unavailableDrawCount ||
    Math.abs(result.availableProbabilityMass + result.unavailableProbabilityMass - 1) > 1e-8
  ) {
    throw new Error('Calculated benchmark result does not reconcile with its input contract.');
  }
  assertValidBounds(result);

  if (config.mode === 'fully_available') {
    if (
      result.status !== 'complete' ||
      result.availableProbabilityMass !== 1 ||
      result.unavailableProbabilityMass !== 0 ||
      result.statistics === null ||
      result.eventProbabilities === null ||
      result.conditionalOnAvailableStatistics !== null ||
      result.reasonCodes.length !== 0 ||
      result.unconditionalEventProbabilityBounds.lowReturn.lower !==
        result.eventProbabilities.lowReturnProbability ||
      result.unconditionalEventProbabilityBounds.lowReturn.upper !==
        result.eventProbabilities.lowReturnProbability ||
      result.unconditionalEventProbabilityBounds.eliteOutcome.lower !==
        result.eventProbabilities.eliteOutcomeProbability ||
      result.unconditionalEventProbabilityBounds.eliteOutcome.upper !==
        result.eventProbabilities.eliteOutcomeProbability
    ) {
      throw new Error('Fully available benchmark workload returned an invalid complete result.');
    }
  } else if (config.mode === 'partially_unavailable') {
    if (
      shape.availableDrawCount === 0 ||
      shape.unavailableDrawCount === 0 ||
      result.status !== 'partial' ||
      result.statistics !== null ||
      result.eventProbabilities !== null ||
      result.conditionalOnAvailableScope !==
        AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE ||
      result.conditionalOnAvailableStatistics === null ||
      result.conditionalOnAvailableEventProbabilities === null ||
      !result.reasonCodes.includes(UNAVAILABLE_REASON_CODE)
    ) {
      throw new Error(
        'Partially unavailable benchmark workload returned an invalid partial result.'
      );
    }
  } else if (
    result.status !== 'unavailable' ||
    result.availableProbabilityMass !== 0 ||
    result.unavailableProbabilityMass !== 1 ||
    result.statistics !== null ||
    result.conditionalOnAvailableStatistics !== null ||
    result.unconditionalEventProbabilityBounds.lowReturn.lower !== 0 ||
    result.unconditionalEventProbabilityBounds.lowReturn.upper !== 1 ||
    result.unconditionalEventProbabilityBounds.eliteOutcome.lower !== 0 ||
    result.unconditionalEventProbabilityBounds.eliteOutcome.upper !== 1 ||
    !result.reasonCodes.includes(UNAVAILABLE_REASON_CODE)
  ) {
    throw new Error('Fully unavailable benchmark workload returned an invalid unavailable result.');
  }

  return {
    ...summaryBase,
    resultStatus: result.status,
    resultDrawCount: result.drawCount,
    availableProbabilityMass: result.availableProbabilityMass,
    unavailableProbabilityMass: result.unavailableProbabilityMass,
    reportedReasonCodeCount: result.reasonCodes.length,
  };
}

function compactSemanticResult(
  config: BenchmarkConfig,
  correctness: CorrectnessSummary,
  result: AflTradeStructuralWeightedDistribution | null
) {
  return {
    benchmarkRecordSchemaVersion: BENCHMARK_RECORD_SCHEMA_VERSION,
    drawCount: config.drawCount,
    mode: config.mode,
    generatedAvailableDrawCount: correctness.generatedAvailableDrawCount,
    generatedUnavailableDrawCount: correctness.generatedUnavailableDrawCount,
    result,
  };
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const config = parseBenchmarkConfig(process.argv.slice(2));
const garbageCollect = exposedGarbageCollector();
warmUp(config);
garbageCollect?.();
const baselineMemory = captureMemory();
const baselineResourceUsage = captureResourceUsage();
const fixtureStartedAt = performance.now();
const fixture = createBenchmarkFixture(config);
const fixtureElapsedMilliseconds = performance.now() - fixtureStartedAt;
const afterFixtureMemory = captureMemory();
const afterFixtureResourceUsage = captureResourceUsage();
const calculationStartedAt = performance.now();
const result = executeWorkload(config, fixture.input);
const calculationElapsedMilliseconds =
  config.mode === 'fixture_only' ? null : performance.now() - calculationStartedAt;
const afterCalculationMemory = captureMemory();
const afterCalculationResourceUsage = captureResourceUsage();
const correctness = validateMeasurement(config, fixture, result);
const compactResultSha256 = sha256(compactSemanticResult(config, correctness, result));
const cpuInfo = cpus();
const record = {
  schemaVersion: BENCHMARK_RECORD_SCHEMA_VERSION,
  recordedAt: new Date().toISOString(),
  environment: {
    nodeVersion: process.version,
    runtimeVersions: process.versions,
    platform: process.platform,
    architecture: process.arch,
    cpuModel: cpuInfo[0]?.model ?? 'unknown',
    logicalCpuCount: cpuInfo.length,
    totalSystemMemoryBytes: totalmem(),
  },
  contract: {
    inputSchemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
    resultSchemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
    valueScope: VALUE_SCOPE,
    probabilityMeasureDefinitionVersion: AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION,
    completenessDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION,
    normalizationDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION,
    conditionalMeasureDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION,
    quantileDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
    eventDefinitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION,
    boundsDefinitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION,
    dispersionDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
    statisticsArithmeticDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION,
    measureScope: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE,
  },
  workload: {
    ...config,
    warmUpDrawCount: Math.min(config.drawCount, WARM_UP_DRAW_LIMIT),
    observationAllocation: 'independent_observation_objects_and_reason_code_arrays',
    observationIdentityScope: 'identity_free_source_native_afl_simulation_draws',
    probabilityWeightPolicy: 'equal_positive_binary64_weight_per_draw',
    valueCatalog: {
      size: VALUE_CATALOG.length,
      includesSignedBroadMagnitudes: true,
      includesExactTies: true,
      includesCanonicalPositiveZero: true,
    },
    eventPolicy: {
      lowReturnOperator: 'less_than_or_equal',
      lowReturnThreshold: LOW_RETURN_THRESHOLD,
      eliteOutcomeOperator: 'greater_than_or_equal',
      eliteOutcomeThreshold: ELITE_OUTCOME_THRESHOLD,
    },
  },
  execution: {
    isolatedProcessRequired: true,
    processIsolationPolicy: 'one_workload_mode_draw_count_and_trial_per_process',
    garbageCollectionExposed: garbageCollect !== null,
    calculationBoundary:
      config.mode === 'fixture_only'
        ? 'not_run_fixture_control'
        : 'canonical_facade_with_runtime_input_and_output_validation',
    performanceAcceptanceThresholds: 'none_measurement_only',
    repositoryWrites: 'none_stdout_only',
  },
  units: {
    elapsedTime: 'milliseconds',
    processMemory: 'bytes',
    processResourceUsageMaxRss: 'kilobytes',
    processCpuTime: 'microseconds',
  },
  timings: {
    fixtureGenerationMilliseconds: fixtureElapsedMilliseconds,
    calculationMilliseconds: calculationElapsedMilliseconds,
  },
  memory: {
    baseline: baselineMemory,
    afterFixtureGeneration: afterFixtureMemory,
    afterCalculation: afterCalculationMemory,
    fixtureGenerationDelta: memoryDelta(afterFixtureMemory, baselineMemory),
    calculationDelta: memoryDelta(afterCalculationMemory, afterFixtureMemory),
  },
  resourceUsage: {
    baseline: baselineResourceUsage,
    afterFixtureGeneration: afterFixtureResourceUsage,
    afterCalculation: afterCalculationResourceUsage,
  },
  determinism: {
    compactSemanticResultHashAlgorithm: 'sha256',
    compactSemanticResultSha256: compactResultSha256,
    trialExcludedFromHash: true,
    timestampsTimingsMemoryAndEnvironmentExcludedFromHash: true,
  },
  correctness: { passed: true, ...correctness },
} as const;

process.stdout.write(`${JSON.stringify(record)}\n`);
