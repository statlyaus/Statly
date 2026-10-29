import type {
  AflTradeStory,
  AflTradeStoryTradeNet,
} from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { clubStyle, contrastRatio, formatSigned, netText } from './tradePageModel';

/**
 * The geometry of the "This trade over time" chart (value-line method step 7,
 * statlyaus/Statly#789): each club's net on one trade at every checkpoint, from the story's lines.
 * Pure, so the client chart only draws what this returns.
 */

type Checkpoint = AflTradeStory['checkpoint'];

/** The chart's surface and ink in each theme: `--ts-surface` and `--ts-ink` in tradeStory.css. */
export const CHART_THEME = {
  light: { surface: '#ffffff', ink: '#0b0b0b' },
  dark: { surface: '#232321', ink: '#f0efec' },
} as const;

/** WCAG 1.4.11: a line must reach 3:1 against the surface it is drawn on. */
const GRAPHIC_CONTRAST = 3;

export const CHART_HEIGHT = 240;
/** The right margin holds the end labels, so it grows with the longest one. */
const MARGIN = { left: 44, top: 16, bottom: 30, endLabelPadding: 4 };
/** The gap between a line's end and its label. */
export const END_LABEL_OFFSET = 8;
/** Axis and end labels are 12px; this is a generous average glyph width for fitting them. */
const GLYPH = 7;
const LABEL_GAP = 8;
const END_LABEL_SPACING = 14;

/** "At the trade, 2019", "2020 draft", "End of 2021". */
export function checkpointName({ kind, season }: Checkpoint): string {
  if (kind === 'trade') return `At the trade, ${season}`;
  return kind === 'draft' ? `${season} draft` : `End of ${season}`;
}

/** The x-axis label: "Trade", "Draft" or the season. */
const axisLabel = ({ kind, season }: Checkpoint) =>
  kind === 'trade' ? 'Trade' : kind === 'draft' ? 'Draft' : String(season);

/**
 * A club's line colour on one surface: its guernsey's main colour, else its trim, else the page ink
 * when neither reaches 3:1 (identity then rides on the end label and the readout).
 */
export function lineStroke(clubName: string, theme: keyof typeof CHART_THEME): string {
  const { surface, ink } = CHART_THEME[theme];
  const { fill, trim } = clubStyle(clubName);
  return [fill, trim].find((colour) => contrastRatio(colour, surface) >= GRAPHIC_CONTRAST) ?? ink;
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
}

/** Two strokes a reader could mistake for each other. */
const alike = (left: string, right: string) =>
  Math.hypot(...channels(left).map((value, at) => value - channels(right)[at]!)) < 80;

/** 5, 6, 8, 10, 15, 20, 25, 30, 40, ...: the smallest clean step at or above `value`. */
function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const factor = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => step * power >= value)!;
  return Math.max(5, factor * power);
}

/** Dash patterns for clubs whose colour looks like an earlier club's, so no two lines match. */
const DASHES = ['6 4', '2 3', '10 3 2 3'];

export interface ValueLineSeries {
  readonly clubId: string;
  readonly clubName: string;
  readonly stroke: { readonly light: string; readonly dark: string };
  /** A dash pattern when its colour is too close to an earlier club's in either theme. */
  readonly dash: string | null;
  readonly path: string;
  readonly points: readonly { readonly x: number; readonly y: number; readonly pending: boolean }[];
}

export interface ValueLineChart {
  readonly width: number;
  readonly height: number;
  readonly plot: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly checkpoints: readonly Checkpoint[];
  readonly xs: readonly number[];
  readonly yTicks: readonly {
    readonly y: number;
    readonly value: number;
    readonly label: string;
  }[];
  readonly xLabels: readonly { readonly x: number; readonly label: string }[];
  readonly series: readonly ValueLineSeries[];
  /** Each club's latest net beside its line's end; one that would overlap another is left out. */
  readonly endLabels: readonly {
    readonly clubId: string;
    readonly y: number;
    readonly text: string;
  }[];
}

