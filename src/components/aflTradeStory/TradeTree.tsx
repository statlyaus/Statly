import { Fragment, useId } from 'react';

import type { AflTradeStory } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import { getTeamAbbreviation } from '@/lib/teamLogos';

import './tradeTree.css';

import { ClubBadge } from './ClubBadge';
import { checkpointText, clubSquare, formatPav } from './tradePageModel';
import { tradeTree, type TreeColumn, type TreeLane } from './tradeTreeModel';

/**
 * "Where the trade went" (owner's design, 2026-11-17): the trade at the left branches to each club,
 * then to a lane per asset that runs through time to the player it became and his PAV. A lane is
 * solid ink while the receiving club holds it, grey while the other club in the trade does, an
 * outline while still a pick, and hatched ink once it is at another club; its thickness is its PAV.
 * Club colour appears only in the 13px club square beside each club's name (style guide, "Club
 * colours"). Below 1024px, and for screen readers, it is a list: the chart scales down with its
 * container, and below 1024px its labels would fall under 11px.
 */

/** Where the chart's parts sit, in SVG units (drawn 1:1 at full width, so 14 units is 14px). */
interface Layout {
  readonly W: number;
  readonly TREE_X: number;
  /** Lanes start past the branch joint at TREE_X + 60, or the branches double back. */
  readonly LANE_X: number;
  readonly COL_X0: number;
  readonly COL_X1: number;
  readonly BECAME_X: number;
  /**
   * "Traded to …" notes and "not used" or "stint ended" over a lane's end. The compact preview leaves
   * them out: on its shorter lanes they meet the lane labels, and the Became column says how it ended.
   */
  readonly notes: boolean;
}
const FULL: Layout = {
  W: 1100,
  TREE_X: 150,
  LANE_X: 250,
  COL_X0: 320,
  COL_X1: 810,
  BECAME_X: 860,
  notes: true,
};
/** The trade list's preview panel (owner, 2026-11-22): 680 units, the same 14-unit text. */
const COMPACT: Layout = {
  W: 680,
  TREE_X: 92,
  LANE_X: 200,
  COL_X0: 230,
  COL_X1: 436,
  BECAME_X: 474,
  notes: false,
};
const HEAD = 56;
const ROW = 56;
const GAP = 26;
const INK = 'var(--foreground)';
const MUTED = 'var(--muted-foreground)';
const PAPER = 'var(--card)';
const RULE = 'var(--border)';

/**
 * A note that fits under its lane (Geist is about 0.55em a letter at 14 units): the
 * whole note, else without its "took" clause (the Became column names the player), else cut short.
 */
function fitNote(main: string, extra: string, { BECAME_X, LANE_X }: Layout): string {
  // Room for a note under a lane, from the lane's start to the "Became" column.
  const NOTE_ROOM = BECAME_X - 24 - LANE_X;
  const fits = (text: string) => text.length * 14 * 0.55 <= NOTE_ROOM;
  if (fits(main + extra)) return main + extra;
  if (fits(main)) return main;
  return `${main.slice(0, Math.floor(NOTE_ROOM / (14 * 0.55)) - 1)}…`;
}

/** A 14-unit label's estimated width: Geist about 0.58em a letter bold, 0.52em regular. */
const textWidth = (text: string, bold = false, size = 14) =>
  text.length * size * (bold ? 0.58 : 0.52);
/** The text, cut short with an ellipsis where it would run past `room`. */
function clip(text: string, room: number, bold = false, size = 14): string {
  if (textWidth(text, bold, size) <= room) return text;
  return `${text.slice(0, Math.max(1, Math.floor(room / (size * (bold ? 0.58 : 0.52))) - 1))}…`;
}

/**
 * A lane's label as drawn over its start, kept clear of the Became column: the pick and how it
 * came, else the pick alone, else the pick cut short.
 */
function laneLabel(lane: TreeLane, { LANE_X, BECAME_X }: Layout) {
  const room = BECAME_X - 12 - LANE_X;
  const via = lane.via ? `  ${lane.via}` : '';
  if (textWidth(lane.label, true) + textWidth(via) <= room)
    return { label: lane.label, via, width: textWidth(lane.label, true) + textWidth(via) };
  const label = clip(lane.label, room, true);
  return { label, via: '', width: textWidth(label, true) };
}

