'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { basketballLeagueHref } from './basketballFormat';

const TAB_GROUPS = [
  [
    { section: '', label: 'Overview' },
    { section: 'matchup', label: 'Matchup' },
    { section: 'players', label: 'Players' },
    { section: 'pickups', label: 'Pickups' },
    { section: 'rotation', label: 'Rotation' },
    { section: 'outlook', label: 'Outlook' },
    { section: 'trade', label: 'Trade' },
  ],
  [
    { section: 'roster', label: 'Roster' },
    { section: 'settings', label: 'Settings' },
  ],
] as const;

/**
 * The league's section tabs: one underlined row, decisions first, then league admin. On a phone the
 * row scrolls sideways; the current tab is scrolled into view and a fade marks more tabs to the right.
 */
export function BasketballLeagueTabs({ leagueId }: { leagueId: string }) {
  const pathname = usePathname() ?? '';
  const base = basketballLeagueHref(leagueId);
  const scroller = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const active = element.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) {
      element.scrollLeft = active.offsetLeft - (element.clientWidth - active.offsetWidth) / 2;
    }
    const update = () =>
      setMoreRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
    update();
    element.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      element.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [pathname]);

  return (
    <nav aria-label="Basketball league sections" className="relative border-b border-border">
      <div
        ref={scroller}
        className="-mb-px flex max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none]"
      >
        {TAB_GROUPS.map((group, groupIndex) => (
          <div key={group[0].label} className="flex shrink-0">
            {groupIndex > 0 ? (
              <span aria-hidden="true" className="mx-2 my-3.5 w-px shrink-0 bg-border" />
            ) : null}
            {group.map((tab) => {
              const href = tab.section ? `${base}/${tab.section}` : base;
              const active = tab.section
                ? pathname === href || pathname.startsWith(`${href}/`)
                : pathname === base;
              return (
                <Link
                  key={tab.label}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex h-12 shrink-0 items-center border-b-2 px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-bar motion-reduce:transition-none ${
                    active
                      ? 'border-brand-bar text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      {moreRight ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
        />
      ) : null}
    </nav>
  );
}