/** Every club's net on this trade at every checkpoint, laid out for a chart `width` pixels wide. */
export function valueLineChart(
  nets: readonly AflTradeStoryTradeNet[],
  width: number
): ValueLineChart {
  const checkpoints = nets[0]?.line.map(({ checkpoint }) => checkpoint) ?? [];
  if (checkpoints.length === 0 || nets.some(({ line }) => line.length !== checkpoints.length))
    throw new Error('Every club of a trade needs a net at the same checkpoints.');

  const endText = (net: AflTradeStoryTradeNet) =>
    `${clubStyle(net.clubName).abbreviation} ${netText(net.line.at(-1)!)}`;
  const longest = Math.max(...nets.map((net) => endText(net).length));
  const plot = {
    left: MARGIN.left,
    right: width - END_LABEL_OFFSET - longest * GLYPH - MARGIN.endLabelPadding,
    top: MARGIN.top,
    bottom: CHART_HEIGHT - MARGIN.bottom,
  };
  const spacing = checkpoints.length > 1 ? (plot.right - plot.left) / (checkpoints.length - 1) : 0;
  const xs = checkpoints.map((_, at) =>
    checkpoints.length > 1 ? plot.left + at * spacing : (plot.left + plot.right) / 2
  );

  // Symmetric about zero, so above the middle line is always ahead.
  const largest = Math.max(...nets.flatMap(({ line }) => line.map(({ net }) => Math.abs(net))));
  const step = niceStep(largest / 2);
  const top = 2 * step;
  const y = (value: number) => plot.top + ((top - value) / (2 * top)) * (plot.bottom - plot.top);
  const yTicks = [2, 1, 0, -1, -2].map((multiple) => {
    const value = multiple * step;
    return { y: y(value), value, label: value === 0 ? '0' : formatSigned(value, 0) };
  });

  // The latest checkpoint and the trade first, then season ends, then drafts, as room allows.
  const priority = (at: number) =>
    at === checkpoints.length - 1
      ? 0
      : at === 0
        ? 1
        : checkpoints[at]!.kind === 'season_end'
          ? 2
          : 3;
  const kept: { x: number; label: string; from: number; to: number }[] = [];
  for (const at of checkpoints.map((_, index) => index).sort((l, r) => priority(l) - priority(r))) {
    const label = axisLabel(checkpoints[at]!);
    const half = (label.length * GLYPH) / 2;
    const from = xs[at]! - half;
    const to = xs[at]! + half;
    if (kept.every((other) => to + LABEL_GAP <= other.from || from >= other.to + LABEL_GAP))
      kept.push({ x: xs[at]!, label, from, to });
  }
  const xLabels = kept.sort((l, r) => l.x - r.x).map(({ x, label }) => ({ x, label }));

  const strokes: { light: string; dark: string }[] = [];
  let dashes = 0;
  const series = nets.map((net): ValueLineSeries => {
    const stroke = {
      light: lineStroke(net.clubName, 'light'),
      dark: lineStroke(net.clubName, 'dark'),
    };
    const dash = strokes.some(
      (other) => alike(other.light, stroke.light) || alike(other.dark, stroke.dark)
    )
      ? DASHES[dashes++ % DASHES.length]!
      : null;
    strokes.push(stroke);
    const points = net.line.map((point, at) => ({
      x: xs[at]!,
      y: y(point.net),
      pending: point.pendingCount > 0,
    }));
    return {
      clubId: net.clubId,
      clubName: net.clubName,
      stroke,
      dash,
      path: points.map(({ x, y: py }, at) => `${at === 0 ? 'M' : 'L'}${x} ${py}`).join(' '),
      points,
    };
  });

  const ends = nets
    .map((net) => ({
      clubId: net.clubId,
      y: y(net.line.at(-1)!.net),
      text: endText(net),
    }))
    .sort((left, right) => left.y - right.y);
  const endLabels: typeof ends = [];
  for (const label of ends)
    if (endLabels.every((other) => Math.abs(label.y - other.y) >= END_LABEL_SPACING))
      endLabels.push(label);

  return { width, height: CHART_HEIGHT, plot, checkpoints, xs, yTicks, xLabels, series, endLabels };
}

/** The checkpoint nearest a pointer `x` pixels from the chart's left edge. */
export function nearestCheckpoint(xs: readonly number[], x: number): number {
  return xs.reduce(
    (best, candidate, at) => (Math.abs(candidate - x) < Math.abs(xs[best]! - x) ? at : best),
    0
  );
}
