// Advanced Integration & Feature Components - Phase 3
import React from 'react';
import dynamic, { type DynamicOptionsLoadingProps } from 'next/dynamic';

// Small helper to render a lightweight placeholder without JSX
// Return a component type compatible with next/dynamic `loading`
const makePlaceholder = (minHeightPx: number): React.ComponentType<DynamicOptionsLoadingProps> => {
  const LoadingPlaceholder: React.FC<DynamicOptionsLoadingProps> = (_props) =>
    React.createElement('div', {
      className: 'w-full rounded-lg border border-gray-200 bg-gray-50 animate-pulse',
      style: { minHeight: `${minHeightPx}px` },
      'aria-busy': true,
      'aria-live': 'polite',
      role: 'status',
    });
  LoadingPlaceholder.displayName = `LoadingPlaceholder(${minHeightPx})`;
  return LoadingPlaceholder;
};

// Use dynamic imports to code-split large client components
export const RealTimeMatchCenter = dynamic(() => import('./RealTimeMatchCenter'), {
  // Reserve space to avoid layout shift while loading
  loading: makePlaceholder(480),
  ssr: false,
});

export const SmartTradeAnalyzer = dynamic(() => import('./SmartTradeAnalyzer'), {
  loading: makePlaceholder(480),
  ssr: false,
});

export const LeagueAnalyticsDashboard = dynamic(() => import('./LeagueAnalyticsDashboard'), {
  loading: makePlaceholder(560),
  ssr: false,
});
