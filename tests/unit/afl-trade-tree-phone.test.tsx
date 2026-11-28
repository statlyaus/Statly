import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TradeTree } from '@/components/aflTradeStory/TradeTree';
import { formatPav } from '@/components/aflTradeStory/tradePageModel';
import { tradeTree } from '@/components/aflTradeStory/tradeTreeModel';
import { aflTradeStorySamples } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

/**
 * The trade tree on a phone (owner, 2026-11-28: "a similar graphic to the desktop"): the same tree
 * redrawn 303 units wide, a heading per club over its lanes, the player on each lane, the pick and
 * its path in a note under it, and the PAV in one column at the right. The list stays as the
 * screen-reader text.
 */

const trades = aflTradeStorySamples.list().stories.map(({ tradeId }) => tradeId);
const texts = (svg: Element) => [...svg.querySelectorAll('text')].map((n) => n.textContent ?? '');

describe('trade tree on a phone', () => {
  it.each(trades)('draws every lane, its player and its PAV in %s', (tradeId) => {
    const story = aflTradeStorySamples.load(tradeId)!.story;
    const { groups } = tradeTree(story);
    for (const compact of [false, true]) {
      const { container, unmount } = render(<TradeTree story={story} compact={compact} />);
      const svg = container.querySelector('svg.tt-phone')!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('viewBox')).toMatch(/^0 0 303 /u);
      const drawn = texts(svg);
      const lanes = groups.flatMap(({ lanes: of }) => of);
      // One PAV per lane, top to bottom, in the list's order.
      const numbers = [...svg.querySelectorAll('text.tt-svg-num')].map((n) => n.textContent);
      expect(numbers).toEqual(
        lanes.map(({ value }) => (value === null ? 'not in yet' : formatPav(value)))
      );
      for (const lane of lanes) {
        const name = lane.player?.name ?? lane.label;
        expect(drawn.some((text) => text.startsWith(name))).toBe(true);
        // The pick it came from leads the note under a player's lane.
        if (lane.player && lane.player.name !== lane.label)
          expect(drawn.some((text) => text.startsWith(lane.label.slice(0, 12)))).toBe(true);
      }
      // A heading per club.
      expect(drawn.filter((text) => text.endsWith(' received'))).toHaveLength(groups.length);
      unmount();
    }
  });

  it('keeps the list for screen readers', () => {
    const story = aflTradeStorySamples.load(trades[0]!)!.story;
    render(<TradeTree story={story} />);
    expect(
      screen.getByRole('list', { name: 'Every pick and player, and what it became' })
    ).toBeInTheDocument();
  });
});
