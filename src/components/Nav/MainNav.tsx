import Link from 'next/link';
import { usePathname } from 'next/navigation';

const routes = [
  { href: '/', label: 'Dashboard' },
  { href: '/drafts', label: 'Drafts' },
  { href: '/live-scoring', label: 'Live' },
  { href: '/leagues', label: 'Leagues' },
  { href: '/trade-centre', label: 'Trades' },
];

export default function MainNav() {
  const pathname = usePathname();
  return (
    <>
      {/* Desktop top nav */}
      <nav aria-label="Primary" className="hidden md:block border-b border-neutral-200 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
        <div className="mx-auto max-w-7xl px-4">
          <ul className="flex items-center gap-4 h-12">
            {routes.map((r) => {
              const active = pathname === r.href || (r.href !== '/' && pathname?.startsWith(r.href));
              return (
                <li key={r.href}>
                  <Link
                    href={r.href}
                    aria-current={active ? 'page' : undefined}
                    className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                      active ? 'text-blue-700 border-b-2 border-blue-600' : 'text-neutral-700 hover:text-neutral-900'
                    }`}
                  >
                    {r.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Mobile bottom nav */}
      <nav aria-label="Primary" className="md:hidden fixed bottom-0 inset-x-0 border-t border-neutral-200 bg-white/90 backdrop-blur z-40">
        <ul className="grid grid-cols-5">
          {routes.map((r) => {
            const active = pathname === r.href || (r.href !== '/' && pathname?.startsWith(r.href));
            return (
              <li key={r.href} className="text-center">
                <Link
                  href={r.href}
                  aria-current={active ? 'page' : undefined}
                  className={`block py-2 text-xs ${active ? 'text-blue-700 font-semibold' : 'text-neutral-700'}`}
                >
                  {r.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
