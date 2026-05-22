'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2, CircleAlert } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  leagueStatusTonePatterns,
  leagueSurfacePatterns,
} from '@/styles/leagueDesignSystem';

export interface LeagueSetupChecklistStep {
  id: string;
  title: string;
  detail: string;
  complete: boolean;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

interface LeagueSetupChecklistProps {
  title: string;
  description: string;
  steps: Array<LeagueSetupChecklistStep>;
}

export function LeagueSetupChecklist({
  title,
  description,
  steps,
}: LeagueSetupChecklistProps) {
  return (
    <section className={cn(leagueSurfacePatterns.panelSection, 'p-5 sm:p-6')}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={leagueSurfacePatterns.sectionEyebrow}>Setup checklist</p>
          <h2 className="mt-3 text-xl font-semibold text-[color:var(--league-text)]">
            {title}
          </h2>
          <p className={cn(leagueSurfacePatterns.body, 'mt-2 max-w-2xl')}>
            {description}
          </p>
        </div>
      </div>

      <ol className="mt-5 grid gap-3">
        {steps.map((step) => {
          const Icon = step.complete ? CheckCircle2 : CircleAlert;
          const statusClass = step.complete
            ? leagueStatusTonePatterns.success
            : leagueStatusTonePatterns.warning;

          return (
            <li
              key={step.id}
              className={cn(
                leagueSurfacePatterns.subpanel,
                'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'
              )}
            >
              <div className="flex gap-3">
                <span
                  className={cn(
                    statusClass,
                    'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full'
                  )}
                >
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-[color:var(--league-text)]">
                      {step.title}
                    </h3>
                    <span className={cn(statusClass, 'rounded-full px-2.5 py-1 text-xs font-semibold')}>
                      {step.complete ? 'Complete' : 'Needs attention'}
                    </span>
                  </div>
                  <p className={cn(leagueSurfacePatterns.body, 'mt-1')}>
                    {step.detail}
                  </p>
                </div>
              </div>

              {step.action?.href ? (
                <Link
                  href={step.action.href}
                  className={cn(
                    buttonVariants({ variant: 'secondary', size: 'sm' }),
                    'w-fit rounded-full'
                  )}
                >
                  {step.action.label}
                  <ArrowRight aria-hidden="true" />
                </Link>
              ) : step.action?.onClick ? (
                <button
                  type="button"
                  onClick={step.action.onClick}
                  className={cn(
                    buttonVariants({ variant: 'secondary', size: 'sm' }),
                    'w-fit rounded-full'
                  )}
                >
                  {step.action.label}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
