import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio } from '@/components/aflTradeStory/tradePageModel';
import {
  CHART_THEME,
  checkpointName,
  lineStroke,
  nearestCheckpoint,
  valueLineChart,
} from '@/components/aflTradeStory/valueLineChart';
import type {
  AflTradeStoryNetPoint,
  AflTradeStoryTradeNet,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

/** The geometry of the private trade page's "This trade over time" chart (#789 step 7). */

const CLUBS = [
  'Adelaide',
  'Brisbane',
  'Carlton',
  'Collingwood',
  'Essendon',
  'Fremantle',
  'Geelong',
  'Gold Coast',
  'GWS',
  'Hawthorn',
  'Melbourne',
  'North Melbourne',
  'Port Adelaide',
  'Richmond',
  'St Kilda',
  'Sydney',
  'West Coast',
  'Western Bulldogs',
];

/** Checkpoints of a 2019 trade: the trade, its draft, then each season end and one later draft. */
const CHECKPOINTS: AflTradeStoryNetPoint['checkpoint'][] = [
  { kind: 'trade', season: 2019 },
  { kind: 'draft', season: 2019 },
  { kind: 'season_end', season: 2020 },
  { kind: 'draft', season: 2020 },
  { kind: 'season_end', season: 2021 },
  { kind: 'season_end', season: 2022 },
  { kind: 'season_end', season: 2023 },
  { kind: 'season_end', season: 2024 },
  { kind: 'season_end', season: 2025 },
  { kind: 'season_end', season: 2026 },
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

/** A two-club trade: each club's line mirrors the other's. */
function pair(left: string, right: string, nets: readonly number[], pendingAt: number[] = []) {
  return [
    net(left, nets, pendingAt),
    net(
      right,
      nets.map((value) => -value),
      pendingAt
    ),
  ];
}

const RISING = [22.7, 29.8, 30.7, 22.2, 29.7, 13.8, 27.0, -3.2, -41.4, -55.0];

describe('value line chart: words', () => {
  it('names each checkpoint for the readout and the table', () => {
    expect(CHECKPOINTS.slice(0, 3).map(checkpointName)).toEqual([
      'At the trade, 2019',
      '2019 draft',
      'End of 2020',
    ]);
  });
});

describe('value line chart: colours', () => {
  it('draws every club at 3:1 or better on both themes', () => {
    for (const theme of ['light', 'dark'] as const)
      for (const club of CLUBS)
        expect(
          contrastRatio(lineStroke(club, theme), CHART_THEME[theme].surface),
          `${club} (${theme})`
        ).toBeGreaterThanOrEqual(3);
  });

  it('keeps the chart theme in step with the page tokens', () => {
    const css = readFileSync(
      join(__dirname, '../../src/components/aflTradeStory/tradeStory.css'),
      'utf8'
    );
    const tokens = (name: string) =>
      [...css.matchAll(new RegExp(`--ts-${name}: (#[0-9a-f]{6});`, 'gu'))].map(([, hex]) => hex);
    expect(tokens('surface')).toEqual([CHART_THEME.light.surface, CHART_THEME.dark.surface]);
    expect(tokens('ink')).toEqual([CHART_THEME.light.ink, CHART_THEME.dark.ink]);
  });

  it('dashes a club whose line looks like an earlier club’s', () => {
    const chart = valueLineChart(
      [net('Collingwood', RISING), net('St Kilda', RISING), net('Gold Coast', RISING)],
      720
    );
    // Collingwood and St Kilda are both black on a light page; St Kilda and Gold Coast both red on
    // a dark one. Each dashed line gets its own pattern.
    expect(chart.series.map(({ dash }) => dash)).toEqual([null, '6 4', '2 3']);
    const distinct = valueLineChart(pair('Geelong', 'Gold Coast', RISING), 720);
    expect(distinct.series.map(({ dash }) => dash)).toEqual([null, null]);
  });
});

describe('value line chart: geometry', () => {
  const chart = valueLineChart(pair('Geelong', 'GWS', RISING), 720);

  it('is symmetric about zero, with clean ticks that hold the largest net', () => {
    expect(chart.yTicks.map(({ value }) => value)).toEqual([60, 30, 0, -30, -60]);
    expect(chart.yTicks.map(({ label }) => label)).toEqual(['+60', '+30', '0', '−30', '−60']);
    const zero = chart.yTicks.find(({ value }) => value === 0)!;
    expect(zero.y).toBeCloseTo((chart.plot.top + chart.plot.bottom) / 2, 9);
  });

  it('places one point per checkpoint per club, a mirror for each two-club pair', () => {
    expect(chart.xs).toHaveLength(CHECKPOINTS.length);
    expect(chart.xs[0]).toBe(chart.plot.left);
    expect(chart.xs.at(-1)).toBe(chart.plot.right);
    const [geelong, gws] = chart.series;
    geelong!.points.forEach((point, at) =>
      expect(point.y + gws!.points[at]!.y).toBeCloseTo(chart.plot.top + chart.plot.bottom, 9)
    );
    expect(geelong!.path.startsWith(`M${chart.plot.left} `)).toBe(true);
  });

  it('marks a point hollow where its net leaves out a value not in yet', () => {
    const pending = valueLineChart(pair('Geelong', 'GWS', RISING, [0, 1]), 720);
    expect(pending.series[0]!.points.map(({ pending: hollow }) => hollow).slice(0, 3)).toEqual([
      true,
      true,
      false,
    ]);
    expect(pending.endLabels.map(({ text }) => text)).toEqual(['GWS +55.0', 'GEE −55.0']);
  });

  it('labels the latest checkpoint and the trade first, then what fits, never overlapping', () => {
    for (const width of [300, 480, 720, 1100]) {
      const labels = valueLineChart(pair('Geelong', 'GWS', RISING), width).xLabels;
      expect(labels[0]!.label, `${width}px`).toBe('Trade');
      expect(labels.at(-1)!.label, `${width}px`).toBe('2026');
      labels.slice(1).forEach((label, at) => {
        const previous = labels[at]!;
        const halfWidths = ((label.label.length + previous.label.length) * 7) / 2;
        expect(label.x - previous.x, `${width}px`).toBeGreaterThanOrEqual(halfWidths + 8);
      });
    }
    expect(valueLineChart(pair('Geelong', 'GWS', RISING), 1100).xLabels).toHaveLength(10);
    expect(valueLineChart(pair('Geelong', 'GWS', RISING), 300).xLabels.length).toBeLessThan(10);
  });

  it('leaves out an end label that would overlap another', () => {
    const level = valueLineChart(pair('Geelong', 'GWS', [...RISING.slice(0, -1), 0.2]), 720);
    expect(level.endLabels).toHaveLength(1);
    const three = valueLineChart(
      [
        net('Brisbane', [...RISING.slice(0, -1), 69.3]),
        net('West Coast', [...RISING.slice(0, -1), -3.5]),
        net('Fremantle', [...RISING.slice(0, -1), -65.8]),
      ],
      720
    );
    expect(three.endLabels.map(({ text }) => text)).toEqual(['BRI +69.3', 'WC −3.5', 'FRE −65.8']);
  });

  it('refuses clubs whose lines have different checkpoints', () => {
    const [geelong, gws] = pair('Geelong', 'GWS', RISING);
    expect(() => valueLineChart([geelong!, { ...gws!, line: gws!.line.slice(1) }], 720)).toThrow(
      /same checkpoints/u
    );
  });

  it('finds the checkpoint nearest the pointer', () => {
    expect(nearestCheckpoint(chart.xs, 0)).toBe(0);
    expect(nearestCheckpoint(chart.xs, chart.xs[3]! + 4)).toBe(3);
    expect(nearestCheckpoint(chart.xs, 10_000)).toBe(CHECKPOINTS.length - 1);
  });
});

describe('value line chart: end labels', () => {
  it('leaves room for the longest end label inside the chart', () => {
    for (const nets of [RISING, [...RISING.slice(0, -1), -207.8]]) {
      const chart = valueLineChart(pair('Western Bulldogs', 'GWS', nets, [nets.length - 1]), 324);
      for (const label of chart.endLabels)
        expect(chart.plot.right + 8 + label.text.length * 7, label.text).toBeLessThanOrEqual(324);
    }
  });
});
