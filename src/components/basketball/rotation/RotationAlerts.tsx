import Link from 'next/link';
import type { ReactNode } from 'react';

import { badgeStyles } from '@/components/ui/controlStyles';
import type { AlertLevel } from '@/lib/basketball/rotation';
import type { RotationPlayerView } from '@/server/basketball/readModels/rotationModel';

import { InjuryBadge } from '../analysis/AnalysisBits';

const LEVELS = {
  RED: { icon: '▼', word: 'Role lost', tone: 'loss' },
  AMBER: { icon: '⚠', word: 'At risk', tone: 'warning' },
  GREEN: { icon: '▲', word: 'Role up', tone: 'win' },
} as const;

/** An alert level as an icon and a word on its token, never colour alone. */
export function AlertBadge({ level }: { level: AlertLevel }) {
  const style = LEVELS[level];
  return (
    <span className={badgeStyles({ tone: style.tone, size: 'xs' })}>
      <span aria-hidden="true">{style.icon}</span>
      {style.word}
    </span>
  );
}

export function RotationPanel({
  id,
  title,
  children,
}: {
  id: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-card p-4">
      <h2 id={id} className="font-display text-lg font-bold text-foreground">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Players with their alert, what it says and the one-line rotation summary. */
export function PlayerAlertList({
  players,
  empty,
}: {
  players: RotationPlayerView[];
  empty: ReactNode;
}) {
  if (players.length === 0) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {players.map((player) => (
        <li key={player.playerId} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-3">
          <span className="shrink-0 sm:w-24 sm:pt-0.5">
            {player.alert ? <AlertBadge level={player.alert.level} /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-semibold text-foreground">{player.fullName}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {player.teamCode} · {player.positions.join('/') || '–'} ·{' '}
                {player.minutesPerGame.toFixed(1)} min
              </span>
              <InjuryBadge injury={player.injury} />
            </span>
            <span className="block text-sm text-foreground">{player.alert?.text}</span>
            <span className="block text-xs text-muted-foreground">{player.summary}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center text-sm font-semibold text-foreground underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  );
}
