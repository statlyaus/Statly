import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveEtlRuntimePaths, resolveFetchPipelineTimeout } from '../../etl/fetchPipeline';

const repositoryRoot = process.cwd();

describe('ETL source-of-truth architecture', () => {
  it('resolves the same ETL assets from source and compiled runtimes', () => {
    const sourcePaths = resolveEtlRuntimePaths('/workspace/etl');
    const compiledPaths = resolveEtlRuntimePaths('/workspace/etl/dist');

    expect(sourcePaths).toEqual({
      etlRoot: '/workspace/etl',
      fetcher: '/workspace/etl/fetch_fw_round.R',
      processor: '/workspace/etl/dist/processFootywireData.js',
    });
    expect(compiledPaths).toEqual(sourcePaths);
  });

  it('keeps one real fetcher and one canonical processor', () => {
    expect(exists('etl/fetch_fw_round.R')).toBe(true);
    expect(exists('etl/processFootywireData.ts')).toBe(true);
    expect(exists('etl/fetch_fw_round.py')).toBe(false);
    expect(exists('etl/ingestFootywire.ts')).toBe(false);
    expect(exists('src/scrapeFootywireStats.ts')).toBe(false);
  });

  it('routes live and historical ingestion through the shared pipeline', () => {
    const liveGuard = read('etl/liveGuard.ts');
    const backfill = read('etl/backfill.ts');
    const fetchPipeline = read('etl/fetchPipeline.ts');
    const processor = read('etl/processFootywireData.ts');

    expect(liveGuard).toContain("import { runFetchPipeline } from './fetchPipeline'");
    expect(liveGuard).toContain('await runFetchPipeline({');
    expect(backfill).toContain("import { runFetchPipeline } from './fetchPipeline'");
    expect(backfill).toContain('backfillMode: true');
    expect(backfill).toContain('Backfill failed for ${failures.length} round(s)');
    expect(backfill).toContain('process.exitCode = 1');
    expect(fetchPipeline).toContain("spawnSync('Rscript', ['--version']");
    expect(fetchPipeline).toContain("from 'stream/promises'");
    expect(fetchPipeline).toContain('processorInput');
    expect(fetchPipeline).toContain('Footywire fetcher output pipe failed');
    expect(resolveFetchPipelineTimeout({ season: 2026 })).toBe(300_000);
    expect(resolveFetchPipelineTimeout({ season: 2026, backfillMode: true })).toBeNull();
    expect(
      resolveFetchPipelineTimeout({ season: 2026, backfillMode: true, timeoutMs: 60_000 })
    ).toBe(60_000);
    expect(processor).toContain("from './normalizePlayerRow'");
    expect(processor).toContain('normalizePlayerRow(JSON.parse(line))');
    expect(processor).toContain('process.exitCode = 1');
  });

  it('preserves row types in R and normalizes numeric fields before processing', () => {
    const fetcher = read('etl/fetch_fw_round.R');
    const normalizer = read('etl/normalizePlayerRow.ts');
    const processor = read('etl/processFootywireData.ts');

    expect(fetcher).toContain('df[row_index, , drop = FALSE]');
    expect(fetcher).not.toContain('apply(df, 1');
    expect(normalizer).toContain("requiredFiniteNumber(row.season, 'season')");
    expect(normalizer).toContain('PLAYER_NUMERIC_FIELDS.map');
    expect(processor).not.toContain('function normalizePlayerRow');
  });

  it('keeps deployment and operator guidance on the canonical contract', () => {
    const deployment = read('etl/deploy.sh');
    const etlReadme = read('etl/README.md');
    const rootReadme = read('README.md');

    expect(deployment).toContain('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');
    expect(deployment).toContain('Rscript -e');
    expect(deployment).not.toContain('python3');
    expect(etlReadme).toMatch(/streams the R\s+fetcher output directly/i);
    expect(rootReadme).toMatch(/there is no mock-data\s+fallback/);
  });
});

function exists(relativePath: string): boolean {
  return existsSync(join(repositoryRoot, relativePath));
}

function read(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), 'utf8');
}
