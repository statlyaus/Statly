'use client';

import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  leagueStatusTonePatterns,
  leagueSurfacePatterns,
} from '@/styles/leagueDesignSystem';

interface LeagueOnboardingEntryProps {
  title: string;
  description: string;
  createHref?: string;
  joinHref?: string;
  createLabel?: string;
  joinLabel?: string;
  variant?: 'panel' | 'compact';
  error?: {
    title: string;
    message: string;
    retryLabel: string;
    onRetry: () => void;
  };
}

export function LeagueOnboardingEntry({
  title,
  description,
  createHref = '/leagues/new',
  joinHref = '/leagues/join',
  createLabel = 'Create league',
  joinLabel = 'Join league',
  variant = 'panel',
  error,
}: LeagueOnboardingEntryProps) {
  const isCompact = variant === 'compact';

  return (
    <section
      className={cn(
        leagueSurfacePatterns.panelSection,
        isCompact ? 'p-4' : 'p-6 text-center sm:p-8'
      )}
    >
      <div className={cn('mx-auto', isCompact ? 'max-w-none' : 'max-w-2xl')}>
        {error ? (
          <div
            role="alert"
            className={cn(leagueStatusTonePatterns.danger, 'mb-5 rounded-2xl px-4 py-3 text-left')}
          >
            <p className="text-sm font-semibold">{error.title}</p>
            <p className="mt-1 text-sm leading-6">
              {error.message}
            </p>
          </div>
        ) : null}

        <h2
          className={cn(
            'font-semibold text-[color:var(--league-text)]',
            isCompact ? 'text-base' : 'text-xl'
          )}
        >
          {title}
        </h2>
        <p
          className={cn(
            'mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]',
            !isCompact && 'mx-auto max-w-xl'
          )}
        >
          {description}
        </p>

        <div
          className={cn(
            'mt-5 flex flex-wrap gap-3',
            isCompact ? 'justify-start' : 'justify-center'
          )}
        >
          {error ? (
            <button
              type="button"
              onClick={error.onRetry}
              className={cn(buttonVariants({ variant: 'secondary', size: 'md' }), 'rounded-full')}
            >
              <RefreshCw aria-hidden="true" />
              {error.retryLabel}
            </button>
          ) : null}
          <Link
            href={createHref}
            className={cn(buttonVariants({ variant: 'primary', size: 'md' }), 'rounded-full')}
          >
            {createLabel}
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link
            href={joinHref}
            className={cn(buttonVariants({ variant: 'secondary', size: 'md' }), 'rounded-full')}
          >
            {joinLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
