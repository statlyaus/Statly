import { ChevronDown } from 'lucide-react';
import Link from 'next/link';

import { buttonStyles } from '@/components/ui/controlStyles';

import { basketballLeagueHref } from './basketballFormat';

/**
 * Switches between the user's basketball league profiles; shown only when there is more than one.
 * A disclosure of plain links, so choosing a league is an explicit activation, never a change event.
 */
export function BasketballLeagueSwitcher({
  leagues,
  currentLeagueId,
}: {
  leagues: { id: string; name: string }[];
  currentLeagueId: string;
}) {
  return (
    <details className="group relative">
      <summary
        className={buttonStyles({
          variant: 'outline',
          size: 'sm',
          className: 'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
        })}
      >
        Switch league
        <ChevronDown
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <ul className="absolute right-0 z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
        {leagues.map((league) => {
          const current = league.id === currentLeagueId;
          return (
            <li key={league.id}>
              <Link
                href={basketballLeagueHref(league.id)}
                aria-current={current ? 'true' : undefined}
                className={`flex min-h-10 items-center rounded-sm px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  current ? 'bg-accent font-semibold text-accent-foreground' : 'hover:bg-muted'
                }`}
              >
                <span className="truncate">{league.name}</span>
              </Link>
            </li>
          );
        })}
        <li className="mt-1 border-t border-border pt-1">
          <Link
            href="/basketball/new"
            className="flex min-h-10 items-center rounded-sm px-3 text-sm font-semibold hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            New league
          </Link>
        </li>
      </ul>
    </details>
  );
}
