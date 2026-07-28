import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dependency and runtime hygiene', () => {
  it('removes only unused UI packages and retains active icon libraries', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
    };
    const dependencies = packageJson.dependencies ?? {};

    expect(dependencies).not.toHaveProperty('react-icons');
    expect(dependencies).not.toHaveProperty('canvas-confetti');
    expect(dependencies).not.toHaveProperty('react-confetti');
    expect(dependencies).toHaveProperty('@heroicons/react');
    expect(dependencies).toHaveProperty('lucide-react');
  });

  it('aligns the production container with the declared Node major', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      engines?: { node?: string };
    };

    expect(packageJson.engines?.node).toBe('>=22 <23');
    expect(read('Dockerfile')).toContain('FROM node:22-alpine AS base');
  });

  it('keeps the dead API placeholder absent and override policy documented', () => {
    expect(existsSync(join(process.cwd(), 'src/app/api/api.ts'))).toBe(false);

    const policy = read('docs/development/dependency-overrides.md');
    for (const dependency of ['zod', '@google-cloud/firestore', 'node-forge', 'jws']) {
      expect(policy).toContain(dependency);
    }
    expect(policy).toContain('Do not use a forced audit fix');
  });
});

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}
