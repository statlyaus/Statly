import type { ReactNode } from 'react';

import { ArrowRight, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

import { AppLayout } from '@/components/navigation';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { leagueSurfacePatterns } from '@/styles/leagueDesignSystem';

interface OnboardingAction {
  href: string;
  label: string;
  active?: boolean;
}

interface OnboardingItem {
  title: string;
  description: string;
}

interface OnboardingSummaryItem {
  label: string;
  value: string;
}

interface LeagueOnboardingShellProps {
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: OnboardingAction;
  secondaryAction: OnboardingAction;
  steps: Array<OnboardingItem>;
  summary: Array<OnboardingSummaryItem>;
  children: ReactNode;
}

function OnboardingActionLink({ action }: { action: OnboardingAction }) {
  return (
    <Link
      href={action.href}
      aria-current={action.active ? 'page' : undefined}
      className={cn(
        buttonVariants({ variant: action.active ? 'primary' : 'secondary', size: 'md' }),
        'rounded-full'
      )}
    >
      <span>{action.label}</span>
      {action.active ? <ArrowRight aria-hidden="true" /> : null}
    </Link>
  );
}

export function LeagueOnboardingShell({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  steps,
  summary,
  children,
}: LeagueOnboardingShellProps) {
  return (
    <AppLayout>
      <div className="min-h-screen bg-[color:var(--league-page)]">
        <div className="mx-auto w-full max-w-[var(--app-shell-max-width)] px-4 py-6 sm:px-6 lg:px-8 2xl:px-10">
          <header className="flex flex-col gap-5 border-b border-[color:var(--league-border)] pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className={leagueSurfacePatterns.sectionEyebrow}>{eyebrow}</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-normal text-[color:var(--league-text)] sm:text-4xl">
                {title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--league-text-muted)] sm:text-base">
                {description}
              </p>
            </div>

            <nav className="flex flex-wrap gap-3" aria-label="League setup mode">
              <OnboardingActionLink action={primaryAction} />
              <OnboardingActionLink action={secondaryAction} />
            </nav>
          </header>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className={cn(leagueSurfacePatterns.panelSection, 'p-5 sm:p-6')}>
              {children}
            </section>

            <aside className="space-y-4" aria-label="League setup guidance">
              <section className={cn(leagueSurfacePatterns.panelSection, 'p-5')}>
                <h2 className={leagueSurfacePatterns.sectionEyebrow}>Setup path</h2>
                <div className="mt-5 space-y-4">
                  {steps.map((step) => (
                    <article key={step.title} className="flex gap-3">
                      <CheckCircle2
                        aria-hidden="true"
                        className="mt-0.5 size-5 shrink-0 text-[color:var(--league-success)]"
                      />
                      <div>
                        <h3 className="text-sm font-semibold text-[color:var(--league-text)]">
                          {step.title}
                        </h3>
                        <p className={cn(leagueSurfacePatterns.body, 'mt-1')}>
                          {step.description}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className={cn(leagueSurfacePatterns.panelSection, 'p-5')}>
                <h2 className={leagueSurfacePatterns.sectionEyebrow}>At a glance</h2>
                <dl className="mt-5 grid gap-3">
                  {summary.map((item) => (
                    <div
                      key={item.label}
                      className={cn(
                        leagueSurfacePatterns.subpanelCompact,
                        'flex items-center justify-between gap-4'
                      )}
                    >
                      <dt className="text-sm text-[color:var(--league-text-muted)]">
                        {item.label}
                      </dt>
                      <dd className="text-sm font-semibold text-[color:var(--league-text)]">
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <Link
                href="/leagues"
                className={cn(
                  leagueSurfacePatterns.actionTile,
                  'flex items-center justify-between gap-3'
                )}
              >
                <span>Back to league center</span>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Link>
            </aside>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
