import type { CSSProperties, ReactNode } from 'react';

import { getTeamAbbreviation } from '@/lib/teamLogos';

import { formatSigned } from './tradePageModel';
import type { ShareCardChart, ShareCardLine, ShareCardModel } from './shareCardModel';

/**
 * The share card as an image (owner-approved design, 2026-11-21), drawn by `next/og` (Satori): only
 * flex layout and inline styles, and text as positioned boxes, never SVG text, which Satori renders
 * without the card's fonts. Cobalt ground; the club ahead in sun, solid with squares; the other in
 * white, dashed with diamonds, so shape and pattern tell them apart, not colour alone.
 */

export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

// Satori cannot read CSS variables, so the brand colours are copied from src/index.css
// (--brand-cobalt, --brand-sun) and allowed in Scripts/design/raw-colour-baseline.json.
const COBALT = '#1a2cff';
const SUN = '#ffc247';
const WHITE = '#ffffff';
const HEAD = 'Geist';
const BODY = 'Saira';

const PAD = 64;
const GUTTER = PAD + 276;
const PLOT = { top: 220, bottom: 492, left: PAD + 304, right: PAD + 836 };
const AXIS_Y = 520;
const FOOTER_Y = 558;

// Satori fails on a style key set to undefined, so unset keys are dropped.
const box = (style: CSSProperties): CSSProperties =>
  Object.fromEntries(
    Object.entries({ display: 'flex', position: 'absolute', ...style }).filter(
      ([, value]) => value !== undefined
    )
  ) as CSSProperties;

export function TradeShareCard({ card }: { card: ShareCardModel }) {
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width: SHARE_CARD_SIZE.width,
        height: SHARE_CARD_SIZE.height,
        background: COBALT,
        color: WHITE,
        fontFamily: BODY,
      }}
    >
      <Header card={card} />
      {card.chart.kind === 'lines' ? <Lines chart={card.chart} /> : <Summary chart={card.chart} />}
      <div
        style={box({
          left: PAD,
          right: PAD,
          top: FOOTER_Y,
          height: SHARE_CARD_SIZE.height - FOOTER_Y,
          borderTop: `2px solid ${WHITE}`,
          alignItems: 'center',
          justifyContent: 'space-between',
        })}
      >
        <div style={{ display: 'flex', fontFamily: HEAD, fontWeight: 800, fontSize: 30 }}>
          Statly
        </div>
        <div style={{ display: 'flex', fontSize: 20 }}>{card.footer}</div>
      </div>
    </div>
  );
}

function Header({ card }: { card: ShareCardModel }) {
  const clubs = card.title.split(' ⇄ ');
  // Long club names shrink the title so it never runs into the result on the right.
  const titleSize = Math.min(56, Math.floor(700 / (card.title.length * 0.6)));
  return (
    <>
      <div style={box({ left: PAD, top: 48, flexDirection: 'column' })}>
        <div
          style={{ display: 'flex', fontFamily: HEAD, fontWeight: 700, fontSize: 22, color: SUN }}
        >
          {card.kicker}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginTop: 8,
            fontFamily: HEAD,
            fontWeight: 800,
            fontSize: titleSize,
            lineHeight: 1,
            letterSpacing: -1.5,
          }}
        >
          {clubs.length === 2 ? (
            <>
              <span>{clubs[0]}</span>
              <Swap size={Math.round(titleSize * 0.9)} />
              <span>{clubs[1]}</span>
            </>
          ) : (
            <span>{card.title}</span>
          )}
        </div>
      </div>
      <div
        style={box({
          left: PAD,
          width: SHARE_CARD_SIZE.width - 2 * PAD,
          top: 48,
          flexDirection: 'column',
          alignItems: 'flex-end',
        })}
      >
        <div style={{ display: 'flex', fontSize: 22 }}>{card.verdict}</div>
        {card.lead ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 2 }}>
            <span
              style={{
                fontFamily: HEAD,
                fontWeight: 800,
                fontSize: 64,
                color: SUN,
                letterSpacing: -2,
              }}
            >
              {card.lead}
            </span>
            <span
              style={{
                fontFamily: HEAD,
                fontWeight: 700,
                fontSize: 28,
                marginLeft: 12,
                marginBottom: 8,
              }}
            >
              PAV so far
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** The swap mark, drawn in the marker style rather than the font's ⇄ glyph. */
function Swap({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={Math.round(size * 0.78)}
      viewBox="0 0 56 44"
      style={{ margin: `${Math.round(size * 0.18)}px ${Math.round(size * 0.3)}px 0` }}
    >
      <g fill="none" stroke={SUN} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 14 C 18 12, 34 15, 50 13" />
        <path d="M41 5 L 51 13 L 42 21" />
        <path d="M52 31 C 38 33, 22 30, 6 32" />
        <path d="M15 23 L 5 32 L 14 40" />
      </g>
    </svg>
  );
}

