import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AflTradeStoryPage } from '@/components/aflTradeStory/AflTradeStoryPage';
import { aflTradeStorySamples } from '@/server/aflTradeIntelligence/development/tradeStorySamples';
import type { AflTradePageModel } from '@/server/aflTradeIntelligence/valuation/realizedTradePageContracts';

import { TRADE } from '../fixtures/aflTradeStoryCameronChainFixture';

/** The private trade page, rendered from the #965 Cameron chain fixture and the Darcy bid sample. */

function model(tradeId: string): AflTradePageModel {
  const loaded = aflTradeStorySamples.load(tradeId);
  if (!loaded) throw new Error(`No sample story for ${tradeId}`);
  return loaded;
}

const renderPage = (tradeId: string) => render(<AflTradeStoryPage model={model(tradeId)} />);
const section = (name: string) => screen.getByRole('region', { name });
/** The text a reader hears: aria-hidden parts left out, elements separated by a space. */
function textOf(element: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? '');
    else if (node instanceof Element && node.getAttribute('aria-hidden') !== 'true')
      node.childNodes.forEach(walk);
  };
  walk(element);
  return parts
    .join(' ')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([.,:’)])/gu, '$1')
    .trim();
}

beforeAll(() => {
  // jsdom does not lay out, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('private trade page: the Cameron trade (Geelong ⇄ GWS, 2020)', () => {
  it('leads with each club’s value so far, not a letter grade', () => {
    const { container } = renderPage(TRADE.cameron);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Geelong are ahead so far');
    const chips = screen.getByRole('list', { name: 'Each club’s value so far' });
    expect(textOf(chips)).toContain('+7.7* Geelong');
    expect(textOf(chips)).toContain('−57.6 GWS');
    // The deal strip: what each club gave, from the trade's sides.
    const deal = screen.getByRole('list', { name: 'What each club gave' });
    expect(within(deal).getAllByRole('listitem').map(textOf)).toEqual([
      'Geelong gave pick 13, pick 15 (WCE), pick 20 → pick 25, 2021 4th round',
      'GWS gave Jeremy Cameron, 2021 2nd round (GWS), 2021 2nd round (ESS)',
    ]);
    expect(textOf(container)).not.toContain('on this trade, then');
    expect(textOf(container)).not.toMatch(/\bgrade\b/iu);
    // No claim the data does not hold, and no dramatised labels.
    expect(textOf(container)).not.toMatch(/got away|came home|goes home|best player|backfired/iu);
    expect(screen.getByText(/Private page\./u)).toBeInTheDocument();
  });

  it('shows what each club gave and what every asset became', () => {
    renderPage(TRADE.cameron);
    const details = section('Trade details');
    const gws = within(details).getByRole('heading', { name: /GWS gave Geelong/u }).parentElement!;
    expect(textOf(gws)).toContain('Jeremy Cameron first stint at Geelong 95.3');
    expect(textOf(gws)).toContain(
      '2021 2nd round (GWS) became Paul Curtis (at North Melbourne) 51.6'
    );
    expect(textOf(gws)).toContain('Geelong received 146.9');
    const geelong = within(details).getByRole('heading', {
      name: /Geelong gave GWS/u,
    }).parentElement!;
    expect(textOf(geelong)).toContain('GWS received 96.0');
    expect(textOf(details)).toContain('On this trade alone');
    expect(textOf(details)).toContain('+50.9');
    expect(textOf(details)).toContain('−43.2 from 1 later trade');
  });

  it('marks players still at their club, and one who left', () => {
    renderPage(TRADE.cameron);
    const players = section('Who they ended up with');
    const cameron = within(players).getByRole('heading', {
      name: /Jeremy Cameron/u,
    }).parentElement!;
    expect(textOf(cameron)).toContain('From GWS in the 2020 trade.');
    expect(textOf(cameron)).toContain('95.3 PAV to date');
    expect(textOf(cameron)).toContain('Still at Geelong · value will move');
    const curtis = within(players).getByRole('heading', { name: /Paul Curtis/u }).parentElement!;
    expect(textOf(curtis)).toContain(
      'Taken with pick 35 in 2021 by North Melbourne, with pick 32.'
    );
    expect(
      within(players).getByRole('heading', { name: 'Now at other clubs' })
    ).toBeInTheDocument();
    const mcmahon = within(players).getByRole('heading', { name: /Liam McMahon/u }).parentElement!;
    expect(textOf(mcmahon)).toContain('Left Collingwood · value is final');
  });

  it('pins every trade and draft on the scarf, with no events until sourced ones exist', () => {
    renderPage(TRADE.cameron);
    const figure = screen.getByRole('figure', {
      name: 'Timeline of the Geelong ⇄ GWS trade, 2020',
    });
    const steps = within(figure)
      .getAllByRole('listitem')
      .map(textOf)
      .filter((text) => /^\d{4}\./u.test(text));
    expect(steps.map((step) => step.split('.').slice(0, 2).join('.'))).toEqual([
      '2020. This trade',
      '2020. COL ⇄ GWS',
      '2020. Other deals',
      '2020. Draft',
      '2021. GEE ⇄ WBD',
      '2021. NM ⇄ WBD',
      '2021. Draft',
      '2022. Draft',
    ]);
    expect(textOf(figure)).toContain('6 trades in the chain');
    expect(textOf(figure)).toContain('Biggest values');
    expect(textOf(figure)).toContain(
      'Geelong get Jeremy Cameron and 2 more. GWS get pick 13 and 3 more.'
    );
    expect(textOf(figure)).toContain('Value now (2026) Geelong +7.7* GWS −57.6');
    expect(textOf(figure)).toContain(
      '2020. Draft. Cook (pick 25), Angwin (pick 18), Stone (pick 15) and'
    );
    expect(textOf(figure)).toContain('2026: Geelong +7.7*, GWS −57.6.');
  });
});

