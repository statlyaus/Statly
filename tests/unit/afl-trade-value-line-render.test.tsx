import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TradeValueLine } from '@/components/aflTradeStory/TradeValueLine';
import type {
  AflTradeStory,
  AflTradeStoryNetPoint,
  AflTradeStoryTradeNet,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

/**
 * The drawn "This trade over time" chart, pinned before the paper surface replaced the --ts-* tokens.
 * Trades with three or four clubs keep today's chart (owner, 2026-11-20), so their line paths,
 * club strokes, dashes and points must not move. Colour token names and class lists are normalised:
 * the surface may rename the roles the chart reads, never its geometry.
 */

const CHECKPOINTS: AflTradeStoryNetPoint['checkpoint'][] = [
  { kind: 'trade', season: 2019 },
  { kind: 'draft', season: 2019 },
  { kind: 'season_end', season: 2020 },
  { kind: 'draft', season: 2020 },
  { kind: 'season_end', season: 2021 },
  { kind: 'season_end', season: 2022 },
];

function net(clubName: string, nets: readonly number[], pendingAt: number[] = []) {
  const line = nets.map((value, at) => ({
    checkpoint: CHECKPOINTS[at]!,
    net: value,
    pendingCount: pendingAt.includes(at) ? 1 : 0,
  }));
  const last = line.at(-1)!;
  return {
    clubId: `club:${clubName}`,
    clubName,
    net: last.net,
    pendingCount: last.pendingCount,
    pending: [],
    atTrade: { net: line[0]!.net, pendingCount: line[0]!.pendingCount, pending: [] },
    line,
  } satisfies AflTradeStoryTradeNet;
}

// Only the fields the chart reads; the rest of a story is irrelevant to it.
const story = (nets: AflTradeStoryTradeNet[]) =>
  ({ trade: { id: 'trade:test' }, nets: { tradeAlone: nets } }) as unknown as AflTradeStory;

const normalise = (markup: string) =>
  markup.replace(/var\(--(?!vl\))[a-z0-9-]+\)/gu, 'var(--token)').replace(/ class="[^"]*"/gu, '');

const render = (nets: AflTradeStoryTradeNet[]) =>
  normalise(renderToStaticMarkup(<TradeValueLine story={story(nets)} />));

const FIXTURES: Record<string, AflTradeStoryTradeNet[]> = {
  'three clubs': [
    net('Essendon', [1.6, -16.8, -13.3, -13.3, -13.0, -5.9]),
    net('West Coast', [-90.3, -79.4, -12.7, -16.8, 22.3, 41.4]),
    net('Geelong', [88.7, 96.2, 26.0, 30.1, -9.3, -35.6]),
  ],
  'four clubs': [
    net('Adelaide', [10, 12, 8, 4, -2, -6]),
    net('Brisbane', [-4, -8, -3, 1, 6, 12]),
    net('Fremantle', [-3, -2, 0, 2, 1, -1]),
    net('Sydney', [-3, -2, -5, -7, -5, -5]),
  ],
  // Collingwood, St Kilda and Essendon all wear black, so the later two are dashed.
  dashed: [
    net('Collingwood', [5, 9, 12, 14, 18, 20]),
    net('St Kilda', [-2, -4, -6, -7, -9, -10]),
    net('Essendon', [-3, -5, -6, -7, -9, -10]),
  ],
  pending: [
    net('Geelong', [20, 24, 30, 26, 31, 35], [4, 5]),
    net('GWS', [-20, -24, -30, -26, -31, -35], [4, 5]),
  ],
};

describe('value line chart markup', () => {
  it.each(Object.keys(FIXTURES))('%s draws as before', (name) => {
    expect(render(FIXTURES[name]!)).toMatchSnapshot();
  });
});
