'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const publicLinks = [
  { href: '/', label: 'Home' },
  {
    href: '/draft/trades',
    label: 'AFL Outcomes',
    accessibleLabel: 'AFL Draft & Trade Outcomes',
  },
  { href: '/dashboard', label: 'Fantasy' },
] as const;

function isPublicLinkActive(pathname: string, href: (typeof publicLinks)[number]['href']): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/draft/trades') return pathname === '/draft' || pathname.startsWith('/draft/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PublicNavigation() {
  const pathname = usePathname() ?? '';

  return (
    <div className="col-span-2 row-start-2 grid min-w-0 grid-cols-3 gap-1 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:flex sm:items-center sm:justify-end">
      {publicLinks.map((link) => {
        const active = isPublicLinkActive(pathname, link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-label={'accessibleLabel' in link ? link.accessibleLabel : undefined}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-11 min-w-0 items-center justify-center rounded-md px-2 text-center text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-3 sm:text-sm ${
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
