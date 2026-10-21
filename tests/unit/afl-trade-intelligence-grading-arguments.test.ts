import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AflTradeStoredEvidence } from '@/server/aflTradeIntelligence/development/localEvidenceStorage';

import {
  parseGradingArguments,
  parseSeasons,
  requireOutAbsent,
  writeStoredOutputFile,
} from '../../Scripts/gradingArguments';

const loopback = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:55436/outcomes' };
const hex = (digit: string) => digit.repeat(64);
const base = [
  '--candidate',
  `external-reconciliation:${hex('a')}`,
  '--method',
  `hpn-pav-method:${hex('b')}`,
  '--seasons',
  '2021-2026',
  '--official-seasons',
  '2021,2022,2023,2024,2025',
  '--benchmark',
  `hpn-pick-benchmark:${hex('c')}`,
  '--out',
  '/receipts/grading-789/batch.json',
];

describe('grading arguments', () => {
  it('parses a stored run', () => {
    expect(
      parseGradingArguments([...base, '--store-id', 'statly-grading-1-artifacts'], loopback)
    ).toEqual({
      databaseUrl: loopback.AFL_OUTCOMES_DATABASE_URL,
      candidateId: `external-reconciliation:${hex('a')}`,
      methodId: `hpn-pav-method:${hex('b')}`,
      seasons: [2021, 2022, 2023, 2024, 2025, 2026],
      officialSeasons: [2021, 2022, 2023, 2024, 2025],
      benchmarkId: `hpn-pick-benchmark:${hex('c')}`,
      storeId: 'statly-grading-1-artifacts',
      out: '/receipts/grading-789/batch.json',
      dryRun: false,
    });
  });

  it('lets a dry run grade without a store', () => {
    expect(parseGradingArguments([...base, '--dry-run'], loopback)).toMatchObject({
      storeId: null,
      dryRun: true,
    });
  });

  it.each<[string, string[], Record<string, string | undefined>, RegExp]>([
    ['a stored run without a store', base, loopback, /--store-id is required unless --dry-run/],
    [
      'a relative output path',
      [...base.slice(0, -1), 'batch.json', '--dry-run'],
      loopback,
      /absolute path/,
    ],
    [
      'repeated seasons',
      [...base.slice(0, 5), '2021,2021', ...base.slice(6), '--dry-run'],
      loopback,
      /distinct seasons/,
    ],
    [
      'a descending season range',
      [...base.slice(0, 5), '2026-2021', ...base.slice(6), '--dry-run'],
      loopback,
      /ascending season range/,
    ],
    ['an unknown flag', [...base, '--dry-run', '--force'], loopback, /Unexpected argument --force/],
    [
      'a flag given twice',
      [...base, '--dry-run', '--seasons', '2021-2022'],
      loopback,
      /may be given once/,
    ],
    ['a missing value', [...base.slice(0, -1), '--dry-run'], loopback, /--out needs a value/],
    [
      'a database that is not on loopback',
      [...base, '--dry-run'],
      { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@10.0.0.5:5432/outcomes' },
      /./,
    ],
  ])('refuses %s', (_label, argv, env, message) => {
    expect(() => parseGradingArguments(argv, env)).toThrow(message);
  });
});

describe('parseSeasons', () => {
  it('reads a range and a list, ascending', () => {
    expect(parseSeasons('--seasons', '2019-2021')).toEqual([2019, 2020, 2021]);
    expect(parseSeasons('--seasons', '2022,2019')).toEqual([2019, 2022]);
  });

  it.each(['', '20x1', '1800', '2021,2021', '2026-2021'])('refuses %j', (value) => {
    expect(() => parseSeasons('--seasons', value)).toThrow(TypeError);
  });
});

describe('output files', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'grading-arguments-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('refuses an --out that already exists, naming the output', async () => {
    const out = join(directory, 'ledger.json');
    await expect(requireOutAbsent(out, 'ledger')).resolves.toBeUndefined();
    await writeFile(out, '{}');
    await expect(requireOutAbsent(out, 'ledger')).rejects.toThrow(
      /already exists; a ledger is never overwritten/
    );
  });

  it('writes --out once and never overwrites it', async () => {
    const out = join(directory, 'fit.json');
    await writeStoredOutputFile(out, new TextEncoder().encode('{"a":1}'), null, 'fit');
    expect(await readFile(out, 'utf8')).toBe('{"a":1}');
    await expect(
      writeStoredOutputFile(out, new TextEncoder().encode('{"a":2}'), null, 'fit')
    ).rejects.toThrow(/EEXIST/);
    expect(await readFile(out, 'utf8')).toBe('{"a":1}');
  });

  it('names the stored artifact when --out cannot be written after the store', async () => {
    const out = join(directory, 'missing', 'lines.json');
    const stored = { reference: { artifactId: 'artifact-1' } } as AflTradeStoredEvidence;
    await expect(
      writeStoredOutputFile(out, new Uint8Array(), stored, 'value lines')
    ).rejects.toThrow(/The value lines was stored as artifact-1, but --out was not written/);
  });
});
