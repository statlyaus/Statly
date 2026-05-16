'use client';

import React, { Component } from 'react';
import type { ReactNode } from 'react';

import { AlertTriangle, RefreshCw } from 'lucide-react';

import { logger } from '@/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo, errorId: string) => void;
  maxRetries?: number;
  level?: 'page' | 'section' | 'component';
  name?: string;
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
      return (
        this.props.fallback || (
          <DefaultErrorFallback
            error={this.state.error}
            resetError={this.resetError}
            errorId={this.state.errorId}
            level={this.props.level}
            retryCount={this.state.retryCount}
            maxRetries={this.props.maxRetries}
          />
        )
      );
    }

    return this.props.children;
  }
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
  error,
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
        <div className="mx-auto mb-4 h-16 w-16 text-destructive">
          <AlertTriangle aria-hidden="true" />
        </div>

        <h2
          className={`${isPageLevel ? 'text-2xl' : 'text-lg'} mb-2 font-semibold text-foreground`}
        >
          {isPageLevel ? 'Page Error' : 'Something went wrong'}
        </h2>

        <p className="mb-4 text-muted-foreground">
          {error?.message || 'An unexpected error occurred. Please try again.'}
        </p>

        {process.env.NODE_ENV === 'development' && errorId && (
          <p className="mb-4 font-mono text-xs text-muted-foreground">Error ID: {errorId}</p>
        )}

        <div className="space-y-2">
          {canRetry && (
            <button
              onClick={resetError}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Try again {retryCount > 0 && `(${maxRetries - retryCount} attempts left)`}
            </button>
          )}

          {isPageLevel && (
            <button
              onClick={() => window.location.reload()}
              className="block w-full rounded-md bg-muted px-4 py-2 text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
