'use client';

import { useEffect } from 'react';

import { initializePerformanceMonitoring } from '@/lib/performance';

interface PerformanceMonitorProps {
  enableAnalytics?: boolean;
  enableConsoleLogging?: boolean;
  sampleRate?: number;
}

export function PerformanceMonitor({
  enableAnalytics = true,
  enableConsoleLogging = process.env.NODE_ENV === 'development',
  sampleRate = 1.0,
}: PerformanceMonitorProps) {
  useEffect(() => {
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
