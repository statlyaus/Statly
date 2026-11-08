/**
 * Small presentational pieces shared by the basketball analysis pages (Players, Matchup, Pickups,
 * Trade). Server-safe: no hooks, tokens only, and every status carries a letter or word.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import { badgeStyles, textLinkStyles } from '@/components/ui/controlStyles';
import type { PlayerOwner, PoolPlayerInjury } from '@/server/basketball/readModels/playerPool';

import { formatAge, formatGameDate, formatSigned } from './format';

export function PageHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="space-y-1">
      <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">{children}</p>
    </header>
  );
}

/** The collapsible plain-language method note every analysis page carries. */
export function HowCalculated({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-card text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        How this is calculated
        <span aria-hidden="true" className="text-muted-foreground group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-2 border-t border-border px-4 py-3 text-muted-foreground [&_strong]:text-foreground">
        {children}
      </div>
    </details>
  );
}

const STALE_HOURS = 24;

/** Shown only when the latest successful box-score ingest is over a day old (or never ran). */
export function StaleStatsNotice({ updatedAt, now }: { updatedAt: string | null; now: Date }) {
  if (updatedAt && now.getTime() - new Date(updatedAt).getTime() < STALE_HOURS * 3_600_000) {
    return null;
  }
  return (
    <p
      role="status"
      className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-foreground"
    >
      {updatedAt
        ? `NBA stats last updated ${formatAge(updatedAt, now)}. Numbers may be behind.`
        : 'NBA stats have not been updated by the scheduled job yet. Numbers may be behind.'}
    </p>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-8 text-center">
      <p className="font-semibold text-foreground">{title}</p>
      {children ? <p className="mt-1 text-sm text-muted-foreground">{children}</p> : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-4 inline-flex min-h-11 items-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground hover:bg-brand-bar/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * OUT or DTD; "OUT · season" for a season-ending injury, and "old" when the report is over a day
 * old (it is still used).
 */
export function InjuryBadge({
  injury,
  seasonEnding = false,
  stale = false,
}: {
  injury: PoolPlayerInjury | null;
  seasonEnding?: boolean;
  stale?: boolean;
}) {
  if (!injury) return null;
  const out = injury.status === 'OUT';
  const when = seasonEnding
    ? ', out for the season'
    : injury.expectedReturnOn
      ? `, back ${formatGameDate(injury.expectedReturnOn)}`
      : '';
  const old = stale ? ' (injury report over a day old)' : '';
  return (
    <span
      className={badgeStyles({ tone: out ? 'loss' : 'warning', size: 'xs' })}
      title={`${injury.detail ?? (out ? 'Out' : 'Day-to-day')}${when}${old}`}
    >
      {out ? 'OUT' : 'DTD'}
      {seasonEnding ? ' · season' : ''}
      {stale ? ' · old' : ''}
      <span className="sr-only">
        {out ? ' ruled out' : ' day-to-day'}
        {injury.detail ? `: ${injury.detail}` : ''}
        {when}
        {old}
      </span>
    </span>
  );
}

export function OwnerLabel({ owner }: { owner: PlayerOwner }) {
  switch (owner.kind) {
    case 'MINE':
      return <span className={badgeStyles({ tone: 'brand', size: 'xs' })}>You</span>;
    case 'OPPONENT':
      return (
        <span
          className={`${badgeStyles({ tone: 'neutral', size: 'xs' })} min-w-0 max-w-full`}
          title={`This week's opponent: ${owner.teamName}`}
        >
          <span className="min-w-0 truncate">Opp · {owner.teamName}</span>
        </span>
      );
    case 'TEAM':
      return <span className="truncate text-xs text-foreground">{owner.teamName}</span>;
    case 'ELSEWHERE':
      return <span className="text-xs text-muted-foreground">Taken</span>;
    case 'FREE_AGENT':
      return <span className={badgeStyles({ tone: 'win', size: 'xs' })}>FA</span>;
  }
}

export type Call = 'WIN' | 'LOSS' | 'TOSS_UP';

const CALL_STYLE: Record<Call, { letter: string; label: string; className: string }> = {
  WIN: { letter: 'W', label: 'win', className: 'bg-result-win text-result-win-foreground' },
  LOSS: { letter: 'L', label: 'loss', className: 'bg-result-loss text-result-loss-foreground' },
  TOSS_UP: {
    letter: 'T',
    label: 'toss-up',
    className: 'bg-result-draw text-result-draw-foreground',
  },
};

/** W, L or T on its result token. */
export function CallChip({ call, className = '' }: { call: Call; className?: string }) {
  const style = CALL_STYLE[call];
  return (
    <span
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-xs font-bold ${style.className} ${className}`}
    >
      <span aria-hidden="true">{style.letter}</span>
      <span className="sr-only">{style.label}</span>
    </span>
  );
}

const Z_HEAT = [
  { min: 2, className: 'bg-result-win/30' },
  { min: 1, className: 'bg-result-win/20' },
  { min: 0.5, className: 'bg-result-win/10' },
  { min: -0.5, className: '' },
  { min: -1, className: 'bg-result-loss/10' },
  { min: -2, className: 'bg-result-loss/20' },
  { min: -Infinity, className: 'bg-result-loss/30' },
] as const;

/** Background tint for a z-score; the signed number is always printed alongside. */
export function zHeatClass(z: number): string {
  return Z_HEAT.find((band) => z >= band.min)?.className ?? '';
}

export function SignedNumber({ value, digits = 1 }: { value: number; digits?: number }) {
  return <span className="tabular-nums">{formatSigned(value, digits)}</span>;
}

/** A column header that sorts by linking to the same page with new search params. */
export function SortHeaderLink({
  href,
  label,
  state,
  className = '',
  align = 'right',
  children,
}: {
  href: string;
  /** Accessible description of the sort, e.g. "points value". */
  label: string;
  state: 'ascending' | 'descending' | 'none';
  className?: string;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <th scope="col" aria-sort={state} className={`py-2 font-semibold ${className}`}>
      <Link
        href={href}
        scroll={false}
        className={`inline-flex min-h-8 w-full items-center gap-1 rounded-sm px-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          align === 'right' ? 'justify-end' : 'justify-start'
        } ${state === 'none' ? '' : 'text-foreground'}`}
      >
        {children}
        <span className="sr-only">, sort by {label}</span>
        {state === 'none' ? null : (
          <span aria-hidden="true">{state === 'descending' ? '▼' : '▲'}</span>
        )}
      </Link>
    </th>
  );
}

export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={textLinkStyles}>
      {children}
    </Link>
  );
}
