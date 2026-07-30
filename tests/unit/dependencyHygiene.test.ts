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

  it('aligns active application, Functions, Firebase, and ETL runtimes on Node 22', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      engines?: { node?: string };
    };
    const functionsPackageJson = JSON.parse(read('functions/package.json')) as {
      engines?: { node?: string };
    };
    const etlPackageJson = JSON.parse(read('etl/package.json')) as {
      engines?: { node?: string };
    };
    const firebaseJson = JSON.parse(read('firebase.json')) as {
      functions?: Array<{ predeploy?: string[]; runtime?: string }>;
    };
    const functionsConfig = firebaseJson.functions?.[0];
    const etlDockerfile = read('etl/Dockerfile');

    expect(packageJson.engines?.node).toBe('>=22 <23');
    expect(read('Dockerfile')).toContain('FROM node:22-alpine AS base');
    expect(functionsPackageJson.engines?.node).toBe('>=22 <23');
    expect(functionsConfig?.runtime).toBe('nodejs22');
    expect(functionsConfig?.predeploy).toEqual([
      'npm --prefix "$RESOURCE_DIR" run lint',
      'npm --prefix "$RESOURCE_DIR" run build',
    ]);
    expect(etlPackageJson.engines?.node).toBe('>=22 <23');
    expect(etlDockerfile.match(/FROM node:22-alpine/g)).toHaveLength(2);
    expect(etlDockerfile).not.toContain('node:18-alpine');
  });

  it('keeps independent nested-package quality scripts available', () => {
    for (const packagePath of ['functions/package.json', 'etl/package.json']) {
      const nestedPackageJson = JSON.parse(read(packagePath)) as {
        scripts?: Record<string, string>;
      };

      expect(nestedPackageJson.scripts).toMatchObject({
        build: expect.any(String),
        lint: expect.any(String),
        test: expect.any(String),
        typecheck: expect.any(String),
      });
      expect(nestedPackageJson.scripts?.lint).not.toContain('--ext');
    }

    const functionsPackageJson = JSON.parse(read('functions/package.json')) as {
      scripts?: Record<string, string>;
    };
    const etlPackageJson = JSON.parse(read('etl/package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(functionsPackageJson.scripts?.lint).toBe('eslint . --max-warnings=0');
    expect(functionsPackageJson.scripts?.clean).toContain("rmSync('lib'");
    expect(read('.gitignore')).toContain('/functions/lib/');
    expect(etlPackageJson.scripts).toMatchObject({
      lint: 'npm run lint:node && npm run lint:r',
      'lint:node': 'eslint . --max-warnings=0',
      'lint:r': `Rscript -e "invisible(parse(file = 'fetch_fw_round.R'))"`,
    });
  });

  it('delegates nested linting to package-local flat configurations', () => {
    const rootEslintConfig = read('eslint.config.js');

    for (const directory of ['functions', 'etl']) {
      expect(rootEslintConfig).toContain(`'${directory}/**'`);
      expect(existsSync(join(process.cwd(), directory, 'eslint.config.mjs'))).toBe(true);
    }

    for (const generatedOutput of ['coverage', 'playwright-report', 'test-results']) {
      expect(rootEslintConfig).toContain(`'**/${generatedOutput}/**'`);
    }
  });

  it('keeps every workspace behind a pinned, fail-closed CI gate', () => {
    const workflow = read('.github/workflows/ci.yml');
    const gate = workflow.slice(workflow.indexOf('  ci-gate:'));

    expect(workflow).toContain('name: Functions');
    expect(workflow).toContain('name: ETL');
    expect(workflow).toContain('r-lib/actions/setup-r@d3c5be51b12e724e68f33216ca3c148b66d5f0b6');
    expect(workflow).toContain("r-version: '4.6.1'");
    expect(workflow).toContain('name: Unit tests');
    expect(workflow).toContain('name: Integration tests');
    expect(workflow).toContain('name: Browser tests');
    expect(gate).toContain('name: CI Gate');
    expect(gate).toContain('if: ${{ always() }}');
    expect(gate).toContain(`all(.[]; .result == "success")`);

    for (const job of [
      'documentation',
      'lint',
      'typecheck',
      'functions',
      'etl',
      'tests',
      'build',
    ]) {
      expect(gate).toContain(`      - ${job}`);
    }

    for (const match of workflow.matchAll(/uses:\s+[^@\s]+@([^\s]+)/g)) {
      expect(match[1]).toMatch(/^[a-f0-9]{40}$/);
    }
  });

  it('keeps the dead API placeholder absent and override policy documented', () => {
    expect(existsSync(join(process.cwd(), 'src/app/api/api.ts'))).toBe(false);

    const policy = read('docs/development/dependency-overrides.md');
    for (const dependency of ['zod', '@google-cloud/firestore', 'node-forge', 'jws']) {
      expect(policy).toContain(dependency);
    }
    expect(policy).toContain('Do not use a forced audit fix');
  });

  it('guards credential-like service-account filenames without blocking examples', () => {
    const docsCheck = read('Scripts/check-docs.mjs');

    expect(docsCheck).toContain('service[-_.]?account');
    expect(docsCheck).toContain('firebase[-_.]?(?:admin|credential)');
    expect(docsCheck).toContain('google[-_.]?(?:application[-_.]?)?credentials?');
    expect(docsCheck.indexOf('if (isExample) return false')).toBeLessThan(
      docsCheck.indexOf('const hasCredentialLikeName')
    );
  });
});

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}
