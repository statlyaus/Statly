import { describe, expect, it } from 'vitest';

import {
  fullName,
  readQuarantine,
  runnerArgs,
  validateEntries,
} from '../../Scripts/ci/quarantine.mjs';

const entry = {
  suite: 'unit',
  file: 'tests/unit/a.test.ts',
  describe: 'group',
  title: 'does (a thing)',
  issue: 1,
  added: '2026-10-21',
  reason: 'flaky',
};
const files = { 'tests/unit/a.test.ts': "describe('group', () => it('does (a thing)'))" };
const fs = {
  fileExists: (file: string) => file in files,
  readText: (file: string) => files[file as keyof typeof files],
};

describe('flaky-test quarantine', () => {
  it('lists only entries that still match a real test', () => {
    expect(validateEntries(readQuarantine())).toEqual([]);
  });

  it('accepts a complete entry', () => {
    expect(validateEntries([entry], fs)).toEqual([]);
  });

  it('rejects an entry without an issue, a reason, or a known suite', () => {
    const errors = validateEntries([{ ...entry, issue: undefined, reason: '', suite: 'nope' }], fs);
    expect(errors).toHaveLength(3);
  });

  it('rejects a missing file, a renamed test, and a duplicate', () => {
    expect(validateEntries([{ ...entry, file: 'gone.ts' }], fs)[0]).toMatch(/does not exist/);
    expect(validateEntries([{ ...entry, title: 'renamed' }], fs)[0]).toMatch(/renamed or removed/);
    expect(validateEntries([entry, entry], fs)[0]).toMatch(/listed twice/);
  });

  it('excludes listed vitest tests from the blocking run and selects only them otherwise', () => {
    const name = fullName(entry);
    const [flag, pattern] = runnerArgs('unit', 'blocking', [entry]);
    expect(flag).toBe('-t');
    expect(new RegExp(pattern).test(name)).toBe(false);
    expect(new RegExp(pattern).test(`${name} and more`)).toBe(true);
    expect(new RegExp(pattern).test('another test')).toBe(true);

    const args = runnerArgs('unit', 'quarantined', [entry]);
    expect(args).toContain(entry.file);
    expect(args).toContain('--passWithNoTests');
    const only = new RegExp(args[args.indexOf('-t') + 1]);
    expect(only.test(name)).toBe(true);
    expect(only.test('another test')).toBe(false);
  });

  it('keeps the draft-worker exclusion in the blocking Playwright run', () => {
    const e2e = { ...entry, suite: 'e2e', describe: undefined, title: 'honors a path' };
    const args = runnerArgs('e2e', 'blocking', [e2e]);
    const pattern = new RegExp(args[args.indexOf('--grep-invert') + 1]);
    expect(pattern.test('@draft-worker lifecycle')).toBe(true);
    expect(pattern.test('login honors a path')).toBe(true);
    expect(pattern.test('login does something else')).toBe(false);
    expect(runnerArgs('e2e', 'quarantined', [e2e])).toContain('--grep');
  });
});