/** 5, 10, 20, 25, 50, 100, ...: the smallest clean step at or above `value`. */
function cleanStep(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  return (
    [1, 2, 2.5, 5, 10].map((step) => step * magnitude).find((step) => step >= value) ??
    10 * magnitude
  );
}

/** Spread label centres at least `gap` apart, keeping their order, inside [low, high]. */
function spread(centres: readonly number[], gap: number, low: number, high: number): number[] {
  const order = centres
    .map((centre, index) => ({ centre, index }))
    .sort((a, b) => a.centre - b.centre);
  const placed = order.map(({ centre }) => Math.min(Math.max(centre, low), high));
  for (let at = 1; at < placed.length; at += 1)
    placed[at] = Math.max(placed[at]!, placed[at - 1]! + gap);
  const overflow = (placed.at(-1) ?? high) - high;
  if (overflow > 0)
    for (let at = 0; at < placed.length; at += 1) placed[at] = placed[at]! - overflow;
  const result: number[] = [];
  order.forEach(({ index }, at) => {
    result[index] = placed[at]!;
  });
  return result;
}

function Lines({ chart }: { chart: Extract<ShareCardChart, { kind: 'lines' }> }) {
  const values = chart.clubs.flatMap(({ held }) => held);
  const span = Math.max(...values) - Math.min(...values);
  const pad = Math.max(span * 0.12, 5);
  const low = Math.min(...values) - pad;
  const high = Math.max(...values) + pad;
  const x = (at: number) => PLOT.left + (at * (PLOT.right - PLOT.left)) / (chart.points.length - 1);
  const y = (value: number) =>
    PLOT.top + ((high - value) * (PLOT.bottom - PLOT.top)) / (high - low);
  const step = cleanStep((high - low) / 3);
  const grid: number[] = [];
  for (let value = Math.ceil(low / step) * step; value < high && grid.length < 3; value += step)
    grid.push(value);

  const ordered = [chart.clubs.find((club) => !club.lead)!, chart.clubs.find((club) => club.lead)!];
  const starts = spread(
    ordered.map((club) => y(club.held[0]!)),
    62,
    PLOT.top + 8,
    PLOT.bottom - 24
  );
  const ends = spread(
    ordered.map((club) => y(club.held.at(-1)!)),
    36,
    PLOT.top,
    PLOT.bottom
  );
  const path = (club: ShareCardLine) =>
    club.held
      .map((value, at) => `${at === 0 ? 'M' : 'L'}${x(at).toFixed(1)},${y(value).toFixed(1)}`)
      .join(' ');

  const ahead = ordered[1]!;
  const behind = ordered[0]!;

  return (
    <>
      <svg
        width={SHARE_CARD_SIZE.width}
        height={SHARE_CARD_SIZE.height}
        viewBox={`0 0 ${SHARE_CARD_SIZE.width} ${SHARE_CARD_SIZE.height}`}
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        {grid.map((value) => (
          <line
            key={value}
            x1={PLOT.left}
            x2={PLOT.right}
            y1={y(value)}
            y2={y(value)}
            stroke={WHITE}
            strokeOpacity="0.6"
            strokeWidth="1.5"
          />
        ))}
        {/* The moment of the trade: both lines start on it. */}
        <line
          x1={x(0)}
          x2={x(0)}
          y1={PLOT.top - 20}
          y2={PLOT.bottom}
          stroke={SUN}
          strokeWidth="3"
          strokeDasharray="3 7"
          strokeLinecap="round"
        />
        {ordered.map((club, index) => (
          <line
            key={`tick-${club.clubId}`}
            x1={GUTTER + 8}
            x2={x(0) - 12}
            y1={starts[index]}
            y2={y(club.held[0]!)}
            stroke={club.lead ? SUN : WHITE}
            strokeWidth="3"
          />
        ))}
        <path
          d={path(behind)}
          fill="none"
          stroke={WHITE}
          strokeWidth="5"
          strokeLinejoin="round"
          strokeDasharray="12 8"
        />
        <path d={path(ahead)} fill="none" stroke={SUN} strokeWidth="6" strokeLinejoin="round" />
        {behind.held.map((value, at) => (
          <rect
            key={`b-${at}`}
            x={x(at) - 7}
            y={y(value) - 7}
            width="14"
            height="14"
            fill={COBALT}
            stroke={WHITE}
            strokeWidth="3"
            transform={`rotate(45 ${x(at)} ${y(value)})`}
          />
        ))}
        {ahead.held.map((value, at) => (
          <rect key={`a-${at}`} x={x(at) - 8} y={y(value) - 8} width="16" height="16" fill={SUN} />
        ))}
      </svg>

      {grid.map((value) => {
        const left = gridLabelLeft(y(value) - 18, ordered, x, y);
        return left === null ? null : (
          <Text key={`g-${value}`} left={left} top={y(value) - 30} size={18}>
            {String(value)}
          </Text>
        );
      })}

      {ordered.map((club, index) => (
        <div
          key={`start-${club.clubId}`}
          style={box({
            left: 0,
            width: GUTTER,
            top: starts[index]! - 26,
            flexDirection: 'column',
            alignItems: 'flex-end',
            color: club.lead ? SUN : WHITE,
          })}
        >
          <div
            style={{ display: 'flex', fontFamily: HEAD, fontWeight: 800, fontSize: 22 }}
          >{`${club.clubName} got`}</div>
          <div
            style={{ display: 'flex', fontSize: 18 }}
          >{`${club.got} · ${pav(club.held[0]!)}`}</div>
        </div>
      ))}

      {ordered.map((club, index) => (
        <div
          key={`end-${club.clubId}`}
          style={box({
            left: PLOT.right + 20,
            width: SHARE_CARD_SIZE.width - PAD - PLOT.right - 20,
            top: ends[index]! - 16,
            justifyContent: 'flex-end',
            alignItems: 'center',
            color: club.lead ? SUN : WHITE,
          })}
        >
          <Marker lead={club.lead} />
          <span
            style={{
              fontFamily: HEAD,
              fontWeight: 800,
              fontSize: 24,
              marginLeft: 10,
              whiteSpace: 'nowrap',
            }}
          >
            {endLabel(club)}
          </span>
        </div>
      ))}

      {chart.points.map((point, at) => (
        <div
          key={`axis-${at}`}
          style={box({ left: x(at) - 60, width: 120, top: AXIS_Y - 14, justifyContent: 'center' })}
        >
          <span
            style={{
              fontFamily: point.checkpoint.kind === 'season_end' ? BODY : HEAD,
              fontWeight: point.checkpoint.kind === 'season_end' ? 400 : 700,
              fontSize: 20,
              color: point.checkpoint.kind === 'trade' ? SUN : WHITE,
            }}
          >
            {point.label}
          </span>
        </div>
      ))}
      <div
        style={box({
          left: PLOT.right + 40,
          width: SHARE_CARD_SIZE.width - PAD - PLOT.right - 40,
          top: AXIS_Y - 12,
          justifyContent: 'flex-end',
          fontSize: 18,
        })}
      >
        Season end
      </div>
    </>
  );
}

