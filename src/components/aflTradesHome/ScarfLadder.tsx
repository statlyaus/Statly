import type { CSSProperties } from 'react';

import Link from 'next/link';

import { STORY_COLLAGE_CLASS } from '@/components/aflStories/CameronMasthead';
import { clubStyle, formatSigned } from '@/components/aflTradeStory/tradePageModel';
import { tradesListHref, type TradeLadderRow } from '@/components/aflTradeStory/tradesListQuery';
import { guernseyFor } from '@/lib/clubGuernseys';

import './scarfLadder.css';

/**
 * The trade ladder as club scarves on a taped line (owner, 2026-11-17: "scarves on a line"). Each
 * club's combined PAV is one barred scarf in its colours: ahead clubs hold theirs up above the line,
 * behind clubs hang below it. Lengths share one scale. On a narrow screen the line turns upright and
 * the scarves lie across it, one club per row.
 */

/** The scarf's bars: the club's main colour, its trim, and a third colour where the jumper has one. */
function scarfBars(clubName: string): string {
  const { fill, trim } = clubStyle(clubName);
  const accent = guernseyFor(clubName).accent;
  const bars = accent
    ? `${fill} 0 16px, ${trim} 16px 22px, ${accent} 22px 28px, ${trim} 28px 34px`
    : `${fill} 0 20px, ${trim} 20px 30px`;
  return `repeating-linear-gradient(var(--sl-dir), ${bars})`;
}

/** A small hand-placed tilt for each scarf, the same on every render. */
const tilt = (index: number) => `${(((index * 37) % 7) - 3) * 0.45}deg`;

function Scarf({
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
  const ahead = row.net >= 0;
  const value = `${formatSigned(row.net)}${row.provisional ? '*' : ''}`;
  const { abbreviation, fill } = clubStyle(row.name);
  return (
    <li>
      <Link
        href={tradesListHref({ year: null, club: row.slug, sort: 'newest' })}
        className={`sl-col ${ahead ? 'sl-ahead' : 'sl-behind'}`}
        aria-label={`${place}. ${row.name}, ${formatSigned(row.net)} PAV${row.provisional ? ', still moving' : ''}: ahead on ${row.ahead} trades, behind on ${row.behind}. See its trades.`}
        style={
          {
            '--sl-len': Math.abs(row.net) / scale,
            '--sl-tilt': tilt(index),
            '--sl-i': index,
            '--sl-fringe': fill,
          } as CSSProperties
        }
      >
        <span className="sl-club" aria-hidden="true">
          <span className="sc-label">{abbreviation}</span>
          <span className="sl-record">
            {row.ahead}–{row.behind}
          </span>
        </span>
        <span className="sl-bar" aria-hidden="true">
          <span className="sl-scarf" style={{ backgroundImage: scarfBars(row.name) }} />
        </span>
        <span className="sl-val sc-hand" aria-hidden="true">
          {value}
        </span>
      </Link>
    </li>
  );
}

export function ScarfLadder({
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
      <div className="sc-wrap sl">
        <div className="sl-head">
          <h2 id="trade-ladder" className="sl-title sc-marker">
            The trade <span className="sc-tornB">ladder</span>
          </h2>
          <p className="sl-lede">
            Every club’s combined result from every trade since {firstYear}, in PAV, drawn as its
            scarf. {top?.name} is {formatSigned(top?.net ?? 0)} in front. {bottom?.name} is{' '}
            {formatSigned(bottom?.net ?? 0)}. Pick a club to see its trades.
          </p>
        </div>

        <div
          className="sl-chart"
          style={{ '--sl-up': up / scale, '--sl-down': down / scale } as CSSProperties}
        >
          <p className="sl-axis sc-label" aria-hidden="true">
            <span>Behind</span>
            <span>Ahead</span>
          </p>
          <span className="sl-line" aria-hidden="true">
            <span className="sc-tape sl-tape sl-tape-start" />
            <span className="sc-tape sl-tape sl-tape-end" />
          </span>
          <p className="sl-note sl-note-up sc-hand" aria-hidden="true">
            Above the line, a club has got more from its trades than it gave away.
          </p>
          <p className="sl-note sl-note-down sc-hand" aria-hidden="true">
            Below it, a club has given away more than it got back.
          </p>
          <ol className="sl-cols" style={{ '--sl-n': ladder.length } as CSSProperties}>
            {ladder.map((row, index) => (
              <Scarf key={row.clubId} row={row} place={index + 1} index={index} scale={scale} />
            ))}
          </ol>
        </div>

        {anyProvisional ? (
          <p className="sl-foot">
            * Includes a trade with a value not in yet, so this total will move.
          </p>
        ) : null}
      </div>
    </section>
  );
}
