'use client';

import { useDeferredValue, useId, useMemo, useState } from 'react';
import Link from 'next/link';

import { DraftTeamLogo } from '@/components/draft/DraftHubState';
import {
  draftHubHeroShellClass,
  draftHubHeroTopAccentClass,
  draftHubSkyPillClass,
} from '@/components/draft/draftHubChrome';
import type { DraftClubTradeRefRow } from '@/lib/draftTrades/contracts';
import { filterClubTradeRefs } from '@/lib/draftTrades/clubTradeRefSearch';

function clubLinkLabel(ref: DraftClubTradeRefRow): string {
  return `${ref.title} (${ref.year}). View trade detail.`;
}

export function DraftClubTradeHistory({
  clubSlug,
  clubName,
  refs,
  exportYear,
}: {
  clubSlug: string;
  clubName: string;
  refs: DraftClubTradeRefRow[];
  exportYear: number | null;
}) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const searchId = useId();

  const filtered = useMemo(() => filterClubTradeRefs(refs, deferredQuery), [refs, deferredQuery]);

  const yearSpan = useMemo(() => {
    if (refs.length === 0) return null;
    const years = refs.map((r) => r.year);
    return { min: Math.min(...years), max: Math.max(...years) };
  }, [refs]);

  const exportHref =
    exportYear != null
      ? `/api/draft-trades/export?club=${encodeURIComponent(clubSlug)}&year=${encodeURIComponent(String(exportYear))}`
      : `/api/draft-trades/export?club=${encodeURIComponent(clubSlug)}&year=`;

  return (
    <section className="space-y-6">
      <div className={draftHubHeroShellClass}>
        <div className={draftHubHeroTopAccentClass} />
        <div className="mb-5 flex flex-col gap-5 border-b border-info/20 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-info">
              Club trade history
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <DraftTeamLogo team={clubName} size={36} withCircle />
              <h2 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                {clubName}
              </h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Every recorded draft trade involving {clubName}. Search by title, year, pick text, or
              trade id—then open a row for the full breakdown on the trade page.
            </p>
            <nav
              className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
              aria-label="Draft hub"
            >
              <Link
                href="/draft/trades"
                className="link font-medium text-info no-underline hover:underline"
              >
                All trades
              </Link>
              <span className="text-muted-foreground" aria-hidden="true">
                ·
              </span>
              <Link
                href="/draft/clubs"
                className="link font-medium text-info no-underline hover:underline"
              >
                Club directory
              </Link>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <a href={exportHref} className="btn btn-primary btn-sm shadow-sm">
              Export latest year
            </a>
            <span className={`${draftHubSkyPillClass} tabular-nums`}>{refs.length} trades</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Trades on file
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
              {refs.length}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Rows in this club&apos;s history (newest year first).
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Year span
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
              {yearSpan ? `${yearSpan.min}–${yearSpan.max}` : '—'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Coverage in the current dataset.</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Export anchor year
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
              {exportYear ?? '—'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Used for the CSV export shortcut (latest season in list).
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-2xl border border-border bg-card p-4">
          <label className="form-control w-full max-w-2xl" htmlFor={searchId}>
            <span className="label-text text-sm font-medium">Search</span>
            <input
              id={searchId}
              type="search"
              className="input input-bordered input-sm w-full"
              placeholder="Title, year, pick text, trade id…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {filtered.length === refs.length
              ? 'Showing all rows.'
              : `Showing ${filtered.length} of ${refs.length} rows.`}
            {filtered.length === 0 && refs.length > 0 ? ' Try fewer or different keywords.' : ''}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-base-content/70">
          <span className="badge badge-outline">{filtered.length} results</span>
          <span className="badge badge-primary badge-outline">{clubName}</span>
          {query.trim() ? (
            <span className="badge badge-neutral badge-outline">Query: {query.trim()}</span>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {filtered.map((ref) => (
          <article
            key={`card-${ref.tradeId}`}
            className="rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-border hover:bg-muted"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground tabular-nums">
                {ref.year}
              </span>
              <span className="badge badge-ghost badge-sm">#{ref.seqInYear}</span>
            </div>
            <h3 className="mt-2 text-lg font-semibold leading-tight text-foreground">
              <Link
                href={`/draft/trades/${ref.tradeId}`}
                className="link link-hover"
                aria-label={clubLinkLabel(ref)}
              >
                {ref.title}
              </Link>
            </h3>
            <p className="mt-2 text-sm leading-snug text-muted-foreground">
              {ref.assetsRaw || 'No raw club return recorded.'}
            </p>
            <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <span>
                Expected:{' '}
                <span className="font-medium tabular-nums text-foreground">
                  {ref.expected ?? '—'}
                </span>
              </span>
              <span>
                Actual:{' '}
                <span className="font-medium tabular-nums text-foreground">{ref.actual ?? '—'}</span>
              </span>
            </div>
          </article>
        ))}
        {filtered.length === 0 && refs.length > 0 && (
          <div className="rounded-2xl border border-base-300 bg-base-100 py-10 text-center text-sm text-base-content/70 shadow-sm">
            No rows match your search.
          </div>
        )}
      </div>

      <div className="hidden md:block">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Trade index
            </p>
            <h3 className="text-xl font-semibold text-foreground">Scan this club</h3>
            <p className="text-sm text-muted-foreground">
              Newest season first. Click a trade title for the full page.
            </p>
          </div>
          <div className="rounded-full border border-border bg-background px-3 py-1 text-sm text-muted-foreground shadow-sm">
            {filtered.length} visible
          </div>
        </div>

        {filtered.length === 0 && refs.length > 0 ? (
          <div className="rounded-2xl border border-base-300 bg-base-100 py-14 text-center text-sm text-base-content/70 shadow-sm">
            <p>No rows match your search.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="table table-sm w-full border-collapse text-base [&_thead]:whitespace-normal [&_th]:px-4 [&_td]:px-4 [&_th]:py-3 [&_td]:py-3">
              <thead>
                <tr className="border-b border-border bg-muted [&>th]:text-xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground">
                  <th scope="col" className="text-left">
                    Year
                  </th>
                  <th scope="col" className="text-left tabular-nums">
                    #
                  </th>
                  <th scope="col" className="text-left">
                    Trade
                  </th>
                  <th scope="col" className="text-left">
                    Club return (raw)
                  </th>
                  <th scope="col" className="text-right tabular-nums">
                    Expected
                  </th>
                  <th scope="col" className="text-right tabular-nums">
                    Actual
                  </th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-b [&>tr]:border-border [&>tr:last-child]:border-b-0">
                {filtered.map((ref) => (
                  <tr key={ref.tradeId} className="hover:bg-muted">
                    <td className="tabular-nums text-foreground">{ref.year}</td>
                    <td className="tabular-nums text-foreground">{ref.seqInYear}</td>
                    <td className="max-w-[min(28rem,40vw)]">
                      <Link
                        href={`/draft/trades/${ref.tradeId}`}
                        className="link font-medium text-foreground no-underline hover:underline"
                        aria-label={clubLinkLabel(ref)}
                      >
                        {ref.title}
                      </Link>
                    </td>
                    <td className="min-w-48 text-sm text-muted-foreground">{ref.assetsRaw || '—'}</td>
                    <td className="text-right tabular-nums text-foreground">
                      {ref.expected ?? '—'}
                    </td>
                    <td className="text-right tabular-nums text-foreground">{ref.actual ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
