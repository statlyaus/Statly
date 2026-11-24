import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AflTradeStoryPage, headline } from '@/components/aflTradeStory/AflTradeStoryPage';
import { BidMatchShareCard } from '@/components/aflTradeStory/BidMatchShareCard';
import { TradeTree } from '@/components/aflTradeStory/TradeTree';
import { aflTradeStorySamples } from '@/server/aflTradeIntelligence/development/tradeStorySamples';
import type { AflTradeAssetLedgerBidMatch } from '@/server/aflTradeIntelligence/valuation/assetLedgerContracts';
import type {
  AflTradePageBidMatch,
  AflTradePageModel,
} from '@/server/aflTradeIntelligence/valuation/realizedTradePageContracts';

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
  it('leads with each club’s net on this trade alone, not a letter grade', () => {
    const { container } = renderPage(TRADE.cameron);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Geelong are ahead so far');
    const chips = screen.getByRole('list', { name: 'Each club’s net on this trade' });
    expect(textOf(chips)).toContain('+50.9 Geelong');
    expect(textOf(chips)).toContain('−50.9 GWS');
    // The deal strip: what each club gave, highest value first, from the trade's sides.
    const deal = screen.getByRole('list', { name: 'What each club gave' });
    expect(within(deal).getAllByRole('listitem').map(textOf)).toEqual([
      'Geelong gave 2021 4th round, pick 20 → pick 25, pick 15 (WCE), pick 13',
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
    // Each asset's value at the trade sits beside its value now.
    expect(textOf(gws)).toContain('Jeremy Cameron first stint at Geelong · at the trade 70.0 95.3');
    expect(textOf(gws)).toContain(
      '2021 2nd round (GWS) became Paul Curtis (at North Melbourne) · at the trade 14.9 51.6'
    );
    expect(textOf(gws)).toContain('Geelong received 146.9');
    const geelong = within(details).getByRole('heading', {
      name: /Geelong gave GWS/u,
    }).parentElement!;
    expect(textOf(geelong)).toContain('GWS received 96.0');
    expect(textOf(details)).toContain(
      'On this trade alone Geelong +50.9 at the trade +28.1* GWS −50.9 at the trade −28.1*'
    );
    // The chain is secondary: shown, never the headline.
    expect(textOf(details)).toContain(
      'With what each club did next Geelong −1.6 −52.5 from 1 later trade'
    );
  });

  it('marks players still at their club, and one who left', () => {
    renderPage(TRADE.cameron);
    const players = section('Who they ended up with');
    const cameron = within(players).getByRole('heading', {
      name: /Jeremy Cameron/u,
    }).parentElement!;
    expect(textOf(cameron)).toContain('From GWS in the 2020 trade.');
    expect(textOf(cameron)).toContain('95.3 PAV, produced plus expected');
    expect(textOf(cameron)).toContain('Still at Geelong · value will move');
    const curtis = within(players).getByRole('heading', { name: /Paul Curtis/u }).parentElement!;
    expect(textOf(curtis)).toContain(
      'Taken with pick 35 in 2021 by North Melbourne, with pick 32.'
    );
    expect(
      within(players).getByRole('heading', { name: 'Now at other clubs' })
    ).toBeInTheDocument();
    const mcmahon = within(players).getByRole('heading', { name: /Liam McMahon/u }).parentElement!;
    expect(textOf(mcmahon)).toContain('0.0 PAV produced');
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
      'Geelong get Jeremy Cameron and 2 more. GWS get 2021 4th round and 3 more.'
    );
    expect(textOf(figure)).toContain('This trade now (2026) Geelong +50.9 GWS −50.9');
    expect(textOf(figure)).toContain(
      '2020. Draft. Cook (pick 25), Angwin (pick 18), Stone (pick 15) and'
    );
    expect(textOf(figure)).toContain('2026: Geelong +50.9, GWS −50.9.');
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
    expect(textOf(card)).toContain('9.34 Pick 34 · 2021 (GEE)’s share: 26.9% of Sam Darcy’s value');
    const rows = within(card)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.querySelectorAll('th, td')].map(textOf));
    expect(rows).toEqual([
      ['Pick 34 (this pick)', '542', '26.9%'],
      ['Pick 42', '395', '19.6%'],
      ['Pick 43', '378', '18.8%'],
      ['Pick 44', '362', '18.0%'],
      ['Pick 45 · part used', '336.6', '16.7%'],
    ]);
    expect(textOf(card)).toContain('Pick 45 had 10.4 points left over. They became pick 61.');
    expect(textOf(card)).not.toContain('not in the totals');
  });

  it('counts each matched-bid pick’s share in the nets, unstarred', () => {
    renderPage(TRADE.geeWbd);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Western Bulldogs are ahead so far'
    );
    const chips = screen.getByRole('list', { name: 'Each club’s net on this trade' });
    expect(textOf(chips)).toContain('−52.5 Geelong');
    expect(textOf(chips)).toContain('+52.5 Western Bulldogs');
    // Each matched-bid pick's value is its value line: its share of the nominee.
    const details = section('Trade details');
    expect(textOf(details)).toMatch(
      /Pick 34 · 2021 \(GEE\) used to match a bid · share of Sam Darcy · at the trade \d+\.\d 9\.34/u
    );
    // The chain still shows the unpriced 2022 bid as pending.
    expect(textOf(details)).toContain('Western Bulldogs +32.0* −20.6 from 1 later trade');
    const pick42 = within(section('Who they ended up with')).getByRole('heading', {
      name: /Pick 42$/u,
    }).parentElement!;
    expect(textOf(pick42)).toContain('6.81 PAV, share of Sam Darcy');
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

describe('private trade page: the headline', () => {
  it('reads this trade alone, never the chain (owner, 2026-10-21)', () => {
    const cameron = model(TRADE.cameron);
    // A chain that leans the other way leaves the headline on this trade's own nets.
    const flipped: AflTradePageModel = {
      ...cameron,
      story: {
        ...cameron.story,
        nets: {
          ...cameron.story.nets,
          withNextMoves: cameron.story.nets.withNextMoves.map((net) => ({
            ...net,
            net: -net.net,
          })),
        },
      },
    };
    expect(headline(flipped)).toBe('Geelong are ahead so far');
    expect(headline(model(TRADE.wbdNth))).toBe('North Melbourne are ahead so far');
  });

  it('calls a trade level when its nets read 0.0, in neutral ink', () => {
    const cameron = model(TRADE.cameron);
    const level: AflTradePageModel = {
      ...cameron,
      story: {
        ...cameron.story,
        nets: {
          ...cameron.story.nets,
          tradeAlone: cameron.story.nets.tradeAlone.map((net, at) => ({
            ...net,
            net: at === 0 ? 0.03 : -0.03,
          })),
        },
      },
    };
    expect(headline(level)).toBe('Level so far');
    render(<AflTradeStoryPage model={level} />);
    const chips = screen.getByRole('list', { name: 'Each club’s net on this trade' });
    for (const value of within(chips).getAllByText('0.0')) {
      expect(value.className).toMatch(/\btext-foreground\b/u);
    }
  });

  it('calls a trade no season has been played since a projection', () => {
    const cameron = model(TRADE.cameron);
    const projected: AflTradePageModel = {
      ...cameron,
      story: {
        ...cameron.story,
        nets: {
          ...cameron.story.nets,
          tradeAlone: cameron.story.nets.tradeAlone.map((net) => ({
            ...net,
            line: net.line.filter(({ checkpoint }) => checkpoint.kind !== 'season_end'),
          })),
        },
      },
    };
    expect(headline(projected)).toBe('Geelong are ahead on projection');
    const { container } = render(<AflTradeStoryPage model={projected} />);
    expect(textOf(container)).toContain('No season has been played since this trade');
    expect(headline(cameron)).toBe('Geelong are ahead so far');
  });

  it('sets every net in ink, never in good and bad colours', () => {
    render(<AflTradeStoryPage model={model(TRADE.cameron)} />);
    const chips = screen.getByRole('list', { name: 'Each club’s net on this trade' });
    for (const value of within(chips).getAllByText(/^[+−]/u)) {
      expect(value.className).toMatch(/\btext-foreground\b/u);
      expect(value.className).not.toMatch(/success|destructive|result-|ts-(pos|neg)/u);
    }
  });

  it('names the checkpoint the values were read at', () => {
    const cameron = model(TRADE.cameron);
    const atDraft: AflTradePageModel = {
      ...cameron,
      story: { ...cameron.story, checkpoint: { kind: 'draft', season: 2026 } },
    };
    render(<AflTradeStoryPage model={atDraft} />);
    expect(screen.getByText(/value lines at the 2026 draft:/u)).toBeInTheDocument();
  });
});

describe('private trade page: values not in yet', () => {
  it('names a pending traded player on his card, never "Pick"', () => {
    const cameron = model(TRADE.cameron);
    const pending = { kind: 'pending', pending: 'traded_player_fit_not_stored' } as const;
    const withPending: AflTradePageModel = {
      ...cameron,
      story: {
        ...cameron.story,
        players: cameron.story.players.map((player) =>
          player.assetId === cameron.story.players[0]!.assetId
            ? { ...player, outcome: pending, value: pending, stillAtClub: false }
            : player
        ),
      },
    };
    render(<AflTradeStoryPage model={withPending} />);
    const players = section('Who they ended up with');
    const card = within(players).getByRole('heading', { name: /Jeremy Cameron/u }).parentElement!;
    expect(textOf(card)).toContain('From GWS. Estimate not in yet.');
  });

  it('gives an at-trade value not in yet its reason, and footnotes an at-trade star', () => {
    renderPage(TRADE.cameron);
    const details = section('Trade details');
    expect(textOf(details)).toContain('at the trade +28.1*');
    expect(textOf(details)).toMatch(/at the trade pick slot not known yet/u);
    expect(screen.getByText(/^\* Totals leave out values not in yet/u)).toBeInTheDocument();
  });

  it('says a trade tree lane’s value is not in yet, as the rest of the page does', () => {
    const cameron = model(TRADE.cameron);
    const pending = { kind: 'pending', pending: 'traded_player_fit_not_stored' } as const;
    const { lineage } = cameron.story;
    const { container } = render(
      <TradeTree
        story={{
          ...cameron.story,
          lineage: {
            ...lineage,
            assets: lineage.assets.map((asset, index) =>
              index === 0 ? { ...asset, value: pending } : asset
            ),
          },
        }}
      />
    );
    const list = screen.getByRole('list', { name: 'Every pick and player, and what it became' });
    const chartNumbers = [...container.querySelectorAll('.tt-svg-num')].map(
      (node) => node.textContent
    );
    expect(textOf(list)).toContain('not in yet');
    expect(textOf(list)).not.toMatch(/pending|not in yet PAV/u);
    expect(chartNumbers).toContain('not in yet');
    expect(chartNumbers).not.toContain('pending');
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

describe('private trade page: this trade over time (#789 step 7)', () => {
  it('reads each club’s net at the latest checkpoint first, as the chart’s legend', () => {
    renderPage(TRADE.cameron);
    const chart = section('This trade over time');
    const readout = within(chart).getByRole('list', { name: 'Each club’s net at this point' });
    expect(textOf(readout)).toBe('+50.9 Geelong −50.9 GWS');
    // The readout names the checkpoint; the values table names it again.
    expect(within(chart).getAllByText('End of 2026')).toHaveLength(2);
    const slider = within(chart).getByRole('slider', { name: 'Point in time' });
    expect(slider).toHaveAttribute('aria-valuetext', 'End of 2026: Geelong +50.9, GWS −50.9');
  });

  it('steps back to the trade with the keyboard, at-trade net starred', () => {
    renderPage(TRADE.cameron);
    const chart = section('This trade over time');
    const slider = within(chart).getByRole('slider', { name: 'Point in time' });
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      'At the trade, 2020: Geelong +28.1*, GWS −28.1*'
    );
    expect(
      within(chart).getByText(/A hollow point leaves out values not in yet\./u)
    ).toBeInTheDocument();
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuetext', 'End of 2026: Geelong +50.9, GWS −50.9');
  });

  it('lists every checkpoint in the values table, the same nets the story holds', () => {
    const { story } = model(TRADE.cameron);
    renderPage(TRADE.cameron);
    const table = within(section('This trade over time')).getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    const geelong = story.nets.tradeAlone[0]!;
    expect(rows).toHaveLength(geelong.line.length);
    expect(textOf(rows[0]!)).toBe('At the trade, 2020 +28.1* −28.1*');
    expect(textOf(rows.at(-1)!)).toBe('End of 2026 +50.9 −50.9');
  });
});

describe('bid match card: a 2026 Draftguru order bid (owner, 2026-11-24)', () => {
  const spent = (asPick: number, label: string, countedPoints: number | null) => ({
    nativePickId: `order-${asPick}`,
    label,
    originalNumber: null,
    originalClubId: null,
    pointsUsed: 0,
    pickId: `pick-${asPick}`,
    link: 'order_row' as const,
    countedPoints,
    share: countedPoints === null ? null : countedPoints / 2700,
    use: countedPoints === null ? null : ('full' as const),
    value: null,
    asPick,
  });
  /** Port Adelaide matched Dougie Cochrane's bid at 1 with picks 6 and 22, 355 points short. */
  const portBid = (fields: Partial<AflTradeAssetLedgerBidMatch> = {}): AflTradePageBidMatch => ({
    match: {
      bidMatchId: 'external-draft-order-bid-match:test',
      source: 'draftguru_order',
      draftYear: 2026,
      draftType: 'national',
      selectionNumber: 1,
      clubId: 'port',
      bidClubId: 'essendon',
      basis: 'next_generation_academy',
      ladderPosition: 15,
      nominee: {
        selectionId: 'sel-c',
        playerId: 'cochrane',
        firstStint: {
          clubId: 'port',
          startSeason: 2027,
          endSeason: null,
          status: 'open',
          arrivalReviewed: false,
          beganBeforeCoverage: false,
          seasons: [],
          seasonsMissingPav: [],
          total: 0,
          value: 0,
        },
      },
      pricing: {
        status: 'shared',
        ruleId: 'afl-bid-price-2026-ladder',
        pricePoints: 2700,
        leftover: null,
        deficit: { points: 355, against: 'next_draft_first_pick' },
      },
      spentPicks: [spent(6, 'Pick 6', 1659), spent(22, 'Pick 22 (from Richmond)', 686)],
      ...fields,
    },
    nomineeName: 'Dougie Cochrane',
    clubName: 'Port Adelaide',
    leftoverLabels: [],
  });
  const renderCard = (
    bid: AflTradePageBidMatch,
    value: Parameters<typeof BidMatchShareCard>[0]['value'] = { kind: 'known', pav: 21.3 },
    season = 2026,
    kind: 'season_end' | 'draft' = 'season_end'
  ) =>
    render(
      <BidMatchShareCard
        assetId="pick-22"
        label="Pick 22 (from Richmond)"
        share={{ bid, spentIndex: 1 }}
        value={value}
        checkpoint={{ kind, season }}
      />
    ).container;

  it('says the deficit comes off next year’s first-round pick, and the value is projected', () => {
    const card = renderCard(portBid());
    expect(textOf(card)).toContain(
      'Port Adelaide matched a bid for Dougie Cochrane at pick 1 in 2026. The price was 2,700 points, paid with 2 picks.'
    );
    expect(textOf(card)).toContain(
      'Port Adelaide were 355 points short. Those points come off their first-round pick in the 2027 draft.'
    );
    expect(textOf(card)).toContain(
      '21.30 Pick 22 (from Richmond)’s share: 25.4% of Dougie Cochrane’s projected value'
    );
    expect(textOf(card)).toContain(
      'Dougie Cochrane has not played a season yet, so his value is projected from pick 1.'
    );
    expect(textOf(card)).not.toContain('price is not known');
  });

  it('drops the projection once the nominee has played, and the deficit line with no deficit', () => {
    const card = renderCard(
      portBid({
        pricing: {
          status: 'shared',
          ruleId: 'afl-bid-price-2026-ladder',
          pricePoints: 2345,
          leftover: null,
          deficit: null,
        },
      }),
      { kind: 'known', pav: 21.3 },
      2027
    );
    expect(textOf(card)).toContain('of Dougie Cochrane’s value');
    expect(textOf(card)).not.toContain('projected');
    expect(textOf(card)).not.toContain('points short');
    // A story read at the next draft comes after that season's end: still played, not projected.
    const atDraft = renderCard(portBid(), { kind: 'known', pav: 21.3 }, 2027, 'draft');
    expect(textOf(atDraft)).not.toContain('projected');
    // At the bid's own draft the nominee has not played.
    const atBid = renderCard(portBid(), { kind: 'known', pav: 21.3 }, 2026, 'draft');
    expect(textOf(atBid)).toContain('projected value');
  });

  it('says why a share is not in: an unpriced bid, or a nominee value not in yet', () => {
    const unpriced = portBid({
      pricing: { status: 'refused', reason: 'ladder_position_missing', detail: 'no ladder' },
      spentPicks: [spent(6, 'Pick 6', null), spent(22, 'Pick 22 (from Richmond)', null)],
    });
    expect(textOf(renderCard(unpriced, { kind: 'pending', pending: 'matched_bid' }))).toContain(
      'This bid has no price yet, so the pick’s share is not in yet.'
    );
    expect(textOf(renderCard(portBid(), { kind: 'pending', pending: 'unavailable' }))).toContain(
      'Pick 22 (from Richmond)’s share is 25.4% of Dougie Cochrane. His value is not in yet.'
    );
  });
});
