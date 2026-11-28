import { getTeamAbbreviation } from '@/lib/teamLogos';

import type { HeldBy } from './TradeTree';
import { clubSquare, formatPav } from './tradePageModel';
import type { TradeTree, TreeLane } from './tradeTreeModel';
import { clip, pathText, textWidth, valueText, wrap } from './tradeTreeText';

/**
 * The trade tree on a phone (owner, 2026-11-28: "a similar graphic to the desktop"): the desktop's
 * knot, branches and lanes redrawn 303 units wide, the inside of the tree card on a 375px screen, so
 * 13-unit text is 13px there. Each club's name heads its lanes instead of sitting left of the knot;
 * the player is written over his lane and the pick, its trades and its draft in a note under it; the
 * PAV stands in one column at the right. Only the first and last seasons are labelled. The marks are
 * the desktop's (solid, grey, hatched, outline, ring, draft dot, end tick) and carry the same
 * `data-key`s, so the key lights them up the same way.
 */

const W = 303;
const KNOT_X = 11;
const JOINT_X = 28;
const LANE_X = 42;
const COL_X0 = 54;
/** The PAV column: "170.9" at 20 units in Geist 900 is about 60 wide. */
const COL_X1 = W - 68;
const HEAD = 22;
const NOTE = 13;
const NAME = 14;
const INK = 'var(--foreground)';
const MUTED = 'var(--muted-foreground)';
const PAPER = 'var(--card)';
const RULE = 'var(--border)';
const HALO = 'var(--warning)';

type Span = TreeLane['spans'][number];

/** A lane's stroke: 2.5 units at 0 PAV to 12 at the top of the trade's scale. */
const widthOf = (value: number | null, top: number) => 2.5 + (9.5 * Math.max(0, value ?? 0)) / top;

/** The note under a lane: the pick a player came from, then the path. */
function laneNote(lane: TreeLane): string {
  if (!lane.player || lane.player.name === lane.label) return pathText(lane);
  const pick = `${lane.label}${lane.via ? ` ${lane.via}` : ''}`;
  return [pick, pathText({ ...lane, via: null })].filter(Boolean).join(' · ');
}

const columnText = ({ kind, season }: TradeTree['columns'][number]) =>
  kind === 'draft' ? `${season} draft` : `${season}`;

