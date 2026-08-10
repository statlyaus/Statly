import Link from 'next/link';

import type {
  AflDraftHistoryReadRequest,
  AflDraftHistorySelection,
  AflDraftHistoryYearResponse,
} from '@/server/aflTradeIntelligence/outcomes/draftHistoryReadService';

import { DraftTeamLogo } from './DraftHubState';
import { draftHubSectionPillClass, draftHubSubtlePanelClass } from './draftHubChrome';

type Props = {
  response: AflDraftHistoryYearResponse;
  query: AflDraftHistoryReadRequest;
  filterNotice?: string | null;
};

const draftKindLabel = {
  national_draft: 'National Draft',
  preseason_draft: 'Pre-season Draft',
  rookie_draft: 'Rookie Draft',
  midseason_draft: 'Mid-season Draft',
  supplemental_selection: 'Supplemental selection',
} as const;

function formatDate(value: string): string {
  const instant = value.includes('T') ? value : `${value}T00:00:00.000Z`;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Melbourne',
  }).format(new Date(instant));
}

function filterHref(
  query: AflDraftHistoryReadRequest,
  overrides: Partial<AflDraftHistoryReadRequest>
): string {
  const next = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.club) params.set('club', next.club);
  if (next.draftKind) params.set('draftKind', next.draftKind);
  const suffix = params.toString();
  return `/draft/drafts/${next.year}${suffix ? `?${suffix}` : ''}`;
}

function Club({ name, secondary }: { name: string; secondary?: string | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <DraftTeamLogo team={name} size={22} withCircle />
      <span>
        <span className="block font-semibold text-foreground">{name}</span>
        {secondary ? (
          <span className="block text-xs text-muted-foreground">{secondary}</span>
        ) : null}
      </span>
    </span>
  );
}

function Lineage({ selection }: { selection: AflDraftHistorySelection }) {
  if (selection.lineage.status === 'unresolved') {
    return <span className="text-sm text-muted-foreground">Pick lineage not resolved</span>;
  }
  if (selection.lineage.tradeRefs.length === 0) {
    return <span className="text-sm text-muted-foreground">No released trade link</span>;
  }
  return (
    <div className="space-y-1">
      {selection.lineage.tradeRefs.map((trade) => (
        <Link
          key={trade.tradeId}
          href={`/draft/trades/${encodeURIComponent(trade.tradeId)}`}
          className="block text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {trade.title}
        </Link>
      ))}
      {selection.lineage.edgeCount > 0 ? (
        <span className="text-xs text-muted-foreground">
          {selection.lineage.edgeCount} lineage{' '}
          {selection.lineage.edgeCount === 1 ? 'step' : 'steps'}
        </span>
      ) : null}
    </div>
  );
}

