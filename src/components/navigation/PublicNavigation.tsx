'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeftRight, House, ListOrdered } from 'lucide-react';

/** Public links only. The fantasy app is not live, so nothing here points at it. */
const publicLinks = [
  { href: '/', label: 'Home', section: '/', Icon: House },
  { href: '/afl/trades', label: 'Trades', section: '/afl', Icon: ArrowLeftRight },
  { href: '/draft/trades', label: 'Draft record', section: '/draft', Icon: ListOrdered },
] as const;

function isPublicLinkActive(pathname: string, section: string): boolean {
  if (section === '/') return pathname === '/';
  return pathname === section || pathname.startsWith(`${section}/`);
}

/**
 * Tab bar: equal-width 72px cells, a 24px icon over a 12px label, and a 2px bar on the edge that
 * faces the page for the current section. Phones get it fixed to the bottom of the screen; from
 * `sm` up it sits in the header, right of the logo.
 */
export function PublicNavigation() {
  const pathname = usePathname() ?? '';

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/10 bg-brand-bar pb-[env(safe-area-inset-bottom)] sm:static sm:col-start-2 sm:row-start-1 sm:justify-end sm:border-0 sm:bg-transparent sm:pb-0">
      {publicLinks.map(({ href, label, section, Icon }) => {
        const active = isPublicLinkActive(pathname, section);

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`relative flex h-18 min-w-0 flex-1 flex-col items-center justify-center gap-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white sm:w-24 sm:flex-none ${
              active
                ? 'text-brand-bar-foreground'
                : 'text-brand-bar-foreground/70 hover:text-brand-bar-foreground'
            }`}
          >
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 mx-auto h-0.5 w-10 rounded-full bg-sky-300 sm:top-auto sm:bottom-0"
              />
            ) : null}
            <Icon aria-hidden="true" className="size-6" strokeWidth={active ? 2.25 : 1.75} />
            <span className="text-xs leading-none font-semibold whitespace-nowrap">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}
