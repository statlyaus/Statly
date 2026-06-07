#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const message = process.argv.slice(2).join(' ').trim();

if (!message) {
  fail('Usage: npm run codex:commit:reviewed -- "commit message"');
}

const repoRoot = git(['rev-parse', '--show-toplevel']);
process.chdir(repoRoot);

const stagedFiles = lines(git(['diff', '--cached', '--name-only', '--diff-filter=ACMRT']));
if (stagedFiles.length === 0) {
  fail('No staged changes to review or commit.');
}

const blockedFiles = stagedFiles.filter(isBlockedCommitFile);
if (blockedFiles.length > 0) {
  fail(`Blocked local/generated files are staged:\n${blockedFiles.join('\n')}`);
}

const unstagedFiles = new Set(lines(git(['diff', '--name-only'])));
const overlappingFiles = stagedFiles.filter((file) => unstagedFiles.has(file));
if (overlappingFiles.length > 0) {
  fail(`These files have both staged and unstaged changes:\n${overlappingFiles.join('\n')}`);
}

run(['git', 'diff', '--check', '--cached']);
const councilOutput = runCapture([
  'node',
  'Scripts/codex/council.mjs',
  '--provider',
  'logical',
  '--staged',
  '--prompt',
  'Chairman Decision 2: decide whether the staged Statly changes should be committed. Report the committee debate, agreement, clashes, blind spots, recommendation, and one next step.',
]);
if (!councilOutput.includes('CHAIRMAN DECISION 2: COMMIT')) {
  fail('Chairman Decision 2 did not approve commit.');
}

run(['git', 'commit', '-m', message]);

function run(command) {
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runCapture(command) {
  const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return `${result.stdout}\n${result.stderr}`;
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function lines(value) {
  return value.split('\n').filter(Boolean);
}

function isBlockedCommitFile(file) {
  const name = file.split('/').pop() ?? file;
  return file === 'prisma/dev.db' || file.endsWith('.db') || name.startsWith('.env');
}

function fail(messageText) {
  console.error(messageText);
  process.exit(1);
}