function MobileSelectionCard({ selection }: { selection: AflDraftHistorySelection }) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm md:hidden">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Pick {selection.selectionNumber}
          </span>
          <h3 className="mt-1 text-lg font-semibold text-foreground">
            {selection.player.displayName}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {draftKindLabel[selection.draftKind]}
            {selection.round ? ` · Round ${selection.round}` : ''}
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
            selection.player.identityStatus === 'resolved'
              ? 'border-primary/25 bg-primary/10 text-foreground'
              : 'border-border bg-muted text-muted-foreground'
          }`}
        >
          {selection.player.identityStatus === 'resolved' ? 'Resolved' : 'Identity pending'}
        </span>
      </div>
      <dl className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Selected by
          </dt>
          <dd className="mt-2">
            <Club name={selection.club.name} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Original club
          </dt>
          <dd className="mt-2">
            {selection.originalClub ? (
              <Club name={selection.originalClub.name} />
            ) : (
              <span className="text-sm text-muted-foreground">Not recorded</span>
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pick movement
          </dt>
          <dd className="mt-2">
            <Lineage selection={selection} />
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function AflDraftHistoryExplorer({ response, query, filterNotice = null }: Props) {
  const isActive = response.consistency.selection === 'active';
  const release = response.consistency.release;

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="draft-history-overview-heading"
        className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm"
      >
        <div className="border-b border-border bg-muted/40 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Draft selections and pick history
              </p>
              <h2
                id="draft-history-overview-heading"
                className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
              >
                Follow each pick from entitlement to player
              </h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
                See the official selection order, who used each pick, the pick&apos;s original club,
                and any released trades in its lineage. A player appears only when the source
                selection and canonical identity are tied to this exact factual release.
              </p>
            </div>
            <span className={draftHubSectionPillClass}>
              {isActive ? 'Reviewed factual release' : 'No active release'}
            </span>
          </div>
          {isActive && release ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Effective through{' '}
              <time dateTime={release.effectiveThrough}>
                {formatDate(release.effectiveThrough)}
              </time>
            </p>
          ) : null}
        </div>

        <div className="p-5 sm:p-6">
          {filterNotice ? (
            <p
              role="status"
              className="mb-5 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground"
            >
              {filterNotice}
            </p>
          ) : null}

          {!isActive ? (
            <div role="status" className="rounded-xl border border-border bg-muted/40 p-5">
              <h3 className="font-semibold text-foreground">Draft history is not activated</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Statly will show selections only from one reviewed factual release. Missing or
                unresolved pick lineage stays explicit instead of being inferred in the browser.
              </p>
            </div>
          ) : (
            <form
              action={`/draft/drafts/${query.year}`}
              method="get"
              className="grid gap-4 rounded-xl border border-border bg-background p-4 sm:grid-cols-2 lg:grid-cols-5"
              aria-label="Filter AFL draft history"
            >
              <label className="text-sm font-medium text-foreground lg:col-span-2">
                Player, club, or pick
                <input
                  name="q"
                  type="search"
                  maxLength={160}
                  defaultValue={query.q}
                  placeholder="Search Harry Kyle or pick 14"
                  className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="text-sm font-medium text-foreground">
                Selecting club
                <select
                  name="club"
                  defaultValue={query.club}
                  className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">All clubs</option>
                  {response.availableFilters.clubs.map((club) => (
                    <option key={club.aflClubId} value={club.aflClubId}>
                      {club.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-foreground">
                Draft
                <select
                  name="draftKind"
                  defaultValue={query.draftKind ?? ''}
                  className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">All drafts</option>
                  {response.availableFilters.draftKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {draftKindLabel[kind]}
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
                  href={`/draft/drafts/${query.year}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Clear
                </Link>
              </div>
            </form>
          )}
        </div>
      </section>

      {isActive ? (
        <section aria-labelledby="draft-selections-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {query.year} draft year
              </p>
              <h2 id="draft-selections-heading" className="mt-1 text-2xl font-bold text-foreground">
                {response.year.filteredSelections.toLocaleString('en-AU')} of{' '}
                {response.year.totalSelections.toLocaleString('en-AU')} selections
              </h2>
            </div>
            <nav aria-label="Draft years" className="flex flex-wrap gap-2">
              {response.availableYears.map(({ year }) => (
                <Link
                  key={year}
                  href={filterHref(query, { year })}
                  aria-current={year === query.year ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    year === query.year
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground hover:bg-accent'
                  }`}
                >
                  {year}
                </Link>
              ))}
            </nav>
          </div>

          {response.selections.length === 0 ? (
            <div role="status" className={`${draftHubSubtlePanelClass} p-6`}>
              <h3 className="font-semibold text-foreground">No selections match these filters</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Clear the filters or choose another released draft year.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {response.selections.map((selection) => (
                  <MobileSelectionCard key={selection.selectionId} selection={selection} />
                ))}
              </div>
              <div className={`${draftHubSubtlePanelClass} hidden overflow-x-auto md:block`}>
                <table className="w-full border-collapse text-left text-sm">
                  <caption className="sr-only">
                    Released AFL draft selections for {query.year}
                  </caption>
                  <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Pick
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Player
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Selected by
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Original club
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Pick movement
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {response.selections.map((selection) => (
                      <tr key={selection.selectionId} className="align-top">
                        <th scope="row" className="whitespace-nowrap px-4 py-4">
                          <span className="text-base font-bold text-foreground">
                            #{selection.selectionNumber}
                          </span>
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">
                            {selection.round ? `Round ${selection.round} · ` : ''}
                            {draftKindLabel[selection.draftKind]}
                          </span>
                        </th>
                        <td className="px-4 py-4">
                          <span className="font-semibold text-foreground">
                            {selection.player.displayName}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {selection.player.identityStatus === 'resolved'
                              ? 'Canonical player resolved'
                              : 'Player identity pending'}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <Club name={selection.club.name} />
                        </td>
                        <td className="px-4 py-4">
                          {selection.originalClub ? (
                            <Club name={selection.originalClub.name} />
                          ) : (
                            <span className="text-muted-foreground">Not recorded</span>
                          )}
                        </td>
                        <td className="max-w-xs px-4 py-4">
                          <Lineage selection={selection} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
