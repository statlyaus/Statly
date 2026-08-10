import Link from 'next/link';

import type {
  DevelopmentWorkbookAcquisitionPreview as DevelopmentWorkbookAcquisitionPreviewData,
  DevelopmentWorkbookAcquisitionPreviewQuery,
} from '@/lib/draftTrades/developmentWorkbook';
import {
  AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORIES,
  AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORY_LABELS,
} from '@/server/aflTradeIntelligence/source/developmentWorkbookAcquisitionProjection';

type Props = {
  preview: DevelopmentWorkbookAcquisitionPreviewData;
  query: DevelopmentWorkbookAcquisitionPreviewQuery;
};

function filterHref(
  query: DevelopmentWorkbookAcquisitionPreviewQuery,
  category: DevelopmentWorkbookAcquisitionPreviewQuery['category']
): string {
  const params = new URLSearchParams();
  if (query.year !== null) params.set('year', String(query.year));
  if (query.club) params.set('club', query.club);
  if (query.q) params.set('q', query.q);
  if (category) params.set('acquisition', category);
  const search = params.toString();
  return search ? `/draft/outcomes?${search}` : '/draft/outcomes';
}

function valueOrUnavailable(value: string | number | null): string {
  return value === null || value === '' ? 'Not recorded' : String(value);
}

export function DevelopmentWorkbookAcquisitionPreview({ preview, query }: Props) {
  return (
    <section
      aria-labelledby="development-workbook-preview-heading"
      className="mb-6 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm"
    >
      <div className="border-b border-border bg-muted/40 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Local development source
            </p>
            <h2
              id="development-workbook-preview-heading"
              className="mt-2 text-2xl font-bold tracking-tight text-foreground"
            >
              Workbook acquisition preview
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              These rows come from the locally pinned workbook. They are separated by acquisition
              mechanism and are not a reviewed factual release, independent verification, or
              production publication.
            </p>
          </div>
          <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground">
            Development only
          </span>
        </div>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <nav
          aria-label="Filter workbook acquisitions by mechanism"
          className="flex flex-wrap gap-2"
        >
          <Link
            href={filterHref(query, null)}
            aria-current={query.category === null ? 'page' : undefined}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              query.category === null
                ? 'border-primary/30 bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            All · {Object.values(preview.categoryCounts).reduce((total, count) => total + count, 0)}
          </Link>
          {AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORIES.map((category) => (
            <Link
              key={category}
              href={filterHref(query, category)}
              aria-current={query.category === category ? 'page' : undefined}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                query.category === category
                  ? 'border-primary/30 bg-primary/10 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              {AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORY_LABELS[category]} ·{' '}
              {preview.categoryCounts[category]}
            </Link>
          ))}
        </nav>

        <form
          action="/draft/outcomes"
          method="get"
          className="grid gap-4 rounded-xl border border-border bg-background p-4 sm:grid-cols-2 lg:grid-cols-5"
          aria-label="Filter development workbook acquisitions"
        >
          <label className="text-sm font-medium text-foreground">
            Player or mechanism
            <input
              name="q"
              type="search"
              defaultValue={query.q}
              maxLength={160}
              placeholder="Search player"
              className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Club
            <input
              name="club"
              defaultValue={query.club}
              maxLength={160}
              placeholder="Any AFL club"
              className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Year
            <select
              name="year"
              defaultValue={query.year ?? ''}
              className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">All years</option>
              {preview.years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-foreground">
            Acquisition
            <select
              name="acquisition"
              defaultValue={query.category ?? ''}
              className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">All mechanisms</option>
              {AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Apply
            </button>
            <Link
              href="/draft/outcomes"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear
            </Link>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <p>
            Showing {preview.items.length.toLocaleString('en-AU')} of{' '}
            {preview.total.toLocaleString('en-AU')} matching workbook rows
          </p>
          <p>Raw workbook totals · not independently checked</p>
        </div>

        {preview.items.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {preview.items.map((item) => (
              <article
                key={item.eventId}
                className="rounded-xl border border-border bg-background p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{item.playerName}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.year} · {item.clubName}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
                      {AFL_OUTCOMES_DEVELOPMENT_ACQUISITION_CATEGORY_LABELS[item.category]}
                    </span>
                    <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground">
                      Source grade {item.grade ?? 'not recorded'}
                    </span>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Detail
                    </dt>
                    <dd className="mt-1 text-foreground">{item.signing ?? item.acquisitionType}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Pick
                    </dt>
                    <dd className="mt-1 tabular-nums text-foreground">
                      {valueOrUnavailable(item.pick ?? item.draftNumber)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Games
                    </dt>
                    <dd className="mt-1 tabular-nums text-foreground">
                      {valueOrUnavailable(item.games)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Goals
                    </dt>
                    <dd className="mt-1 tabular-nums text-foreground">
                      {valueOrUnavailable(item.goals)}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <p
            role="status"
            className="rounded-xl border border-border bg-muted/40 p-5 text-sm text-foreground"
          >
            No workbook acquisition rows match these development filters.
          </p>
        )}
      </div>
    </section>
  );
}
