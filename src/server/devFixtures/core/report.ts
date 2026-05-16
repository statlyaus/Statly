import { DEV_FIXTURE_MANIFEST } from './manifest';
import type { DevFixtureRunResult } from './types';

export function formatScenarioList() {
  return DEV_FIXTURE_MANIFEST.scenarios
    .map((scenario) => `${scenario.id}\t${scenario.description}`)
    .join('\n');
}

export function formatRunResult(result: DevFixtureRunResult) {
  const lines = [
    `Command: ${result.command}`,
    result.scenarioId ? `Scenario: ${result.scenarioId}` : null,
    result.ownerUserId ? `Owner: ${result.ownerUserId}` : null,
    `Status: ${result.ok ? 'ok' : 'failed'}`,
  ].filter((line): line is string => Boolean(line));

  if (result.steps.length > 0) {
    lines.push('', 'Steps:');
    for (const step of result.steps) {
      lines.push(`- ${step.status}: ${step.name} - ${step.detail}`);
    }
  }

  if (result.leagues.length > 0) {
    lines.push('', 'Leagues:');
    for (const league of result.leagues) {
      lines.push(
        `- ${league.ready ? 'ready' : 'not ready'}: ${league.name} (${league.url}) members=${league.memberCount} bots=${league.botCount} rosters=${league.rosteredMemberCount} draft=${league.draftStatus ?? 'none'} matchups=${league.matchupCount}`
      );
      for (const issue of league.issues) {
        lines.push(`  issue: ${issue}`);
      }
    }
  }

  if (result.issues.length > 0) {
    lines.push('', 'Issues:');
    for (const issue of result.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return lines.join('\n');
}
