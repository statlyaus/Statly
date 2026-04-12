#!/usr/bin/env node
/**
 * Configures Git to use versioned hooks (.githooks) and ensures hook scripts are executable (Unix).
 * Invoked by `npm run prepare` after install and by `npm run setup:hooks` manually.
 * Never fails the install: skips when not in a Git checkout, in CI, or when git is unavailable.
 */
import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const gitMeta = join(root, '.git');
const hooksDir = join(root, '.githooks');

if (process.env.CI === 'true' || process.env.CI === '1') {
  process.exit(0);
}

if (!existsSync(gitMeta)) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: root,
    stdio: 'ignore',
  });
} catch {
  process.exit(0);
}

console.log('statly: Git hooks path set to .githooks (pre-push runs npm run prepush:ci)');

if (process.platform !== 'win32' && existsSync(hooksDir)) {
  const prePush = join(hooksDir, 'pre-push');
  if (existsSync(prePush)) {
    try {
      chmodSync(prePush, 0o755);
    } catch {
      /* ignore */
    }
  }
}
