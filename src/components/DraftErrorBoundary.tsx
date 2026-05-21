'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

import Link from 'next/link';

import {
  TriangleAlert as ExclamationTriangleIcon,
  RefreshCw as ArrowPathIcon,
  Home as HomeIcon,
} from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

export default class DraftErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    retryCount: 0,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, retryCount: 0 };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Draft Error Boundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // Log to external service in production
    if (process.env.NODE_ENV === 'production') {
      // TODO: Implement error logging service
      console.error('Production error:', { error: error.message, stack: error.stack });
    }
  }

  private handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  private handleRefresh = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      const { error, retryCount } = this.state;

      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-muted flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-destructive/10 mb-4">
              <ExclamationTriangleIcon className="h-6 w-6 text-destructive" />
            </div>

            <h2 className="text-lg font-semibold text-foreground mb-2">Draft Room Error</h2>

            <p className="text-sm text-muted-foreground mb-4">
              Something went wrong while loading the draft room. This might be a temporary issue.
            </p>

            {error && (
              <details className="mb-4 text-left">
                <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
                  Error Details
                </summary>
                <div className="mt-2 p-3 bg-muted rounded text-xs font-mono text-foreground overflow-auto">
                  {error.message}
                </div>
              </details>
            )}

            <div className="space-y-3">
              <button
                onClick={this.handleRetry}
                disabled={retryCount >= 3}
                className="w-full px-4 py-2 bg-info text-white rounded-md hover:bg-info disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                <ArrowPathIcon className="h-4 w-4" />
                <span>Retry ({3 - retryCount} attempts left)</span>
              </button>

              {retryCount >= 3 && (
                <div className="text-xs text-destructive">
                  Maximum retry attempts reached. Try refreshing the page.
                </div>
              )}

              <button
                onClick={this.handleRefresh}
                className="w-full px-4 py-2 bg-muted text-white rounded-md hover:bg-muted flex items-center justify-center space-x-2"
              >
                <ArrowPathIcon className="h-4 w-4" />
                <span>Refresh Page</span>
              </button>

              <Link
                href="/drafts"
                className="w-full px-4 py-2 border border-border text-foreground rounded-md hover:bg-muted flex items-center justify-center space-x-2"
              >
                <HomeIcon className="h-4 w-4" />
                <span>Back to Drafts</span>
              </Link>
            </div>

            <div className="mt-4 text-xs text-muted-foreground">
              If this problem persists, please contact support.
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
