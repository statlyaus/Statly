'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';

import { TeamLogo } from '@/components/TeamLogo';
import {
  draftHubHeroShellClass,
  draftHubHeroTopAccentClass,
  draftHubSkyPillClass,
  draftHubSkyPillSmClass,
  draftHubSlatePillSmClass,
} from '@/components/draft/draftHubChrome';
import type { DraftClubListItem } from '@/lib/draftTrades/contracts';

type ViewMode = 'cards' | 'table';

type TableSortKey = 'club' | 'trades' | 'assets';

type TableSort = { key: TableSortKey; dir: 'asc' | 'desc' };

function sortClubs(list: DraftClubListItem[], sort: TableSort): DraftClubListItem[] {
  const copy = [...list];
  const mult = sort.dir === 'asc' ? 1 : -1;
  copy.sort((a, b) => {
    if (sort.key === 'club') {
      return mult * a.clubName.localeCompare(b.clubName);
    }
    if (sort.key === 'trades') {
      const d = a.tradeCount - b.tradeCount;
      if (d !== 0) return mult * d;
      return a.clubName.localeCompare(b.clubName);
    }
    const d = a.assetCount - b.assetCount;
    if (d !== 0) return mult * d;
    return a.clubName.localeCompare(b.clubName);
  });
  return copy;
}

function sortSummaryLine(sort: TableSort): string {
  if (sort.key === 'club') {
    return 'Sorted A–Z by club name.';
  }
  if (sort.key === 'trades') {
    return sort.dir === 'desc'
      ? 'Sorted by trades (most first).'
      : 'Sorted by trades (fewest first).';
  }
  return sort.dir === 'desc'
    ? 'Sorted by assets (most first).'
    : 'Sorted by assets (fewest first).';
}

function yearRangeLabel(club: DraftClubListItem): string {
  if (club.firstYear && club.lastYear) {
    return `${club.firstYear}–${club.lastYear}`;
  }
  return 'Years unknown';
}

function clubLinkLabel(club: DraftClubListItem): string {
  const years = yearRangeLabel(club);
  return `${club.clubName}, ${club.tradeCount} trades, ${years}. View trade history.`;
}

const sortThBtnClass =
  'inline-flex min-h-10 w-full items-center justify-end gap-1 rounded-md px-2 py-2 text-xs font-semibold uppercase tracking-wide text-base-content/65 transition hover:bg-base-200/80 hover:text-base-content focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:min-h-0';

