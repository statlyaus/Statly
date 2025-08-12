import { useEffect, useRef, useCallback } from 'react';
import React from 'react';

interface PerformanceMetrics {
  renderTime: number;
  componentName: string;
  timestamp: number;
}

interface UsePerformanceOptions {
  componentName: string;
  logToConsole?: boolean;
  threshold?: number; // Log only if render time exceeds this (ms)
}

export function usePerformanceMonitor(options: UsePerformanceOptions) {
  const { componentName, logToConsole = false, threshold = 10 } = options;
  const startTimeRef = useRef<number>(0);
  const metricsRef = useRef<PerformanceMetrics[]>([]);

  const startTiming = useCallback(() => {
    startTimeRef.current = performance.now();
  }, []);

  const endTiming = useCallback(() => {
    const renderTime = performance.now() - startTimeRef.current;
    
    const metrics: PerformanceMetrics = {
      renderTime,
      componentName,
      timestamp: Date.now(),
    };

    metricsRef.current.push(metrics);

    // Keep only last 50 measurements
    if (metricsRef.current.length > 50) {
      metricsRef.current = metricsRef.current.slice(-50);
    }

    if (logToConsole && renderTime > threshold) {
      console.warn(
        `🐌 Slow render detected in ${componentName}: ${renderTime.toFixed(2)}ms`
      );
    }

    return metrics;
  }, [componentName, logToConsole, threshold]);

  const getAverageRenderTime = useCallback(() => {
    const metrics = metricsRef.current;
    if (metrics.length === 0) return 0;
    
    const total = metrics.reduce((sum, metric) => sum + metric.renderTime, 0);
    return total / metrics.length;
  }, []);

  const getSlowRenders = useCallback((slowThreshold = 16) => {
    return metricsRef.current.filter(metric => metric.renderTime > slowThreshold);
  }, []);

  // Start timing on every render
  useEffect(() => {
    startTiming();
  });

  // End timing after render is complete
  useEffect(() => {
    endTiming();
  });

  return {
    getAverageRenderTime,
    getSlowRenders,
    getAllMetrics: () => [...metricsRef.current],
    clearMetrics: () => {
      metricsRef.current = [];
    }
  };
}

// Development-only performance wrapper
export function withPerformanceMonitoring<P extends object>(
  Component: React.ComponentType<P>,
  componentName?: string
): React.ComponentType<P> {
  if (process.env.NODE_ENV !== 'development') {
    return Component;
  }

  const WrappedComponent = (props: P) => {
    usePerformanceMonitor({
      componentName: componentName || Component.displayName || Component.name || 'Unknown',
      logToConsole: true,
      threshold: 16, // 16ms = 60fps threshold
    });

    return React.createElement(Component, props);
  };

  WrappedComponent.displayName = `withPerformanceMonitoring(${componentName || Component.displayName || Component.name})`;

  return WrappedComponent;
}
