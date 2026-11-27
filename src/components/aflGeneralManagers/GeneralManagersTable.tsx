'use client';

import { useState } from 'react';

import { formatSigned } from '@/components/aflTradeStory/tradePageModel';
import type { GeneralManagerLadderRow } from './generalManagerLadder';
import { clubSquareBackground } from '@/lib/clubGuernseys';
import { getTeamAbbreviation } from '@/lib/teamLogos';

/**
 * The general managers table: by PAV +/− (the club's whole net) unless the reader picks per trade
 * (owner, 2026-11-27). A second press on the sorted column turns it round.
 */

type SortKey = 'net' | 'perDeal';
const SORT_LABEL: Record<SortKey, string> = { net: 'PAV +/−', perDeal: 'Per trade' };
type Sort = { readonly key: SortKey; readonly dir: 1 | -1 };

const focusRing =
  'focus-visible:outline-[3px] focus-visible:outline-ring focus-visible:outline-dashed';

function sortRows(rows: readonly GeneralManagerLadderRow[], { key, dir }: Sort) {
  return [...rows].sort(
    (left, right) =>
      dir * (left[key] - right[key]) ||
      right.net - left.net ||
      left.person.localeCompare(right.person)
  );
}

export function GeneralManagersTable({ rows }: { rows: readonly GeneralManagerLadderRow[] }) {
  const [sort, setSort] = useState<Sort>({ key: 'net', dir: -1 });
  const sortBy = (key: SortKey) =>
    setSort((current) => ({ key, dir: current.key === key ? (-current.dir as 1 | -1) : -1 }));
  const sorted = sortRows(rows, sort);
  const order = sort.dir === -1 ? 'highest' : 'lowest';

  return (
    <table className="w-full border-collapse text-left text-sm tabular-nums sm:text-base">
      <caption className="sr-only">
        {`General managers of football, by ${SORT_LABEL[sort.key]}, ${order} first`}
      </caption>
      <thead>
        <tr className="border-b-2 border-foreground font-display text-xs font-bold text-muted-foreground">
          <th scope="col" className="w-[3ch] px-1 py-2 text-right">
            #
          </th>
          <th scope="col" className="px-1 py-2 sm:px-2">
            General manager
          </th>
          <th scope="col" className="px-1 py-2 sm:px-2">
            Club
          </th>
          <th scope="col" className="hidden px-1 py-2 sm:px-2 sm:table-cell">
            Trade years
          </th>
          <th scope="col" className="px-1 py-2 sm:px-2 text-right">
            Trades
          </th>
          <SortHeader sortKey="perDeal" sort={sort} onSort={sortBy} />
          <SortHeader sortKey="net" sort={sort} onSort={sortBy} />
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, index) => (
          <tr key={`${row.person}|${row.club}`} className="border-b border-foreground/15">
            <td className="px-1 py-2 text-right text-muted-foreground">{index + 1}</td>
            <th scope="row" className="px-1 py-2 sm:px-2 font-display font-bold">
              {row.person}
              {row.unconfirmed ? (
                <>
                  <span aria-hidden="true">*</span>
                  <span className="sr-only"> (dates in the role not confirmed yet)</span>
                </>
              ) : null}
            </th>
            <td className="px-1 py-2 sm:px-2">
              <span className="flex items-center gap-1.5 whitespace-nowrap sm:gap-2">
                <span
                  aria-hidden="true"
                  data-club-square=""
                  className="size-[13px] flex-none border border-foreground"
                  style={{ background: clubSquareBackground(row.club) }}
                />
                <span className="hidden sm:inline">{row.club}</span>
                <abbr title={row.club} className="no-underline sm:hidden">
                  {getTeamAbbreviation(row.club)}
                </abbr>
              </span>
            </td>
            <td className="hidden px-1 py-2 sm:px-2 whitespace-nowrap sm:table-cell">
              {row.firstYear === row.lastYear ? row.firstYear : `${row.firstYear}–${row.lastYear}`}
            </td>
            <td className="px-1 py-2 sm:px-2 text-right">{row.deals}</td>
            <td
              className={`px-1 py-2 sm:px-2 text-right ${sort.key === 'perDeal' ? 'font-semibold' : ''}`}
            >
              {formatSigned(row.perDeal)}
            </td>
            <td
              className={`px-1 py-2 sm:px-2 text-right ${sort.key === 'net' ? 'font-semibold' : ''}`}
            >
              {formatSigned(row.net)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SortHeader({
  sortKey,
  sort,
  onSort,
}: {
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  const on = sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={on ? (sort.dir === -1 ? 'descending' : 'ascending') : undefined}
      className="px-1 py-0 text-right sm:px-2"
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`ml-auto flex min-h-11 items-center justify-end text-right sm:whitespace-nowrap ${
          on ? 'text-foreground' : 'hover:text-foreground'
        } ${focusRing}`}
      >
        {SORT_LABEL[sortKey]}
        <span aria-hidden="true" className="inline-block w-[1ch]">
          {on ? (sort.dir === -1 ? '↓' : '↑') : ''}
        </span>
      </button>
    </th>
  );
}
