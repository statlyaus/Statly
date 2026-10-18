import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { storeLocalAflTradeEvidence } from '@/server/aflTradeIntelligence/development/localEvidenceStorage';
import type { AflTradePlayerSeasonGames } from '@/server/aflTradeIntelligence/modeling/playerSeasonGames';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

import {
  createAflTradeValueLineFitArtifact,
  parseExportValueLineFitArguments,
  runExportValueLineFitCommand,
  storeValueLineFit,
} from '../../Scripts/export-value-line-fit';

vi.mock('@/server/aflTradeIntelligence/development/localEvidenceStorage', () => ({
  storeLocalAflTradeEvidence: vi.fn(async () => ({ custody: 'recorded' })),
}));

const loopback = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@127.0.0.1:55436/outcomes' };
const argv = (out: string, extra: string[] = []) => [
  '--method',
  `hpn-pav-method:${'b'.repeat(64)}`,
  '--seasons',
  '2011-2026',
  '--draft-years',
  '2011-2025',
  '--held-out-draft-years',
  '2017-2019',
  '--store-id',
  'statly-grading-1-artifacts',
  '--out',
  out,
  ...extra,
];

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('export-value-line-fit', () => {
  it('parses the fit and back-test windows', () => {
    expect(parseExportValueLineFitArguments(argv('/receipts/fit.json'), loopback)).toMatchObject({
      seasons: Array.from({ length: 16 }, (_, index) => 2011 + index),
      draftYears: Array.from({ length: 15 }, (_, index) => 2011 + index),
      heldOutDraftYears: [2017, 2018, 2019],
      storeId: 'statly-grading-1-artifacts',
      dryRun: false,
    });
  });

  it('refuses windows the fit cannot use', () => {
    const parse = (overrides: Record<string, string>) => {
      const args = argv('/receipts/fit.json');
      for (const [name, value] of Object.entries(overrides)) args[args.indexOf(name) + 1] = value;
      return () => parseExportValueLineFitArguments(args, loopback);
    };
    expect(parse({ '--seasons': '2013-2026' })).toThrow(/must cover every season/);
    expect(parse({ '--draft-years': '2011-2026' })).toThrow(/must cover every season/);
    expect(parse({ '--held-out-draft-years': '2024-2026' })).toThrow(/drafts in --draft-years/);
    expect(parse({ '--held-out-draft-years': '2012-2013' })).toThrow(/two draft classes/);
    expect(parse({ '--held-out-draft-years': '2017,2019' })).toThrow(/consecutive/);
    expect(parse({ '--held-out-draft-years': '2018-2020' })).toThrow(/at least 7 seasons/);
    expect(() =>
      parseExportValueLineFitArguments(
        argv('/receipts/fit.json').filter(
          (_, index, all) => all[index - 1] !== '--store-id' && all[index] !== '--store-id'
        ),
        loopback
      )
    ).toThrow(/--store-id is required unless --dry-run/);
  });

  it('stores the fit as private derived output in its own repository', async () => {
    const client = {} as AflOutcomeSqlClient;
    const bytes = new TextEncoder().encode('{"fitId":"x"}');
    await storeValueLineFit(client, 'statly-grading-1-artifacts', bytes);
    expect(storeLocalAflTradeEvidence).toHaveBeenCalledWith(client, {
      storeId: 'statly-grading-1-artifacts',
      repositoryId: 'value-line-fits',
      artifactClass: 'derived_private',
      bytes,
      mediaType: 'application/json',
      maximumObjectBytes: 16 * 1024 * 1024,
    });
  });

  it('refuses a read model with an unavailable season or a games discrepancy', () => {
    const base: AflTradePlayerSeasonGames = {
      methodId: 'm',
      seasons: [{ season: 2026, availability: 'no_head', calculationId: null }],
      rows: [],
      discrepancies: [],
    };
    expect(() =>
      createAflTradeValueLineFitArtifact({ model: base, draftees: [], heldOutDraftYears: [2019] })
    ).toThrow(/not available/);
    expect(() =>
      createAflTradeValueLineFitArtifact({
        model: {
          ...base,
          seasons: [{ season: 2026, availability: 'available', calculationId: 'c' }],
          discrepancies: [
            { playerId: 'p', season: 2026, clubId: 'c', games: 1, factualMatches: 2 },
          ],
        },
        draftees: [],
        heldOutDraftYears: [2019],
      })
    ).toThrow(/disagree with their appearances/);
  });

  it('refuses an existing --out before it opens the database', async () => {
    directory = await mkdtemp(join(tmpdir(), 'value-line-fit-'));
    const out = join(directory, 'fit.json');
    await writeFile(out, '{}');
    await expect(runExportValueLineFitCommand({ argv: argv(out), env: loopback })).rejects.toThrow(
      /a fit is never overwritten/
    );
  });

  it('takes the genuine database only on loopback', () => {
    expect(() =>
      parseExportValueLineFitArguments(argv('/receipts/fit.json'), {
        AFL_OUTCOMES_DATABASE_URL: 'postgresql://archive:x@10.0.0.5:5432/outcomes',
      })
    ).toThrow(/loopback/);
  });
});
