import Link from 'next/link';

import { aflDraftTradeOutcomeAcquisitionKey } from '@/types/aflDraftTradeOutcomes';
import type {
  AflDraftTradeOutcomeCheckStatus,
  AflDraftTradeOutcomeListResponse,
  AflDraftTradeOutcomeMetric,
  AflDraftTradeOutcomeMetricCheck,
} from '@/types/aflDraftTradeOutcomes';

type OutcomeQuery = {
  year: number | null;
  club: string;
  q: string;
  metric: AflDraftTradeOutcomeMetric | null;
  status: AflDraftTradeOutcomeCheckStatus | null;
  cursor: string | null;
};

type Props = {
  response: AflDraftTradeOutcomeListResponse;
  query: OutcomeQuery;
  filterNotice?: string | null;
};

const statusLabel: Record<AflDraftTradeOutcomeCheckStatus, string> = {
  matched: 'Matches source',
  different: 'Difference found',
  recorded_only: 'Recorded only',
  source_only: 'Observed only',
  partial: 'Partial coverage',
  unavailable: 'Not checked',
};

const statusClass: Record<AflDraftTradeOutcomeCheckStatus, string> = {
  matched: 'border-primary/30 bg-primary/10 text-foreground',
  different: 'border-destructive/30 bg-destructive/10 text-destructive',
  recorded_only: 'border-border bg-muted text-foreground',
  source_only: 'border-border bg-muted text-foreground',
  partial: 'border-border bg-muted text-foreground',
  unavailable: 'border-border bg-background text-muted-foreground',
};

