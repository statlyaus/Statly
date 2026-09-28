'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const publicLinks = [
  { href: '/', label: 'Home' },
  { href: '/draft/trades', label: 'AFL Draft & Trade Outcomes' },
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
    <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-1 overflow-x-auto sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-end">
      {publicLinks.map((link) => {
        const active = isPublicLinkActive(pathname, link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 text-center text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:text-sm ${
              active
                ? 'bg-white text-brand-bar'
                : 'text-brand-bar-foreground/80 hover:bg-white/10 hover:text-brand-bar-foreground'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
