import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TradeTree } from '@/components/aflTradeStory/TradeTree';
import { aflTradeStorySamples } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

/**
 * No two labels in the trade tree's chart meet (owner, 2026-11-27: "not used" over the pick's name,
 * "stint ended" into the PAV, the last year into "Became"). Widths are estimated as the chart does:
 * about 0.58em a letter for bold text and 0.52em for regular, numbers at 0.6em.
 */

interface Box {
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const boxes = (svg: SVGSVGElement): Box[] =>
  [...svg.querySelectorAll('text')].flatMap((node) => {
    // A text drawn inside a marker (the ⇄ in its circle) or a legend swatch is not a label.
    if (node.closest('pattern, defs, marker') || node.textContent === '⇄') return [];
    const size = Number(node.getAttribute('font-size') ?? 14);
    const bold = Number(node.getAttribute('font-weight') ?? 400) >= 600;
    const text = node.textContent ?? '';
    if (text.trim() === '') return [];
    const em = node.classList.contains('tt-svg-num') ? 0.6 : bold ? 0.58 : 0.52;
    const width = text.length * size * em;
    const x = Number(node.getAttribute('x'));
    const y = Number(node.getAttribute('y'));
    const anchor = node.getAttribute('text-anchor');
    const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
    return [{ text, left, right: left + width, top: y - size * 0.75, bottom: y + size * 0.2 }];
  });

/** Labels on one line need a few units between them, or they read as one. */
const GAP = 6;
const meet = (a: Box, b: Box) =>
  a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom && b.top < a.bottom;

const trades = aflTradeStorySamples.list().stories.map(({ tradeId }) => tradeId);

describe('trade tree layout', () => {
  it.each(trades)('keeps every chart label clear of the others in %s', (tradeId) => {
    const story = aflTradeStorySamples.load(tradeId)!.story;
    for (const compact of [false, true]) {
      const { container, unmount } = render(<TradeTree story={story} compact={compact} />);
      for (const svg of container.querySelectorAll('svg')) {
        const all = boxes(svg);
        const clashes = all.flatMap((a, i) =>
          all.slice(i + 1).flatMap((b) => (meet(a, b) ? [`«${a.text}» meets «${b.text}»`] : []))
        );
        expect(clashes, compact ? 'compact' : 'full').toEqual([]);
      }
      unmount();
    }
  });

  it.each(trades)('starts each "traded to" note at its ring in %s', (tradeId) => {
    const story = aflTradeStorySamples.load(tradeId)!.story;
    const { container, unmount } = render(<TradeTree story={story} />);
    const svg = container.querySelector('.tt-chart svg')!;
    const rings = [...svg.querySelectorAll('circle[r="11"]')].map((ring) =>
      Number(ring.getAttribute('cx'))
    );
    const notes = [...svg.querySelectorAll('text')].filter((n) =>
      n.textContent?.startsWith('traded to')
    );
    expect(notes.length).toBe(rings.length);
    notes.forEach((note, at) => expect(Number(note.getAttribute('x'))).toBe(rings[at]! - 11));
    unmount();
  });

  it.each(trades)('puts "not in yet" on its name\'s line in %s', (tradeId) => {
    const story = aflTradeStorySamples.load(tradeId)!.story;
    const { container, unmount } = render(<TradeTree story={story} />);
    const svg = container.querySelector('.tt-chart svg')!;
    for (const value of svg.querySelectorAll('.tt-svg-num')) {
      if (value.textContent !== 'not in yet') continue;
      const name = [...value.parentElement!.children].find(
        (n) => n.tagName === 'text' && n.getAttribute('font-weight') === '700'
      )!;
      expect(value.getAttribute('y')).toBe(name.getAttribute('y'));
    }
    unmount();
  });
});
