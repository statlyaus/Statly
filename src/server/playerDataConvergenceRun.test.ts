import { describe, expect, it } from 'vitest';

import {
  buildPlayerDataConvergenceRun,
  parseConvergenceRounds,
} from './playerDataConvergenceRun';

describe('parseConvergenceRounds', () => {
  it('normalizes comma-separated round lists', () => {
    expect(parseConvergenceRounds('2,0,2,1')).toEqual([0, 1, 2]);
  });

  it('rejects empty or unsafe round values', () => {
    expect(() => parseConvergenceRounds('')).toThrow(
      'Expected --rounds with at least one non-negative integer round'
    );
    expect(() => parseConvergenceRounds('0,1.5')).toThrow(
      'Expected --rounds to contain only comma-separated non-negative integers'
    );
  });
});

describe('buildPlayerDataConvergenceRun', () => {
  it('plans a dry-run convergence sequence by default', () => {
    const run = buildPlayerDataConvergenceRun({
      season: 2026,
      rounds: [0],
      runId: '2026-05-05T00-00-00-000Z',
      applyDirectorySync: false,
      includeMergedLive: true,
      skipBuild: false,
      skipVerify: false,
      json: true,
    });

    expect(run.artifactDir).toBe('tmp/player-data-convergence/2026-r0-2026-05-05T00-00-00-000Z');
    expect(run.commands.map((command) => command.phase)).toEqual([
      'diagnose',
      'sync-dry-run',
      'build-read-models',
      'verify-read-models',
    ]);
    expect(run.commands[0].args).toContain('--output-jsonl');
    expect(run.commands[1].args).toContain('--diagnostic-jsonl');
    expect(run.commands[1].args).not.toContain('--apply');
    expect(run.commands[2].args).toContain('--mode=refresh');
    expect(run.commands[3].args).toContain('--include-merged-live');
  });

  it('adds an explicit apply phase only when requested', () => {
    const run = buildPlayerDataConvergenceRun({
      season: 2026,
      rounds: [0, 1],
      runId: '2026-05-05T00-00-00-000Z',
      applyDirectorySync: true,
      includeMergedLive: false,
      skipBuild: false,
      skipVerify: false,
      json: true,
    });

    expect(run.commands.map((command) => command.phase)).toEqual([
      'diagnose',
      'sync-dry-run',
      'sync-apply',
      'build-read-models',
      'verify-read-models',
    ]);
    expect(run.commands[2].args).toContain('--apply');
    expect(run.commands[3].args).toContain('--rounds=0,1');
  });

  it('supports diagnostic-only investigation without build or verify', () => {
    const run = buildPlayerDataConvergenceRun({
      season: 2026,
      rounds: [0],
      runId: '2026-05-05T00-00-00-000Z',
      applyDirectorySync: false,
      includeMergedLive: false,
      skipBuild: true,
      skipVerify: true,
      json: false,
    });

    expect(run.commands.map((command) => command.phase)).toEqual(['diagnose', 'sync-dry-run']);
    expect(run.commands[0].args).not.toContain('--json');
  });
});
