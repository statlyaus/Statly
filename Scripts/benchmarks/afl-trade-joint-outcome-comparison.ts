import { cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';

import {
  AFL_TRADE_JOINT_OUTCOME_BOUNDS_DEFINITION_VERSION,
  AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
  AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION,
  AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION,
  AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_JOINT_OUTCOME_SCHEMA_VERSION,
  AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
  calculateAflTradeJointOutcomeComparison,
  type AflTradeJointOutcomeComparison,
  type AflTradeJointOutcomeComparisonInput,
} from '../../src/server/aflTradeIntelligence/valuation/jointOutcomeComparison';

const BENCHMARK_RECORD_SCHEMA_VERSION =
  'afl-trade-joint-outcome-comparison-benchmark-record/v2' as const;
const BENCHMARK_CLEAR_LEADER_TOLERANCE_QUANTA = 10;
const WORKLOAD_MODES = ['fixture_only', 'fully_available', 'unavailable_last_party'] as const;

type WorkloadMode = (typeof WORKLOAD_MODES)[number];
interface BenchmarkConfig {
  clubCount: number;
  drawCount: number;
  mode: WorkloadMode;
  trial: number;
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
  generatedPartyObservationCount: number;
  resultStatus: 'not_run' | AflTradeJointOutcomeComparison['status'];
  resultDrawCount: number | null;
  availableProbabilityMass: number | null;
  unavailableProbabilityMass: number | null;
  exhaustiveAvailableProbability: number | null;
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
    if (!['--clubs', '--draws', '--mode', '--trial'].includes(flag)) {
      throw new Error(`Unsupported benchmark flag: ${flag}`);
    }
    if (values.has(flag)) throw new Error(`Duplicate benchmark flag: ${flag}`);
    values.set(flag, value);
  }

  if (values.size !== 4) {
    throw new Error('Required flags: --clubs, --draws, --mode, and --trial.');
  }
  const mode = values.get('--mode');
  if (!WORKLOAD_MODES.includes(mode as WorkloadMode)) {
    throw new Error(`--mode must be one of: ${WORKLOAD_MODES.join(', ')}.`);
  }

  return {
    clubCount: parseBoundedInteger({
      flag: '--clubs',
      rawValue: values.get('--clubs'),
      minimum: 2,
      maximum: 18,
    }),
    drawCount: parseBoundedInteger({
      flag: '--draws',
      rawValue: values.get('--draws'),
      minimum: 1,
      maximum: 100_000,
    }),
    mode: mode as WorkloadMode,
    trial: parseBoundedInteger({
      flag: '--trial',
      rawValue: values.get('--trial'),
      minimum: 1,
      maximum: 1_000,
    }),
  };
}

function createBenchmarkInput(config: BenchmarkConfig): AflTradeJointOutcomeComparisonInput {
  const aflClubIds = Array.from(
    { length: config.clubCount },
    (_, index) => `club-${String(index).padStart(2, '0')}`
  );
  const probabilityWeight = 1 / config.drawCount;

  return {
    inputSchemaVersion: AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    comparisonValueScope: AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
    outcomeDefinitionVersion: AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION,
    valueUnitId: 'benchmark-contribution-unit',
    valueScale: {
      definitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
      decimalPlaces: 2,
    },
    aflClubIds,
    clearLeaderToleranceQuanta: BENCHMARK_CLEAR_LEADER_TOLERANCE_QUANTA,
    draws: Array.from({ length: config.drawCount }, (_, drawIndex) => {
      const outcomeIndex = drawIndex % (config.clubCount + 1);
      const noClearLeaderDraw = outcomeIndex === config.clubCount;
      return {
        drawKey: `draw-${String(drawIndex).padStart(6, '0')}`,
        probabilityWeight,
        parties: aflClubIds.map((aflClubId, clubIndex) => ({
          aflClubId,
          observation:
            config.mode === 'unavailable_last_party' && clubIndex === config.clubCount - 1
              ? {
                  status: 'unavailable' as const,
                  reasonCodes: ['benchmark-source-missing'],
                }
              : {
                  status: 'available' as const,
                  valueQuanta: noClearLeaderDraw
                    ? clubIndex < 2
                      ? 1_000 - clubIndex * 5
                      : 0
                    : clubIndex === outcomeIndex
                      ? 1_000
                      : 0,
                },
        })),
      };
    }),
  };
}

function executeWorkload(
  config: BenchmarkConfig,
  input: AflTradeJointOutcomeComparisonInput
): AflTradeJointOutcomeComparison | null {
  return config.mode === 'fixture_only' ? null : calculateAflTradeJointOutcomeComparison(input);
}

