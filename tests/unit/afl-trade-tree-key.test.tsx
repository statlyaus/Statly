import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TradeTree } from '@/components/aflTradeStory/TradeTree';
import { aflTradeStorySamples } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

/**
 * The trade tree's key (owner, 2026-11-28): one icon per kind of mark the trade draws, each mark
 * tagged so the highlighter can find it, and a pin that a second press or Escape clears.
 */

const trades = aflTradeStorySamples.list().stories.map(({ tradeId }) => tradeId);
const keysOf = (node: Element) => (node.getAttribute('data-key') ?? '').split(' ');

describe('trade tree key', () => {
  it.each(trades)(
    'tags every bar, branch and ring, and mirrors them in the highlighter in %s',
    (tradeId) => {
      const story = aflTradeStorySamples.load(tradeId)!.story;
      const { container, unmount } = render(<TradeTree story={story} />);
      const svg = container.querySelector('.tt-chart svg')!;
      const halo = svg.querySelector('.tt-halo')!;
      const drawn = [...svg.querySelectorAll('[data-key]')].filter((node) => !halo.contains(node));
      // Every lane bar and every ring carries a key.
      for (const rect of svg.querySelectorAll('.tt-lane > rect'))
        expect(rect.getAttribute('data-key')).toBeTruthy();
      for (const ring of svg.querySelectorAll('.tt-lane circle[r="11"]'))
        expect(ring.closest('[data-key]')?.getAttribute('data-key')).toBe('traded');
      // The highlighter holds a copy for each, of the same kind.
      const count = (nodes: Element[], kind: string) =>
        nodes.filter((n) => keysOf(n).includes(kind)).length;
      for (const kind of ['received', 'other', 'away', 'pick', 'traded'])
        expect(count([...halo.querySelectorAll('[data-key]')], kind), kind).toBe(
          count(drawn, kind)
        );
      unmount();
    }
  );

  it.each(trades)('shows an icon only for the kinds of mark %s draws', (tradeId) => {
    const story = aflTradeStorySamples.load(tradeId)!.story;
    const { container, unmount } = render(<TradeTree story={story} />);
    const svg = container.querySelector('.tt-chart svg')!;
    const drawn = new Set(
      [...svg.querySelectorAll('.tt-halo [data-key]')].flatMap(keysOf).filter((k) => k !== 'bar')
    );
    expect(container.querySelectorAll('.ttk-btn')).toHaveLength(drawn.size);
    unmount();
  });

  it('pins a kind on press and clears it on a second press or Escape', () => {
    const story = aflTradeStorySamples.load(trades[0]!)!.story;
    const { container } = render(<TradeTree story={story} />);
    const key = container.querySelector('.ttk')!;
    const first = screen.getAllByRole('button', { pressed: false })[0]!;
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(key.getAttribute('data-active')).toBeTruthy();
    expect(container.querySelector('.ttk-says')!.textContent).not.toMatch(/Point at or tap/u);
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(first);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(key.getAttribute('data-active')).toBeNull();
  });
});
