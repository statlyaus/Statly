import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveEtlRuntimePaths } from '../../etl/fetchPipeline';

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
    expect(processor).toContain('process.exitCode = 1');
  });

  it('keeps deployment and operator guidance on the canonical contract', () => {
    const deployment = read('etl/deploy.sh');
    const etlReadme = read('etl/README.md');
    const rootReadme = read('README.md');

    expect(deployment).toContain('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');
    expect(deployment).toContain('Rscript -e');
    expect(deployment).not.toContain('python3');
    expect(etlReadme).toContain('Streams the R fetcher output directly');
    expect(rootReadme).toContain('there is no mock-data fallback');
  });
});

function exists(relativePath: string): boolean {
  return existsSync(join(repositoryRoot, relativePath));
}

function read(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), 'utf8');
}
