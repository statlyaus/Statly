import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  parseLocateLocalArtifactCustodyArguments,
  runLocateLocalArtifactCustodyCommand,
} from '../../Scripts/locate-local-artifact-custody';

const loopback = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:55436/outcomes' };
// Nothing listens on port 1, so any database use surfaces as a connection error.
const unreachable = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:1/outcomes' };
let durableRoot = '';

beforeAll(async () => {
  durableRoot = await mkdtemp(join(tmpdir(), 'statly-locate-artifacts-'));
});

afterAll(async () => {
  await rm(durableRoot, { recursive: true, force: true });
});

describe('locate local artifact custody arguments', () => {
  // The fixture root lives under the system temporary directory, so these cases pass an empty
  // temporary-directory list to stand in for a durable root.
  const parse = (argv: string[], env: Record<string, string | undefined> = loopback) =>
    parseLocateLocalArtifactCustodyArguments(argv, env, []);

  it('defaults to a dry run without a report', () => {
    expect(parse(['--store-id', 'grading-local', '--artifact-root', durableRoot])).toMatchObject({
      storeId: 'grading-local',
      apply: false,
      reportPath: null,
    });
  });

  it('accepts --apply and an absolute report path in any order', () => {
    expect(
      parse([
        '--apply',
        '--report',
        '/srv/reports/locate.json',
        '--artifact-root',
        durableRoot,
        '--store-id',
        'grading-local',
      ])
    ).toMatchObject({ apply: true, reportPath: '/srv/reports/locate.json' });
  });

  it('refuses a non-loopback database, a temporary root, and malformed options', () => {
    const argv = ['--store-id', 'grading-local', '--artifact-root', durableRoot];
    expect(() =>
      parse(argv, { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@10.0.0.4:5432/outcomes' })
    ).toThrow(/loopback/u);
    expect(() => parseLocateLocalArtifactCustodyArguments(argv, loopback)).toThrow(/durable/u);
    expect(() => parse(['--store-id', 'Grading', '--artifact-root', durableRoot])).toThrow(
      /--store-id/u
    );
    expect(() => parse([...argv, '--report', 'relative.json'])).toThrow(/absolute/u);
    expect(() => parse([...argv, '--apply', '--apply'])).toThrow(/once/u);
    expect(() => parse([...argv, '--store-id', 'other-local'])).toThrow(/once/u);
    expect(() => parse([...argv, '--unknown', 'x'])).toThrow(/Unexpected argument/u);
  });
});

describe('locate local artifact custody report reservation', () => {
  const run = (argv: string[]) =>
    runLocateLocalArtifactCustodyCommand({
      argv: ['--store-id', 'grading-local', '--artifact-root', durableRoot, ...argv],
      env: unreachable,
      writeOutput: () => undefined,
      temporaryDirectories: [],
    });

  it('stops on an existing report path before any database change', async () => {
    const reportPath = join(durableRoot, 'existing-report.json');
    await writeFile(reportPath, 'earlier report\n');
    await expect(run(['--apply', '--report', reportPath])).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(reportPath, 'utf8')).toBe('earlier report\n');
  });

  it('removes the reserved report when the run fails before writing it', async () => {
    const reportPath = join(durableRoot, 'reserved-report.json');
    await expect(run(['--report', reportPath])).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    await expect(stat(reportPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
