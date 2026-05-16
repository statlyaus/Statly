import { prisma } from '@/lib/prisma';

import { DEV_FIXTURE_MANIFEST, isDevFixtureScenarioId } from './manifest';
import { formatRunResult, formatScenarioList } from './report';
import { assertNotProduction } from './safety';
import type { DevFixtureCliOptions, DevFixtureCommand } from './types';

function isDevFixtureCommand(value: string): value is DevFixtureCommand {
  return value === 'list' || value === 'apply' || value === 'verify' || value === 'reset';
}

export function parseDevFixtureCliArgs(argv: string[]): DevFixtureCliOptions {
  const [commandValue, scenarioValue, ...rest] = argv;
  if (!commandValue || !isDevFixtureCommand(commandValue)) {
    throw new Error('Usage: npm run dev:fixtures -- <list|apply|verify|reset> [scenario] [--json] [--fixture-owned]');
  }

  const scenarioId =
    scenarioValue && !scenarioValue.startsWith('--')
      ? scenarioValue
      : commandValue === 'list'
        ? undefined
        : '';
  const flags = scenarioValue?.startsWith('--') ? [scenarioValue, ...rest] : rest;

  if (commandValue !== 'list' && (!scenarioId || !isDevFixtureScenarioId(scenarioId))) {
    const valid = DEV_FIXTURE_MANIFEST.scenarios.map((scenario) => scenario.id).join(', ');
    throw new Error(`Unknown or missing scenario. Valid scenarios: ${valid}`);
  }

  return {
    command: commandValue,
    scenarioId: scenarioId && isDevFixtureScenarioId(scenarioId) ? scenarioId : undefined,
    outputFormat: flags.includes('--json') ? 'json' : 'text',
    fixtureOwned: flags.includes('--fixture-owned'),
  };
}

export async function runDevFixtures(options: DevFixtureCliOptions) {
  if (options.command === 'list') {
    return formatScenarioList();
  }

  assertNotProduction();

  if (!options.scenarioId) {
    throw new Error('Scenario is required.');
  }

  const { getDevFixtureScenario } = await import('../scenarios');
  const scenario = getDevFixtureScenario(options.scenarioId);
  const result =
    options.command === 'apply'
      ? await scenario.apply()
      : options.command === 'verify'
        ? await scenario.verify()
        : await scenario.reset({ fixtureOwned: options.fixtureOwned });

  return options.outputFormat === 'json' ? JSON.stringify(result, null, 2) : formatRunResult(result);
}

export async function disconnectDevFixtureRunner() {
  const { ScalableRedisConnection } = await import('@/server/realtime/scalableConnection');
  await ScalableRedisConnection.getInstance().shutdown();
  await prisma.$disconnect();
}
