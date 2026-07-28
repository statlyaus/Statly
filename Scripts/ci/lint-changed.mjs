#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const baseSha = process.env.STATLY_LINT_BASE_SHA ?? process.argv[2];

if (!baseSha) {
  console.error('STATLY_LINT_BASE_SHA or a base SHA argument is required.');
  process.exit(1);
}

const baseCheck = spawnSync('git', ['cat-file', '-e', `${baseSha}^{commit}`], {
  encoding: 'utf8',
});

if (baseCheck.status !== 0) {
  console.error(`Lint base commit is unavailable: ${baseSha}`);
  process.exit(baseCheck.status ?? 1);
}

const changedFilesResult = spawnSync(
  'git',
  ['diff', '--name-only', '--diff-filter=ACMR', '-z', baseSha, '--', 'src'],
  { encoding: 'utf8' }
);

if (changedFilesResult.status !== 0) {
  process.stderr.write(changedFilesResult.stderr);
  process.exit(changedFilesResult.status ?? 1);
}

const changedSourceFiles = changedFilesResult.stdout
  .split('\0')
  .filter((file) => /\.[cm]?[jt]sx?$/.test(file));

if (changedSourceFiles.length === 0) {
  console.log('No changed source files require the zero-warning lint gate.');
  process.exit(0);
}

console.log(
  `Linting ${changedSourceFiles.length} changed source file(s) with zero warnings allowed.`
);
const lintResult = spawnSync('eslint', [...changedSourceFiles, '--max-warnings=0'], {
  stdio: 'inherit',
});

if (lintResult.error) {
  console.error(lintResult.error.message);
  process.exit(1);
}

process.exit(lintResult.status ?? 1);
