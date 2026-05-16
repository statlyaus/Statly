#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';

const git = (args, options = {}) =>
  execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    ...options,
  });

const section = (title) => {
  console.log(`\n== ${title} ==`);
};

const printOrFallback = (value, fallback) => {
  const text = value.trim();
  console.log(text.length > 0 ? text : fallback);
};

const splitNull = (value) => value.split('\0').filter(Boolean);

const isHighRiskPath = (filePath) => {
  const normalized = filePath.replaceAll('\\', '/');
  const basename = normalized.split('/').at(-1) ?? normalized;

  if (normalized === '.env' || normalized.startsWith('.env.')) {
    return !['.env.example', '.env.sample', '.env.template'].includes(normalized);
  }

  return (
    normalized.startsWith('.firebase-data/') ||
    normalized.startsWith('firebase-export-') ||
    normalized.startsWith('dataconnect/.dataconnect/') ||
    normalized.startsWith('.next/') ||
    normalized.startsWith('dist/') ||
    normalized.startsWith('coverage/') ||
    normalized.includes('/node_modules/') ||
    normalized.startsWith('node_modules/') ||
    normalized.startsWith('tmp/') ||
    normalized.startsWith('tmp-') ||
    normalized.startsWith('.cache/') ||
    basename.endsWith('.local') ||
    basename.endsWith('.log') ||
    basename.endsWith('.sqlite') ||
    basename.endsWith('.sqlite3') ||
    basename.endsWith('.db') ||
    basename.endsWith('.dump') ||
    basename.endsWith('.tmp')
  );
};

let exitCode = 0;

try {
  section('Branch');
  printOrFallback(git(['status', '--short', '--branch']), 'No status output.');

  section('Unstaged Diff Stat');
  printOrFallback(git(['diff', '--stat']), 'No unstaged changes.');

  section('Staged Diff Stat');
  printOrFallback(git(['diff', '--cached', '--stat']), 'No staged changes.');

  section('Untracked Files');
  printOrFallback(git(['ls-files', '--others', '--exclude-standard']), 'No untracked files.');

  section('Whitespace Check');
  const whitespace = spawnSync('git', ['diff', '--check'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (whitespace.status === 0) {
    console.log('No whitespace errors in unstaged or staged changes.');
  } else {
    process.stdout.write(whitespace.stdout);
    process.stderr.write(whitespace.stderr);
    exitCode = 1;
  }

  section('Staged High-Risk Paths');
  const stagedFiles = splitNull(git(['diff', '--cached', '--name-only', '-z']));
  const highRiskStagedFiles = stagedFiles.filter(isHighRiskPath);

  if (highRiskStagedFiles.length === 0) {
    console.log('No staged high-risk local artifact paths detected.');
  } else {
    console.error('Staged high-risk local artifact paths detected:');
    for (const filePath of highRiskStagedFiles) {
      console.error(` - ${filePath}`);
    }
    exitCode = 1;
  }

  section('Untracked High-Risk Paths');
  const untrackedFiles = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const highRiskUntrackedFiles = untrackedFiles.filter(isHighRiskPath);

  if (highRiskUntrackedFiles.length === 0) {
    console.log('No untracked high-risk local artifact paths detected.');
  } else {
    console.warn('Untracked high-risk local artifact paths detected; do not stage without explicit approval:');
    for (const filePath of highRiskUntrackedFiles) {
      console.warn(` - ${filePath}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
}

process.exit(exitCode);