describe('private trade page: Geelong ⇄ Western Bulldogs, 2021', () => {
  it('shows pick 34 as a swap for a share of Sam Darcy', () => {
    renderPage(TRADE.geeWbd);
    const card = screen.getByRole('article', {
      name: 'Pick 34 · 2021 (GEE) became a share of Sam Darcy',
    });
    expect(within(card).getByText('BID MATCH')).toBeInTheDocument();
    expect(textOf(card)).toContain(
      'Western Bulldogs matched a bid for Sam Darcy at pick 2 in 2021. The price was 2,013.6 points, paid with 5 picks.'
    );
    expect(textOf(card)).toContain('9.34 Pick 34 · 2021 (GEE)’s share: 26.9% of Sam Darcy’s 34.71');
    const rows = within(card)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.querySelectorAll('th, td')].map(textOf));
    expect(rows).toEqual([
      ['Pick 34 (this pick)', '542', '9.34'],
      ['Pick 42', '395', '6.81'],
      ['Pick 43', '378', '6.52'],
      ['Pick 44', '362', '6.24'],
      ['Pick 45 · part used', '336.6', '5.80'],
    ]);
    expect(textOf(card)).toContain('Pick 45 had 10.4 points left over. They became pick 61.');
    expect(textOf(card)).toContain('Shares are not in the totals yet.');
  });

  it('keeps the matched-bid picks out of the nets, starred', () => {
    renderPage(TRADE.geeWbd);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Western Bulldogs are ahead so far'
    );
    const chips = screen.getByRole('list', { name: 'Each club’s value so far' });
    expect(textOf(chips)).toContain('−43.2* Geelong');
    expect(textOf(chips)).toContain('+15.8* Western Bulldogs');
    // Each matched-bid pick shows its ledger share, starred, instead of "pending".
    const details = section('Trade details');
    expect(textOf(details)).toContain(
      'Pick 34 · 2021 (GEE) used to match a bid · share of Sam Darcy 9.34 (share, not in the totals yet)'
    );
    const pick42 = within(section('Who they ended up with')).getByRole('heading', {
      name: /Pick 42$/u,
    }).parentElement!;
    expect(textOf(pick42)).toContain('6.81 share of Sam Darcy, not in the totals yet');
    // Pick 42 came to the Bulldogs in their next trade: its share card is on the page too.
    expect(
      screen.getByRole('article', { name: 'Pick 42 became a share of Sam Darcy' })
    ).toBeInTheDocument();
  });

  it('adds a BID MATCH node to the lineage that links to the share card', () => {
    renderPage(TRADE.geeWbd);
    const lineage = section('Lineage');
    expect(within(lineage).getByText('BID MATCH')).toBeInTheDocument();
    const link = within(lineage).getByRole('link', { name: 'Share of Sam Darcy: 9.34' });
    expect(link).toHaveAttribute('href', '#bid-pick-2021-34-gee');
    expect(document.getElementById('bid-pick-2021-34-gee')).not.toBeNull();
  });
});

describe('private trade page: the lineage map', () => {
  it('opens a trade inside the map, with its hash and its own page link', () => {
    renderPage(TRADE.cameron);
    const lineage = section('Lineage');
    const open = within(lineage).getAllByRole('button', {
      name: 'Show the Geelong ⇄ Western Bulldogs, 2021 trade',
    })[0]!;
    fireEvent.click(open);

    const panel = within(lineage).getByRole('region', {
      name: /Geelong ⇄ Western Bulldogs, 2021/u,
    });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(open).toHaveAttribute('aria-controls', panel.id);
    expect(within(panel).getByRole('heading')).toHaveFocus();
    expect(window.location.hash).toBe('#trade=trade%3A2021-gee-wbd');
    expect(textOf(panel)).toContain(
      'Pick 32 · 2021 (GWS) · became Paul Curtis (at North Melbourne) 51.6'
    );
    expect(
      within(panel).getByRole('link', { name: 'Trade page for Geelong ⇄ Western Bulldogs, 2021' })
    ).toHaveAttribute('href', '/dev/afl-trade-stories/trade%3A2021-gee-wbd');

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(within(lineage).queryByRole('region')).toBeNull();
    expect(open).toHaveFocus();
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(window.location.hash).toBe('');
  });

  it('opens the trade a hash names when the page loads', () => {
    window.history.replaceState(null, '', '/#trade=trade%3A2020-col-pta');
    renderPage(TRADE.cameron);
    const panel = screen.getByRole('region', { name: /Collingwood ⇄ Port Adelaide, 2020/u });
    expect(within(panel).getByRole('heading')).toHaveFocus();
  });

  it('follows a hash change, and ignores a hash for a trade not in the lineage', () => {
    renderPage(TRADE.cameron);
    act(() => {
      window.history.replaceState(null, '', '/#trade=trade%3A2099-unknown');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.queryByRole('region', { name: /2099/u })).toBeNull();
    act(() => {
      window.history.replaceState(null, '', '/#trade=trade%3A2020-gws-gee');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const panel = screen.getByRole('region', { name: /Geelong ⇄ GWS, 2020 \(this trade\)/u });
    expect(within(panel).queryByRole('link', { name: /Trade page/u })).toBeNull();
  });
});
