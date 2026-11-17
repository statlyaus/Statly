import { describe, expect, it } from 'vitest';

import { createAflTradeStoryBundleSource } from '@/server/aflTradeIntelligence/development/tradeStoryBundle';
import { laneLabel, tradeTree } from '@/components/aflTradeStory/tradeTreeModel';

import { sampleTradeStoryBundle } from '../fixtures/aflTradeStorySampleBundle';

describe('trade tree', () => {
  const source = createAflTradeStoryBundleSource(sampleTradeStoryBundle());
  const stories = source.list().stories;

  it('names a pick by whose it was', () => {
    expect(laneLabel('2024 pick 11 (Collingwood)')).toBe('Collingwood’s 2024 pick 11');
    expect(laneLabel('Shai Bolton')).toBe('Shai Bolton');
  });

  it('gives every asset of the trade one lane, under the club that received it', () => {
    for (const summary of stories) {
      const { story } = source.load(summary.tradeId)!;
      const tree = tradeTree(story);
      const lanes = tree.groups.flatMap(({ lanes }) => lanes);
      expect(lanes).toHaveLength(story.lineage.assets.length);
      for (const group of tree.groups)
        for (const lane of group.lanes) expect(lane.receiverId).toBe(group.clubId);
    }
  });

  it('keeps time in order and totals what each club kept and lost', () => {
    for (const summary of stories) {
      const { story } = source.load(summary.tradeId)!;
      const tree = tradeTree(story);
      const order = tree.columns.map(({ kind, season }) => season * 3 + (kind === 'draft' ? 2 : 0));
      expect(order).toEqual([...order].sort((left, right) => left - right));
      for (const group of tree.groups) {
        const total = group.lanes.reduce((sum, { value }) => sum + (value ?? 0), 0);
        expect(group.kept + group.elsewhere).toBeCloseTo(total, 6);
      }
    }
  });
});