function formatMetricValue(value: number | null, unit: string): string {
  if (value === null) return 'Not available';
  return `${value.toLocaleString('en-AU')} ${unit}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeZone: 'Australia/Melbourne',
  }).format(new Date(value));
}

function nextPageHref(query: OutcomeQuery, cursor: string): string {
  const params = new URLSearchParams();
  if (query.year !== null) params.set('year', String(query.year));
  if (query.club) params.set('club', query.club);
  if (query.q) params.set('q', query.q);
  if (query.metric) params.set('metric', query.metric);
  if (query.status) params.set('status', query.status);
  params.set('cursor', cursor);
  return `/draft/outcomes?${params.toString()}`;
}

function MetricCheck({ check, unit }: { check: AflDraftTradeOutcomeMetricCheck; unit: string }) {
  return (
    <article className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{check.metric.replaceAll('_', ' ')}</p>
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass[check.status]}`}
        >
          {statusLabel[check.status]}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recorded
          </dt>
          <dd className="mt-1 font-semibold tabular-nums text-foreground">
            {formatMetricValue(check.recordedValue, unit)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Observed
          </dt>
          <dd className="mt-1 font-semibold tabular-nums text-foreground">
            {formatMetricValue(check.observedValue, unit)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{check.message}</p>
      {check.scopeLabel ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">Scope:</span> {check.scopeLabel}
        </p>
      ) : null}
      {check.delta !== null && check.status === 'different' ? (
        <p className="mt-2 text-xs font-semibold tabular-nums text-destructive">
          Difference: {check.delta > 0 ? '+' : ''}
          {check.delta.toLocaleString('en-AU')} {unit}
        </p>
      ) : null}
      {check.coverageRatio !== null && check.coverageRatio < 1 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Coverage: {(check.coverageRatio * 100).toFixed(0)}%
        </p>
      ) : null}
      {check.effectiveThrough ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Checked through{' '}
          <time dateTime={check.effectiveThrough}>{formatDate(check.effectiveThrough)}</time>
        </p>
      ) : null}
      {check.sources.length > 0 ? (
        <details className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <summary className="min-h-11 cursor-pointer py-3 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Evidence used ({check.sources.length})
          </summary>
          <ul className="space-y-2 pb-1">
            {check.sources.map((source) => (
              <li key={`${source.role}-${source.artifactId}`}>
                <span className="font-semibold capitalize text-foreground">{source.role}:</span>{' '}
                {source.locator}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

export function AflDraftTradeOutcomesExplorer({ response, query, filterNotice = null }: Props) {
  const metricUnits = new Map(
    response.metricDefinitions.map((definition) => [definition.metric, definition.unit])
  );
  const isPublished = response.consistency.selection === 'active';
  const release = response.consistency.release;
  const releaseLabel = !isPublished
    ? 'Outcome release not published'
    : response.consistency.freshness === 'withdrawn'
      ? 'Factual release withdrawn'
      : response.consistency.freshness === 'stale'
        ? 'Reviewed release · update overdue'
        : 'Reviewed factual release';

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="outcomes-overview-heading"
        className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm"
      >
        <div className="border-b border-border bg-muted/40 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Recorded facts and independent checks
              </p>
              <h2
                id="outcomes-overview-heading"
                className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
              >
                Check what each AFL acquisition produced
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
                Compare recorded games, goals, coaches votes, Brownlow votes, and structured
                achievements with independently observed evidence using the same player identity,
                competition scope, club-custody window, and effective-through date.
              </p>
            </div>
            <span
              className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${
                response.consistency.freshness === 'withdrawn'
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border-border bg-background text-foreground'
              }`}
            >
              {releaseLabel}
            </span>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {filterNotice ? (
            <p
              role="status"
              className="mb-5 rounded-lg border border-border bg-muted px-4 py-3 text-sm leading-6 text-foreground"
            >
              {filterNotice}
            </p>
          ) : null}
          {!isPublished ? (
            <div
              role="status"
              className="rounded-xl border border-border bg-muted/40 p-5 text-foreground"
            >
              <h3 className="text-base font-semibold">Checks are implemented but not activated</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                A public row appears only after stable player identity, source rights, matching
                metric scope, and one exact reviewed release are all available. Missing evidence
                stays unavailable; zero remains a real checked value.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href="/draft/trades"
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Explore trade archive
                </Link>
                <Link
                  href="/draft/outcomes/methodology"
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Outcome check methodology
                </Link>
              </div>
            </div>
          ) : null}

          {isPublished && release ? (
            <section
              aria-labelledby="active-outcome-release-heading"
              className="rounded-xl border border-border bg-background p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id="active-outcome-release-heading" className="text-base font-semibold">
                    Exact factual release
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Published {formatDate(release.publishedAt)} · effective through{' '}
                    {formatDate(release.effectiveThrough)}
                  </p>
                </div>
                <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-foreground">
                  {response.consistency.freshness === 'current'
                    ? 'Current'
                    : response.consistency.freshness === 'stale'
                      ? 'Stale'
                      : 'Withdrawn'}
                </span>
              </div>
              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="font-semibold text-foreground">Release ID</dt>
                  <dd className="mt-1 break-all font-mono text-muted-foreground">
                    {release.releaseId}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-foreground">Archive dataset</dt>
                  <dd className="mt-1 break-all font-mono text-muted-foreground">
                    {release.archiveDatasetId}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-foreground">Metric registry</dt>
                  <dd className="mt-1 break-all font-mono text-muted-foreground">
                    {release.metricRegistryVersion}
                  </dd>
                </div>
              </dl>
              {response.consistency.warnings.length > 0 ? (
                <div className="mt-4 space-y-2" aria-label="Release warnings">
                  {response.consistency.warnings.map((warning) => (
                    <p
                      key={warning.code}
                      role={warning.severity === 'critical' ? 'alert' : 'status'}
                      className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
                    >
                      <span className="font-semibold capitalize">{warning.severity}:</span>{' '}
                      {warning.message}
                    </p>
                  ))}
                </div>
              ) : null}
              {response.consistency.supportedScope.length > 0 ||
              response.consistency.excludedScope.length > 0 ? (
                <details className="mt-4 border-t border-border pt-2 text-sm">
                  <summary className="min-h-11 cursor-pointer py-3 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Coverage and limitations
                  </summary>
                  <div className="grid gap-4 pb-2 text-muted-foreground sm:grid-cols-2">
                    <div>
                      <h4 className="font-semibold text-foreground">Included</h4>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {response.consistency.supportedScope.map((scope) => (
                          <li key={scope}>{scope}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground">Excluded</h4>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {response.consistency.excludedScope.map((scope) => (
                          <li key={scope}>{scope}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </details>
              ) : null}
            </section>
          ) : null}

          <form
            action="/draft/outcomes"
            method="get"
            className="mt-6 grid gap-4 rounded-xl border border-border bg-background p-4 sm:grid-cols-2 lg:grid-cols-6"
            aria-label="Filter AFL Draft and Trade outcomes"
          >
            <label className="text-sm font-medium text-foreground">
              Player or event
              <input
                name="q"
                type="search"
                defaultValue={query.q}
                maxLength={160}
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Search player"
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              Club
              <input
                name="club"
                defaultValue={query.club}
                maxLength={160}
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Any AFL club"
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              Year
              <input
                name="year"
                type="number"
                min={1897}
                max={2200}
                defaultValue={query.year ?? ''}
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              Metric
              <select
                name="metric"
                defaultValue={query.metric ?? ''}
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">All metrics</option>
                {response.metricDefinitions.map((definition) => (
                  <option key={definition.metric} value={definition.metric}>
                    {definition.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-foreground">
              Check status
              <select
                name="status"
                defaultValue={query.status ?? ''}
                className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">All statuses</option>
                {Object.entries(statusLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Apply filters
              </button>
              <Link
                href="/draft/outcomes"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear
              </Link>
            </div>
          </form>
        </div>
      </section>

      <section aria-labelledby="metric-definitions-heading">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Metric contract
          </p>
          <h2 id="metric-definitions-heading" className="mt-2 text-2xl font-bold text-foreground">
            What Statly checks
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Each number keeps its own definition and evidence. An upstream total with an
            undocumented scope cannot silently become an AFL career or receiving-club total.
          </p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {response.metricDefinitions.map((definition) => (
            <article
              key={definition.metric}
              className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm"
            >
              <h3 className="text-base font-semibold text-foreground">{definition.label}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {definition.description}
              </p>
              <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                {definition.comparisonBasis}
              </p>
            </article>
          ))}
        </div>
      </section>

      {response.items.length > 0 ? (
        <section aria-labelledby="outcome-results-heading">
          <h2 id="outcome-results-heading" className="text-2xl font-bold text-foreground">
            Checked acquisitions
          </h2>
          <div className="mt-5 space-y-5">
            {response.items.map((item) => (
              <article
                key={aflDraftTradeOutcomeAcquisitionKey(item)}
                className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold text-foreground">{item.player.displayName}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.year} {item.acquisitionType} · {item.clubName}
                    </p>
                  </div>
                  <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-foreground">
                    Identity {item.player.identityStatus}
                  </span>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {item.checks.map((check) => (
                    <MetricCheck
                      key={check.metric}
                      check={check}
                      unit={metricUnits.get(check.metric) ?? 'units'}
                    />
                  ))}
                </div>
                {item.achievements.length > 0 ? (
                  <section
                    aria-label={`${item.player.displayName} achievements`}
                    className="mt-5 border-t border-border pt-5"
                  >
                    <h4 className="text-base font-semibold text-foreground">
                      Awards and achievements
                    </h4>
                    <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                      {item.achievements.map((achievement, index) => (
                        <li
                          key={
                            achievement.achievementId ??
                            `${achievement.label}-${achievement.season}-${index}`
                          }
                          className="rounded-lg border border-border bg-background p-4 text-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-foreground">{achievement.label}</p>
                              <p className="mt-1 text-muted-foreground">
                                Season {achievement.season}
                              </p>
                            </div>
                            <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold capitalize text-foreground">
                              {achievement.status.replaceAll('_', ' ')}
                            </span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            <span className="font-semibold text-foreground">Scope:</span>{' '}
                            {achievement.scopeLabel}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Checked through{' '}
                            <time dateTime={achievement.effectiveThrough}>
                              {formatDate(achievement.effectiveThrough)}
                            </time>
                          </p>
                          <details className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                            <summary className="min-h-11 cursor-pointer py-3 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                              Achievement evidence ({achievement.sources.length})
                            </summary>
                            <ul className="space-y-2 pb-1">
                              {achievement.sources.map((source) => (
                                <li key={`${source.role}-${source.artifactId}`}>
                                  <span className="font-semibold capitalize text-foreground">
                                    {source.role}:
                                  </span>{' '}
                                  {source.locator}
                                </li>
                              ))}
                            </ul>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </article>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <p className="text-sm text-muted-foreground">
              Showing {response.items.length.toLocaleString('en-AU')}
              {response.page.total === null
                ? ' checked acquisitions on this page'
                : ` of ${response.page.total.toLocaleString('en-AU')} checked acquisitions`}
            </p>
            {response.page.nextCursor ? (
              <Link
                href={nextPageHref(query, response.page.nextCursor)}
                rel="next"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Next results
              </Link>
            ) : null}
          </div>
        </section>
      ) : isPublished ? (
        <section
          aria-labelledby="outcome-empty-heading"
          className="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
        >
          <h2 id="outcome-empty-heading" className="text-xl font-semibold text-foreground">
            {response.consistency.freshness === 'withdrawn'
              ? 'Outcome rows are unavailable'
              : 'No acquisitions match these filters'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {response.consistency.freshness === 'withdrawn'
              ? 'This factual release has been withdrawn, so Statly is not serving any of its outcome rows.'
              : 'Try clearing one or more filters. A recorded zero still counts as a result and is never hidden as missing data.'}
          </p>
          {response.consistency.freshness !== 'withdrawn' ? (
            <Link
              href="/draft/outcomes"
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Clear all filters
            </Link>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
