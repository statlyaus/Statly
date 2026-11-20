import { Fragment, useId } from 'react';

import { STORY_FONT_CLASS } from '@/components/aflStories/CameronMasthead';
import type { AflTradeStory } from '@/server/aflTradeIntelligence/valuation/realizedTradeStory';

import './tradeTree.css';
import { checkpointText, clubStyle, formatPav } from './tradePageModel';
import { tradeTree, type TreeColumn, type TreeLane } from './tradeTreeModel';

/**
 * "Where the trade went" (owner's design, 2026-11-17): the trade at the left branches to each club,
 * then to a lane per asset that runs through time to the player it became and his PAV. A lane is in
 * the receiving club's colour, an outline while still a pick, and hatched ink once it is at another
 * club; its thickness is its PAV. Below 768px, and for screen readers, it is a list.
 */

const W = 1100;
const TREE_X = 120;
const LANE_X = 230;
const COL_X0 = 320;
const COL_X1 = 830;
const BECAME_X = 860;
const HEAD = 56;
const ROW = 56;
const GAP = 26;
const INK = 'var(--ts-ink)';
const MUTED = 'var(--ts-muted)';
const PAPER = 'var(--ts-surface)';
const RULE = 'var(--ts-line)';

const columnLabel = ({ kind, season }: TreeColumn) =>
  kind === 'draft' ? ['Draft', `${season}`] : ['', `${season}`];
const widthOf = (value: number | null, max: number) => 3 + (13 * Math.max(0, value ?? 0)) / max;

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
}: {
  lane: TreeLane;
  y: number;
  w: number;
  colX: (at: number) => number;
  stop: number;
}) {
  const onwardX = lane.onward ? colX(lane.onward.beforeColumn) - 18 : 0;
  const took = lane.player
    ? `; ${lane.player.clubName} took ${lane.player.name}${lane.drafted?.selection ? ` at ${lane.drafted.selection}` : ''}`
    : '';
  return (
    <>
      {lane.drafted ? <circle cx={colX(lane.drafted.column)} cy={y} r="4" fill={INK} /> : null}
      {lane.drafted?.selection && !lane.onward ? (
        <text x={colX(lane.drafted.column) + 8} y={y + w / 2 + 14} fontSize="12" fill={MUTED}>
          drafted at {lane.drafted.selection}
        </text>
      ) : null}
      {lane.onward ? (
        <>
          <circle cx={onwardX} cy={y} r="9" fill={PAPER} stroke={INK} strokeWidth="1.5" />
          <text x={onwardX} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
            ⇄
          </text>
          <text x={stop - 2} y={y + w / 2 + 14} textAnchor="end" fontSize="12" fill={MUTED}>
            traded to {lane.onward.clubNames.join(', then ')}
            {took}
          </text>
        </>
      ) : null}
      {lane.endColumn !== null ? (
        <>
          <line x1={stop} y1={y - 7} x2={stop} y2={y + 7} stroke={INK} strokeWidth="1.5" />
          <text x={stop - 4} y={y - 12} textAnchor="end" fontSize="12" fill={MUTED}>
            {lane.endReason === 'not_used' ? 'not used' : 'stint ended'}
          </text>
        </>
      ) : null}
    </>
  );
}

/** The player the lane became, his club, and its PAV. */
function BecameCell({ lane, y, colour }: { lane: TreeLane; y: number; colour: string }) {
  const away = lane.player?.away ?? false;
  const name = lane.player?.name ?? (lane.endReason === 'not_used' ? 'Not used' : 'Value pending');
  return (
    <>
      <text x={BECAME_X} y={y - 1} fontSize="14" fontWeight="700" fill={away ? MUTED : INK}>
        {name}
      </text>
      <text x={BECAME_X} y={y + 15} fontSize="12" fill={MUTED}>
        {lane.player?.clubName ?? ''}
        {lane.endReason === 'closed' ? ', stint ended' : ''}
      </text>
      <text
        x={W}
        y={y + 10}
        textAnchor="end"
        fontSize={lane.value === null ? 15 : 30}
        fontWeight="600"
        fill={away || lane.value === null ? MUTED : colour}
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
  colour,
}: {
  lane: TreeLane;
  y: number;
  w: number;
  colX: (at: number) => number;
  stop: number;
  fill: (span: Span) => string;
  outlined: (span: Span) => boolean;
  colour: string;
}) {
  return (
    <g>
      <text x={LANE_X} y={y - 12} fontSize="12.5" fontWeight="600" fill={INK}>
        {lane.label}
        {lane.via ? (
          <tspan fontWeight="400" fill={MUTED}>
            {'  '}
            {lane.via}
          </tspan>
        ) : null}
      </text>
      <LaneBars lane={lane} y={y} w={w} colX={colX} stop={stop} fill={fill} outlined={outlined} />
      <LaneMarks lane={lane} y={y} w={w} colX={colX} stop={stop} />
      <BecameCell lane={lane} y={y} colour={colour} />
    </g>
  );
}

