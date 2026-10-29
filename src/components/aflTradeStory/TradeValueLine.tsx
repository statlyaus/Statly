'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import type { AflTradeStory } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { ClubBadge } from './ClubBadge';
import { netText, netTone } from './tradePageModel';
import {
  END_LABEL_OFFSET,
  checkpointName,
  nearestCheckpoint,
  valueLineChart,
  type ValueLineSeries,
} from './valueLineChart';

/** Server render and first paint; the chart then follows its container's width. */
const DEFAULT_WIDTH = 720;
const MIN_WIDTH = 280;

const strokeStyle = ({ stroke }: ValueLineSeries) =>
  ({ '--vl-light': stroke.light, '--vl-dark': stroke.dark }) as CSSProperties;

function LineKey({ series }: { series: ValueLineSeries }) {
  return (
    <svg width="20" height="8" aria-hidden="true" focusable="false" className="ts-vl flex-none">
      <line
        x1="1"
        x2="19"
        y1="4"
        y2="4"
        style={strokeStyle(series)}
        stroke="var(--vl)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={series.dash ?? undefined}
      />
    </svg>
  );
}

/**
 * "This trade over time" (value-line method step 7, statlyaus/Statly#789): each club's net on this
 * trade at the trade, each draft and each season end. The readout under the heading is the legend
 * and follows the pointer or the arrow keys; it rests on the latest checkpoint. Every value is also
 * in the table below the chart.
 */
export function TradeValueLine({ story }: { story: AflTradeStory }) {
  const nets = story.nets.tradeAlone;
  const latest = (nets[0]?.line.length ?? 1) - 1;
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [active, setActive] = useState(latest);

  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(MIN_WIDTH, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const chart = valueLineChart(nets, width);
  const { plot, xs } = chart;
  const anyPending = nets.some(({ line }) => line.some(({ pendingCount }) => pendingCount > 0));
  const readout = (at: number) =>
    `${checkpointName(chart.checkpoints[at]!)}: ${nets
      .map((net) => `${net.clubName} ${netText(net.line[at]!)}`)
      .join(', ')}`;

  const follow = (event: PointerEvent<SVGSVGElement>) =>
    setActive(
      nearestCheckpoint(xs, event.clientX - event.currentTarget.getBoundingClientRect().left)
    );
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? active - 1
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? active + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? latest
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(Math.min(latest, Math.max(0, next)));
  };

  return (
    <section aria-labelledby="value-line-title" className="mt-12">
      <h2 id="value-line-title" className="ts-head font-semibold">
        This trade over time
      </h2>
      <p className="mt-1 max-w-[68ch] text-(--ts-ink2)">
        Each club’s net on this trade at the trade, at each draft and at the end of each season.
        Above the middle line, the club is ahead.
        {anyPending ? ' A hollow point leaves out values not in yet.' : null}
      </p>

      <div className="mt-4 rounded-2xl border border-(--ts-line) bg-(--ts-surface) p-4">
        <div aria-live="polite">
          <p className="ts-small text-(--ts-ink2)">{checkpointName(chart.checkpoints[active]!)}</p>
          <ul
            className="mt-1 flex flex-wrap gap-x-5 gap-y-1"
            aria-label="Each club’s net at this point"
          >
            {chart.series.map((series, at) => (
              <li key={series.clubId} className="flex items-center gap-2">
                <LineKey series={series} />
                <ClubBadge clubName={series.clubName} named />
                <b className={`font-semibold tabular-nums ${netTone(nets[at]!.line[active]!.net)}`}>
                  {netText(nets[at]!.line[active]!)}
                </b>
                <span className="ts-small text-(--ts-ink2)">{series.clubName}</span>
              </li>
            ))}
          </ul>
        </div>

        <div
          ref={frame}
          role="slider"
          tabIndex={0}
          aria-label="Point in time"
          aria-valuemin={0}
          aria-valuemax={latest}
          aria-valuenow={active}
          aria-valuetext={readout(active)}
          onKeyDown={step}
          className="mt-3 rounded-lg"
        >
          <svg
            width={chart.width}
            height={chart.height}
            viewBox={`0 0 ${chart.width} ${chart.height}`}
            className="block max-w-full touch-pan-y"
            aria-hidden="true"
            focusable="false"
            onPointerMove={follow}
            onPointerDown={follow}
            onPointerLeave={(event) => {
              // A tap keeps its point; only a mouse leaving returns the readout to the latest.
              if (event.pointerType === 'mouse') setActive(latest);
            }}
          >
            {chart.yTicks.map((tick) => (
              <g key={tick.value}>
                <line
                  x1={plot.left}
                  x2={plot.right}
                  y1={tick.y}
                  y2={tick.y}
                  stroke={tick.value === 0 ? 'var(--ts-muted)' : 'var(--ts-line)'}
                  strokeWidth="1"
                />
                <text
                  x={plot.left - 8}
                  y={tick.y + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill="var(--ts-ink2)"
                  className="tabular-nums"
                >
                  {tick.label}
                </text>
              </g>
            ))}
            {chart.xLabels.map((label) => (
              <text
                key={label.x}
                x={label.x}
                y={plot.bottom + 20}
                textAnchor="middle"
                fontSize="12"
                fill="var(--ts-ink2)"
              >
                {label.label}
              </text>
            ))}
            <line
              x1={xs[active]}
              x2={xs[active]}
              y1={plot.top}
              y2={plot.bottom}
              stroke="var(--ts-ink2)"
              strokeWidth="1"
            />
            {chart.series.map((series) => (
              <g key={series.clubId} className="ts-vl" style={strokeStyle(series)}>
                <path
                  d={series.path}
                  fill="none"
                  stroke="var(--vl)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={series.dash ?? undefined}
                />
                {series.points.map((point, at) => (
                  <circle
                    key={at}
                    cx={point.x}
                    cy={point.y}
                    r={at === active ? 5 : 4}
                    fill={point.pending ? 'var(--ts-surface)' : 'var(--vl)'}
                    stroke={point.pending ? 'var(--vl)' : 'var(--ts-surface)'}
                    strokeWidth="2"
                  />
                ))}
              </g>
            ))}
            {chart.endLabels.map((label) => (
              <text
                key={label.clubId}
                x={plot.right + END_LABEL_OFFSET}
                y={label.y + 4}
                fontSize="12"
                fontWeight="600"
                fill="var(--ts-ink)"
                className="tabular-nums"
              >
                {label.text}
              </text>
            ))}
          </svg>
        </div>

        <details className="mt-3">
          <summary className="cursor-pointer ts-small text-(--ts-ink2)">Show the values</summary>
          <table className="mt-2 w-full ts-small tabular-nums">
            <caption className="sr-only">
              Each club’s net on this trade at each point in time
            </caption>
            <thead>
              <tr className="text-left text-(--ts-ink2)">
                <th scope="col" className="py-1 pr-3 font-medium">
                  When
                </th>
                {nets.map((net) => (
                  <th key={net.clubId} scope="col" className="py-1 pr-3 text-right font-medium">
                    <ClubBadge clubName={net.clubName} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-(--ts-line)">
              {chart.checkpoints.map((checkpoint, at) => (
                <tr key={at}>
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    {checkpointName(checkpoint)}
                  </th>
                  {nets.map((net) => (
                    <td key={net.clubId} className="py-1 pr-3 text-right">
                      {netText(net.line[at]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  );
}
