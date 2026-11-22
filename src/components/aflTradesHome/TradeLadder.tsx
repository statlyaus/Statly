'use client';

import { useState } from 'react';
import Link from 'next/link';

import { formatSigned } from '@/components/aflTradeStory/tradePageModel';
import {
  combineLadders,
  tradesListHref,
  type TradeLadderRow,
} from '@/components/aflTradeStory/tradesListQuery';
import { chipStyles } from '@/components/ui/controlStyles';
import StatlyIcon from '@/components/ui/StatlyIcon';
import { clubSquareBackground } from '@/lib/clubGuernseys';
import { getTeamAbbreviation } from '@/lib/teamLogos';

/**
 * The trade ladder on the front page (owner, 2026-11-22): every club's combined result from the
 * trades of the years picked on the strip, ranked like an AFL ladder. W–L counts the trades a club is
 * ahead and behind on so far, Win % is W ÷ (W + L), and PAV +/− is what it got back minus what it
 * gave away. Years are picked in the browser so the cached page stays one page.
 */

type SortKey = 'wl' | 'pct' | 'net';
const SORT_LABEL: Record<SortKey, string> = { wl: 'W–L so far', pct: 'Win %', net: 'PAV +/−' };

const winShare = ({ ahead, behind }: TradeLadderRow) =>
  ahead + behind > 0 ? ahead / (ahead + behind) : null;
const SORT_VALUE: Record<SortKey, (row: TradeLadderRow) => number | null> = {
  wl: ({ ahead, behind }) => ahead - behind,
  pct: winShare,
  net: ({ net }) => net,
};

/** Rows in the chosen order; a club with no decided trade has no Win % and goes last. */
function sortRows(rows: readonly TradeLadderRow[], key: SortKey, dir: 1 | -1) {
  const value = SORT_VALUE[key];
  return [...rows].sort((left, right) => {
    const [a, b] = [value(left), value(right)];
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return dir * (a - b) || right.net - left.net || left.name.localeCompare(right.name);
  });
}

const percent = (row: TradeLadderRow) => {
  const share = winShare(row);
  return share === null ? '–' : `${Math.round(share * 100)}%`;
};

const ROW =
  'grid grid-cols-[2ch_minmax(0,1fr)_5.5ch_4.5ch_7.5ch] items-center gap-x-2 gap-y-1.5 px-1 py-2 sm:grid-cols-[2ch_minmax(10rem,auto)_6.5ch_5ch_minmax(5rem,1fr)_8ch] sm:gap-x-4';

