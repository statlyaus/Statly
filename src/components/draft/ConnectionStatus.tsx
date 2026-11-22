'use client';

interface ConnectionStatusProps {
  status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  onRefresh?: () => void;
  /** Live updates keep failing (or are switched off), so the room offers a reload. */
  liveUpdatesDown?: boolean;
  /** The board is kept current by database reads, so picking is still safe. */
  picksStillWork?: boolean;
  onReload?: () => void;
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
    accent: 'border-border text-muted-foreground',
    icon: SPINNER,
    message: 'Connecting to the live draft…',
  },
  reconnecting: {
    accent: 'border-warning-text text-warning-text',
    icon: SPINNER,
    message: 'Reconnecting to the live draft. Picks made meanwhile will catch up.',
  },
  disconnected: {
    accent: 'border-destructive-text text-destructive-text',
    icon: WARNING_ICON,
    message: 'Connection lost. The board may be out of date.',
  },
} as const;

const BUTTON_CLASS =
  'inline-flex min-h-11 items-center rounded-cut border border-foreground bg-card px-3 font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground';

export default function ConnectionStatus({
  status,
  onRefresh,
  liveUpdatesDown = false,
  picksStillWork = false,
  onReload,
}: ConnectionStatusProps) {
  if (status === 'connected') {
    return null;
  }

  if (liveUpdatesDown) {
    return (
      <div
        role="status"
        aria-label="Live draft connection"
        aria-live="polite"
        className={`flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 border-b-2 bg-card px-4 py-2 text-sm ${
          picksStillWork
            ? 'border-warning-text text-warning-text'
            : 'border-destructive-text text-destructive-text'
        }`}
      >
        {WARNING_ICON}
        <span className="font-medium text-foreground">
          {picksStillWork
            ? 'Live updates are down. Picks still work and the board refreshes every few seconds.'
            : 'Live updates are down. The board may be out of date.'}
        </span>
        {onReload ? (
          <button type="button" onClick={onReload} className={BUTTON_CLASS}>
            Reload to reconnect
          </button>
        ) : null}
      </div>
    );
  }

  const config = STATUS_CONFIG[status];

  return (
    <div
      role="status"
      aria-label="Live draft connection"
      aria-live="polite"
      className={`flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 border-b-2 bg-card px-4 py-2 text-sm ${config.accent}`}
    >
      {config.icon}
      <span className="font-medium text-foreground">{config.message}</span>
      {status === 'disconnected' && onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh draft room"
          className={BUTTON_CLASS}
        >
          Refresh
        </button>
      ) : null}
    </div>
  );
}
