import Link from 'next/link';
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';

export default function AuthCTA() {
  return (
    <main className="container mx-auto p-4 sm:p-6 lg:p-8">
      <div className="text-center max-w-md mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
          You&apos;re not signed in
        </h1>
        <p id="signin-description" className="text-slate-600 dark:text-slate-400 mt-2">
          Please sign in to view your dashboard and access all features.
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-200"
            aria-describedby="signin-description"
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5" />
            Sign In
          </Link>
        </div>
        <div className="mt-4">
          <Link
            href="/register"
            className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors duration-200"
          >
            Don&apos;t have an account? Sign up here
          </Link>
        </div>
      </div>
    </main>
  );
}