function warmUp(config: BenchmarkConfig): void {
  const warmUpConfig = {
    ...config,
    drawCount: Math.min(config.drawCount, 1_000),
    trial: 0,
  };
  const warmUpInput = createBenchmarkInput(warmUpConfig);
  executeWorkload(warmUpConfig, warmUpInput);
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

function validateMeasurement(
  config: BenchmarkConfig,
  input: AflTradeJointOutcomeComparisonInput,
  result: AflTradeJointOutcomeComparison | null
): CorrectnessSummary {
  const generatedPartyObservationCount = config.drawCount * config.clubCount;
  if (
    input.aflClubIds.length !== config.clubCount ||
    input.draws.length !== config.drawCount ||
    input.draws[0]?.parties.length !== config.clubCount ||
    input.draws.at(-1)?.parties.length !== config.clubCount ||
    input.clearLeaderToleranceQuanta !== BENCHMARK_CLEAR_LEADER_TOLERANCE_QUANTA ||
    input.outcomeDefinitionVersion !== AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION
  ) {
    throw new Error('Generated benchmark workload does not match its requested shape and policy.');
  }

  if (config.mode === 'fixture_only') {
    if (result !== null) throw new Error('Fixture-only workload unexpectedly ran calculation.');
    return {
      generatedDrawCount: input.draws.length,
      generatedPartyObservationCount,
      resultStatus: 'not_run',
      resultDrawCount: null,
      availableProbabilityMass: null,
      unavailableProbabilityMass: null,
      exhaustiveAvailableProbability: null,
    };
  }
  if (result === null) throw new Error('Calculated workload did not return a result.');
  if (
    result.drawCount !== config.drawCount ||
    result.aflClubIds.length !== config.clubCount ||
    result.availableDrawCount + result.unavailableDrawCount !== config.drawCount ||
    result.clearLeaderToleranceQuanta !== input.clearLeaderToleranceQuanta ||
    result.outcomeDefinitionVersion !== input.outcomeDefinitionVersion
  ) {
    throw new Error('Calculated benchmark result does not reconcile with its input contract.');
  }

  if (config.mode === 'fully_available') {
    if (result.status !== 'available') {
      throw new Error('Fully available benchmark workload returned unavailable status.');
    }
    const exhaustiveAvailableProbability = result.probabilities.clubClearLeaderProbabilities.reduce(
      (sum, probability) => sum + probability.probability,
      result.probabilities.noClearLeaderProbability
    );
    if (Math.abs(exhaustiveAvailableProbability - 1) > 1e-8) {
      throw new Error('Fully available benchmark probabilities are not exhaustive.');
    }
    return {
      generatedDrawCount: input.draws.length,
      generatedPartyObservationCount,
      resultStatus: result.status,
      resultDrawCount: result.drawCount,
      availableProbabilityMass: result.availableProbabilityMass,
      unavailableProbabilityMass: result.unavailableProbabilityMass,
      exhaustiveAvailableProbability,
    };
  }

  if (
    result.status !== 'unavailable' ||
    result.availableDrawCount !== 0 ||
    result.unavailableDrawCount !== config.drawCount ||
    result.availableProbabilityMass !== 0 ||
    result.unavailableProbabilityMass !== 1 ||
    result.conditionalOnAvailableProbabilities !== null ||
    !result.reasonCodes.includes('benchmark-source-missing')
  ) {
    throw new Error('Unavailable-last-party benchmark result did not fail closed as expected.');
  }
  return {
    generatedDrawCount: input.draws.length,
    generatedPartyObservationCount,
    resultStatus: result.status,
    resultDrawCount: result.drawCount,
    availableProbabilityMass: result.availableProbabilityMass,
    unavailableProbabilityMass: result.unavailableProbabilityMass,
    exhaustiveAvailableProbability: null,
  };
}

const config = parseBenchmarkConfig(process.argv.slice(2));
const garbageCollect = exposedGarbageCollector();
warmUp(config);
garbageCollect?.();
const baselineMemory = captureMemory();
const fixtureStartedAt = performance.now();
const workload = createBenchmarkInput(config);
const fixtureElapsedMilliseconds = performance.now() - fixtureStartedAt;
const afterFixtureMemory = captureMemory();
const calculationStartedAt = performance.now();
const result = executeWorkload(config, workload);
const calculationElapsedMilliseconds =
  config.mode === 'fixture_only' ? null : performance.now() - calculationStartedAt;
const afterCalculationMemory = captureMemory();
const correctness = validateMeasurement(config, workload, result);
const cpuInfo = cpus();
const record = {
  schemaVersion: BENCHMARK_RECORD_SCHEMA_VERSION,
  recordedAt: new Date().toISOString(),
  environment: {
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    platform: process.platform,
    architecture: process.arch,
    cpuModel: cpuInfo[0]?.model ?? 'unknown',
    logicalCpuCount: cpuInfo.length,
    totalSystemMemoryBytes: totalmem(),
  },
  contract: {
    inputSchemaVersion: AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION,
    resultSchemaVersion: AFL_TRADE_JOINT_OUTCOME_SCHEMA_VERSION,
    outcomeDefinitionVersion: AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION,
    boundsDefinitionVersion: AFL_TRADE_JOINT_OUTCOME_BOUNDS_DEFINITION_VERSION,
    valueScaleDefinitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
    publicAssetBoundary: AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    comparisonValueScope: AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
  },
  workload: {
    ...config,
    warmUpDrawCount: Math.min(config.drawCount, 1_000),
    independentlyAllocatedDrawsAndParties: true,
    probabilityWeightPolicy: 'equal_weight_per_draw',
    comparisonPolicy: {
      clearLeaderToleranceQuanta: BENCHMARK_CLEAR_LEADER_TOLERANCE_QUANTA,
    },
  },
  execution: {
    isolatedProcessRequired: true,
    garbageCollectionExposed: garbageCollect !== null,
    calculationBoundary:
      config.mode === 'fixture_only'
        ? 'not_run_fixture_control'
        : 'exported_calculate_function_with_runtime_input_and_output_validation',
    repositoryWrites: 'none',
  },
  units: {
    elapsedTime: 'milliseconds',
    processMemory: 'bytes',
    processResourceUsageMaxRss: 'kilobytes',
  },
  timings: {
    fixtureGenerationMilliseconds: fixtureElapsedMilliseconds,
    calculationMilliseconds: calculationElapsedMilliseconds,
  },
  memory: {
    baseline: baselineMemory,
    afterFixtureGeneration: afterFixtureMemory,
    afterCalculation: afterCalculationMemory,
  },
  correctness: { passed: true, ...correctness },
} as const;

process.stdout.write(`${JSON.stringify(record)}\n`);
