import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Welcome to Statly | Fantasy AFL Platform',
  description:
    'Your new home for fantasy AFL. View stats, join leagues, and dominate the competition.',
};

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-24 dark:bg-gray-900">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-6xl">
          Welcome to Statly
        </h1>
        <p className="mt-6 text-lg leading-8 text-gray-600 dark:text-gray-300">
          Your Fantasy AFL Platform.
        </p>
        <div className="mt-10 flex items-center justify-center gap-x-6">
          <Link
            href="/stats"
            className="rounded-md bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            View Stats
          </Link>
          <Link href="/login" className="text-sm font-semibold leading-6 text-gray-900 dark:text-white">
            Log in <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </main>
  );
}