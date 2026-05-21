'use client';

interface ConnectionStatusProps {
  status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  onRefresh?: () => void;
}

export default function ConnectionStatus({ status, onRefresh }: ConnectionStatusProps) {
  if (status === 'connected') {
    return null;
  }

  const getStatusConfig = () => {
    switch (status) {
      case 'connecting':
        return {
          bgColor: 'bg-info',
          icon: (
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          ),
          message: 'Connecting to live draft...',
        };
      case 'reconnecting':
        return {
          bgColor: 'bg-warning',
          icon: (
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          ),
          message: 'Reconnecting to live draft...',
        };
      case 'disconnected':
        return {
          bgColor: 'bg-destructive',
          icon: (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          ),
          message: 'Connection lost - Draft may not be in sync',
        };
      default:
        return {
          bgColor: 'bg-muted',
          icon: null,
          message: 'Unknown connection status',
        };
    }
  };

  const config = getStatusConfig();

  const liveRegionProps =
    status === 'disconnected'
      ? ({ role: 'alert' } as const)
      : ({ role: 'status', 'aria-live': 'polite' } as const);

  return (
    <div className={`w-full px-4 py-2 text-center text-white ${config.bgColor}`} {...liveRegionProps}>
      <div className="flex items-center justify-center space-x-2">
        <span aria-hidden="true">{config.icon}</span>
        <span>{config.message}</span>
        {status === 'disconnected' && onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="ml-2 underline hover:no-underline"
            aria-label="Refresh draft state"
          >
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}
