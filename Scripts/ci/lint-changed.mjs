#!/usr/bin/env node

// Two modes over the files changed since a base commit:
//
//   npm run lint:changed -- <base-sha>   zero-warning ESLint ratchet on changed `src` files.
//   npm run check:changed [-- <base>]    the default pre-commit check: prettier, ESLint, the
//                                        relevant typecheck(s) once, and `vitest related`.
//
// check mode compares the working tree (committed, staged, unstaged and untracked changes; deleted
// files excluded) with the merge base of `origin/main` unless a base is given.

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const checkMode = args.includes('--check');
const baseArg = args.find((arg) => !arg.startsWith('--'));
const scriptFile = /\.[cm]?[jt]sx?$/;

function git(gitArgs) {
  const result = spawnSync('git', gitArgs, { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function run(command, commandArgs, env = process.env) {
  console.log(`\n$ ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, { env, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  return result.status === 0;
}

function resolveBase() {
  const base = baseArg ?? process.env.STATLY_LINT_BASE_SHA ?? (checkMode ? 'origin/main' : null);
  if (!base) {
    console.error('STATLY_LINT_BASE_SHA or a base SHA argument is required.');
    process.exit(1);
  }
  const exists = spawnSync('git', ['cat-file', '-e', `${base}^{commit}`]);
  if (exists.status !== 0) {
    console.error(`Base commit is unavailable: ${base}`);
    process.exit(exists.status ?? 1);
  }
  return checkMode ? git(['merge-base', base, 'HEAD']).trim() : base;
}

function nulList(output) {
  return output.split('\0').filter(Boolean);
}

const base = resolveBase();

if (!checkMode) {
  const changedSourceFiles = nulList(
    git(['diff', '--name-only', '--diff-filter=ACMR', '-z', base, '--', 'src'])
  ).filter((file) => scriptFile.test(file));

  if (changedSourceFiles.length === 0) {
    console.log('No changed source files require the zero-warning lint gate.');
    process.exit(0);
  }

  console.log(
    `Linting ${changedSourceFiles.length} changed source file(s) with zero warnings allowed.`
  );
  const passed = run('eslint', [...changedSourceFiles, '--max-warnings=0'], {
    ...process.env,
    STATLY_LINT_ADVISORY: '1',
  });
  process.exit(passed ? 0 : 1);
}

const changedFiles = [
  ...new Set([
    ...nulList(git(['diff', '--name-only', '--diff-filter=d', '-z', base])),
    ...nulList(git(['ls-files', '--others', '--exclude-standard', '-z'])),
  ]),
].sort();

if (changedFiles.length === 0) {
  console.log(`check:changed: no files changed since ${base.slice(0, 9)}.`);
  process.exit(0);
}

const scriptFiles = changedFiles.filter((file) => scriptFile.test(file));
// functions/ and etl/ are separate packages with their own lint, typecheck and tests.
const rootScriptFiles = scriptFiles.filter((file) => !/^(functions|etl)\//.test(file));
const isTestFile = (file) =>
  /^tests\//.test(file) || /\.(test|spec)\.[jt]sx?$/.test(file) || /__tests__\//.test(file);
const appTypeFiles = rootScriptFiles.filter(
  (file) => /^src\/.*\.tsx?$/.test(file) && !isTestFile(file)
);
const testTypeFiles = rootScriptFiles.filter((file) => /\.tsx?$/.test(file) && isTestFile(file));

console.log(`check:changed: ${changedFiles.length} file(s) changed since ${base.slice(0, 9)}.`);

const steps = [
  ['prettier', () => run('prettier', ['--check', '--ignore-unknown', ...changedFiles])],
  [
    'eslint',
    rootScriptFiles.length &&
      (() => run('eslint', ['--quiet', '--no-warn-ignored', ...rootScriptFiles])),
  ],
  ['typecheck', appTypeFiles.length && (() => run('npm', ['run', '--silent', 'typecheck']))],
  [
    'typecheck:tests',
    testTypeFiles.length && (() => run('npm', ['run', '--silent', 'typecheck:tests'])),
  ],
  [
    'vitest related',
    rootScriptFiles.length &&
      (() =>
        run('vitest', [
          'related',
          '--run',
          '--passWithNoTests',
          '--config',
          'vitest.config.unit.ts',
          ...rootScriptFiles,
        ])),
  ],
];

const results = steps.map(([name, step]) => [name, step ? (step() ? 'pass' : 'FAIL') : 'skip']);

console.log('\ncheck:changed summary');
for (const [name, outcome] of results) console.log(`  ${outcome.padEnd(4)}  ${name}`);

const failed = results.filter(([, outcome]) => outcome === 'FAIL').map(([name]) => name);
if (failed.length) {
  console.log(`\nFailed: ${failed.join(', ')}. Prettier fixes: npx prettier --write <file>.`);
  process.exit(1);
}
console.log('\nAll changed-file checks passed.');
