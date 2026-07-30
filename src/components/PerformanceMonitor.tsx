'use client';

import { useEffect } from 'react';
import { initializeFirebaseAnalytics } from '@/lib/firebase/clientAnalytics';
import { initializePerformanceMonitoring } from '@/lib/performance';

interface PerformanceMonitorProps {
  enableAnalytics?: boolean;
  enableConsoleLogging?: boolean;
  sampleRate?: number;
}

export function shouldSendPerformanceAnalytics(): boolean {
  if (process.env.NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS === 'true') return false;

  return (
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_ENABLE_DEVELOPMENT_PERFORMANCE_ANALYTICS === 'true'
  );
}

export function PerformanceMonitor({
  enableAnalytics = shouldSendPerformanceAnalytics(),
  enableConsoleLogging = process.env.NODE_ENV === 'development',
  sampleRate = 1.0,
}: PerformanceMonitorProps) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || enableAnalytics) {
      void initializeFirebaseAnalytics();
    }

    // Initialize performance monitoring on the client side
    initializePerformanceMonitoring({
      enableAnalytics,
      enableConsoleLogging,
      enableLocalStorage: true,
      sampleRate,
    });
  }, [enableAnalytics, enableConsoleLogging, sampleRate]);

  // This component doesn't render anything
  return null;
}

export default PerformanceMonitor;
