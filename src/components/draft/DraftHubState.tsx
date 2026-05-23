import Image from 'next/image';
import Link from 'next/link';

import { getTeamLogo } from '@/lib/teamLogos';

type DraftHubStateVariant = 'empty' | 'error';

type DraftHubStateProps = {
  variant: DraftHubStateVariant;
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
};

const variantLabel: Record<DraftHubStateVariant, string> = {
  empty: 'No data',
  error: 'Load issue',
};

const variantLabelClass: Record<DraftHubStateVariant, string> = {
  empty: 'bg-muted text-muted-foreground ring-1 ring-border',
  error: 'bg-destructive text-destructive-foreground',
};

type DraftTeamLogoProps = {
  team?: string | null;
  size?: number;
  decorative?: boolean;
  withCircle?: boolean;
  className?: string;
};

export function DraftTeamLogo({
  team,
  size = 20,
  decorative = true,
  withCircle = false,
  className = '',
}: DraftTeamLogoProps) {
  const safeTeam = team?.trim() ?? '';
  const src = getTeamLogo(safeTeam);
  const img = (
    <Image
      src={src}
      alt={decorative ? '' : `${safeTeam || 'Team'} logo`}
      aria-hidden={decorative ? 'true' : undefined}
      width={size}
      height={size}
      unoptimized={src.endsWith('.svg')}
      className={`shrink-0 object-contain ${className}`}
    />
  );

  if (!withCircle) return img;

  return (
    <span className="inline-flex items-center justify-center rounded-full bg-muted ring-1 ring-ring">
      {img}
    </span>
  );
}

export function DraftHubState({
  variant,
  title,
  description,
  actionHref,
  actionLabel,
}: DraftHubStateProps) {
  return (
    <section
      role={variant === 'error' ? 'alert' : 'status'}
      className="rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm"
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
    >
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${variantLabelClass[variant]}`}
        >
          {variantLabel[variant]}
        </span>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-card-foreground">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base">
          {description}
        </p>
        {actionHref && actionLabel ? (
          <Link
            href={actionHref}
            className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {actionLabel}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
