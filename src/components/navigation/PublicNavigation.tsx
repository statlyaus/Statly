'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Public links only. The fantasy app is not live, so nothing here points at it. */
const publicLinks = [
  { href: '/', label: 'Home', section: '/' },
  { href: '/afl/trades', label: 'Trades', section: '/afl' },
  {
    href: '/afl/trades/general-managers',
    label: 'General managers',
    // Four tabs do not fit a 360px phone with the full label.
    phoneLabel: 'Managers',
    section: '/afl/trades/general-managers',
  },
  { href: '/draft/trades', label: 'Draft record', section: '/draft' },
] as const;

function inSection(pathname: string, section: string): boolean {
  if (section === '/') return pathname === '/';
  return pathname === section || pathname.startsWith(`${section}/`);
}

/** The current tab is the most specific section holding the page: General managers sits inside /afl. */
function currentSection(pathname: string): string | undefined {
  return publicLinks
    .map(({ section }) => section)
    .filter((section) => inSection(pathname, section))
    .sort((left, right) => right.length - left.length)[0];
}

/**
 * Text tabs on the cobalt bar: tint labels, the current section in bold white with a 3px white
 * underline the width of the word, sitting on the bar's bottom edge. Phones put the tabs on their own row under the
 * logo and scroll sideways when they do not fit (style guide, "Navigation"); from `sm` up they sit
 * beside it.
 */
export function PublicNavigation() {
  const pathname = usePathname() ?? '';
  const current = currentSection(pathname);

  return (
    <div className="-my-1 flex basis-full gap-6 overflow-x-auto py-1 [scrollbar-width:none] sm:my-0 sm:basis-auto sm:gap-7 sm:self-stretch sm:overflow-visible sm:py-0">
      {publicLinks.map((link) => {
        const { href, label, section } = link;
        const phoneLabel = 'phoneLabel' in link ? link.phoneLabel : null;
        const active = section === current;

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            aria-label={phoneLabel ? label : undefined}
            className={`relative inline-flex min-h-11 items-center text-[15px] whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              active ? 'font-bold text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {phoneLabel ? (
              <>
                <span className="sm:hidden">{phoneLabel}</span>
                <span className="hidden sm:inline">{label}</span>
              </>
            ) : (
              label
            )}
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[3px] bg-foreground"
              />
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
