import { describe, expect, it } from 'vitest';

import { gotSummary, tradeShareCardModel } from '@/components/aflTradeStory/shareCardModel';
import { aflTradeStorySamples } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

/**
 * The share card a trade link shows on Reddit, X and in chats (owner-approved design, 2026-11-21):
 * each club's PAV held from the trade over time, starting from what it got.
 */

const sample = (tradeId: string) => {
  const model = aflTradeStorySamples.load(tradeId);
  if (!model) throw new Error(`no sample ${tradeId}`);
  return model;
};

describe('tradeShareCardModel', () => {
  it('draws two lines that reconcile with the trade page nets at every point', () => {
    let drawn = 0;
    for (const { tradeId } of aflTradeStorySamples.list().stories) {
      const page = sample(tradeId);
      const card = tradeShareCardModel(page);
      if (card.chart.kind !== 'lines') continue;
      drawn += 1;
      const [first, second] = card.chart.clubs;
      const net = page.story.nets.tradeAlone.find(({ clubId }) => clubId === first!.clubId)!;
      card.chart.points.forEach((point, at) => {
        const onPage = net.line.find(
          ({ checkpoint }) =>
            checkpoint.kind === point.checkpoint.kind &&
            checkpoint.season === point.checkpoint.season
        )!;
        expect(first!.held[at]! - second!.held[at]!).toBeCloseTo(onPage.net, 6);
      });
    }
    expect(drawn).toBeGreaterThan(0);
  });

  it('keeps the trade, the first draft and every season end, in order', () => {
    const card = tradeShareCardModel(sample('trade:2021-gee-wbd'));
    if (card.chart.kind !== 'lines') throw new Error('expected lines');
    const labels = card.chart.points.map(({ label }) => label);
    expect(labels[0]).toBe('Trade');
    expect(labels.filter((label) => label === 'Draft')).toHaveLength(1);
    expect(labels.slice(2)).toEqual([...labels.slice(2)].sort());
  });

  it('gives each club a headline the trade page agrees with', () => {
    const card = tradeShareCardModel(sample('trade:2021-gee-wbd'));
    expect(card.kicker).toBe('AFL trades · 2021');
    expect(card.title).toBe('Geelong ⇄ Western Bulldogs');
    expect(card.verdict).toBe('Western Bulldogs are ahead');
    expect(card.lead).toBe('+52.5');
    expect(card.footer).toBe('Values to the end of 2026 · statly.com.au/afl/trades');
  });

  it('says level, not a number, when no club is ahead', () => {
    const card = tradeShareCardModel(sample('trade:2021-nth-gee'));
    expect(card.verdict).toBe('Level so far');
    expect(card.lead).toBeNull();
  });

  it('shows no chart when a value is still to come, so a line never drops to zero', () => {
    const card = tradeShareCardModel(sample('trade:2020-gws-gee'));
    expect(card.chart.kind).toBe('summary');
    expect(card.chart.clubs.map(({ got }) => got)).toEqual([
      'Jeremy Cameron + 2 picks',
      'picks 13, 15, 20 + 1',
    ]);
  });

  it('describes the card in alt text', () => {
    const card = tradeShareCardModel(sample('trade:2021-gee-wbd'));
    expect(card.alt).toMatch(/^Share card for the 2021 Geelong and Western Bulldogs trade\./u);
    expect(card.alt).toContain('Western Bulldogs are ahead by 52.5 PAV');
  });
});

describe('gotSummary', () => {
  const asset = (assetKind: 'player' | 'pick', label: string) => ({ assetKind, label });

  it('names players, groups numbered picks and counts the rest', () => {
    expect(
      gotSummary([
        asset('pick', '2021 4th round'),
        asset('pick', 'Pick 20 → pick 25'),
        asset('pick', 'Pick 15 (WCE)'),
        asset('pick', 'Pick 13'),
      ])
    ).toBe('picks 13, 15, 20 + 1');
    expect(
      gotSummary([asset('player', 'Jeremy Cameron'), asset('pick', '2021 2nd round (GWS)')])
    ).toBe('Jeremy Cameron + 1 pick');
    expect(gotSummary([asset('pick', '2020 pick 13 (Geelong)')])).toBe('pick 13');
    expect(
      gotSummary([asset('pick', '2022 1st round (GCS)'), asset('pick', '2022 2nd round')])
    ).toBe('2 picks');
  });

  it('fits the column, moving whatever does not fit into the count', () => {
    const text = gotSummary([
      asset('player', 'Christopher Mayne-Smith'),
      asset('player', 'Bailey Smith'),
      asset('pick', 'Pick 3'),
    ]);
    expect(text.length).toBeLessThanOrEqual(30);
    expect(text).toBe('Christopher Mayne-Smith + 2');
  });
});
