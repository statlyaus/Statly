// Legacy ErrorBoundary - redirects to enhanced version
// This file is kept for backward compatibility
'use client';

import { ComponentErrorBoundary } from './ui/ErrorBoundary';
import type { ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

// Legacy wrapper that uses the enhanced ErrorBoundary
export default function ErrorBoundary({ children, fallback }: ErrorBoundaryProps) {
  return (
    <ComponentErrorBoundary name="LegacyErrorBoundary" fallback={fallback}>
      {children}
    </ComponentErrorBoundary>
  );
}
