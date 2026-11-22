import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'AFL | Statly',
  description: 'Statly on the AFL: every trade valued by what happened next, and the draft record.',
};

const products = [
  {
    href: '/afl/trades',
    title: 'Trades',
    description:
      'Every trade Statly has graded, valued by what the players and picks went on to do for the club that got them.',
  },
  {
    href: '/draft',
    title: 'Draft record',
    description: 'Draft classes, clubs and outcomes from the public record.',
  },
] as const;

/** The AFL hub. Addresses are sport first, product second: /afl/trades, later /afl/draft, /afl/fantasy. */
export default function AflHubPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-semibold text-foreground">AFL</h1>
      <ul className="mt-6 grid gap-3">
        {products.map((product) => (
          <li key={product.href}>
            <Link
              href={product.href}
              className="block border border-border bg-card px-4 py-4 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-lg font-semibold text-foreground">{product.title}</span>
              <span className="mt-1 block text-muted-foreground">{product.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
