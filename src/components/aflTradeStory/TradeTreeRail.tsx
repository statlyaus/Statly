'use client';

import { useCallback, useEffect, useRef } from 'react';

import {
  ARRIVE,
  INTRO_MS,
  ease,
  leaderOf,
  linearAt,
  marginAt,
  marginText,
  railTop,
} from './marginMotion';
import type { TreeMargin, TreeMarginPoint } from './tradeTreeModel';

/**
 * The margin rail (owner, 2026-11-28, layout A): a line beside the tree's PAV column whose knob sits
 * at who is ahead on the trade's net, up for the upper club and down for the lower, zero level with
 * the trade knot. From 1440px only, where the tree card is wide enough to keep its text at 11px or
 * more. The server draws the final state; on the first view the client plays the trade season by
 * season, opening the lanes column by column, then fades the players in.
 */

/** The rail's own width in the tree's units, beside the tree's 1100. */
export const RAIL_W = 260;
const X = 196;
const KR = 12;

interface Colours {
  readonly upper: string;
  readonly lower: string;
}

/** The line, wrapping round the knob's right side so the knob sits clear of it. */
function railPath(cy: number, top: number, bottom: number) {
  const cx = X - 8;
  const g = KR + 5;
  const reach = g + 14;
  const out = cx + g + 6;
  return `M${X},${top} L${X},${cy - reach} C${X},${cy - reach + 8} ${out},${cy - g} ${out},${cy} C${out},${cy + g} ${X},${cy + reach - 8} ${X},${cy + reach} L${X},${bottom}`;
}

/** The lanes' reveal and the players' arrival, written straight to the tree's own nodes. */
function treeParts(root: Element) {
  const clip = root.querySelector<SVGRectElement>('.tt-reveal-rect');
  const players = [...root.querySelectorAll<SVGGElement>('.tt-chart-tree .tt-player')];
  return { clip, players };
}

function hidePlayers(players: readonly SVGGElement[]) {
  for (const player of players) {
    player.style.transition = 'none';
    player.style.opacity = '0';
    player.style.transform = 'translateY(6px)';
  }
}

