// @vitest-environment node
import { readdirSync } from 'node:fs';
import path from 'node:path';

import type { TestSpecification, Vitest } from 'vitest/node';

import OutcomesShardSequencer from '../testUtils/outcomesShardSequencer';
import durations from '../testUtils/outcomesFileDurations.json';

const root = path.resolve(__dirname, '../..');
const outcomesFiles = readdirSync(path.join(root, 'tests/outcomes-integration'), {
  recursive: true,
  encoding: 'utf8',
})
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `tests/outcomes-integration/${file.split(path.sep).join('/')}`);

const measured = Object.keys(durations);
const seconds: Record<string, number> = durations;

const spec = (file: string) => ({ moduleId: path.join(root, file) }) as TestSpecification;
const keys = (specs: TestSpecification[]) =>
  specs.map((s) => path.relative(root, s.moduleId).split(path.sep).join('/'));

function sequencer(shard?: { index: number; count: number }) {
  return new OutcomesShardSequencer({ config: { root, shard } } as unknown as Vitest);
}

async function shards(files: string[], count: number) {
  const out: string[][] = [];
  for (let index = 1; index <= count; index += 1) {
    out.push(keys(await sequencer({ index, count }).shard(files.map(spec))));
  }
  return out;
}

describe('OutcomesShardSequencer', () => {
  it.each([2, 3, 4])('puts every file in exactly one of %i shards', async (count) => {
    const files = [...outcomesFiles, 'tests/outcomes-integration/not-yet-measured.test.ts'];
    const split = await shards(files, count);
    expect(split.flat().sort()).toEqual([...files].sort());
    expect(split.every((shard) => shard.length > 0)).toBe(true);
  });

  it('gives each of the heaviest files its own shard and keeps the shards within a file of each other', async () => {
    const heaviest = [...measured].sort((a, b) => seconds[b] - seconds[a]).slice(0, 4);
    const split = await shards(measured, 4);
    expect(heaviest.map((file) => split.findIndex((shard) => shard.includes(file))).sort()).toEqual(
      [0, 1, 2, 3]
    );
    const totals = split.map((shard) => shard.reduce((sum, file) => sum + seconds[file], 0));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(
      Math.max(...Object.values(seconds))
    );
  });

  it('starts the longest files first and keeps the file list when not sharding', async () => {
    const files = measured.map(spec);
    const sorted = keys(await sequencer().sort(files)).map((file) => seconds[file]);
    expect(sorted).toEqual([...sorted].sort((a, b) => b - a));
    expect(await sequencer().shard(files)).toBe(files);
  });
});
