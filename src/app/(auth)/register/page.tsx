import { Suspense } from 'react';

import AuthForm from '@/components/AuthForm';
import Button from '@/components/Button';
import LegalLinks from '@/components/LegalLinks';

import type { Metadata } from 'next';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Create account | Statly',
  description: 'Create your Statly account',
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const pickFirst = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);
  const toSafeRedirect = (url?: string) =>
    url && url.startsWith('/') && !url.startsWith('//') ? url : undefined;
  const nextUrl =
    toSafeRedirect(pickFirst(params.callbackUrl)) ?? toSafeRedirect(pickFirst(params.next));

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="flex">
        {/* Left side - Branding */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-purple-600 to-blue-700 relative overflow-hidden">
          <div className="absolute inset-0 bg-black/20"></div>
          <div className="relative z-10 flex flex-col justify-center px-12 text-white">
            <div className="max-w-md">
              <h2 className="text-4xl font-bold mb-6">Join Statly Today</h2>
              <p className="text-xl mb-8 text-purple-100">
                Create your account and start dominating your fantasy leagues with advanced
                analytics and insights.
              </p>
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-purple-300 rounded-full"></div>
                  <span className="text-purple-100">Free to start, premium features available</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-purple-300 rounded-full"></div>
                  <span className="text-purple-100">
                    Join thousands of fantasy sports enthusiasts
                  </span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-purple-300 rounded-full"></div>
                  <span className="text-purple-100">Advanced AI-powered recommendations</span>
                </div>
              </div>
            </div>
          </div>
          {/* Decorative elements */}
          <div
            className="absolute top-10 right-10 w-32 h-32 bg-white/10 rounded-full blur-xl"
            aria-hidden="true"
            role="presentation"
          ></div>
          <div
            className="absolute bottom-10 left-10 w-24 h-24 bg-white/10 rounded-full blur-xl"
            aria-hidden="true"
            role="presentation"
          ></div>
        </div>

        {/* Right side - Register Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Mobile branding */}
            <div className="lg:hidden text-center mb-8">
              <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-700 bg-clip-text text-transparent mb-2">
                Statly
              </h2>
              <p className="text-slate-600 dark:text-slate-400">Fantasy Sports Dashboard</p>
            </div>

            {/* Register Card */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl mb-4">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                    />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                  Create Account
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                  Join Statly to track your fantasy sports performance
                </p>
              </div>

              <Suspense
                fallback={
                  <div className="animate-pulse space-y-6">
                    <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                    <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                    <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                  </div>
                }
              >
                <AuthForm
                  initialMode="signup"
                  autoRedirectIfAuthenticated={true}
                  nextUrl={nextUrl}
                  className="space-y-6"
                  showModeSwitch={false}
                />
              </Suspense>

              {/* Additional actions */}
              <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
                <div className="flex flex-col space-y-3">
                  <Button href="/login" variant="secondary" className="w-full justify-center">
                    Already have an account? Sign in
                  </Button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <LegalLinks prefix="By creating an account, you agree to our" className="mt-8" />
          </div>
        </div>
      </div>
    </main>
  );
}
