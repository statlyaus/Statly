'use client';

import React, { Component } from 'react';
import type { ReactNode } from 'react';
import { ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { logger } from '@/lib/logger';
import { captureError } from '@/lib/sentry-utils';

export interface ErrorFallbackContext {
  error?: Error;
  resetError: () => void;
  errorId?: string;
  retryCount: number;
  maxRetries: number;
}

interface Props {
  children: ReactNode;
  fallback?: ReactNode | ((context: ErrorFallbackContext) => ReactNode);
  onError?: (error: Error, errorInfo: React.ErrorInfo, errorId: string) => void;
  maxRetries?: number;
  level?: 'page' | 'section' | 'component';
  name?: string;
  resetKeys?: readonly unknown[];
}

interface State {
  hasError: boolean;
  error?: Error;
  errorId?: string;
  retryCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return { hasError: true, error, errorId };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const { onError, name = 'Unknown', level = 'component' } = this.props;
    const errorId =
      this.state.errorId || `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Enhanced error logging
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      level,
      name,
      errorId,
      timestamp: new Date().toISOString(),
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'server',
      url: typeof window !== 'undefined' ? window.location.href : 'server',
    };

    logger.error('ErrorBoundary caught an error', error, {
      ...errorDetails,
      errorBoundary: true,
    });
    captureError(error, { ...errorDetails, errorBoundary: true });

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo, errorId);
    }

    // Report to analytics if available
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'exception', {
        description: error.message,
        fatal: level === 'page',
        custom_map: { error_id: errorId },
      });
    }
  }

  componentDidUpdate(previousProps: Props) {
    if (this.state.hasError && resetKeysChanged(previousProps.resetKeys, this.props.resetKeys)) {
      this.setState({
        hasError: false,
        error: undefined,
        errorId: undefined,
        retryCount: 0,
      });
    }
  }

  resetError = () => {
    const { maxRetries = 3 } = this.props;
    const newRetryCount = this.state.retryCount + 1;

    if (newRetryCount <= maxRetries) {
      this.setState({
        hasError: false,
        error: undefined,
        errorId: undefined,
        retryCount: newRetryCount,
      });
    }
  };

  render() {
    if (this.state.hasError) {
      const maxRetries = this.props.maxRetries ?? 3;
      const fallbackContext: ErrorFallbackContext = {
        error: this.state.error,
        resetError: this.resetError,
        errorId: this.state.errorId,
        retryCount: this.state.retryCount,
        maxRetries,
      };

      return (
        (typeof this.props.fallback === 'function'
          ? this.props.fallback(fallbackContext)
          : this.props.fallback) || (
          <DefaultErrorFallback
            error={this.state.error}
            resetError={this.resetError}
            errorId={this.state.errorId}
            level={this.props.level}
            retryCount={this.state.retryCount}
            maxRetries={maxRetries}
          />
        )
      );
    }

    return this.props.children;
  }
}

function resetKeysChanged(
  previousKeys: readonly unknown[] | undefined,
  nextKeys: readonly unknown[] | undefined
): boolean {
  const previous = previousKeys ?? [];
  const next = nextKeys ?? [];
  return (
    previous.length !== next.length ||
    previous.some((value, index) => !Object.is(value, next[index]))
  );
}

interface ErrorFallbackProps {
  error?: Error;
  resetError: () => void;
  errorId?: string;
  level?: 'page' | 'section' | 'component';
  retryCount?: number;
  maxRetries?: number;
}

function DefaultErrorFallback({
  resetError,
  errorId,
  level = 'component',
  retryCount = 0,
  maxRetries = 3,
}: ErrorFallbackProps) {
  const isPageLevel = level === 'page';
  const canRetry = retryCount < maxRetries;

  return (
    <div
      className={`${isPageLevel ? 'min-h-screen' : 'min-h-[200px]'} flex items-center justify-center p-4`}
    >
      <div className="text-center max-w-md">
        <div className="mx-auto mb-4 h-12 w-12 text-result-loss">
          <ExclamationTriangleIcon aria-hidden="true" />
        </div>

        <h2
          className={`${isPageLevel ? 'text-2xl' : 'text-lg'} mb-2 font-semibold text-foreground`}
        >
          {isPageLevel ? 'Page Error' : 'Something went wrong'}
        </h2>

        {/* Raw error text can expose internals (service names, IDs); it is logged, not shown. */}
        <p className="mb-4 text-muted-foreground">
          {isPageLevel
            ? 'This page could not load. Try again, or reload the page.'
            : 'This part of the page could not load. Try again in a moment.'}
        </p>

        {errorId && (
          <p className="mb-4 font-mono text-xs text-muted-foreground">Reference: {errorId}</p>
        )}

        <div className="space-y-2">
          {canRetry && (
            <button
              onClick={resetError}
              className="inline-flex min-h-11 items-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground transition-colors hover:bg-brand-bar/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ArrowPathIcon aria-hidden="true" className="mr-2 h-4 w-4" />
              Try again {retryCount > 0 && `(${maxRetries - retryCount} attempts left)`}
            </button>
          )}

          {isPageLevel && (
            <button
              onClick={() => window.location.reload()}
              className="block min-h-11 w-full rounded-md border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Reload page
            </button>
          )}

          {!canRetry && (
            <p className="text-sm text-muted-foreground">
              Maximum retry attempts reached. Please reload the page.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Specialized error boundaries for different contexts
export function PageErrorBoundary({ children, ...props }: Omit<Props, 'level'>) {
  return (
    <ErrorBoundary level="page" {...props}>
      {children}
    </ErrorBoundary>
  );
}

export function SectionErrorBoundary({ children, ...props }: Omit<Props, 'level'>) {
  return (
    <ErrorBoundary level="section" {...props}>
      {children}
    </ErrorBoundary>
  );
}

export function ComponentErrorBoundary({ children, ...props }: Omit<Props, 'level'>) {
  return (
    <ErrorBoundary level="component" {...props}>
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
