'use client';

import type { ReactNode } from 'react';

type HeaderChip = {
  label: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning';
};

interface LeagueViewHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  chips?: HeaderChip[];
  actions?: ReactNode;
  aside?: ReactNode;
}

function chipClassName(tone: HeaderChip['tone']) {
  switch (tone) {
    case 'accent':
      return 'border-[color:var(--league-primary-soft)] bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]';
    case 'success':
      return 'border-[color:var(--league-success-soft)] bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]';
    case 'warning':
      return 'border-[color:var(--league-warning-soft)] bg-[color:var(--league-warning-soft)] text-[color:var(--league-warning)]';
    default:
      return 'border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)]';
  }
}

export default function LeagueViewHeader({
  eyebrow,
  title,
  description,
  chips = [],
  actions,
  aside,
}: LeagueViewHeaderProps) {
  const hasUtilityRail = Boolean(actions) || chips.length > 0;

  return (
    <section className="overflow-hidden rounded-[32px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_24px_60px_-45px_rgba(23,34,48,0.18)]">
      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[minmax(0,1.15fr)_360px] xl:px-8 xl:py-7 2xl:grid-cols-[minmax(0,1.25fr)_420px]">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[color:var(--league-text-muted)]">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--league-text)] sm:text-[2rem]">
            {title}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:var(--league-text-muted)] sm:text-[15px] 2xl:max-w-4xl">
            {description}
          </p>
        </div>

        {hasUtilityRail ? (
          <div className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] p-4 shadow-sm">
            {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
            {chips.length > 0 ? (
              <div className={actions ? 'mt-4 flex flex-wrap gap-2' : 'flex flex-wrap gap-2'}>
                {chips.map((chip) => (
                  <span
                    key={chip.label}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${chipClassName(chip.tone)}`}
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {aside ? (
        <div className="border-t border-[color:var(--league-border)] bg-[color:var(--league-page)] px-6 py-5 lg:px-8">
          {aside}
        </div>
      ) : null}
    </section>
  );
}
