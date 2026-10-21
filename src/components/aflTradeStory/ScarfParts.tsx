import type { AflTradeStory } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import {
  clampLines,
  scarfPanelLabel,
  scarfPanelTitle,
  wrapText,
  type ScarfPlayer,
  type ScarfStep,
} from './scarfTimeline';
import { clubStyle, netText } from './tradePageModel';

/** The scarf's SVG pieces: a wavy band, its fringes, player panels, the end block and callouts. */

export const HEIGHT = 480;
export const BAND = 100;
export const END_BLOCK = 150;
export const FRINGE = 18;

export const topEdge = (x: number) => 185 + 9 * Math.sin((2 * Math.PI * x) / 360);

export function bandPath(start: number, end: number, offset = 0): string {
  const xs: number[] = [];
  for (let x = start; x < end; x += 20) xs.push(x);
  xs.push(end);
  const top = xs.map((x) => `${x.toFixed(1)},${(topEdge(x) + offset).toFixed(1)}`);
  const bottom = [...xs]
    .reverse()
    .map((x) => `${x.toFixed(1)},${(topEdge(x) + BAND + offset).toFixed(1)}`);
  return `M${top.join(' L')} L${bottom.join(' L')} Z`;
}

export function Fringe({
  x,
  direction,
  colours,
}: {
  x: number;
  direction: 1 | -1;
  colours: string[];
}) {
  const lines = Array.from({ length: 7 }, (_, index) => {
    const y = topEdge(x) + 10 + index * 13.5;
    return (
      <line
        key={index}
        x1={x}
        y1={y}
        x2={x + direction * FRINGE}
        y2={y + 2}
        stroke={colours[index % colours.length]}
        strokeWidth={4}
        strokeLinecap="round"
      />
    );
  });
  return <g>{lines}</g>;
}

export function Panels({
  players,
  start,
  end,
  bandMid,
}: {
  players: readonly ScarfPlayer[];
  start: number;
  end: number;
  bandMid: number;
}) {
  if (players.length === 0)
    return <rect x={start} y={0} width={end - start} height={HEIGHT} fill="var(--ts-bar)" />;
  const width = (end - start) / players.length;
  return (
    <>
      {players.map((player, index) => {
        const style = clubStyle(player.clubName);
        const x = start + index * width;
        const centre = x + width / 2;
        return (
          <g key={player.key}>
            <rect x={x} y={0} width={width} height={HEIGHT} fill={style.fill} />
            {index > 0
              ? [0, 1, 2].map((stripe) => (
                  <rect
                    key={stripe}
                    x={x + 4 + stripe * 9}
                    y={0}
                    width={5}
                    height={HEIGHT}
                    fill={stripe === 1 ? style.fill : style.trim}
                  />
                ))
              : null}
            <text
              x={centre + (index > 0 ? 12 : 0)}
              y={bandMid - 2}
              textAnchor="middle"
              fontSize={20}
              fontWeight={700}
              letterSpacing="0.04em"
              fill={style.ink}
            >
              {scarfPanelTitle(player)}
            </text>
            <text
              x={centre + (index > 0 ? 12 : 0)}
              y={bandMid + 20}
              textAnchor="middle"
              fontSize={13}
              fill={style.ink}
            >
              {scarfPanelLabel(player)}
            </text>
          </g>
        );
      })}
    </>
  );
}

export function EndBlock({
  story,
  throughSeason,
  x,
}: {
  story: AflTradeStory;
  throughSeason: number;
  x: number;
}) {
  const top = Math.min(topEdge(x), topEdge(x + END_BLOCK)) - 12;
  const height = BAND + 30;
  const nets = story.nets.tradeAlone;
  const rowHeight = (height - 28) / Math.max(nets.length, 1);
  return (
    <g>
      <rect x={x} y={top} width={END_BLOCK} height={height} fill="var(--ts-scarf-side)" />
      <text
        x={x + END_BLOCK / 2}
        y={top + 20}
        textAnchor="middle"
        fontSize={13}
        fill="var(--ts-scarf-side-ink)"
      >
        {throughSeason}
      </text>
      {nets.map((net, index) => {
        const style = clubStyle(net.clubName);
        const y = top + 28 + index * rowHeight;
        return (
          <g key={net.clubId}>
            <rect x={x} y={y} width={END_BLOCK} height={rowHeight} fill={style.fill} />
            <text
              x={x + END_BLOCK / 2}
              y={y + rowHeight / 2 + 5}
              textAnchor="middle"
              fontSize={15}
              fontWeight={700}
              fill={style.ink}
            >
              {`${style.abbreviation} ${netText(net)}`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function Callout({
  step,
  x,
  above,
  wrap,
}: {
  step: ScarfStep;
  x: number;
  above: boolean;
  wrap: number;
}) {
  const major = step.kind === 'major';
  const lines = clampLines(wrapText(step.text, wrap), 4);
  const boxTop = above ? 24 : 324;
  const pinStart = above ? boxTop + 64 + lines.length * 17 : topEdge(x) + BAND;
  const pinEnd = above ? topEdge(x) : 318;
  const labelWidth = step.label.length * 8.5 + 20;
  return (
    <g>
      <line x1={x} y1={pinStart} x2={x} y2={pinEnd} stroke="var(--ts-pin)" strokeWidth={1.5} />
      <circle
        cx={x}
        cy={above ? pinStart : pinEnd}
        r={5}
        fill="var(--ts-scarf-bg)"
        stroke="var(--ts-pin)"
        strokeWidth={1.5}
      />
      <circle cx={x} cy={above ? pinEnd : pinStart} r={3.5} fill="var(--ts-pin)" />
      <rect
        x={x - 10}
        y={boxTop}
        width={labelWidth}
        height={26}
        fill="var(--ts-surface)"
        stroke={major ? 'var(--ts-bid)' : 'var(--ts-ink)'}
        strokeWidth={major ? 2 : 1}
      />
      <text x={x} y={boxTop + 18} fontSize={14} fontWeight={600} fill="var(--ts-ink)">
        {step.label}
      </text>
      <text
        x={x - 10}
        y={boxTop + 50}
        fontSize={16}
        fontWeight={700}
        fill={major ? 'var(--ts-bid)' : 'var(--ts-ink)'}
      >
        {step.title}
      </text>
      {lines.map((line, index) => (
        <text
          key={index}
          x={x - 10}
          y={boxTop + 70 + index * 17}
          fontSize={14}
          fill="var(--ts-ink2)"
        >
          {line}
        </text>
      ))}
    </g>
  );
}