/** A club label's size, and the room for it between the left edge and the knot's branches. */
const LABEL_SIZE = 16;
/** The club's name, or its abbreviation when the name would run into the branches (Geist 700 is
 * about 0.58em a letter). */
const clubLabel = (clubName: string, { TREE_X }: Layout) =>
  clubName.length * LABEL_SIZE * 0.58 <= TREE_X - 16 - 21
    ? clubName
    : getTeamAbbreviation(clubName);

const columnLabel = ({ kind, season }: TreeColumn) =>
  kind === 'draft' ? ['Draft', `${season}`] : ['', `${season}`];
/** A lane's stroke in the chart: 3px at 0 PAV to 16px at the top of the trade's scale. */
const widthOf = (value: number | null, top: number) => 3 + (13 * Math.max(0, value ?? 0)) / top;
/** A scale value as a label: "20", "1.5". */
const scaleText = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
/** Where a value sits along a track, as a share of the trade's scale (0 to 100). */
const along = (value: number, top: number) => Math.min(100, (100 * Math.max(0, value)) / top);

/** What happened to a lane, in words, for the list and the chart's labels. */
function pathText(lane: TreeLane): string {
  const steps: string[] = [];
  if (lane.via) steps.push(`came ${lane.via}`);
  if (lane.onward) steps.push(`traded to ${lane.onward.clubNames.join(', then ')}`);
  if (lane.drafted?.selection) steps.push(`drafted at ${lane.drafted.selection}`);
  if (lane.endReason === 'not_used') steps.push('not used');
  if (lane.endReason === 'closed') steps.push('stint ended');
  return steps.join(' · ');
}

/** A lane's PAV, or "not in yet" as the rest of the trade page says it. */
function valueText(lane: TreeLane): string {
  return lane.value === null ? 'not in yet' : formatPav(lane.value);
}

type Span = TreeLane['spans'][number];

/** The lane's bars: an outline while a pick, then a bar as thick as its PAV. */
function LaneBars({
  lane,
  y,
  w,
  colX,
  stop,
  fill,
  outlined,
}: {
  lane: TreeLane;
  y: number;
  w: number;
  colX: (at: number) => number;
  stop: number;
  fill: (span: Span) => string;
  outlined: (span: Span) => boolean;
}) {
  const xOf = (at: number) => colX(at) + (at === lane.onward?.beforeColumn ? -18 : 0);
  return (
    <>
      {lane.spans.map((span, at) => {
        const from = xOf(span.from);
        const next = lane.spans[at + 1];
        const to = Math.min(next ? xOf(next.from) : stop, stop);
        if (to <= from) return null;
        return span.pick ? (
          <rect
            key={span.from}
            x={from}
            y={y - 2.5}
            width={to - from}
            height="5"
            fill={PAPER}
            stroke={INK}
            strokeWidth="1.2"
          />
        ) : (
          <rect
            key={span.from}
            x={from}
            y={y - w / 2}
            width={to - from}
            height={w}
            fill={fill(span)}
            stroke={outlined(span) ? INK : 'none'}
            strokeWidth="0.8"
          />
        );
      })}
    </>
  );
}

