'use client';

import clsx from 'clsx';

export type StatusKind = 'SCHEDULED' | 'LIVE' | 'PAUSED' | 'COMPLETED' | string;

export default function StatusBadge({
  status,
  className,
}: {
  status: StatusKind;
  className?: string;
}) {
  // Known statuses map (hoisted to module scope)
  const STATUS_MAP = {
    SCHEDULED: { bg: 'bg-info/10', text: 'text-info', label: 'Scheduled' },
    LIVE: { bg: 'bg-success/10', text: 'text-success', label: 'Live' },
    PAUSED: { bg: 'bg-warning/10', text: 'text-warning', label: 'Paused' },
    COMPLETED: { bg: 'bg-muted', text: 'text-foreground', label: 'Completed' },
  } as const satisfies Record<StatusKind, { bg: string; text: string; label: string }>;

  // …later, inside your component’s render logic:

  const key = String(status).toUpperCase().trim() as keyof typeof STATUS_MAP;
  const fallbackLabel = String(status)
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const s = STATUS_MAP[key] ?? {
    bg: 'bg-warning/10',
    text: 'text-warning',
    label: fallbackLabel,
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
        s.bg,
        s.text,
        className
      )}
    >
      {s.label}
    </span>
  );
}