export function TradeTree({ story }: { story: AflTradeStory }) {
  const hatch = `tt-hatch-${useId().replace(/[^a-zA-Z0-9_-]/gu, '')}`;
  const tree = tradeTree(story);
  const { columns, groups, maxValue } = tree;
  const clubIds = new Set(story.trade.clubs.map(({ clubId }) => clubId));
  const colX = (at: number) =>
    at < 0
      ? LANE_X
      : columns.length === 1
        ? COL_X0
        : COL_X0 + ((COL_X1 - COL_X0) * at) / (columns.length - 1);
  const endX = COL_X1 + 8;

  // Rows: every group's lanes, top to bottom, with a gap between groups.
  let y = HEAD + 24;
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
  const mid = (HEAD + 24 + height - 8 - ROW) / 2;

  const fillFor = (clubId: string, receiverId: string, clubName: string) =>
    clubId === receiverId || clubIds.has(clubId) ? clubStyle(clubName).fill : `url(#${hatch})`;

  const kept = groups
    .map(({ clubName, kept: value }) => `${clubName} kept ${formatPav(value)}`)
    .join(', ');
  const elsewhere = groups.reduce((total, { elsewhere: value }) => total + value, 0);

  return (
    <section aria-labelledby="lineage-title" className={`tt ${STORY_FONT_CLASS}`}>
      <h2 id="lineage-title" className="tt-title">
        Where the trade went
      </h2>
      <p className="tt-lede">
        Every pick and player in the trade, followed to the player it became and his PAV to{' '}
        {checkpointText(story.checkpoint)}. {kept}
        {elsewhere > 0 ? `; ${formatPav(elsewhere)} went to other clubs` : ''}.
      </p>
      <ul className="tt-key" aria-label="Key">
        {story.trade.clubs.map((club) => (
          <li key={club.clubId}>
            <svg aria-hidden="true" width="26" height="10">
              <rect width="26" height="10" fill={clubStyle(club.clubName).fill} />
            </svg>
            {club.clubName}
          </li>
        ))}
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
        <li>Line thickness is PAV.</li>
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
                {kicker ? (
                  <text x={colX(at)} y={HEAD - 20} textAnchor="middle" fontSize="12" fill={MUTED}>
                    {kicker}
                  </text>
                ) : null}
                <text
                  x={colX(at)}
                  y={HEAD - 4}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="600"
                  fill={INK}
                >
                  {year}
                </text>
              </g>
            );
          })}
          <text x={BECAME_X} y={HEAD - 4} fontSize="13" fontWeight="600" fill={INK}>
            Became
          </text>
          <text x={W} y={HEAD - 4} textAnchor="end" fontSize="13" fontWeight="600" fill={INK}>
            PAV
          </text>
          <line x1={BECAME_X} y1={HEAD + 4} x2={W} y2={HEAD + 4} stroke={INK} strokeWidth="1" />

          {/* The trade, branching to each club and then to each lane. */}
          {rows.map(({ group, lanes }) => {
            const style = clubStyle(group.clubName);
            const top = lanes[0]!.y;
            const bottom = lanes.at(-1)!.y;
            const groupMid = (top + bottom) / 2;
            const trunk = Math.min(
              18,
              lanes.reduce((total, { lane }) => total + widthOf(lane.value, maxValue), 0) * 0.6
            );
            const jx = TREE_X + 60;
            return (
              <g key={group.clubId}>
                <text
                  x="0"
                  y={groupMid + 5}
                  fontSize="17"
                  fontWeight="600"
                  fill={style.fill}
                  className="tt-svg-label"
                >
                  {group.clubName} received
                </text>
                <path
                  d={`M${TREE_X},${mid} C${TREE_X + 30},${mid} ${jx - 30},${groupMid} ${jx},${groupMid}`}
                  fill="none"
                  stroke={style.fill}
                  strokeWidth={trunk}
                  strokeLinecap="round"
                />
                {lanes.map(({ lane, y: laneY }) => {
                  const pick = lane.spans[0]!.pick;
                  const w = widthOf(lane.value, maxValue);
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
                      stroke={style.fill}
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
          <text x="0" y={mid - 4} fontSize="16" fontWeight="600" fill={INK}>
            The trade
          </text>
          <text x="0" y={mid + 13} fontSize="12" fill={MUTED}>
            {story.trade.year} trade period
          </text>

          {/* Each lane through time. */}
          {rows.flatMap(({ group, lanes }) =>
            lanes.map(({ lane, y: laneY }) => (
              <TreeLaneRow
                key={lane.asset.transferId}
                lane={lane}
                y={laneY}
                w={widthOf(lane.value, maxValue)}
                colX={colX}
                stop={lane.endColumn === null ? endX : colX(lane.endColumn)}
                fill={(span) => fillFor(span.clubId, lane.receiverId, span.clubName)}
                outlined={(span) => span.clubId !== lane.receiverId && !clubIds.has(span.clubId)}
                colour={clubStyle(group.clubName).fill}
              />
            ))
          )}
        </svg>
      </div>

      <ol className="tt-list" aria-label="Every pick and player, and what it became">
        {groups.map((group) => (
          <li key={group.clubId} className="tt-group">
            <h3>
              {group.clubName} received
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
                  <span
                    aria-hidden="true"
                    className="tt-weight"
                    style={{
                      width: `${Math.max(2, (100 * Math.max(0, lane.value ?? 0)) / maxValue)}%`,
                      background: lane.player?.away
                        ? `repeating-linear-gradient(135deg, ${INK} 0 2px, ${PAPER} 2px 5px)`
                        : clubStyle(group.clubName).fill,
                    }}
                  />
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
      <p className="tt-foot">
        PAV to {checkpointText(story.checkpoint)}: what each player has given the club that drafted
        or traded for him, plus what an open stint is expected to add. Picks are named as traded;
        the number drafted at can differ.
      </p>
    </section>
  );
}
