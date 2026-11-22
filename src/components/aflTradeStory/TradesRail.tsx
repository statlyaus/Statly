import Link from 'next/link';

import type { AflTradeStorySampleSummary } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

import { buttonStyles, fieldStyles } from '@/components/ui/controlStyles';

import { clubSquareBackground } from '@/lib/clubGuernseys';
import {
  tradesListClubs,
  tradesListHref,
  tradesListYears,
  type TradesListQuery,
} from './tradesListQuery';
import { clubCounts, yearCounts } from './tradesPreviewModel';

const label = 'font-display ts-small font-bold tracking-[0.1em] text-muted-foreground uppercase';
const item =
  'flex min-h-6 items-center justify-between gap-2 px-2 font-display ts-small font-medium hover:bg-card aria-[current=true]:font-extrabold';
// The current place is heavier type and a 3px cobalt underline (style guide, "Navigation"); sun is
// kept for the previewed trade, the one "yours and now" on the screen.
const marked = 'underline decoration-primary decoration-[3px] underline-offset-4';
const count = 'font-sans text-muted-foreground tabular-nums';

function RailLink({
  href,
  active,
  children,
  n,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  n: number;
}) {
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        aria-current={active ? 'true' : undefined}
        className={item}
      >
        <span className={`flex min-w-0 items-center gap-1.5 ${active ? marked : ''}`}>
          {children}
        </span>
        <span className={count}>{n}</span>
      </Link>
    </li>
  );
}

/**
 * The list's filters. From 1280px a rail of years and clubs, each with its count under the other
 * filter; narrower, a plain form of two selects that works without scripts. Changing a filter closes
 * the preview, so the first row of the new list opens.
 */
export function TradesRail({
  stories,
  query,
}: {
  stories: readonly AflTradeStorySampleSummary[];
  query: TradesListQuery;
}) {
  const years = tradesListYears(stories);
  const clubs = tradesListClubs(stories);
  const perYear = yearCounts(stories, query.club);
  const perClub = clubCounts(stories, query.year);
  const at = { ...query, trade: null };

  return (
    <>
      <nav
        aria-label="Filter the trades"
        className="hidden min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-r border-border bg-muted px-3 py-4 xl:flex"
      >
        <div>
          <h2 className={`${label} px-2 pb-1`}>Year</h2>
          <ul>
            <RailLink
              href={tradesListHref({ ...at, year: null })}
              active={query.year === null}
              n={perYear.all}
            >
              All years
            </RailLink>
            {years.map((year) => (
              <RailLink
                key={year}
                href={tradesListHref({ ...at, year })}
                active={query.year === year}
                n={perYear.byYear.get(year) ?? 0}
              >
                {year}
              </RailLink>
            ))}
          </ul>
        </div>
        <div>
          <div className="flex items-baseline justify-between px-2 pb-1">
            <h2 className={label}>Club</h2>
            {query.club === null ? null : (
              <Link
                href={tradesListHref({ ...at, club: null })}
                prefetch={false}
                className="font-display ts-small font-semibold text-primary underline underline-offset-2"
              >
                Clear
              </Link>
            )}
          </div>
          <ul>
            <RailLink
              href={tradesListHref({ ...at, club: null })}
              active={query.club === null}
              n={perClub.all}
            >
              All clubs
            </RailLink>
            {clubs.map(({ slug, name }) => {
              return (
                <RailLink
                  key={slug}
                  href={tradesListHref({ ...at, club: slug })}
                  active={query.club === slug}
                  n={perClub.bySlug.get(slug) ?? 0}
                >
                  <span
                    aria-hidden="true"
                    className="size-[13px] flex-none border border-foreground"
                    style={{ background: clubSquareBackground(name) }}
                  />
                  <span className="truncate">{name}</span>
                </RailLink>
              );
            })}
          </ul>
        </div>
        <div>
          <h2 className={`${label} px-2 pb-1`}>Order</h2>
          <ul>
            {(['newest', 'biggest'] as const).map((sort) => (
              <li key={sort}>
                <Link
                  href={tradesListHref({ ...at, sort })}
                  prefetch={false}
                  aria-current={query.sort === sort ? 'true' : undefined}
                  className={item}
                >
                  <span className={query.sort === sort ? marked : ''}>
                    {sort === 'newest' ? 'Newest first' : 'Biggest result first'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <form
        action="/afl/trades"
        method="get"
        aria-label="Filter the trades"
        className="flex flex-wrap items-end gap-3 border-b border-border bg-muted px-4 py-3 xl:hidden"
      >
        <label className="grid gap-1">
          <span className={label}>Year</span>
          <select name="year" defaultValue={query.year ?? 'all'} className={fieldStyles()}>
            <option value="all">All years ({perYear.all})</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year} ({perYear.byYear.get(year) ?? 0})
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className={label}>Club</span>
          <select name="club" defaultValue={query.club ?? ''} className={fieldStyles()}>
            <option value="">All clubs ({perClub.all})</option>
            {clubs.map(({ slug, name }) => (
              <option key={slug} value={slug}>
                {name} ({perClub.bySlug.get(slug) ?? 0})
              </option>
            ))}
          </select>
        </label>
        {query.sort === 'biggest' ? <input type="hidden" name="sort" value="biggest" /> : null}
        <button type="submit" className={buttonStyles({ variant: 'outline', size: 'md' })}>
          Show trades
        </button>
      </form>
    </>
  );
}
