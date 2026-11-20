'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Public links only. The fantasy app is not live, so nothing here points at it. */
const publicLinks = [
  { href: '/', label: 'Home', section: '/' },
  { href: '/afl/trades', label: 'Trades', section: '/afl' },
  { href: '/draft/trades', label: 'Draft record', section: '/draft' },
] as const;

function isPublicLinkActive(pathname: string, section: string): boolean {
  if (section === '/') return pathname === '/';
  return pathname === section || pathname.startsWith(`${section}/`);
}

/**
 * Text tabs: grey labels, the current section in bold ink with a 3px cobalt underline the width of
 * the word, sitting on the header's bottom divider. Phones put the tabs on their own row under the
 * logo; from `sm` up they sit beside it.
 */
export function PublicNavigation() {
  const pathname = usePathname() ?? '';

  return (
    <div className="flex basis-full gap-6 sm:basis-auto sm:gap-7 sm:self-stretch">
      {publicLinks.map(({ href, label, section }) => {
        const active = isPublicLinkActive(pathname, section);

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`relative inline-flex min-h-11 items-center text-[15px] whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              active ? 'font-bold text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-[3px] bg-primary"
              />
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
