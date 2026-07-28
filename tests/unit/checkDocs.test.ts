import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  absoluteLocalPathPatterns,
  isProhibitedTrackedEnvironment,
  stripFencedCode,
  validateMarkdownLinks,
} from '../../Scripts/check-docs.mjs';

const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('documentation validation', () => {
  it('rejects environment and credential filenames while allowing examples', () => {
    for (const file of [
      '.env',
      '.env.production',
      '.Renviron',
      'firebase-admin.json',
      'production-service-account.json',
      'google-application-credentials.json',
      'private-key.pem',
    ]) {
      expect(isProhibitedTrackedEnvironment(file), file).toBe(true);
    }

    expect(isProhibitedTrackedEnvironment('.env.example')).toBe(false);
    expect(isProhibitedTrackedEnvironment('secrets/serviceAccountKey.example.json')).toBe(false);
    expect(isProhibitedTrackedEnvironment('src/lib/firebaseAdmin.ts')).toBe(false);
  });

  it('strips fenced examples using the opening marker and run length', () => {
    const errors: string[] = [];
    const content = [
      'visible before',
      '````md',
      '```',
      '/Users/example/hidden',
      '```',
      '````',
      'visible after',
    ].join('\n');

    const prose = stripFencedCode(content, 'fixture.md', (error) => {
      errors.push(error);
    });

    expect(prose).toContain('visible before');
    expect(prose).toContain('visible after');
    expect(prose).not.toContain('/Users/example/hidden');
    expect(errors).toEqual([]);
  });

  it('reports an unclosed fence with its opening line', () => {
    const errors: string[] = [];

    stripFencedCode('heading\n~~~ts\nconst open = true;', 'fixture.md', (error) => {
      errors.push(error);
    });

    expect(errors).toEqual(['fixture.md: unclosed fenced code block opened at line 2']);
  });

  it('allows only the exact GitHub runner home path', () => {
    const containsProhibitedPath = (value: string) =>
      absoluteLocalPathPatterns.some((pattern) => pattern.test(value));

    expect(containsProhibitedPath('/home/runner/work/Statly')).toBe(false);
    expect(containsProhibitedPath('/home/runner-backup/secret')).toBe(true);
    expect(containsProhibitedPath('/home/runner.bak/secret')).toBe(true);
    expect(containsProhibitedPath('/Users/example/Statly')).toBe(true);
  });

  it('validates inline, same-page, and reference-style links and real anchors', () => {
    const root = createFixture({
      'source.md': [
        '# Source heading',
        '[same](#source-heading)',
        '[target](target.md#real-heading)',
        '[reference use][guide]',
        '[guide]: target.md#real-heading',
      ].join('\n'),
      'target.md': ['````md', '# Fenced heading', '````', '# Real heading'].join('\n'),
    });
    const content = readFixture(root, 'source.md');

    expect(validateMarkdownLinks(root, 'source.md', content)).toEqual([]);
  });

  it('reports broken definitions, references, escapes, and non-navigable anchors', () => {
    const root = createFixture({
      'source.md': [
        '# Source heading',
        '[missing reference][absent]',
        '[broken definition][guide]',
        '[guide]: missing.md',
        '[escape](../outside.md)',
        '[bad same anchor](#not-real)',
        '[fenced anchor](target.md#fenced-heading)',
      ].join('\n'),
      'target.md': ['````md', '# Fenced heading', '````', '# Real heading'].join('\n'),
    });
    const errors = validateMarkdownLinks(root, 'source.md', readFixture(root, 'source.md'));

    expect(errors).toEqual(
      expect.arrayContaining([
        'source.md: missing Markdown reference definition: absent',
        'source.md: broken relative link: missing.md',
        'source.md: relative link escapes the repository: ../outside.md',
        'source.md: missing Markdown anchor in #not-real',
        'source.md: missing Markdown anchor in target.md#fenced-heading',
      ])
    );
  });
});

function createFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'statly-docs-check-'));
  fixtureRoots.push(root);
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(root, file), `${content}\n`, 'utf8');
  }
  return root;
}

function readFixture(root: string, file: string): string {
  return readFileSync(join(root, file), 'utf8');
}
