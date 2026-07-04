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
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_32rem] lg:px-8 lg:py-8">
        <section className="hidden min-w-0 flex-col overflow-hidden rounded-l-[2rem] border border-border bg-card p-8 shadow-sm lg:flex xl:p-10">
          <div>
            <Image
              src="/brand/statly-primary-logo.png"
              alt="Statly"
              width={312}
              height={118}
              priority
              className="h-auto w-56"
            />
            <h1 className="mt-10 max-w-2xl text-4xl font-semibold leading-tight tracking-normal text-foreground xl:text-5xl">
              Your fantasy AFL command center.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Draft smarter, compare every stat that matters, and move from league setup to live
              decisions without changing tools.
            </p>
            <div className="mt-6 flex flex-wrap gap-4 text-sm font-medium text-muted-foreground">
              {['Live draft rooms', 'Advanced analytics', 'Team management', 'Real-time updates'].map(
                (item) => (
                  <span key={item} className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                    {item}
                  </span>
                )
              )}
            </div>
          </div>

          <div className="mb-8 mt-10 grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
              <div className="flex items-center justify-between gap-4 border-b border-border pb-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Live draft
                  </p>
                  <p className="mt-1 text-lg font-semibold text-foreground">Round 1 / Pick 7</p>
                </div>
                <div className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  1:48
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {['All', 'G', 'DEF', 'MID', 'FWD', 'RUC'].map((filter) => (
                  <span
                    key={filter}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground"
                  >
                    {filter}
                  </span>
                ))}
              </div>
              <div className="mt-4 overflow-hidden rounded-xl border border-border">
                <div className="grid grid-cols-[2.5rem_minmax(0,1.4fr)_4rem_4rem_4rem] bg-muted px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <span>#</span>
                  <span>Player</span>
                  <span>Pos</span>
                  <span>Avg</span>
                  <span>Trend</span>
                </div>
                {[
                  ['1', 'Nick Daicos', 'COL', 'MID', '118.6'],
                  ['2', 'Marcus Bontempelli', 'WBD', 'MID', '112.4'],
                  ['3', 'Zak Butters', 'PA', 'MID', '109.7'],
                  ['4', 'Jye Caldwell', 'ESS', 'MID', '104.9'],
                ].map(([rank, player, club, position, average]) => (
                  <div
                    key={rank}
                    className="grid grid-cols-[2.5rem_minmax(0,1.4fr)_4rem_4rem_4rem] items-center border-t border-border px-3 py-3 text-sm"
                  >
                    <span className="text-muted-foreground">{rank}</span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{player}</p>
                      <p className="truncate text-xs text-muted-foreground">{club}</p>
                    </div>
                    <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                      {position}
                    </span>
                    <span className="font-semibold text-foreground">{average}</span>
                    <span className="font-semibold text-primary" aria-label="trending up">
                      {'\u2197'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Draft order
                </p>
                <div className="mt-4 space-y-2">
                  {[
                    ['35', 'Footy Fanatics', 'Complete'],
                    ['36', 'Goal Getters', 'Complete'],
                    ['37', 'Robbo Rockers', 'On clock'],
                    ['38', 'Mark Masters', 'Upcoming'],
                  ].map(([pick, team, status]) => (
                    <div
                      key={`${pick}-${team}`}
                      className="grid grid-cols-[2rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-lg px-2 py-2 text-xs"
                    >
                      <span className="font-semibold text-muted-foreground">{pick}</span>
                      <span className="truncate font-semibold text-foreground">{team}</span>
                      <span className="truncate text-right text-muted-foreground">{status}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  My roster
                </p>
                <div className="mt-4 space-y-2 text-xs">
                  {[
                    ['DEF', 'Jake Lloyd'],
                    ['MID', 'Marcus Bontempelli'],
                    ['MID', 'Zak Butters'],
                    ['FWD', 'Empty'],
                  ].map(([slot, player]) => (
                    <div key={`${slot}-${player}`} className="flex justify-between gap-3">
                      <span className="font-semibold text-muted-foreground">{slot}</span>
                      <span className="truncate text-foreground">{player}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-auto grid grid-cols-3 gap-3 border-t border-border pt-6">
            {[
              ['642', 'player pool'],
              ['9', 'scoring categories'],
              ['22', 'roster slots'],
            ].map(([value, label]) => (
              <div key={label}>
                <p className="text-2xl font-semibold text-foreground">{value}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex min-w-0 items-center justify-center rounded-[2rem] border border-border bg-card px-5 py-8 shadow-sm sm:px-8 lg:rounded-l-none lg:border-l-0">
          <div className="w-full max-w-[26rem]">
            <div className="mb-8 lg:hidden">
              <Image
                src="/brand/statly-wordmark-logo.png"
                alt="Statly"
                width={182}
                height={60}
                priority
                className="h-auto w-36"
              />
              <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-normal text-foreground">
                Fantasy AFL operations.
              </h1>
            </div>

            <div className="mb-8">
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-background">
                <Image
                  src="/brand/statly-compact-logo.png"
                  alt="Statly logo"
                  width={36}
                  height={24}
                  priority
                  className="h-7 w-10 object-contain"
                />
              </div>
              <h2 className="text-3xl font-semibold tracking-normal text-foreground">
                Sign in to Statly
              </h2>
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

            <LegalLinks prefix="By signing in, you agree to our" className="mt-8" />
          </div>
        </section>
      </div>
    </main>
  );
}
