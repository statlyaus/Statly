import { Suspense } from 'react';

import { ShieldCheck } from 'lucide-react';

import AuthForm from '@/components/AuthForm';
import Button from '@/components/Button';
import LegalLinks from '@/components/LegalLinks';

import type { Metadata } from 'next';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Sign in | Statly',
  description: 'Sign in to your Statly account',
};

export default async function LoginPage({
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
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        {/* Left side - Branding */}
        <div className="relative hidden overflow-hidden bg-primary lg:flex lg:w-1/2">
          <div className="absolute inset-0 bg-foreground/20"></div>
          <div className="relative z-10 flex flex-col justify-center px-12 text-primary-foreground">
            <div className="max-w-md">
              <h1 className="mb-6 text-4xl font-bold">Welcome to Statly</h1>
              <p className="mb-8 text-xl text-primary-foreground/80">
                Your ultimate fantasy sports dashboard. Track performance, manage teams, and
                dominate your leagues.
              </p>
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="h-2 w-2 rounded-full bg-primary-foreground/70"></div>
                  <span className="text-primary-foreground/80">
                    Real-time statistics and analytics
                  </span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="h-2 w-2 rounded-full bg-primary-foreground/70"></div>
                  <span className="text-primary-foreground/80">Advanced team management tools</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="h-2 w-2 rounded-full bg-primary-foreground/70"></div>
                  <span className="text-primary-foreground/80">Smart drafting assistance</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right side - Login Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Mobile branding */}
            <div className="mb-8 text-center lg:hidden">
              <h1 className="mb-2 text-3xl font-bold text-primary">Statly</h1>
              <p className="text-muted-foreground">Fantasy Sports Dashboard</p>
            </div>

            {/* Login Card */}
            <div className="rounded-2xl border border-border bg-card p-8 text-card-foreground shadow-xl">
              <div className="text-center mb-8">
                <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
                  <ShieldCheck className="h-8 w-8 text-primary-foreground" aria-hidden="true" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Welcome Back</h2>
                <p className="text-muted-foreground">
                  Sign in to access your fantasy sports dashboard
                </p>
              </div>

              <Suspense
                fallback={
                  <div className="animate-pulse space-y-6">
                    <div className="h-12 rounded-lg bg-muted"></div>
                    <div className="h-12 rounded-lg bg-muted"></div>
                    <div className="h-12 rounded-lg bg-muted"></div>
                  </div>
                }
              >
                <AuthForm
                  initialMode="login"
                  autoRedirectIfAuthenticated={true}
                  nextUrl={nextUrl}
                  className="space-y-6"
                  showModeSwitch={false}
                />
              </Suspense>

              {/* Additional actions */}
              <div className="mt-8 border-t border-border pt-6">
                <div className="flex flex-col space-y-3">
                  <Button href="/register" variant="secondary" className="w-full justify-center">
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