export function DraftClubsDirectory({ clubs }: { clubs: DraftClubListItem[] }) {
  const [view, setView] = useState<ViewMode>('table');
  const [tableSort, setTableSort] = useState<TableSort>({ key: 'club', dir: 'asc' });
  const cardsPanelId = useId();
  const tablePanelId = useId();

  const sortedClubs = useMemo(() => sortClubs(clubs, tableSort), [clubs, tableSort]);

  function toggleTradesSort() {
    setTableSort((s) =>
      s.key === 'trades'
        ? { key: 'trades', dir: s.dir === 'desc' ? 'asc' : 'desc' }
        : { key: 'trades', dir: 'desc' }
    );
  }

  function toggleAssetsSort() {
    setTableSort((s) =>
      s.key === 'assets'
        ? { key: 'assets', dir: s.dir === 'desc' ? 'asc' : 'desc' }
        : { key: 'assets', dir: 'desc' }
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="club-directory-heading">
      <header className={draftHubHeroShellClass}>
        <div className={draftHubHeroTopAccentClass} />
        <div className="flex flex-col gap-5 border-b border-info/20 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-info">
              Club lens
            </p>
            <h2
              id="club-directory-heading"
              className="mt-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl"
            >
              Club trade directory
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base">
              Browse every AFL club and open its full draft trade history—same data model as the
              season explorer.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{sortSummaryLine(tableSort)}</p>
          </div>
          <div
            className="flex shrink-0 flex-wrap gap-2 sm:justify-end"
            role="group"
            aria-label="Choose directory layout"
          >
            <button
              type="button"
              className={`btn btn-sm ${view === 'cards' ? 'btn-primary shadow-sm' : 'btn-outline bg-white/80'}`}
              aria-pressed={view === 'cards'}
              aria-controls={cardsPanelId}
              onClick={() => setView('cards')}
            >
              Cards
            </button>
            <button
              type="button"
              className={`btn btn-sm ${view === 'table' ? 'btn-primary shadow-sm' : 'btn-outline bg-white/80'}`}
              aria-pressed={view === 'table'}
              aria-controls={tablePanelId}
              onClick={() => setView('table')}
            >
              Table
            </button>
          </div>
        </div>
      </header>

      {view === 'cards' ? (
        <div id={cardsPanelId} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sortedClubs.map((club) => (
            <article
              key={club.clubSlug}
              className="rounded-2xl border border-border bg-white p-4 shadow-sm transition hover:border-border hover:bg-muted"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <Link
                  href={`/draft/clubs/${club.clubSlug}`}
                  className="group flex min-w-0 items-center gap-2 rounded-lg text-base font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  aria-label={clubLinkLabel(club)}
                >
                  <TeamLogo team={club.clubName} size={20} withCircle />
                  <span className="truncate group-hover:text-primary">{club.clubName}</span>
                </Link>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <span className={`${draftHubSkyPillClass} tabular-nums`}>
                    {club.tradeCount} trades
                  </span>
                  {club.firstYear && club.lastYear ? (
                    <span className={`${draftHubSkyPillClass} tabular-nums`}>
                      {club.firstYear}–{club.lastYear}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
                      Years TBC
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-border bg-white/85 p-3 text-center shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Assets
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-foreground">
                    {club.assetCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-white/85 p-3 text-center shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Club sides
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-foreground">
                    {club.partyCount}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">Rows as a party</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div
          id={tablePanelId}
          className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm"
          role="region"
          aria-label="Club directory as a table"
        >
          <table className="table table-sm w-full table-fixed border-collapse text-base [&_thead]:whitespace-normal [&_th]:px-4 [&_td]:px-4 [&_th]:py-3 [&_td]:py-3">
            <caption className="sr-only">
              AFL clubs with draft trade counts and year coverage. {sortSummaryLine(tableSort)} Use
              Trades and Assets column headers to change sort.
            </caption>
            <colgroup>
              <col className="min-w-48" />
              <col className="w-24" />
              <col className="w-28" />
              <col className="w-36" />
            </colgroup>
            <thead>
              <tr className="border-b border-base-200 bg-base-200/50 [&>th]:text-sm [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-base-content/65">
                <th scope="col" className="text-left">
                  Club
                </th>
                <th
                  scope="col"
                  className="p-0 text-right align-bottom tabular-nums"
                  aria-sort={
                    tableSort.key === 'trades'
                      ? tableSort.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className={sortThBtnClass}
                    onClick={toggleTradesSort}
                    aria-label={
                      tableSort.key === 'trades'
                        ? `Trades column, sorted ${tableSort.dir === 'desc' ? 'high to low' : 'low to high'}. Click to reverse.`
                        : 'Sort by trades, highest first'
                    }
                  >
                    Trades
                    {tableSort.key === 'trades' ? (
                      <span className="text-base-content/80" aria-hidden="true">
                        {tableSort.dir === 'desc' ? '↓' : '↑'}
                      </span>
                    ) : null}
                  </button>
                </th>
                <th
                  scope="col"
                  className="p-0 text-right align-bottom tabular-nums"
                  aria-sort={
                    tableSort.key === 'assets'
                      ? tableSort.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className={sortThBtnClass}
                    onClick={toggleAssetsSort}
                    aria-label={
                      tableSort.key === 'assets'
                        ? `Assets column, sorted ${tableSort.dir === 'desc' ? 'high to low' : 'low to high'}. Click to reverse.`
                        : 'Sort by assets, highest first'
                    }
                  >
                    Assets
                    {tableSort.key === 'assets' ? (
                      <span className="text-base-content/80" aria-hidden="true">
                        {tableSort.dir === 'desc' ? '↓' : '↑'}
                      </span>
                    ) : null}
                  </button>
                </th>
                <th scope="col" className="text-right tabular-nums">
                  Years
                </th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-b [&>tr]:border-base-200/80 [&>tr:last-child]:border-b-0">
              {sortedClubs.map((club) => (
                <tr key={club.clubSlug} className="hover">
                  <td className="min-w-0 align-middle">
                    <div className="flex items-center gap-2">
                      <TeamLogo team={club.clubName} size={16} withCircle />
                      <Link
                        href={`/draft/clubs/${club.clubSlug}`}
                        className="link link-hover font-medium"
                        aria-label={clubLinkLabel(club)}
                      >
                        {club.clubName}
                      </Link>
                    </div>
                  </td>
                  <td className="align-middle">
                    <div className="flex justify-end">
                      <span className={draftHubSkyPillSmClass}>{club.tradeCount}</span>
                    </div>
                  </td>
                  <td className="align-middle">
                    <div className="flex justify-end">
                      <span className={draftHubSlatePillSmClass}>{club.assetCount}</span>
                    </div>
                  </td>
                  <td className="align-middle">
                    <div className="flex justify-end">
                      {club.firstYear && club.lastYear ? (
                        <span className={draftHubSkyPillSmClass}>
                          {club.firstYear}–{club.lastYear}
                        </span>
                      ) : (
                        <span className={draftHubSlatePillSmClass}>—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