/**
 * Where a gridline's value label fits: just inside the chart's left or right edge, wherever no line
 * runs within reach of it; null (no label) when both are crowded.
 */
function gridLabelLeft(
  centre: number,
  clubs: readonly ShareCardLine[],
  x: (at: number) => number,
  y: (value: number) => number
): number | null {
  const lineYAt = (club: ShareCardLine, at: number) => {
    const step = (PLOT.right - PLOT.left) / (club.held.length - 1);
    const index = Math.min(Math.floor((at - PLOT.left) / step), club.held.length - 2);
    const from = y(club.held[index]!);
    const to = y(club.held[index + 1]!);
    return from + ((to - from) * (at - x(index))) / step;
  };
  const clear = (from: number, to: number) =>
    clubs.every((club) =>
      [0, 0.25, 0.5, 0.75, 1].every(
        (share) => Math.abs(lineYAt(club, from + share * (to - from)) - centre) > 22
      )
    );
  if (clear(PLOT.left + 8, PLOT.left + 60)) return PLOT.left + 14;
  if (clear(PLOT.right - 60, PLOT.right - 4)) return PLOT.right - 44;
  return null;
}

/** A PAV value with a true minus sign and no plus: "226.9", "−4.1". */
const pav = (value: number) => formatSigned(value).replace(/^\+/u, '');

/** "Geelong 226.9", or "WCE 0.0" when the club's full name would not fit beside the chart. */
function endLabel(club: ShareCardLine): string {
  const value = pav(club.held.at(-1)!);
  const full = `${club.clubName} ${value}`;
  return full.length <= 13 ? full : `${getTeamAbbreviation(club.clubName)} ${value}`;
}

function Marker({ lead }: { lead: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      {lead ? (
        <rect x="1" y="1" width="16" height="16" fill={SUN} />
      ) : (
        <rect
          x="4"
          y="4"
          width="10"
          height="10"
          fill={COBALT}
          stroke={WHITE}
          strokeWidth="2.5"
          transform="rotate(45 9 9)"
        />
      )}
    </svg>
  );
}

function Summary({ chart }: { chart: Extract<ShareCardChart, { kind: 'summary' }> }) {
  return (
    <div style={box({ left: PAD, right: PAD, top: 210, flexDirection: 'column' })}>
      {chart.clubs.map((club) => (
        <div
          key={club.clubId}
          style={{ display: 'flex', flexDirection: 'column', marginBottom: 28 }}
        >
          <div
            style={{ display: 'flex', fontFamily: HEAD, fontWeight: 800, fontSize: 30, color: SUN }}
          >{`${club.clubName} got`}</div>
          <div style={{ display: 'flex', fontSize: 28 }}>{club.got}</div>
        </div>
      ))}
    </div>
  );
}

function Text({
  children,
  left,
  top,
  size,
}: {
  children: ReactNode;
  left: number;
  top: number;
  size: number;
}) {
  return <div style={box({ left, top, fontSize: size })}>{children}</div>;
}
