import { describe, expect, it, vi } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { storeLocalAflTradeEvidence } from '@/server/aflTradeIntelligence/development/localEvidenceStorage';

import {
  parseGradeRealizedTradesArguments,
  storeRealizedTradeGradeBatch,
} from '../../Scripts/grade-realized-trades';

vi.mock('@/server/aflTradeIntelligence/development/localEvidenceStorage', () => ({
  storeLocalAflTradeEvidence: vi.fn(async () => ({ custody: 'recorded' })),
}));

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

describe('grade-realized-trades arguments', () => {
  it('parses a stored run', () => {
    expect(
      parseGradeRealizedTradesArguments(
        [...base, '--store-id', 'statly-grading-1-artifacts'],
        loopback
      )
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
    expect(parseGradeRealizedTradesArguments([...base, '--dry-run'], loopback)).toMatchObject({
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
    expect(() => parseGradeRealizedTradesArguments(argv, env)).toThrow(message);
  });
});

describe('grade-realized-trades storage', () => {
  it('stores the batch as private derived output in its own repository', async () => {
    const client = {} as AflOutcomeSqlClient;
    const bytes = new TextEncoder().encode('{"batchId":"x"}');
    await storeRealizedTradeGradeBatch(client, 'statly-grading-1-artifacts', bytes);
    expect(storeLocalAflTradeEvidence).toHaveBeenCalledWith(client, {
      storeId: 'statly-grading-1-artifacts',
      repositoryId: 'realized-trade-grades',
      artifactClass: 'derived_private',
      bytes,
      mediaType: 'application/json',
      maximumObjectBytes: 64 * 1024 * 1024,
    });
  });
});
