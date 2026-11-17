import type { CSSProperties } from 'react';

import Link from 'next/link';

import { STORY_COLLAGE_CLASS } from '@/components/aflStories/CameronMasthead';
import { clubStyle, formatSigned } from '@/components/aflTradeStory/tradePageModel';
import { tradesListHref, type TradeLadderRow } from '@/components/aflTradeStory/tradesListQuery';

import './towerLadder.css';

/**
 * The trade ladder as a row of ground light towers (owner, 2026-11-18: "light towers"). Each club's
 * combined PAV is one lattice tower in its colours: clubs ahead stand on the turf with their lamps
 * lit, clubs behind are sunk into the soil below it with their lamps off. Heights share one scale.
 */

/** One lattice mast, base at the bottom: two tapering rails, a strut and a cross brace per section. */
function Mast({ len, colour }: { len: number; colour: string }) {
  const sections = Math.max(2, Math.round((len * 600) / 16));
  const height = sections * 12;
  const left = (y: number) => 34 - 28 * (y / height);
  const right = (y: number) => 66 + 28 * (y / height);
  const ys = Array.from({ length: sections + 1 }, (_, k) => height - k * 12);
  const zig = ys.map((y, k) => `${k % 2 ? right(y) : left(y)},${y}`).join(' ');
  const zag = ys.map((y, k) => `${k % 2 ? left(y) : right(y)},${y}`).join(' ');
  const struts = ys.map((y) => `M${left(y)} ${y}H${right(y)}`).join('');
  return (
    <svg
      className="tl-mast"
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      focusable="false"
    >
      <g fill="none" stroke={colour} vectorEffect="non-scaling-stroke">
        <path
          d={`M6 ${height}L34 0M94 ${height}L66 0`}
          strokeWidth="2.4"
          vectorEffect="non-scaling-stroke"
        />
        <path d={struts} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <polyline points={zig} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <polyline points={zag} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

function Tower({
  row,
  place,
  index,
  scale,
}: {
  row: TradeLadderRow;
  place: number;
  index: number;
  scale: number;
}) {
  const lit = row.net >= 0;
  const len = Math.abs(row.net) / scale;
  const { abbreviation, fill, trim } = clubStyle(row.name);
  return (
    <li>
      <Link
        href={tradesListHref({ year: null, club: row.slug, sort: 'newest' })}
        className={`tl-col ${lit ? 'tl-lit' : 'tl-sunk'}`}
        aria-label={`${place}. ${row.name}, ${formatSigned(row.net)} PAV${row.provisional ? ', still moving' : ''}: ahead on ${row.ahead} trades, behind on ${row.behind}. See its trades.`}
        style={
          {
            '--tl-len': len,
            '--tl-i': index,
            '--tl-fill': fill,
            '--tl-trim': trim,
          } as CSSProperties
        }
      >
        <span className="tl-tower" aria-hidden="true">
          <span className="tl-head" />
          <Mast len={len} colour={fill} />
        </span>
        <span className="tl-val" aria-hidden="true">
          {formatSigned(row.net)}
          {row.provisional ? '*' : ''}
        </span>
        <span className="tl-club" aria-hidden="true">
          <b>{abbreviation}</b>
          <span>
            {row.ahead}–{row.behind}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function TowerLadder({
  ladder,
  firstYear,
}: {
  ladder: readonly TradeLadderRow[];
  firstYear: number | undefined;
}) {
  const up = Math.max(0, ...ladder.map(({ net }) => net));
  const down = Math.max(0, ...ladder.map(({ net }) => -net));
  const scale = Math.max(1, up + down);
  const top = ladder[0];
  const bottom = ladder.at(-1);
  const anyProvisional = ladder.some(({ provisional }) => provisional);

  return (
    <section aria-labelledby="trade-ladder" className={STORY_COLLAGE_CLASS}>
      <div className="sc-wrap tl">
        <div className="tl-head-row">
          <h2 id="trade-ladder" className="tl-title">
            The trade ladder
          </h2>
          <p className="tl-lede">
            Every club’s combined result from every trade since {firstYear}, in PAV. {top?.name} is{' '}
            {formatSigned(top?.net ?? 0)} in front. {bottom?.name} is{' '}
            {formatSigned(bottom?.net ?? 0)}. Pick a club to see its trades.
          </p>
        </div>

        <div
          className="tl-scene"
          style={
            {
              '--tl-up': up / scale,
              '--tl-down': down / scale,
              '--tl-n': ladder.length,
            } as CSSProperties
          }
        >
          <span className="tl-sky" aria-hidden="true" />
          <span className="tl-turf" aria-hidden="true" />
          <span className="tl-soil" aria-hidden="true" />
          <p className="tl-note tl-note-sky" aria-hidden="true">
            Lit towers have got more from their trades than they gave away.
          </p>
          <p className="tl-note tl-note-soil" aria-hidden="true">
            Sunk, lights off: given away more than they got back.
          </p>
          <ol className="tl-cols">
            {ladder.map((row, index) => (
              <Tower key={row.clubId} row={row} place={index + 1} index={index} scale={scale} />
            ))}
          </ol>
        </div>

        {anyProvisional ? (
          <p className="tl-foot">
            * Includes a trade with a value not in yet, so this total will move.
          </p>
        ) : null}
      </div>
    </section>
  );
}
