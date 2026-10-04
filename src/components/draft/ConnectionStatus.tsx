'use client';

interface ConnectionStatusProps {
  status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  onRefresh?: () => void;
}

const SPINNER = (
  <svg className="h-4 w-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

const WARNING_ICON = (
  <svg
    className="h-4 w-4 shrink-0"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19c-.77.833.192 2.5 1.732 2.5z"
    />
  </svg>
);

const STATUS_CONFIG = {
  connecting: {
    accent:
      'border-[color:var(--draft-broadcast-border)] text-[color:var(--draft-broadcast-muted)]',
    icon: SPINNER,
    message: 'Connecting to the live draft…',
  },
  reconnecting: {
    accent:
      'border-[color:var(--draft-broadcast-caution)] text-[color:var(--draft-broadcast-caution)]',
    icon: SPINNER,
    message: 'Reconnecting to the live draft. Picks made meanwhile will catch up.',
  },
  disconnected: {
    accent: 'border-[color:var(--draft-broadcast-alert)] text-[color:var(--draft-broadcast-alert)]',
    icon: WARNING_ICON,
    message: 'Connection lost. The board may be out of date.',
  },
} as const;

export default function ConnectionStatus({ status, onRefresh }: ConnectionStatusProps) {
  if (status === 'connected') {
    return null;
  }

  const config = STATUS_CONFIG[status];

  return (
    <div
      role="status"
      aria-label="Live draft connection"
      aria-live="polite"
      className={`flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 border-b-2 bg-[color:var(--draft-broadcast-panel-strong)] px-4 py-2 text-sm ${config.accent}`}
    >
      {config.icon}
      <span className="font-medium text-[color:var(--draft-broadcast-text)]">{config.message}</span>
      {status === 'disconnected' && onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh draft room"
          className="inline-flex min-h-11 items-center rounded-md border border-[color:var(--draft-broadcast-border)] bg-[color:var(--draft-broadcast-muted-surface)] px-3 font-semibold text-[color:var(--draft-broadcast-text)] transition-colors hover:bg-[color:var(--draft-broadcast-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--draft-broadcast-text)]"
        >
          Refresh
        </button>
      ) : null}
    </div>
  );
}