/** Each player fades up in turn, top to bottom, its PAV counting up from 0. Returns the timers. */
function showPlayers(players: readonly SVGGElement[]): number[] {
  return players.map((player, at) =>
    window.setTimeout(() => {
      player.style.transition =
        'opacity 0.5s cubic-bezier(0.2, 0.7, 0.2, 1), transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1)';
      player.style.opacity = '1';
      player.style.transform = 'none';
      const number = player.querySelector('.tt-svg-num');
      const text = number?.textContent ?? '';
      const value = Number.parseFloat(text);
      if (!number || Number.isNaN(value)) return;
      const start = performance.now();
      const count = (now: number) => {
        const q = Math.min(1, (now - start) / 700);
        number.textContent = q < 1 ? (value * (1 - (1 - q) ** 3)).toFixed(1) : text;
        if (q < 1) requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
    }, at * 70)
  );
}

/** Motion only where the browser can say what the screen is and when the tree is in view. */
const canAnimate = (query: string) =>
  typeof window.matchMedia === 'function' &&
  typeof window.IntersectionObserver === 'function' &&
  window.matchMedia(query).matches &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TradeTreeRail({
  margin,
  colours,
  height,
  mid,
  half,
  reveal,
  width,
}: {
  margin: TreeMargin;
  colours: Colours;
  /** The tree's own height and zero line, in its units, so the rail's rows line up with it. */
  height: number;
  mid: number;
  half: number;
  /** For each margin point, how far along the tree the lanes have got by then. */
  reveal: readonly number[];
  /** The tree's width in its units, where the lanes' reveal ends. */
  width: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const line = useRef<SVGPathElement>(null);
  const knob = useRef<SVGCircleElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const who = useRef<SVGTextElement>(null);
  const big = useRef<SVGTextElement>(null);
  const when = useRef<SVGTextElement>(null);
  const ticks = useRef<(SVGGElement | null)[]>([]);
  const frame = useRef(0);
  const timers = useRef<number[]>([]);

  const values = margin.points.map(({ value }) => value);
  const last = margin.points.at(-1)!;
  const top = railTop(margin.points);
  const y = useCallback(
    (value: number) => mid - (Math.max(-top, Math.min(top, value)) / top) * half,
    [mid, half, top]
  );
  const railTopY = mid - half - 40;
  const railBottomY = mid + half + 40;
  const scale = [top, top / 2, 0, -top / 2, -top];
  const colourOf = (value: number) => (value >= 0 ? colours.upper : colours.lower);
  // A tick the knob passes over steps aside, so the bend never runs through its label.
  const tickHidden = (tick: number, cy: number) => Math.abs(y(tick) - cy) < 30;

  const draw = useCallback(
    (value: number, { label, pendingCount }: TreeMarginPoint) => {
      const cy = y(value);
      const leader = leaderOf(value, margin.upper, margin.lower);
      line.current?.setAttribute('d', railPath(cy, railTopY, railBottomY));
      knob.current?.setAttribute('cy', String(cy));
      dot.current?.setAttribute('cy', String(cy));
      dot.current?.setAttribute('fill', value >= 0 ? colours.upper : colours.lower);
      if (who.current) {
        who.current.setAttribute('y', String(cy - 16));
        who.current.setAttribute('fill', value >= 0 ? colours.upper : colours.lower);
        who.current.textContent = leader ?? '';
      }
      if (big.current) {
        big.current.setAttribute('y', String(cy + 6));
        big.current.setAttribute('fill', value >= 0 ? colours.upper : colours.lower);
        big.current.textContent = marginText(value, pendingCount);
      }
      if (when.current) {
        when.current.setAttribute('y', String(cy + 24));
        when.current.textContent = label;
      }
      ticks.current.forEach((tick, at) => {
        if (tick) tick.style.opacity = tickHidden(scale[at]!, cy) ? '0' : '1';
      });
    },
    // scale and tickHidden follow from y and top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [y, railTopY, railBottomY, colours, margin.upper, margin.lower, top]
  );

  const play = useCallback(() => {
    const root = holder.current?.closest('.tt');
    if (!root) return;
    const { clip, players } = treeParts(root);
    cancelAnimationFrame(frame.current);
    timers.current.forEach((timer) => window.clearTimeout(timer));
    hidePlayers(players);
    let started: number | null = null;
    let arrived = false;
    const tick = (now: number) => {
      started ??= now;
      const q = Math.min(1, (now - started) / INTRO_MS);
      const at = ease(q) * (values.length - 1);
      draw(q < 1 ? marginAt(values, at) : last.value, margin.points[Math.round(at)]!);
      clip?.setAttribute('width', String(q < 1 ? linearAt(reveal, at) : width));
      if (!arrived && q > ARRIVE) {
        arrived = true;
        timers.current = showPlayers(players);
      }
      if (q < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [draw, last.value, margin.points, reveal, values, width]);

  // Plays once, the first time the tree comes into view; a tree already in view at load keeps its
  // drawn final state, so nothing jumps.
  useEffect(() => {
    const root = holder.current?.closest('.tt');
    const chart = root?.querySelector('.tt-chart');
    if (!root || !chart) return;
    if (!canAnimate('(min-width: 1440px)')) return;
    const box = chart.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) return;
    const { clip, players } = treeParts(root);
    hidePlayers(players);
    clip?.setAttribute('width', String(reveal[0] ?? 0));
    draw(values[0] ?? 0, margin.points[0]!);
    // Plays once the chart's top third is on screen, however tall the chart.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some(({ isIntersecting }) => isIntersecting)) return;
        observer.disconnect();
        play();
      },
      { rootMargin: '0px 0px -33% 0px' }
    );
    observer.observe(chart);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
    // Once per page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cy = y(last.value);
  return (
    <div ref={holder} className="tt-rail">
      <svg aria-hidden="true" viewBox={`0 0 ${RAIL_W} ${height}`}>
        <text
          x={RAIL_W - 4}
          y={railTopY - 10}
          textAnchor="end"
          fontSize="14"
          fontWeight="700"
          fill={colours.upper}
        >
          {margin.upper} ahead
        </text>
        <text
          x={RAIL_W - 4}
          y={railBottomY + 22}
          textAnchor="end"
          fontSize="14"
          fontWeight="700"
          fill={colours.lower}
        >
          {margin.lower} ahead
        </text>
        {scale.map((tick, at) => (
          <g
            key={tick}
            ref={(node) => {
              ticks.current[at] = node;
            }}
            style={{ opacity: tickHidden(tick, cy) ? 0 : 1, transition: 'opacity 0.15s' }}
          >
            <line
              x1={X + 6}
              x2={X + (tick === 0 ? 18 : 12)}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeWidth="1.5"
            />
            <text x={X + 22} y={y(tick) + 5} fontSize="14" fill="var(--muted-foreground)">
              {tick === 0 ? '0' : Math.abs(tick)}
            </text>
          </g>
        ))}
        <path
          ref={line}
          d={railPath(cy, railTopY, railBottomY)}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth="2"
        />
        <circle
          ref={knob}
          cx={X - 8}
          cy={cy}
          r={KR}
          fill="var(--warning)"
          stroke="var(--foreground)"
          strokeWidth="2"
        />
        <circle ref={dot} cx={X - 8} cy={cy} r="4" fill={colourOf(last.value)} />
        <text
          ref={who}
          x={X - 34}
          y={cy - 16}
          textAnchor="end"
          fontSize="14"
          fontWeight="700"
          fill={colourOf(last.value)}
        >
          {leaderOf(last.value, margin.upper, margin.lower) ?? ''}
        </text>
        <text
          ref={big}
          x={X - 34}
          y={cy + 6}
          textAnchor="end"
          fontSize="22"
          fontWeight="900"
          fill={colourOf(last.value)}
          className="tt-svg-num"
        >
          {marginText(last.value, last.pendingCount)}
        </text>
        <text
          ref={when}
          x={X - 34}
          y={cy + 24}
          textAnchor="end"
          fontSize="14"
          fill="var(--muted-foreground)"
        >
          {last.label}
        </text>
      </svg>
      <button type="button" className="tt-replay" onClick={play}>
        Play the trade again
      </button>
    </div>
  );
}

/** The strip's own width and baseline, in its units. */
/** The phone strip's width in its units; on a wider screen the strip takes the tree's own width. */
export const PHONE_STRIP_W = 343;
const STRIP_Y = 78;
/** The phone strip sits 16 units in from the card's edge; the wide strip runs flush with the tree. */
const STRIP_L = 16;

/** The line along the strip, dipping under the knob so the knob sits clear of it. */
function stripPath(cx: number, width: number, inset: number) {
  const cy = STRIP_Y - 8;
  const g = 11 + 5;
  const reach = g + 14;
  const low = cy + g + 6;
  return `M${inset},${STRIP_Y} L${cx - reach},${STRIP_Y} C${cx - reach + 8},${STRIP_Y} ${cx - g},${low} ${cx},${low} C${cx + g},${low} ${cx + reach - 8},${STRIP_Y} ${cx + reach},${STRIP_Y} L${width - inset},${STRIP_Y}`;
}

/**
 * The margin on phones, where the tree is a list: the same rail lying on its side above the list,
 * the upper club's side to the left. It plays once when it comes into view.
 */
export function TradeTreeMarginStrip({
  margin,
  colours,
  width = PHONE_STRIP_W,
}: {
  margin: TreeMargin;
  colours: Colours;
  /** The tree's width in its units, so the strip runs the tree's full length at its text size. */
  width?: number;
}) {
  const holder = useRef<SVGSVGElement>(null);
  const line = useRef<SVGPathElement>(null);
  const knob = useRef<SVGCircleElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const big = useRef<SVGTextElement>(null);
  const when = useRef<SVGTextElement>(null);
  const ticks = useRef<(SVGGElement | null)[]>([]);

  const values = margin.points.map(({ value }) => value);
  const last = margin.points.at(-1)!;
  const top = railTop(margin.points);
  const mid = width / 2;
  const inset = width === PHONE_STRIP_W ? STRIP_L : 0;
  const x = useCallback(
    (value: number) => mid - (Math.max(-top, Math.min(top, value)) / top) * (mid - 40),
    [mid, top]
  );
  const scale = [top, top / 2, 0, -top / 2, -top];
  // Room for "End of 2026" either side of its centre.
  const labelX = (cx: number) => Math.max(70, Math.min(width - 70, cx));
  const tickHidden = (tick: number, cx: number) => Math.abs(x(tick) - cx) < 26;

  const draw = useCallback(
    (value: number, { label, pendingCount }: TreeMarginPoint) => {
      const cx = x(value);
      const colour = value >= 0 ? colours.upper : colours.lower;
      line.current?.setAttribute('d', stripPath(cx, width, inset));
      knob.current?.setAttribute('cx', String(cx));
      dot.current?.setAttribute('cx', String(cx));
      dot.current?.setAttribute('fill', colour);
      if (big.current) {
        big.current.setAttribute('x', String(labelX(cx)));
        big.current.setAttribute('fill', colour);
        big.current.textContent = marginText(value, pendingCount);
      }
      if (when.current) {
        when.current.setAttribute('x', String(labelX(cx)));
        when.current.textContent = label;
      }
      ticks.current.forEach((tick, at) => {
        if (tick) tick.style.opacity = tickHidden(scale[at]!, cx) ? '0' : '1';
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [x, colours, margin.upper, margin.lower, top]
  );

  useEffect(() => {
    const strip = holder.current;
    if (!strip || strip.getBoundingClientRect().width === 0) return;
    if (!canAnimate('(min-width: 0px)')) return;
    const box = strip.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) return;
    draw(values[0] ?? 0, margin.points[0]!);
    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some(({ isIntersecting }) => isIntersecting)) return;
        observer.disconnect();
        let started: number | null = null;
        const tick = (now: number) => {
          started ??= now;
          const q = Math.min(1, (now - started) / 3000);
          const at = ease(q) * (values.length - 1);
          draw(q < 1 ? marginAt(values, at) : last.value, margin.points[Math.round(at)]!);
          if (q < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.6 }
    );
    observer.observe(strip);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cx = x(last.value);
  const colour = last.value >= 0 ? colours.upper : colours.lower;
  // Only the checkpoint above the number: the clubs sit at the strip's two ends (owner, 2026-11-28).
  const stripWhen = last.label;
  return (
    <svg
      ref={holder}
      className={width === PHONE_STRIP_W ? 'tt-strip tt-strip-phone' : 'tt-strip tt-strip-wide'}
      aria-hidden="true"
      viewBox={`0 0 ${width} 146`}
    >
      {scale.map((tick, at) => (
        <g
          key={tick}
          ref={(node) => {
            ticks.current[at] = node;
          }}
          style={{ opacity: tickHidden(tick, cx) ? 0 : 1, transition: 'opacity 0.15s' }}
        >
          <line
            x1={x(tick)}
            x2={x(tick)}
            y1={STRIP_Y + 6}
            y2={STRIP_Y + (tick === 0 ? 16 : 11)}
            stroke="var(--border)"
            strokeWidth="1.5"
          />
          <text
            x={x(tick)}
            y={STRIP_Y + 30}
            textAnchor="middle"
            fontSize="15"
            fill="var(--muted-foreground)"
          >
            {tick === 0 ? '0' : Math.abs(tick)}
          </text>
        </g>
      ))}
      <text x={inset} y="140" fontSize="15" fontWeight="700" fill={colours.upper}>
        {margin.upper}
      </text>
      <text
        x={width - inset}
        y="140"
        textAnchor="end"
        fontSize="15"
        fontWeight="700"
        fill={colours.lower}
      >
        {margin.lower}
      </text>
      <path
        ref={line}
        d={stripPath(cx, width, inset)}
        fill="none"
        stroke="var(--foreground)"
        strokeWidth="2"
      />
      <circle
        ref={knob}
        cx={cx}
        cy={STRIP_Y - 8}
        r="11"
        fill="var(--warning)"
        stroke="var(--foreground)"
        strokeWidth="2"
      />
      <circle ref={dot} cx={cx} cy={STRIP_Y - 8} r="3.5" fill={colour} />
      <text
        ref={big}
        x={labelX(cx)}
        y="36"
        textAnchor="middle"
        fontSize="22"
        fontWeight="900"
        fill={colour}
        className="tt-svg-num"
      >
        {marginText(last.value, last.pendingCount)}
      </text>
      <text
        ref={when}
        x={labelX(cx)}
        y="15"
        textAnchor="middle"
        fontSize="15"
        fill="var(--muted-foreground)"
      >
        {stripWhen}
      </text>
    </svg>
  );
}
