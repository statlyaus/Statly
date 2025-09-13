'use client';

import { useEffect, useRef, useCallback, useMemo } from 'react';

import { logger } from '@/lib/logger';

interface PerformanceMetrics {
  renderTime: number;
  memoryUsage: number;
  networkLatency: number;
  errorRate: number;
  userInteractions: number;
}

interface UseDraftPerformanceOptions {
  enableMonitoring?: boolean;
  logMetrics?: boolean;
  performanceThresholds?: {
    renderTime: number;
    memoryUsage: number;
    networkLatency: number;
  };
}

export function useDraftPerformance(options: UseDraftPerformanceOptions = {}) {
  const {
    enableMonitoring = true,
    logMetrics = false,
    performanceThresholds = {
      renderTime: 16, // 60fps target
      memoryUsage: 50 * 1024 * 1024, // 50MB
      networkLatency: 100, // 100ms
    },
  } = options;

  const metricsRef = useRef<PerformanceMetrics>({
    renderTime: 0,
    memoryUsage: 0,
    networkLatency: 0,
    errorRate: 0,
    userInteractions: 0,
  });

  const renderStartTimeRef = useRef<number>(0);
  const errorCountRef = useRef<number>(0);
  const interactionCountRef = useRef<number>(0);

  // Measure render performance
  const measureRender = useCallback(() => {
    if (!enableMonitoring) return;

    const startTime = performance.now();
    renderStartTimeRef.current = startTime;

    return () => {
      const endTime = performance.now();
      const renderTime = endTime - startTime;

      metricsRef.current.renderTime = renderTime;

      if (logMetrics && renderTime > performanceThresholds.renderTime) {
        logger.warn('Render time exceeded threshold', {
          renderTime,
          threshold: performanceThresholds.renderTime,
        });
      }
    };
  }, [enableMonitoring, logMetrics, performanceThresholds.renderTime]);

  // Measure memory usage
  const measureMemory = useCallback(() => {
    if (!enableMonitoring || !('memory' in performance)) return;

    const memory = (performance as any).memory;
    const memoryUsage = memory.usedJSHeapSize;

    metricsRef.current.memoryUsage = memoryUsage;

    if (logMetrics && memoryUsage > performanceThresholds.memoryUsage) {
      logger.warn('Memory usage exceeded threshold', {
        memoryUsage: `${(memoryUsage / 1024 / 1024).toFixed(2)}MB`,
        threshold: `${(performanceThresholds.memoryUsage / 1024 / 1024).toFixed(2)}MB`,
      });
    }
  }, [enableMonitoring, logMetrics, performanceThresholds.memoryUsage]);

  // Measure network latency
  const measureNetworkLatency = useCallback(
    async (url: string) => {
      if (!enableMonitoring) return 0;

      const startTime = performance.now();

      try {
        const _response = await fetch(url, { method: 'HEAD' });
        const endTime = performance.now();
        const latency = endTime - startTime;

        metricsRef.current.networkLatency = latency;

        if (logMetrics && latency > performanceThresholds.networkLatency) {
          logger.warn('Network latency exceeded threshold', {
            latency,
            threshold: performanceThresholds.networkLatency,
            url,
          });
        }

        return latency;
      } catch (error) {
        logger.error('Failed to measure network latency', { url, error });
        return 0;
      }
    },
    [enableMonitoring, logMetrics, performanceThresholds.networkLatency]
  );

  // Track errors
  const trackError = useCallback(
    (error: Error, context?: string) => {
      if (!enableMonitoring) return;

      errorCountRef.current++;
      metricsRef.current.errorRate = errorCountRef.current;

      if (logMetrics) {
        logger.error('Draft error tracked', {
          error: error.message,
          context,
          errorCount: errorCountRef.current,
        });
      }
    },
    [enableMonitoring, logMetrics]
  );

  // Track user interactions
  const trackInteraction = useCallback(
    (interactionType: string) => {
      if (!enableMonitoring) return;

      interactionCountRef.current++;
      metricsRef.current.userInteractions = interactionCountRef.current;

      if (logMetrics) {
        logger.info('User interaction tracked', {
          type: interactionType,
          count: interactionCountRef.current,
        });
      }
    },
    [enableMonitoring, logMetrics]
  );

  // Get current metrics
  const getMetrics = useCallback(() => {
    return { ...metricsRef.current };
  }, []);

  // Reset metrics
  const resetMetrics = useCallback(() => {
    metricsRef.current = {
      renderTime: 0,
      memoryUsage: 0,
      networkLatency: 0,
      errorRate: 0,
      userInteractions: 0,
    };
    errorCountRef.current = 0;
    interactionCountRef.current = 0;
  }, []);

  // Performance optimization suggestions
  const getOptimizationSuggestions = useMemo(() => {
    const suggestions: string[] = [];
    const metrics = metricsRef.current;

    if (metrics.renderTime > performanceThresholds.renderTime) {
      suggestions.push('Consider using React.memo for expensive components');
      suggestions.push('Implement virtualization for large lists');
      suggestions.push('Use useCallback and useMemo for expensive calculations');
    }

    if (metrics.memoryUsage > performanceThresholds.memoryUsage) {
      suggestions.push('Check for memory leaks in useEffect cleanup');
      suggestions.push('Consider lazy loading for non-critical components');
      suggestions.push('Implement proper cleanup for event listeners');
    }

    if (metrics.networkLatency > performanceThresholds.networkLatency) {
      suggestions.push('Implement request caching');
      suggestions.push('Consider using a CDN for static assets');
      suggestions.push('Optimize API response sizes');
    }

    if (metrics.errorRate > 5) {
      suggestions.push('Review error handling and user feedback');
      suggestions.push('Implement better error boundaries');
      suggestions.push('Add retry logic for failed operations');
    }

    return suggestions;
  }, [performanceThresholds]);

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => {
      if (logMetrics) {
        logger.info('Draft performance metrics', {
          finalMetrics: getMetrics(),
          suggestions: getOptimizationSuggestions,
        });
      }
    };
  }, [logMetrics, getMetrics, getOptimizationSuggestions]);

  return {
    measureRender,
    measureMemory,
    measureNetworkLatency,
    trackError,
    trackInteraction,
    getMetrics,
    resetMetrics,
    getOptimizationSuggestions,
    isMonitoringEnabled: enableMonitoring,
  };
}
