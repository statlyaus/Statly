'use client';

import { onCLS, onFID, onFCP, onLCP, onTTFB } from 'web-vitals';

interface PerformanceMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  id: string;
  navigationType: string;
}

interface PerformanceConfig {
  enableAnalytics?: boolean;
  enableConsoleLogging?: boolean;
  enableLocalStorage?: boolean;
  sampleRate?: number;
}

class PerformanceMonitor {
  private config: PerformanceConfig;
  private metrics: Map<string, PerformanceMetric> = new Map();
  private sessionId: string;

  constructor(config: PerformanceConfig = {}) {
    this.config = {
      enableAnalytics: false,
      enableConsoleLogging: false,
      enableLocalStorage: false,
      sampleRate: 1.0,
      ...config,
    };

    this.sessionId = this.generateSessionId();
    this.initializeWebVitals();
  }

  private generateSessionId(): string {
    return `perf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private shouldSample(): boolean {
    return Math.random() < this.config.sampleRate!;
  }

  private initializeWebVitals(): void {
    if (!this.shouldSample()) return;

    // Core Web Vitals
    onCLS(this.handleMetric.bind(this));
    onFID(this.handleMetric.bind(this));
    onFCP(this.handleMetric.bind(this));
    onLCP(this.handleMetric.bind(this));
    onTTFB(this.handleMetric.bind(this));
  }

  private handleMetric(metric: {
    name: string;
    value: number;
    rating: 'good' | 'needs-improvement' | 'poor';
    delta: number;
    id: string;
    navigationType?: string;
  }): void {
    const performanceMetric: PerformanceMetric = {
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
      id: metric.id,
      navigationType: metric.navigationType || 'unknown',
    };

    this.metrics.set(metric.name, performanceMetric);

    if (this.config.enableConsoleLogging) {
      console.log(`[Performance] ${metric.name}:`, performanceMetric);
    }

    if (this.config.enableLocalStorage) {
      this.saveToLocalStorage(performanceMetric);
    }

    if (this.config.enableAnalytics) {
      this.sendToAnalytics(performanceMetric);
    }
  }

  private saveToLocalStorage(metric: PerformanceMetric): void {
    try {
      const key = `perf_${metric.name}_${this.sessionId}`;
      localStorage.setItem(
        key,
        JSON.stringify({
          ...metric,
          timestamp: Date.now(),
          url: window.location.href,
          userAgent: navigator.userAgent,
        })
      );
    } catch (error) {
      console.warn('Failed to save performance metric to localStorage:', error);
    }
  }

  private sendToAnalytics(metric: PerformanceMetric): void {
    // Send to Google Analytics if available
    if (typeof window !== 'undefined' && 'gtag' in window) {
      const gtag = (window as unknown as { gtag: (...args: unknown[]) => void }).gtag;
      gtag('event', metric.name, {
        event_category: 'Web Vitals',
        value: Math.round(metric.value),
        metric_rating: metric.rating,
        custom_map: {
          metric_id: metric.id,
          session_id: this.sessionId,
        },
      });
    }

    // Send to custom analytics endpoint
    this.sendToCustomEndpoint(metric);
  }

  private async sendToCustomEndpoint(metric: PerformanceMetric): Promise<void> {
    try {
      await fetch('/api/analytics/performance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...metric,
          sessionId: this.sessionId,
          timestamp: Date.now(),
          url: window.location.href,
          userAgent: navigator.userAgent,
        }),
      });
    } catch (error) {
      // Silently fail - don't impact user experience
      if (this.config.enableConsoleLogging) {
        console.warn('Failed to send performance metric to analytics:', error);
      }
    }
  }

  // Public methods for custom metrics
  public measureCustomMetric(name: string, startTime: number, endTime?: number): void {
    const end = endTime || performance.now();
    const value = end - startTime;

    const customMetric: PerformanceMetric = {
      name: `custom_${name}`,
      value,
      rating: value < 100 ? 'good' : value < 300 ? 'needs-improvement' : 'poor',
      delta: value,
      id: `custom_${Date.now()}`,
      navigationType: 'custom',
    };

    this.handleMetric(customMetric);
  }

  public startTimer(name: string): () => void {
    const startTime = performance.now();
    return () => this.measureCustomMetric(name, startTime);
  }

  public getMetrics(): Map<string, PerformanceMetric> {
    return new Map(this.metrics);
  }

  public getMetricsSummary(): Record<
    string,
    {
      value: number;
      rating: 'good' | 'needs-improvement' | 'poor';
    }
  > {
    const summary: Record<
      string,
      {
        value: number;
        rating: 'good' | 'needs-improvement' | 'poor';
      }
    > = {};

    this.metrics.forEach((metric, name) => {
      summary[name] = {
        value: metric.value,
        rating: metric.rating,
      };
    });

    return summary;
  }
}

// No-op implementation for SSR
class NoOpPerformanceMonitor extends PerformanceMonitor {
  constructor() {
    super({ enableAnalytics: false, enableConsoleLogging: false, enableLocalStorage: false });
  }

  public measureCustomMetric(): void {}
  public startTimer(): () => void {
    return () => {};
  }
  public getMetrics(): Map<string, PerformanceMetric> {
    return new Map();
  }
  public getMetricsSummary(): Record<
    string,
    {
      value: number;
      rating: 'good' | 'needs-improvement' | 'poor';
    }
  > {
    return {};
  }
}

let performanceMonitor: PerformanceMonitor | null = null;

export function initializePerformanceMonitoring(config?: PerformanceConfig): PerformanceMonitor {
  return new NoOpPerformanceMonitor();
}

export function getPerformanceMonitor(): PerformanceMonitor | null {
  return null;
}

// React hook for performance monitoring
export function usePerformanceMonitor() {
  const monitor = getPerformanceMonitor();

  return {
    measureCustomMetric: monitor?.measureCustomMetric.bind(monitor) || (() => {}),
    startTimer: monitor?.startTimer.bind(monitor) || (() => () => {}),
    getMetrics: monitor?.getMetrics.bind(monitor) || (() => new Map()),
    getMetricsSummary: monitor?.getMetricsSummary.bind(monitor) || (() => ({})),
  };
}

// Utility functions for common measurements
export function measurePageLoad(): () => void {
  const monitor = getPerformanceMonitor();
  if (!monitor) return () => {};

  return monitor.startTimer('page_load');
}

export function measureAPICall(endpoint: string): () => void {
  const monitor = getPerformanceMonitor();
  if (!monitor) return () => {};

  return monitor.startTimer(`api_${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`);
}

export function measureComponentRender(componentName: string): () => void {
  const monitor = getPerformanceMonitor();
  if (!monitor) return () => {};

  return monitor.startTimer(`component_${componentName}`);
}
