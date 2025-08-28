import AuthForm from '@/components/AuthForm';
import Button from '@/components/Button';
import LegalLinks from '@/components/LegalLinks';
import type { Metadata } from 'next';
import { Suspense } from 'react';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Sign in | Statly',
  description: 'Sign in to your Statly account',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const params = searchParams ?? {};
  const pickFirst = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);
  const toSafeRedirect = (url?: string) =>
    url && url.startsWith('/') && !url.startsWith('//') ? url : undefined;
  const nextUrl =
    toSafeRedirect(pickFirst(params.callbackUrl)) ??
    toSafeRedirect(pickFirst(params.next));

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="flex min-h-screen">
        {/* Left side - Branding */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 to-purple-700 relative overflow-hidden">
          <div className="absolute inset-0 bg-black/20"></div>
          <div className="relative z-10 flex flex-col justify-center px-12 text-white">
            <div className="max-w-md">
              <h1 className="text-4xl font-bold mb-6">Welcome to Statly</h1>
              <p className="text-xl mb-8 text-blue-100">
                Your ultimate fantasy sports dashboard. Track performance, manage teams, and dominate your leagues.
              </p>
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-blue-300 rounded-full"></div>
                  <span className="text-blue-100">Real-time statistics and analytics</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-blue-300 rounded-full"></div>
                  <span className="text-blue-100">Advanced team management tools</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-blue-300 rounded-full"></div>
                  <span className="text-blue-100">Smart drafting assistance</span>
                </div>
              </div>
            </div>
          </div>
          {/* Decorative elements */}
          <div className="absolute top-10 right-10 w-32 h-32 bg-white/10 rounded-full blur-xl"></div>
          <div className="absolute bottom-10 left-10 w-24 h-24 bg-white/10 rounded-full blur-xl"></div>
        </div>

        {/* Right side - Login Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Mobile branding */}
            <div className="lg:hidden text-center mb-8">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-700 bg-clip-text text-transparent mb-2">
                Statly
              </h1>
              <p className="text-slate-600 dark:text-slate-400">
                Fantasy Sports Dashboard
              </p>
            </div>

            {/* Login Card */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-4">
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
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" 
                    />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                  Welcome Back
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                  Sign in to access your fantasy sports dashboard
                </p>
              </div>

              <Suspense fallback={
                <div className="animate-pulse space-y-6">
                  <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                  <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                  <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                </div>
              }>
                <AuthForm
                  initialMode="login"
                  autoRedirectIfAuthenticated={true}
                  nextUrl={nextUrl}
                  className="space-y-6"
                />
              </Suspense>
              
              {/* Additional actions */}
              <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
                <div className="flex flex-col space-y-3">
                  <Button 
                    href="/register" 
                    variant="secondary"
                    className="w-full justify-center"
                  >
                    Don't have an account? Sign up
                  </Button>
                  <Button 
                    href="/forgot-password" 
                    variant="ghost"
                    className="w-full justify-center text-sm"
                  >
                    Forgot password?
                  </Button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <LegalLinks prefix="By signing in, you agree to our" className="mt-8" />
          </div>
        </div>
      </div>
    </main>
  );
}
