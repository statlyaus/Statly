import path from 'node:path';

import { BaseSequencer, type TestSpecification } from 'vitest/node';

import measuredSeconds from './outcomesFileDurations.json';

const durations: Readonly<Record<string, number>> = measuredSeconds;

/** Estimate for a file the duration list does not know yet: the median measured file. */
const UNMEASURED_SECONDS = (() => {
  const sorted = Object.values(durations).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
})();

/**
 * Splits the outcomes integration files across CI shards by measured duration, not by path hash.
 *
 * Every shard job resolves the same file list and computes the same assignment: files are placed
 * longest first, each on the shard with the least total so far (ties go to the lower shard, and
 * equal durations are ordered by path). Within a shard the longest files start first, so the two
 * workers finish close together. Durations come from outcomesFileDurations.json; see
 * docs/development/testing.md.
 */
export default class OutcomesShardSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return files;
    const loads = Array.from({ length: shard.count }, () => 0);
    const assigned: TestSpecification[] = [];
    for (const { file, seconds } of this.longestFirst(files)) {
      const target = loads.indexOf(Math.min(...loads));
      loads[target] += seconds;
      if (target === shard.index - 1) assigned.push(file);
    }
    return assigned;
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return this.longestFirst(files).map(({ file }) => file);
  }

  private longestFirst(files: TestSpecification[]) {
    return files
      .map((file) => {
        const key = path.relative(this.ctx.config.root, file.moduleId).split(path.sep).join('/');
        return { file, key, seconds: durations[key] ?? UNMEASURED_SECONDS };
      })
      .sort((a, b) => b.seconds - a.seconds || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
}