/** The draft dot, the onward-trade marker, the end cap and their notes. */
function LaneMarks({
  lane,
  y,
  w,
  colX,
  stop,
  layout,
}: {
  lane: TreeLane;
  y: number;
  w: number;
  colX: (at: number) => number;
  stop: number;
  layout: Layout;
}) {
  const onwardX = lane.onward ? colX(lane.onward.beforeColumn) - 18 : 0;
  const took = lane.player
    ? `; ${lane.player.clubName} took ${lane.player.name}${lane.drafted?.selection ? ` at ${lane.drafted.selection}` : ''}`
    : '';
  const endNote = lane.endReason === 'not_used' ? 'not used' : 'stint ended';
  const onwardNote = lane.onward
    ? fitNote(`traded to ${lane.onward.clubNames.join(', then ')}`, took, layout)
    : '';
  return (
    <>
      {lane.drafted ? <circle cx={colX(lane.drafted.column)} cy={y} r="4" fill={INK} /> : null}
      {lane.drafted?.selection && !lane.onward ? (
        <text x={colX(lane.drafted.column) + 8} y={y + w / 2 + 14} fontSize="14" fill={MUTED}>
          drafted at {lane.drafted.selection}
        </text>
      ) : null}
      {lane.onward ? (
        <>
          <circle cx={onwardX} cy={y} r="11" fill={PAPER} stroke={INK} strokeWidth="1.5" />
          <text x={onwardX} y={y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill={INK}>
            ⇄
          </text>
          {layout.notes ? (
            <text x={layout.LANE_X} y={y + Math.max(w / 2, 11) + 16} fontSize="14" fill={MUTED}>
              {onwardNote}
            </text>
          ) : null}
        </>
      ) : null}
      {lane.endColumn !== null ? (
        <>
          <line x1={stop} y1={y - 7} x2={stop} y2={y + 7} stroke={INK} strokeWidth="1.5" />
          {/* Left out where it would meet the lane's label: the Became column says it too. */}
          {layout.notes &&
          stop - 4 - textWidth(endNote) >= layout.LANE_X + laneLabel(lane, layout).width + 12 ? (
            <text x={stop - 4} y={y - 12} textAnchor="end" fontSize="14" fill={MUTED}>
              {endNote}
            </text>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/** The player the lane became, his club, and its PAV. */
function BecameCell({ lane, y, layout }: { lane: TreeLane; y: number; layout: Layout }) {
  const { BECAME_X, W } = layout;
  const away = lane.player?.away ?? false;
  const name = lane.player?.name ?? (lane.endReason === 'not_used' ? 'Not used' : 'Value pending');
  const valueSize = lane.value === null ? 15 : 30;
  // The room left of the PAV, which sits level with the name and the club.
  const room = W - valueText(lane).length * valueSize * 0.6 - 12 - BECAME_X;
  const club = lane.player?.clubName ?? '';
  const ended = lane.endReason === 'closed';
  const oneLine = ended && textWidth(`${club}, stint ended`) <= room;
  return (
    <>
      <text x={BECAME_X} y={y - 1} fontSize="14" fontWeight="700" fill={away ? MUTED : INK}>
        {clip(name, room, true)}
      </text>
      <text x={BECAME_X} y={y + 15} fontSize="14" fill={MUTED}>
        {clip(oneLine ? `${club}, stint ended` : club, room)}
      </text>
      {ended && !oneLine ? (
        <text x={BECAME_X} y={y + 31} fontSize="14" fill={MUTED}>
          stint ended
        </text>
      ) : null}
      <text
        x={W}
        y={y + 10}
        textAnchor="end"
        fontSize={valueSize}
        fontWeight="600"
        fill={away || lane.value === null ? MUTED : INK}
        className="tt-svg-num"
      >
        {valueText(lane)}
      </text>
    </>
  );
}

/** One asset's lane: its label, its bars and marks, and what it became. */
function TreeLaneRow({
  lane,
  y,
  w,
  colX,
  stop,
  fill,
  outlined,
  layout,
}: {
  lane: TreeLane;
  y: number;
  w: number;
  colX: (at: number) => number;
  stop: number;
  fill: (span: Span) => string;
  outlined: (span: Span) => boolean;
  layout: Layout;
}) {
  const shown = laneLabel(lane, layout);
  return (
    <g>
      <text x={layout.LANE_X} y={y - 12} fontSize="14" fontWeight="600" fill={INK}>
        {shown.label}
        {shown.via ? (
          <tspan fontWeight="400" fill={MUTED}>
            {shown.via}
          </tspan>
        ) : null}
      </text>
      <LaneBars lane={lane} y={y} w={w} colX={colX} stop={stop} fill={fill} outlined={outlined} />
      <LaneMarks lane={lane} y={y} w={w} colX={colX} stop={stop} layout={layout} />
      <BecameCell lane={lane} y={y} layout={layout} />
    </g>
  );
}

/**
 * `compact` is the trade list's preview: the chart alone, 680 units wide, with no heading, lede, notes
 * or footer (the preview writes its own heading and basis line).
 */
export function TradeTree({ story, compact = false }: { story: AflTradeStory; compact?: boolean }) {
  const layout = compact ? COMPACT : FULL;
  const { W, TREE_X, LANE_X, COL_X0, COL_X1, BECAME_X } = layout;
  const hatch = `tt-hatch-${useId().replace(/[^a-zA-Z0-9_-]/gu, '')}`;
  const tree = tradeTree(story);
  const { columns, groups, scale } = tree;
  const clubIds = new Set(story.trade.clubs.map(({ clubId }) => clubId));
  const colX = (at: number) =>
    at < 0
      ? LANE_X
      : columns.length === 1
        ? COL_X0
        : COL_X0 + ((COL_X1 - COL_X0) * at) / (columns.length - 1);
  const endX = COL_X1 + 8;
  // A season label is about 34 units wide at 14 units bold; closer columns label every few.
  const step = columns.length > 1 ? (COL_X1 - COL_X0) / (columns.length - 1) : Infinity;
  const labelEvery = Math.ceil(44 / Math.min(step, 44));

  // Rows: every group's lanes, top to bottom, with a gap between groups.
  // The first lane's label clears the column heads above it.
  const FIRST = HEAD + 38;
  let y = FIRST;
  const rows = groups.map((group) => {
    const lanes = group.lanes.map((lane) => {
      const at = y;
      y += ROW;
      return { lane, y: at };
    });
    y += GAP;
    return { group, lanes };
  });
  const height = y - GAP + 8;
  const mid = (FIRST + height - 8 - ROW) / 2;

  const fillFor = (clubId: string, receiverId: string) =>
    clubId === receiverId ? INK : clubIds.has(clubId) ? MUTED : `url(#${hatch})`;

  const kept = groups
    .map(({ clubName, kept: value }) => `${clubName} kept ${formatPav(value)}`)
    .join(', ');
  const elsewhere = groups.reduce((total, { elsewhere: value }) => total + value, 0);

  return (
    <section
      // The compact tree sits under its host's own heading.
      aria-labelledby={compact ? undefined : 'lineage-title'}
      className={compact ? 'tt tt-compact' : 'tt'}
    >
      {compact ? null : (
        <>
          <h2 id="lineage-title" className="tt-title">
            Where the trade went
          </h2>
          <p className="tt-lede">
            Every pick and player in the trade, followed to the player it became and his PAV to{' '}
            {checkpointText(story.checkpoint)}. {kept}
            {elsewhere > 0 ? `; ${formatPav(elsewhere)} went to other clubs` : ''}.
          </p>
        </>
      )}
      <ul className="tt-key" aria-label="Key">
        <li>
          <svg aria-hidden="true" width="26" height="10">
            <rect width="26" height="10" fill={INK} />
          </svg>
          held by the club that received it
        </li>
        <li>
          <svg aria-hidden="true" width="26" height="10">
            <rect width="26" height="10" fill={MUTED} />
          </svg>
          held by another club in the trade
        </li>
        <li>
          <svg aria-hidden="true" width="26" height="10">
            <defs>
              <pattern
                id={`${hatch}-key`}
                width="5"
                height="5"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="5" height="5" fill={PAPER} />
                <line x1="0" y1="0" x2="0" y2="5" stroke={INK} strokeWidth="2" />
              </pattern>
            </defs>
            <rect width="26" height="10" fill={`url(#${hatch}-key)`} />
          </svg>
          another club
        </li>
        <li>
          <svg aria-hidden="true" width="26" height="10">
            <rect
              x="0.6"
              y="2.6"
              width="24.8"
              height="4.8"
              fill={PAPER}
              stroke={INK}
              strokeWidth="1.2"
            />
          </svg>
          still a pick
        </li>
        <li>
          <svg aria-hidden="true" width="18" height="18">
            <circle cx="9" cy="9" r="8" fill={PAPER} stroke={INK} strokeWidth="1.5" />
            <text x="9" y="13" textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
              ⇄
            </text>
          </svg>
          traded
        </li>
        <li className="tt-thickness">
          Thickness is PAV:
          {[scale.ticks[0]!, scale.top].map((value) => (
            <span key={value} className="tt-thickness-sample">
              <svg aria-hidden="true" width="26" height="16">
                <rect
                  y={8 - widthOf(value, scale.top) / 2}
                  width="26"
                  height={widthOf(value, scale.top)}
                  fill={INK}
                />
              </svg>
              {scaleText(value)} PAV
            </span>
          ))}
        </li>
      </ul>

      <div className="tt-chart">
        <svg aria-hidden="true" viewBox={`0 0 ${W} ${height}`}>
          <defs>
            <pattern
              id={hatch}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="5" height="5" fill={PAPER} />
              <line x1="0" y1="0" x2="0" y2="5" stroke={INK} strokeWidth="2" />
            </pattern>
          </defs>
          {/* The time axis. */}
          {columns.map((column, at) => {
            const [kicker, year] = columnLabel(column);
            // Every column keeps its rule; its label shows only where labels fit, counted back from
            // the latest so it is always named.
            const labelled = (columns.length - 1 - at) % labelEvery === 0;
            return (
              <g key={`${column.kind}-${column.season}`}>
                <line
                  x1={colX(at)}
                  y1={HEAD + 6}
                  x2={colX(at)}
                  y2={height}
                  stroke={RULE}
                  strokeDasharray="2 4"
                />
                {kicker && labelled ? (
                  <text x={colX(at)} y={HEAD - 20} textAnchor="middle" fontSize="14" fill={MUTED}>
                    {kicker}
                  </text>
                ) : null}
                {labelled ? (
                  <text
                    x={colX(at)}
                    y={HEAD - 4}
                    textAnchor="middle"
                    fontSize="14"
                    fontWeight="600"
                    fill={INK}
                  >
                    {year}
                  </text>
                ) : null}
              </g>
            );
          })}
          <text x={BECAME_X} y={HEAD - 4} fontSize="14" fontWeight="600" fill={INK}>
            Became
          </text>
          <text x={W} y={HEAD - 4} textAnchor="end" fontSize="14" fontWeight="600" fill={INK}>
            PAV
          </text>
          <line x1={BECAME_X} y1={HEAD + 4} x2={W} y2={HEAD + 4} stroke={INK} strokeWidth="1" />

          {/* The trade, branching to each club and then to each lane. */}
          {rows.map(({ group, lanes }) => {
            const square = clubSquare(group.clubName);
            const top = lanes[0]!.y;
            const bottom = lanes.at(-1)!.y;
            const groupMid = (top + bottom) / 2;
            const labelY = groupMid;
            const label = clubLabel(group.clubName, layout);
            const trunk = Math.min(
              18,
              lanes.reduce((total, { lane }) => total + widthOf(lane.value, scale.top), 0) * 0.6
            );
            const jx = TREE_X + 60;
            return (
              <g key={group.clubId}>
                {/* Two short lines in Geist left of the knot; a name too long for the space is
                    its abbreviation. The square is 14 units, about 12-13px as the chart scales. */}
                <path d={`M0.75 ${labelY - 15.25}h14L0.75 ${labelY - 1.25}Z`} fill={square.main} />
                <path d={`M14.75 ${labelY - 15.25}v14H0.75Z`} fill={square.second} />
                <rect
                  x="0.75"
                  y={labelY - 15.25}
                  width="14"
                  height="14"
                  fill="none"
                  stroke={INK}
                  strokeWidth="1"
                />
                <text
                  x="21"
                  y={labelY - 2}
                  fontSize={LABEL_SIZE}
                  fontWeight="700"
                  fill={INK}
                  className="tt-svg-label"
                >
                  {label}
                  <tspan x="21" dy="17" fontSize="14" fontWeight="400" fill={MUTED}>
                    received
                  </tspan>
                </text>
                <path
                  d={`M${TREE_X},${mid} C${TREE_X + 30},${mid} ${jx - 30},${groupMid} ${jx},${groupMid}`}
                  fill="none"
                  stroke={INK}
                  strokeWidth={trunk}
                  strokeLinecap="round"
                />
                {lanes.map(({ lane, y: laneY }) => {
                  const pick = lane.spans[0]!.pick;
                  const w = widthOf(lane.value, scale.top);
                  const d = `M${jx},${groupMid} C${jx + 22},${groupMid} ${LANE_X - 22},${laneY} ${LANE_X},${laneY}`;
                  return pick ? (
                    <Fragment key={lane.asset.transferId}>
                      <path d={d} fill="none" stroke={INK} strokeWidth="5" />
                      <path d={d} fill="none" stroke={PAPER} strokeWidth="2.6" />
                    </Fragment>
                  ) : (
                    <path
                      key={lane.asset.transferId}
                      d={d}
                      fill="none"
                      stroke={INK}
                      strokeWidth={w}
                    />
                  );
                })}
              </g>
            );
          })}
          <circle cx={TREE_X} cy={mid} r="12" fill={INK} />
          <text
            x={TREE_X}
            y={mid + 5}
            textAnchor="middle"
            fontSize="14"
            fontWeight="700"
            fill={PAPER}
          >
            ⇄
          </text>
          {/* The knot's name heads its column, like the seasons, so the club labels beside the
              knot never meet it. */}
          <text x="0" y={HEAD - 20} fontSize="14" fontWeight="700" fill={INK}>
            The trade
          </text>
          <text x="0" y={HEAD - 4} fontSize="14" fill={MUTED}>
            {story.trade.year} trade period
          </text>

          {/* Each lane through time. */}
          {rows.flatMap(({ lanes }) =>
            lanes.map(({ lane, y: laneY }) => (
              <TreeLaneRow
                key={lane.asset.transferId}
                lane={lane}
                y={laneY}
                w={widthOf(lane.value, scale.top)}
                colX={colX}
                stop={lane.endColumn === null ? endX : colX(lane.endColumn)}
                fill={(span) => fillFor(span.clubId, lane.receiverId)}
                outlined={(span) => span.clubId !== lane.receiverId && !clubIds.has(span.clubId)}
                layout={layout}
              />
            ))
          )}
        </svg>
      </div>

      <div className="tt-scale" aria-hidden="true">
        <span className="tt-scale-axis">
          <span>0</span>
          {scale.ticks.map((tick) => (
            <span
              key={tick}
              className="tt-scale-tick"
              style={{ left: `${along(tick, scale.top)}%` }}
            >
              {scaleText(tick)}
            </span>
          ))}
          <span>{scaleText(scale.top)} PAV</span>
        </span>
      </div>
      <ol className="tt-list" aria-label="Every pick and player, and what it became">
        {groups.map((group) => (
          <li key={group.clubId} className="tt-group">
            <h3>
              <span className="inline-flex items-center gap-2">
                <ClubBadge clubName={group.clubName} named />
                {group.clubName} received
              </span>
              <small>
                {formatPav(group.kept)} PAV kept
                {group.elsewhere > 0 ? ` · ${formatPav(group.elsewhere)} went elsewhere` : ''}
              </small>
            </h3>
            <ul>
              {group.lanes.map((lane) => (
                <li key={lane.asset.transferId} className="tt-item">
                  <p>
                    <b>{lane.label}</b>
                    {lane.player && lane.player.name !== lane.label ? (
                      <>
                        {' '}
                        → <b>{lane.player.name}</b>
                        {lane.player.away ? `, at ${lane.player.clubName}` : ''}
                      </>
                    ) : null}
                  </p>
                  {pathText(lane) ? <p className="tt-path">{pathText(lane)}</p> : null}
                  {/* One track per lane, the trade's whole scale long, so bars compare across
                      clubs; a value not in yet leaves the track empty. */}
                  <span aria-hidden="true" className="tt-track">
                    {scale.ticks.map((tick) => (
                      <span
                        key={tick}
                        className="tt-track-tick"
                        style={{ left: `${along(tick, scale.top)}%` }}
                      />
                    ))}
                    {lane.value === null ? null : (
                      <span
                        className={lane.player?.away ? 'tt-weight tt-weight-away' : 'tt-weight'}
                        style={{ width: `${along(lane.value, scale.top)}%` }}
                      />
                    )}
                  </span>
                  <span
                    className={lane.value === null ? 'tt-num tt-num-words' : 'tt-num'}
                    style={{
                      color: lane.player?.away || lane.value === null ? MUTED : undefined,
                    }}
                  >
                    {valueText(lane)}
                    {lane.value === null ? null : <span className="sr-only"> PAV</span>}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {compact ? null : (
        <p className="tt-foot">
          PAV to {checkpointText(story.checkpoint)}: what each player has given the club that
          drafted or traded for him, plus what an open stint is expected to add. Picks are named as
          traded; the number drafted at can differ.
        </p>
      )}
    </section>
  );
}
