import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Docker build context safety', () => {
  it('excludes every repository-known service credential filename family', () => {
    const patterns = new Set(
      readFileSync(resolve(process.cwd(), '.dockerignore'), 'utf8')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
    );

    for (const requiredPattern of [
      '.env*',
      '.Renviron',
      '**/.Renviron',
      '**/credentials',
      '**/credentials/**',
      '**/*service-account*.json',
      '**/*service_account*.json',
      '**/*serviceAccount*.json',
      '**/sa.b64',
      '**/sa.dec.json',
      '**/key.txt',
      '**/statly-*.json',
      '**/firebase-export*',
      '**/.firebase/**',
    ]) {
      expect(patterns.has(requiredPattern), requiredPattern).toBe(true);
    }
  });
});
