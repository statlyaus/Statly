import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { storeLocalAflTradeEvidence } from '@/server/aflTradeIntelligence/development/localEvidenceStorage';

import { runExportAssetLedgerCommand, storeAssetLedger } from '../../Scripts/export-asset-ledger';

vi.mock('@/server/aflTradeIntelligence/development/localEvidenceStorage', () => ({
  storeLocalAflTradeEvidence: vi.fn(async () => ({ custody: 'recorded' })),
}));

const loopback = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:55436/outcomes' };
const hex = (digit: string) => digit.repeat(64);
const argv = (out: string) => [
  '--candidate',
  `external-reconciliation:${hex('a')}`,
  '--method',
  `hpn-pav-method:${hex('b')}`,
  '--seasons',
  '2019-2026',
  '--official-seasons',
  '2019-2025',
  '--benchmark',
  `hpn-pick-benchmark:${hex('c')}`,
  '--store-id',
  'statly-grading-1-artifacts',
  '--out',
  out,
];

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('export-asset-ledger', () => {
  it('stores the ledger as private derived output in its own repository', async () => {
    const client = {} as AflOutcomeSqlClient;
    const bytes = new TextEncoder().encode('{"ledgerId":"x"}');
    await storeAssetLedger(client, 'statly-grading-1-artifacts', bytes);
    expect(storeLocalAflTradeEvidence).toHaveBeenCalledWith(client, {
      storeId: 'statly-grading-1-artifacts',
      repositoryId: 'asset-ledgers',
      artifactClass: 'derived_private',
      bytes,
      mediaType: 'application/json',
      maximumObjectBytes: 64 * 1024 * 1024,
    });
  });

  it('refuses an existing --out before it opens the database', async () => {
    directory = await mkdtemp(join(tmpdir(), 'asset-ledger-'));
    const out = join(directory, 'ledger.json');
    await writeFile(out, '{}');
    await expect(runExportAssetLedgerCommand({ argv: argv(out), env: loopback })).rejects.toThrow(
      /a ledger is never overwritten/
    );
  });

  it('takes the genuine database only on loopback, like the realized grader', async () => {
    await expect(
      runExportAssetLedgerCommand({
        argv: argv('/receipts/ledger.json'),
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@10.0.0.5:5432/outcomes' },
      })
    ).rejects.toThrow(/loopback/);
  });
});
