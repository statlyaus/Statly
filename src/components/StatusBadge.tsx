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
    SCHEDULED: { bg: 'bg-indigo-100', text: 'text-indigo-800', label: 'Scheduled' },
    LIVE: { bg: 'bg-green-100', text: 'text-green-800', label: 'Live' },
    PAUSED: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Paused' },
    COMPLETED: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Completed' },
  } as const satisfies Record<StatusKind, { bg: string; text: string; label: string }>;

  // …later, inside your component’s render logic:

  const key = String(status).toUpperCase().trim() as keyof typeof STATUS_MAP;
  const fallbackLabel = String(status)
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const s = STATUS_MAP[key] ?? {
    bg: 'bg-yellow-100',
    text: 'text-yellow-800',
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
