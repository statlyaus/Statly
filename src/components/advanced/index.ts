// Advanced Integration & Feature Components - Phase 3
import React from 'react';

import dynamic from 'next/dynamic';

// Small helper to render a lightweight placeholder without JSX
// Return a function that matches next/dynamic `loading` signature
/**
 * Create a `loading` renderer compatible with Next.js next/dynamic.
 * @param minHeightPx Minimum height (in pixels) to reserve for the placeholder.
 * @returns A function that renders the placeholder (signature: () => React.ReactNode)
 */
const makePlaceholder = (minHeightPx: number) => {
  function LoadingPlaceholder() {
    return React.createElement('div', {
      className: 'w-full rounded-lg border border-border bg-muted animate-pulse',
      style: { minHeight: `${minHeightPx}px` },
      'aria-busy': true,
      'aria-live': 'polite',
      role: 'status',
    });
  }
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
