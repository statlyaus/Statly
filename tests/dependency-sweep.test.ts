import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildDependencyRows,
  classifyDependencyUpgrade,
  formatDependencyReport,
} from '../Scripts/dependency-sweep.mjs';

describe('classifyDependencyUpgrade', () => {
  it('marks exact-version patch bumps as safe', () => {
    expect(
      classifyDependencyUpgrade({
        name: 'firebase-admin',
        current: '13.6.0',
        latest: '13.8.0',
        workspace: 'root',
      })
    ).toEqual({
      lane: 'safe',
      reason: 'same major version; patch/minor candidate',
    });
  });

  it('marks major upgrades as hold', () => {
    expect(
      classifyDependencyUpgrade({
        name: 'lucide-react',
        current: '0.544.0',
        latest: '1.0.0',
        workspace: 'root',
      })
    ).toEqual({
      lane: 'hold',
      reason: 'major version change requires dedicated migration review',
    });
  });

  it('routes framework and infra packages to review even within the same major', () => {
    expect(
      classifyDependencyUpgrade({
        name: 'openai',
        current: '5.20.2',
        latest: '5.21.0',
        workspace: 'root',
      })
    ).toEqual({
      lane: 'review',
      reason: 'package is pinned to explicit migration review policy',
    });
  });
});

describe('buildDependencyRows', () => {
  it('reads matching packages across root, etl, and functions', () => {
    const rows = buildDependencyRows([
      {
        workspace: 'root',
        manifestPath: 'package.json',
        dependencies: {
          'firebase-admin': '13.6.0',
          dotenv: '^17.2.2',
        },
        devDependencies: {},
      },
      {
        workspace: 'etl',
        manifestPath: 'etl/package.json',
        dependencies: {
          'firebase-admin': '13.8.0',
          dotenv: '^17.4.1',
        },
        devDependencies: {},
      },
      {
        workspace: 'functions',
        manifestPath: 'functions/package.json',
        dependencies: {
          'firebase-admin': '13.8.0',
        },
        devDependencies: {},
      },
    ]);

    expect(rows).toEqual([
      {
        name: 'dotenv',
        workspaces: {
          etl: '^17.4.1',
          root: '^17.2.2',
        },
      },
      {
        name: 'firebase-admin',
        workspaces: {
          etl: '13.8.0',
          functions: '13.8.0',
          root: '13.6.0',
        },
      },
    ]);
  });
});

describe('formatDependencyReport', () => {
  it('prints a stable markdown summary', () => {
    expect(
      formatDependencyReport({
        generatedAt: '2026-04-29T12:06:50Z',
        packageRows: [
          {
            name: 'firebase-admin',
            workspaces: {
              root: '13.6.0',
              etl: '13.8.0',
              functions: '13.8.0',
            },
          },
        ],
        upgradeCandidates: [
          {
            name: 'firebase-admin',
            workspace: 'root',
            current: '13.6.0',
            latest: '13.8.0',
            lane: 'safe',
            reason: 'same major version; patch/minor candidate',
          },
        ],
        warnings: [],
      })
    ).toContain('| firebase-admin | 13.6.0 | 13.8.0 | 13.8.0 |');
  });
});

describe('dependency-sweep cli', () => {
  it('prints repo report rows for all workspace manifests', () => {
    const result = spawnSync(process.execPath, ['Scripts/dependency-sweep.mjs', '--fixtures'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('# Dependency Sweep Report');
    expect(result.stdout).toContain('| firebase-admin | 13.6.0 | 13.8.0 | 13.8.0 |');
    expect(result.stdout).toContain('## Upgrade Candidates');
    expect(result.stdout).toContain('| root | openai | 5.20.2 | 5.21.0 | review |');
  });
});
