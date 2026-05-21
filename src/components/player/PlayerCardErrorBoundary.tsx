/**
 * PlayerCard Error Boundary
 * Provides fallback UI when PlayerCard encounters errors
 */

import React, { Component } from 'react';
import type { ReactNode } from 'react';

import { TriangleAlert as ExclamationTriangleIcon } from 'lucide-react';

import { leagueDesignTokens, componentSizes } from '@/styles/leagueDesignSystem';

interface PlayerCardErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface PlayerCardErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info?: React.ErrorInfo) => void;
}

export class PlayerCardErrorBoundary extends Component<
  PlayerCardErrorBoundaryProps,
  PlayerCardErrorBoundaryState
> {
  constructor(props: PlayerCardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): PlayerCardErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('PlayerCard Error:', error, errorInfo);

    // Invoke optional error callback for monitoring/analytics
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback or default skeleton
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <PlayerCardSkeleton error={this.state.error} />;
    }

    return this.props.children;
  }
}

// Default skeleton fallback component
function PlayerCardSkeleton({ error }: { error?: Error }) {
  // Token-driven class names
  const SKELETON_CLASSES = `relative bg-white border border-border ${leagueDesignTokens.rounded.lg} ${leagueDesignTokens.spacing.md} ${leagueDesignTokens.shadows.sm}`;
  const AVATAR_CLASSES = `${componentSizes.avatar.lg} ${leagueDesignTokens.rounded.full} ${leagueDesignTokens.colors.error[50]} flex items-center justify-center`;
  const ICON_CLASSES = `${componentSizes.icon.lg} text-current`;
  const TITLE_CLASSES = `text-sm font-medium ${leagueDesignTokens.colors.gray[900]}`;
  const MESSAGE_CLASSES = `text-xs ${leagueDesignTokens.colors.gray[500]}`;

  return (
    <div className={SKELETON_CLASSES}>
      <div className="flex items-center space-x-3">
        {/* Error avatar */}
        <div className={AVATAR_CLASSES}>
          <ExclamationTriangleIcon className={ICON_CLASSES} />
        </div>

        {/* Error content */}
        <div className="flex-1">
          <h4 className={TITLE_CLASSES}>Player Card Error</h4>
          <p className={MESSAGE_CLASSES}>{error?.message || 'Unable to load player data'}</p>
        </div>
      </div>
    </div>
  );
}

// HOC wrapper for PlayerCard with error boundary
export function withPlayerCardErrorBoundary<T extends object>(
  WrappedComponent: React.ComponentType<T>
) {
  const ComponentWithErrorBoundary = (props: T) => (
    <PlayerCardErrorBoundary>
      <WrappedComponent {...props} />
    </PlayerCardErrorBoundary>
  );

  ComponentWithErrorBoundary.displayName = `withPlayerCardErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name})`;

  return ComponentWithErrorBoundary;
}
