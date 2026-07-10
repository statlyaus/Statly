import AuthForm from '@/components/AuthForm';
import Button from '@/components/Button';
import LegalLinks from '@/components/LegalLinks';
import type { Metadata } from 'next';
import Image from 'next/image';
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
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-8 sm:px-6 lg:px-8">
        <section className="w-full py-8 sm:py-10">
          <div className="mx-auto w-full max-w-xl">
            <div className="mb-10 text-center">
              <Image
                src="/brand/statly-primary-logo.png"
                alt="Statly"
                width={312}
                height={118}
                priority
                className="mx-auto mb-8 h-auto w-64 max-w-full sm:w-80"
              />
              <h1 className="text-3xl font-semibold tracking-normal text-foreground">
                Sign in to Statly
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Access your leagues, live draft rooms, watchlists, and commissioner tools.
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-6">
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

              <div className="mt-8 border-t border-border pt-6">
                <div className="flex flex-col space-y-3">
                  <Button href="/register" variant="secondary" className="w-full justify-center">
                    Don&apos;t have an account? Sign up
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

            <LegalLinks prefix="By signing in, you agree to our" className="mt-8 text-center" />
          </div>
        </section>
      </div>
    </main>
  );
}
