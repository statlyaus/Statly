'use client';

import { useState } from 'react';

import type { ReactNode } from 'react';

interface DraftStatusBannerProps {
  status: string;
  onStartDraft?: () => void;
  isLoading?: boolean;
}

export default function DraftStatusBanner({
  status,
  onStartDraft,
  isLoading = false,
}: DraftStatusBannerProps) {
  const [localLoading, setLocalLoading] = useState(false);

  const handleStartDraft = async () => {
    if (!onStartDraft) return;

    setLocalLoading(true);
    try {
      await onStartDraft();
    } finally {
      setLocalLoading(false);
    }
  };

  const isActuallyLoading = isLoading || localLoading;
  const statusConfig: Record<
    string,
    {
      label: string;
      title: string;
      description: string;
      tone: string;
      icon: ReactNode;
    }
  > = {
    SCHEDULED: {
      label: 'Scheduled',
      title: 'Draft room is ready',
      description: 'Participants can join now. Start manually or wait for the scheduled launch.',
      tone: 'border-[color:var(--draft-broadcast-yellow)] bg-[color:var(--draft-broadcast-yellow)] text-[color:var(--draft-broadcast-yellow-text)]',
      icon: (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    LIVE: {
      label: 'Live',
      title: 'Draft is in progress',
      description: 'The clock is active and picks, queues, and auto-picks are live.',
      tone: 'border-[color:var(--draft-broadcast-green)] bg-[color:var(--draft-broadcast-green)] text-[color:var(--draft-broadcast-text)]',
      icon: (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      ),
    },
    COMPLETED: {
      label: 'Completed',
      title: 'Draft is complete',
      description: 'All picks have been finalized and the room is now read-only.',
      tone: 'border-[color:var(--draft-broadcast-green)] bg-[color:var(--draft-broadcast-green)] text-[color:var(--draft-broadcast-text)]',
      icon: (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
  };

  if (status === 'PAUSED') {
    return null;
  }

  const config = statusConfig[status] ?? {
    label: status,
    title: `Draft status: ${status}`,
    description: 'The draft room is active, but this state does not yet have dedicated messaging.',
    tone: 'border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel-strong)] text-[color:var(--draft-broadcast-text)]',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  };

  return (
    <section className="w-full px-4 pt-4 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 rounded-3xl border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel)] px-5 py-4 text-[color:var(--draft-broadcast-text)] shadow-[0_22px_70px_-48px_var(--draft-broadcast-shadow-deep)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${config.tone}`}
          >
            {config.icon}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-panel-strong)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--draft-broadcast-muted)]">
                {config.label}
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-[color:var(--draft-broadcast-text)]">
                {config.title}
              </p>
              <p className="text-sm text-[color:var(--draft-broadcast-muted)]">
                {config.description}
              </p>
            </div>
          </div>
        </div>

        {status === 'SCHEDULED' && onStartDraft ? (
          <button
            type="button"
            onClick={handleStartDraft}
            disabled={isActuallyLoading}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[color:var(--draft-broadcast-red)] px-4 py-2 text-sm font-semibold text-[color:var(--draft-broadcast-text)] shadow-[0_0_24px_var(--draft-broadcast-red-glow)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isActuallyLoading ? 'Starting draft...' : 'Start draft now'}
          </button>
        ) : null}
      </div>
    </section>
  );
}
