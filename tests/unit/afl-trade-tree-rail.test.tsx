import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { marginText } from '@/components/aflTradeStory/marginMotion';
import { TradeTree } from '@/components/aflTradeStory/TradeTree';
import { tradeTree } from '@/components/aflTradeStory/tradeTreeModel';
import { aflTradeStorySamples } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

/**
 * The margin rail (owner, 2026-11-28): drawn by the server at today's margin, the trade's own net,
 * beside the full tree of a two-club trade and as a strip above the phone list; never on the trade
 * list's compact preview.
 */

const trades = aflTradeStorySamples.list().stories.map(({ tradeId }) => tradeId);

describe('trade tree margin rail', () => {
  it.each(trades)('draws the rail and the strip at the trade net for %s', (tradeId) => {
    const story = aflTradeStorySamples.load(tradeId)!.story;
    const margin = tradeTree(story).margin;
    const { container, unmount } = render(<TradeTree story={story} />);
    const rail = container.querySelector('.tt-rail svg');
    const strip = container.querySelector('svg.tt-strip');
    if (!margin) {
      expect(rail).toBeNull();
      expect(strip).toBeNull();
      unmount();
      return;
    }
    const last = margin.points.at(-1)!;
    // The net as the page writes it, "*" while a leg is not in yet.
    const today = marginText(last.value, last.pendingCount);
    expect(rail!.querySelector('.tt-svg-num')!.textContent).toBe(today);
    expect(strip!.querySelector('.tt-svg-num')!.textContent).toBe(today);
    expect(container.querySelector('.tt')).toHaveClass('tt-wide');
    // Rail and tree share their height, so their rows line up.
    const height = (svg: Element) => svg.getAttribute('viewBox')!.split(' ')[3];
    expect(height(rail!)).toBe(height(container.querySelector('.tt-chart-tree')!));
    unmount();
  });

  it('gives the compact preview the strip below the graph, never the side rail', () => {
    const story = aflTradeStorySamples.load(trades[0]!)!.story;
    const { container } = render(<TradeTree story={story} compact />);
    expect(container.querySelector('.tt-rail')).toBeNull();
    expect(container.querySelector('.tt')).not.toHaveClass('tt-wide');
    if (tradeTree(story).margin) {
      const strip = container.querySelector('.tt-strip-wide')!;
      // After the chart, before the phone list's scale.
      expect(container.querySelector('.tt-chart')!.compareDocumentPosition(strip)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    }
  });
});