export function TradeTreePhone({
  tree,
  heldBy,
  hatch,
}: {
  tree: TradeTree;
  heldBy: (lane: TreeLane) => (span: Span) => HeldBy;
  hatch: string;
}) {
  const { columns, groups, scale } = tree;
  const colX = (at: number) =>
    at < 0
      ? LANE_X
      : columns.length === 1
        ? COL_X0
        : COL_X0 + ((COL_X1 - COL_X0) * at) / (columns.length - 1);
  const endX = COL_X1 + 4;
  // A trade on is drawn a little before the draft it came ahead of, as on the desktop.
  const xOf = (lane: TreeLane, at: number) =>
    colX(at) - (at === lane.onward?.beforeColumn ? 10 : 0);

  // Top to bottom: each club's heading, then its lanes, each lane as tall as its note.
  let y = HEAD + 14;
  const rows = groups.map((group) => {
    const headY = y + 14;
    y = headY + 34;
    const lanes = group.lanes.map((lane) => {
      const w = widthOf(lane.value, scale.top);
      const notes = wrap(laneNote(lane), COL_X1 - LANE_X, NOTE);
      const laneY = y + 24;
      // "not in yet" takes the first note line's right end, so such a lane has at least one line.
      const lines = Math.max(notes.length, lane.value === null ? 1 : 0);
      y = laneY + Math.max(w / 2, 5) + lines * 16 + 18;
      const stop = lane.endColumn === null ? endX : colX(lane.endColumn);
      return { lane, w, notes, y: laneY, stop };
    });
    y += 10;
    const mid = (lanes[0]!.y + lanes.at(-1)!.y) / 2;
    return { group, headY, lanes, mid };
  });
  const height = y;
  const all = rows.flatMap(({ lanes }) => lanes);
  const knotY = (all[0]!.y + all.at(-1)!.y) / 2;
  const branch = (laneY: number, mid: number) =>
    `M${JOINT_X},${mid} C${JOINT_X + 9},${mid} ${LANE_X - 9},${laneY} ${LANE_X},${laneY}`;

  type Row = (typeof all)[number];
  const bars = ({ lane, w, y: laneY, stop }: Row, halo: boolean) =>
    lane.spans.map((span, at) => {
      const from = xOf(lane, span.from);
      const next = lane.spans[at + 1];
      const to = Math.min(next ? xOf(lane, next.from) : stop, stop);
      if (to <= from) return null;
      const held = heldBy(lane)(span);
      const glow = { fill: HALO, stroke: HALO, strokeWidth: 10, strokeLinejoin: 'round' as const };
      return span.pick ? (
        <rect
          key={span.from}
          data-key={halo ? 'pick' : undefined}
          x={from}
          y={laneY - 2}
          width={to - from}
          height="4"
          {...(halo ? glow : { fill: PAPER, stroke: INK, strokeWidth: 1.1 })}
        />
      ) : (
        <rect
          key={span.from}
          data-key={halo ? `${held} bar` : undefined}
          x={from}
          y={laneY - w / 2}
          width={to - from}
          height={w}
          {...(halo
            ? glow
            : {
                fill: { received: INK, other: MUTED, away: `url(#${hatch})` }[held],
                stroke: held === 'away' ? INK : 'none',
                strokeWidth: 0.7,
              })}
        />
      );
    });

  return (
    <svg className="tt-phone" aria-hidden="true" viewBox={`0 0 ${W} ${height}`}>
      <defs>
        <pattern
          id={hatch}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="4" height="4" fill={PAPER} />
          <line x1="0" y1="0" x2="0" y2="4" stroke={INK} strokeWidth="1.6" />
        </pattern>
      </defs>

      {/* The key's highlighter: a sun copy of every mark, shown by the stylesheet. */}
      <g className="tt-halo">
        {rows.flatMap(({ lanes, mid }) =>
          lanes.map((row) => {
            const pick = row.lane.spans[0]!.pick;
            return (
              <g key={row.lane.asset.transferId}>
                <path
                  data-key={pick ? 'pick' : 'received'}
                  d={branch(row.y, mid)}
                  fill="none"
                  stroke={HALO}
                  strokeWidth={(pick ? 4 : row.w) + 10}
                  strokeLinecap="round"
                />
                {bars(row, true)}
                {row.lane.onward ? (
                  <circle
                    data-key="traded"
                    cx={xOf(row.lane, row.lane.onward.beforeColumn)}
                    cy={row.y}
                    r="14"
                    fill={HALO}
                  />
                ) : null}
              </g>
            );
          })
        )}
      </g>

      {/* The seasons: every rule, the first and last named. */}
      {columns.map((column, at) => (
        <line
          key={`${column.kind}-${column.season}`}
          x1={colX(at)}
          y1={HEAD + 6}
          x2={colX(at)}
          y2={height}
          stroke={RULE}
          strokeDasharray="2 4"
        />
      ))}
      <text x={colX(0) - 4} y={HEAD} fontSize="12" fontWeight="600" fill={INK}>
        {columnText(columns[0]!)}
      </text>
      {columns.length > 1 ? (
        <text
          x={colX(columns.length - 1) + 4}
          y={HEAD}
          textAnchor="end"
          fontSize="12"
          fontWeight="600"
          fill={INK}
        >
          {columnText(columns.at(-1)!)}
        </text>
      ) : null}
      <text x={W} y={HEAD} textAnchor="end" fontSize="12" fontWeight="600" fill={INK}>
        PAV
      </text>

      {/* Each club: its heading, the trunk from the knot, and a branch to each lane. */}
      {rows.map(({ group, headY, lanes, mid }) => {
        const square = clubSquare(group.clubName);
        const room = W - LANE_X - 20;
        const name =
          textWidth(`${group.clubName} received`, true, 15) <= room
            ? group.clubName
            : getTeamAbbreviation(group.clubName);
        const trunk = Math.min(10, lanes.reduce((total, { w }) => total + w, 0) * 0.5);
        return (
          <g key={group.clubId}>
            <path
              d={`M${LANE_X + 0.5} ${headY - 13.5}h13L${LANE_X + 0.5} ${headY - 0.5}Z`}
              fill={square.main}
            />
            <path
              d={`M${LANE_X + 13.5} ${headY - 13.5}v13H${LANE_X + 0.5}Z`}
              fill={square.second}
            />
            <rect
              x={LANE_X + 0.5}
              y={headY - 13.5}
              width="13"
              height="13"
              fill="none"
              stroke={INK}
              strokeWidth="1"
            />
            <text x={LANE_X + 20} y={headY} fontSize="15" fontWeight="700" fill={INK}>
              {name} received
            </text>
            <text x={LANE_X} y={headY + 18} fontSize={NOTE} fill={MUTED}>
              {formatPav(group.kept)} PAV kept
              {group.elsewhere > 0 ? ` · ${formatPav(group.elsewhere)} went elsewhere` : ''}
            </text>
            <path
              d={`M${KNOT_X},${knotY} C${KNOT_X},${knotY} ${KNOT_X},${mid} ${JOINT_X},${mid}`}
              fill="none"
              stroke={INK}
              strokeWidth={trunk}
              strokeLinecap="round"
            />
            {lanes.map(({ lane, w, y: laneY }) =>
              lane.spans[0]!.pick ? (
                <g key={lane.asset.transferId}>
                  <path d={branch(laneY, mid)} fill="none" stroke={INK} strokeWidth="4" />
                  <path d={branch(laneY, mid)} fill="none" stroke={PAPER} strokeWidth="1.8" />
                </g>
              ) : (
                <path
                  key={lane.asset.transferId}
                  d={branch(laneY, mid)}
                  fill="none"
                  stroke={INK}
                  strokeWidth={w}
                />
              )
            )}
          </g>
        );
      })}
      <circle cx={KNOT_X} cy={knotY} r="10" fill={INK} />
      <text
        x={KNOT_X}
        y={knotY + 4}
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fill={PAPER}
      >
        ⇄
      </text>

      {/* Each lane: the player over it, its marks, the note under it and its PAV. */}
      {all.map((row) => {
        const { lane, w, notes, y: laneY, stop } = row;
        const away = lane.player?.away ?? false;
        const name = lane.player?.name ?? lane.label;
        const where = away ? ` at ${lane.player!.clubName}` : '';
        const nameRoom = W - LANE_X;
        const withWhere = textWidth(name + where, true, NAME) <= nameRoom;
        const noteTop = laneY + Math.max(w / 2, 5) + 14;
        return (
          <g key={lane.asset.transferId}>
            <text
              x={LANE_X}
              y={laneY - Math.max(w / 2, lane.onward ? 8 : 3) - 6}
              fontSize={NAME}
              fontWeight="600"
              fill={away ? MUTED : INK}
            >
              {clip(name, nameRoom, true, NAME)}
              {withWhere && where ? <tspan fontWeight="400">{where}</tspan> : null}
            </text>
            {bars(row, false)}
            {lane.drafted ? (
              <circle cx={colX(lane.drafted.column)} cy={laneY} r="3.2" fill={INK} />
            ) : null}
            {lane.onward ? (
              <g data-key="traded">
                <circle
                  cx={xOf(lane, lane.onward.beforeColumn)}
                  cy={laneY}
                  r="8.5"
                  fill={PAPER}
                  stroke={INK}
                  strokeWidth="1.3"
                />
                <text
                  x={xOf(lane, lane.onward.beforeColumn)}
                  y={laneY + 4}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill={INK}
                >
                  ⇄
                </text>
              </g>
            ) : null}
            {lane.endColumn !== null ? (
              <line
                x1={stop}
                y1={laneY - 6}
                x2={stop}
                y2={laneY + 6}
                stroke={INK}
                strokeWidth="1.4"
              />
            ) : null}
            {notes.map((line, at) => (
              <text key={line} x={LANE_X} y={noteTop + at * 16} fontSize={NOTE} fill={MUTED}>
                {line}
              </text>
            ))}
            {lane.value === null ? (
              // Words, not a number: reading weight, under the lane's end so it never meets the lane.
              <text
                x={W}
                y={noteTop}
                textAnchor="end"
                fontSize="12"
                fill={MUTED}
                className="tt-svg-num"
                style={{ fontWeight: 400 }}
              >
                {valueText(lane)}
              </text>
            ) : (
              <text
                x={W}
                y={laneY + 7}
                textAnchor="end"
                fontSize="20"
                fill={away ? MUTED : INK}
                className="tt-svg-num"
              >
                {valueText(lane)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
