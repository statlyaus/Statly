// @vitest-environment node
import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

import { classifyChangedFiles, suitesForFile } from '../../Scripts/ci/changed-suites.mjs';

const isTestFile = (file: string) => /(\/__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$)/.test(file);

// The app's AFL Draft and Trade Outcomes pages and routes, stated independently of the classifier.
const OUTCOMES_APP_SURFACES =
  /^src\/app\/(\(public\)\/draft\/|api\/draft-trades\/|(api\/)?dev\/afl-trade-)/;

const files = (...patterns: string[]) => patterns.flatMap((pattern) => globSync(pattern));

async function importClosure(entryPoints: string[]): Promise<string[]> {
  const result = await build({
    entryPoints,
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outdir: 'ci-changed-suites-closure',
    tsconfig: 'tsconfig.json',
    jsx: 'automatic',
    logLevel: 'silent',
    loader: { '.css': 'empty', '.png': 'empty', '.sql': 'text', '.svg': 'empty' },
  });
  return Object.keys(result.metafile.inputs);
}

// Repository paths a file names in a string literal, such as read('docs/development/setup.md') or a
// migration directory. A named directory stands for every file under it.
function pathsNamedBy(files: string[]): string[] {
  const named = new Set<string>();
  for (const file of files) {
    for (const [, candidate] of readFileSync(file, 'utf8').matchAll(
      /['"`]([\w.@()[\]/-]+)['"`]/g
    )) {
      if (!/\/|\.\w+$/.test(candidate) || /^(\.\.?\/|\/|node_modules)/.test(candidate)) continue;
      if (!existsSync(candidate)) continue;
      if (statSync(candidate).isDirectory()) {
        for (const nested of globSync(`${candidate}/**/*`)) {
          if (statSync(nested).isFile()) named.add(nested);
        }
      } else {
        named.add(candidate);
      }
    }
  }
  return [...named];
}

const missing = (files: string[], suite: string) =>
  files.filter((file) => !suitesForFile(file).includes(suite)).sort();

describe('changed-suites classifier', () => {
  it.each([
    {
      change: 'a root Dependabot npm bump',
      files: ['package.json', 'package-lock.json'],
      on: ['root', 'fantasy_app', 'outcomes'],
    },
    {
      change: 'an /etl Dependabot npm bump',
      files: ['etl/package.json', 'etl/package-lock.json'],
      on: ['root', 'etl'],
    },
    {
      change: 'a /functions Dependabot npm bump',
      files: ['functions/package.json', 'functions/package-lock.json'],
      on: ['root', 'functions'],
    },
    {
      change: 'an outcomes change',
      files: [
        'Scripts/compute-value-lines.ts',
        'docs/architecture/afl-trade-intelligence.md',
        'src/server/aflTradeIntelligence/valuation/valueLines.ts',
        'tests/unit/afl-trade-intelligence-value-lines.test.ts',
      ],
      on: ['root', 'outcomes'],
    },
    {
      change: 'an outcomes migration',
      files: ['prisma/afl-trade-outcomes/migrations/0300_example/migration.sql'],
      on: ['root', 'outcomes'],
    },
    {
      change: 'a fantasy app change',
      files: ['src/server/draft/draftService.ts', 'tests/e2e/draft.spec.ts'],
      on: ['root', 'fantasy_app'],
    },
    {
      change: 'a unit-test-only change',
      files: ['tests/unit/example.test.ts', 'src/lib/__tests__/example.test.ts'],
      on: ['root'],
    },
    {
      change: 'a doc that a unit test reads',
      files: ['docs/development/setup.md'],
      on: ['root'],
    },
    {
      change: 'the CI workflow',
      files: ['.github/workflows/ci.yml'],
      on: ['root', 'fantasy_app', 'outcomes', 'etl', 'functions'],
    },
  ])('$change runs $on', ({ files, on }) => {
    const outputs = classifyChangedFiles(files);
    expect(
      Object.keys(outputs)
        .filter((key) => outputs[key] && key !== 'docs_only')
        .sort()
    ).toEqual([...on].sort());
    expect(outputs.docs_only).toBe(false);
  });

  it('runs no suite for a documentation-only change', () => {
    expect(classifyChangedFiles(['docs/runbooks/example.md', 'CHANGELOG.md'])).toEqual({
      docs_only: true,
      root: false,
      fantasy_app: false,
      outcomes: false,
      etl: false,
      functions: false,
    });
  });
});

// These guards keep the path lists honest: when a test or page starts importing or reading a file
// whose change would not turn its suite on, they fail and name the file to add to
// Scripts/ci/changed-suites.mjs.
describe('changed-suites drift guards', () => {
  it('turns the outcomes suite on for everything the outcomes tests import or name', async () => {
    const closure = await importClosure([
      ...files('tests/outcomes-integration/**/*.test.ts'),
      'vitest.config.outcomes-int.ts',
    ]);
    expect(missing([...closure, ...pathsNamedBy(closure)], 'outcomes')).toEqual([]);
  }, 60_000);

  it('turns the fantasy suites on for everything the fantasy app and its tests import or name', async () => {
    const app = files(
      'src/app/**/*.{ts,tsx}',
      'src/server/*.ts',
      'src/server/workers/**/*.ts',
      'src/proxy.ts'
    ).filter((file) => !isTestFile(file) && !OUTCOMES_APP_SURFACES.test(file));
    const closure = await importClosure([
      ...app,
      ...files('tests/integration/**/*.{ts,tsx}', 'tests/e2e/**/*.ts', 'tests/setup/int.*.ts'),
      'playwright.config.ts',
      'vitest.config.int.ts',
    ]);
    expect(missing([...closure, ...pathsNamedBy(closure)], 'fantasy_app')).toEqual([]);
  }, 60_000);

  it('turns the root suite on for every path a unit test names', () => {
    // This file names example paths, not paths it reads.
    const unitTests = files('tests/unit/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}').filter(
      (file) => isTestFile(file) && file !== 'tests/unit/ciChangedSuites.test.ts'
    );
    expect(missing(pathsNamedBy(unitTests), 'root')).toEqual([]);
  });
});