export function TradeLadder({
  years,
}: {
  years: readonly { readonly year: number; readonly rows: readonly TradeLadderRow[] }[];
}) {
  const everyYear = years.map(({ year }) => year);
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set(everyYear));
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'net', dir: -1 });
  const all = picked.size === everyYear.length;

  // From every year, the first tap shows just that year; after that a tap adds or drops a year, and
  // dropping the last one goes back to every year.
  const toggle = (year: number) =>
    setPicked((current) => {
      if (current.size === everyYear.length) return new Set([year]);
      const next = new Set(current);
      if (!next.delete(year)) next.add(year);
      return next.size === 0 ? new Set(everyYear) : next;
    });
  const sortBy = (key: SortKey) =>
    setSort((current) => ({ key, dir: current.key === key ? (-current.dir as 1 | -1) : -1 }));

  const rows = sortRows(
    combineLadders(years.filter(({ year }) => picked.has(year)).map(({ rows }) => rows)),
    sort.key,
    sort.dir
  );
  const up = Math.max(0, ...rows.map(({ net }) => net));
  const down = Math.max(0, ...rows.map(({ net }) => -net));
  const scale = Math.max(1, up + down);
  const zero = (down / scale) * 100;
  // The heavy line between gaining and losing clubs means something only in PAV order.
  const lastAhead =
    sort.key === 'net' && sort.dir === -1 ? rows.findIndex(({ net }) => net < 0) - 1 : -2;
  const onlyYear = !all && picked.size === 1 ? [...picked][0]! : null;
  const shownYears = all ? 'every year' : [...picked].sort().join(', ');
  const order = sort.dir === -1 ? 'highest first' : 'lowest first';

  return (
    <section aria-labelledby="trade-ladder" className="flex flex-col gap-5">
      <h2
        id="trade-ladder"
        className="flex items-end gap-3 border-b-4 border-foreground pb-3 font-display text-5xl leading-none font-extrabold sm:text-6xl"
      >
        <StatlyIcon name="ladder" className="size-10 sm:size-12" strokeWidth={2.5} />
        The trade ladder
      </h2>

      <div role="group" aria-label="Trade years" className="flex flex-wrap items-stretch gap-2">
        <button
          type="button"
          aria-pressed={all}
          onClick={() => setPicked(new Set(everyYear))}
          className={chipStyles({ picked: all })}
        >
          All years
        </button>
        <div className="grid min-w-0 flex-[1_1_14rem] auto-cols-fr grid-flow-col overflow-hidden rounded-cut border-[2.5px] border-foreground">
          {everyYear.map((year) => {
            const on = !all && picked.has(year);
            return (
              <button
                key={year}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(year)}
                className={`min-h-11 border-l-[1.5px] border-foreground font-display text-xs font-bold tabular-nums first:border-l-0 sm:text-sm focus-visible:outline-[3px] focus-visible:outline-offset-[-5px] focus-visible:outline-ring focus-visible:outline-dashed ${
                  on
                    ? 'bg-warning text-warning-foreground'
                    : 'bg-card text-foreground hover:bg-muted'
                }`}
              >
                {year}
              </button>
            );
          })}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {`Trades from ${shownYears}, by ${SORT_LABEL[sort.key]}, ${order}.`}
      </p>

      <div className="tabular-nums">
        <div className={`${ROW} border-b-2 border-foreground pt-0`}>
          <span />
          <span className="font-display text-xs font-bold text-muted-foreground">Club</span>
          {(['wl', 'pct'] as const).map((key) => (
            <SortButton key={key} sortKey={key} sort={sort} onSort={sortBy} align="center" />
          ))}
          <span className="hidden sm:block" />
          <SortButton sortKey="net" sort={sort} onSort={sortBy} align="end" />
        </div>
        <ol>
          {rows.map((row, index) => {
            const width = (Math.abs(row.net) / scale) * 100;
            const left = row.net >= 0 ? zero : zero - width;
            const signed = `${formatSigned(row.net)}${row.provisional ? '*' : ''}`;
            return (
              <li
                key={row.clubId}
                className={
                  index === lastAhead
                    ? 'border-b-2 border-foreground'
                    : 'border-b border-foreground/15'
                }
              >
                <Link
                  href={tradesListHref({ year: onlyYear, club: row.slug, sort: 'newest' })}
                  prefetch={false}
                  className={`${ROW} hover:bg-muted focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-ring focus-visible:outline-dashed`}
                >
                  <span className="text-right text-muted-foreground">{index + 1}</span>
                  <span className="flex min-w-0 items-center gap-2 font-display font-bold whitespace-nowrap">
                    <span
                      aria-hidden="true"
                      data-club-square=""
                      className="size-[13px] flex-none border border-foreground"
                      style={{ background: clubSquareBackground(row.name) }}
                    />
                    <span className="hidden truncate sm:inline">{row.name}</span>
                    <span className="sm:hidden">{getTeamAbbreviation(row.name)}</span>
                  </span>
                  <span className="text-center whitespace-nowrap">
                    {row.ahead}–{row.behind}
                    <span className="sr-only"> so far,</span>
                  </span>
                  <span className="text-center">
                    {percent(row)}
                    <span className="sr-only">
                      {winShare(row) === null ? ' (no trades decided),' : ' won,'}
                    </span>
                  </span>
                  <span className="relative col-[2/-1] row-start-2 h-1.5 sm:col-auto sm:row-auto sm:h-3">
                    <span
                      className="absolute -inset-y-1 w-[1.5px] bg-foreground sm:-inset-y-2"
                      style={{ left: `${zero}%` }}
                    />
                    <span
                      className={`absolute inset-y-0 motion-safe:transition-[left,width] motion-safe:duration-300 ${
                        row.net >= 0 ? 'bg-primary' : 'bg-foreground'
                      }`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  </span>
                  <span className="text-right font-semibold whitespace-nowrap">
                    {signed}
                    <span className="sr-only">
                      {` PAV${row.provisional ? ', part not valued yet' : ''}. See its trades.`}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>

      {rows.some(({ provisional }) => provisional) ? (
        <p className="text-sm text-muted-foreground">
          * Part of these trades isn’t valued yet, so it’s left out.
        </p>
      ) : null}
    </section>
  );
}

function SortButton({
  sortKey,
  sort,
  onSort,
  align,
}: {
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  align: 'center' | 'end';
}) {
  const on = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`flex min-h-8 items-center font-display text-xs font-bold whitespace-nowrap ${
        align === 'end' ? 'justify-end' : 'justify-center'
      } ${on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'} focus-visible:outline-[3px] focus-visible:outline-ring focus-visible:outline-dashed`}
    >
      {SORT_LABEL[sortKey]}
      <span aria-hidden="true" className="inline-block w-[1ch]">
        {on ? (sort.dir === -1 ? '↓' : '↑') : ''}
      </span>
      <span className="sr-only">
        {on ? `, sorted ${sort.dir === -1 ? 'highest' : 'lowest'} first` : ', sort by this'}
      </span>
    </button>
  );
}
