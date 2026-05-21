'use client';

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

type WebVitalName = 'CLS' | 'FID' | 'FCP' | 'INP' | 'LCP' | 'TTFB';

type PerformanceEntryWithValue = PerformanceEntry & {
  hadRecentInput?: boolean;
  value?: number;
  processingStart?: number;
};

const WEB_VITAL_NAMES = new Set<string>(['CLS', 'FID', 'FCP', 'INP', 'LCP', 'TTFB']);

const THRESHOLDS: Record<WebVitalName, [number, number]> = {
  CLS: [0.1, 0.25],
  FID: [100, 300],
  FCP: [1800, 3000],
  INP: [200, 500],
  LCP: [2500, 4000],
  TTFB: [800, 1800],
};

function rateMetric(name: WebVitalName | string, value: number): PerformanceMetric['rating'] {
  const thresholds = WEB_VITAL_NAMES.has(name) ? THRESHOLDS[name as WebVitalName] : [100, 300];
  if (value <= thresholds[0]) return 'good';
  if (value <= thresholds[1]) return 'needs-improvement';
  return 'poor';
}

class PerformanceMonitor {
  private config: PerformanceConfig;
  private metrics: Map<string, PerformanceMetric> = new Map();
  private sessionId: string;
  private observers: PerformanceObserver[] = [];

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
    return `perf_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private shouldSample(): boolean {
    return Math.random() < this.config.sampleRate!;
  }

  private initializeWebVitals(): void {
    if (!this.shouldSample()) return;
    if (typeof window === 'undefined' || typeof performance === 'undefined') return;

    this.recordNavigationTiming();

    if (typeof PerformanceObserver === 'undefined') return;

    this.observe('paint', (entries) => {
      const fcp = entries.find((entry) => entry.name === 'first-contentful-paint');
      if (fcp) this.recordWebVital('FCP', fcp.startTime, 'navigate');
    });

    this.observe('largest-contentful-paint', (entries) => {
      const latest = entries.at(-1);
      if (latest) this.recordWebVital('LCP', latest.startTime, 'navigate');
    });

    let clsValue = 0;
    this.observe('layout-shift', (entries) => {
      for (const entry of entries as PerformanceEntryWithValue[]) {
        if (!entry.hadRecentInput) clsValue += entry.value ?? 0;
      }
      this.recordWebVital('CLS', clsValue, 'navigate');
    });

    this.observe('first-input', (entries) => {
      const firstInput = entries[0] as PerformanceEntryWithValue | undefined;
      if (!firstInput) return;
      const value = Math.max(0, (firstInput.processingStart ?? 0) - firstInput.startTime);
      this.recordWebVital('FID', value, 'navigate');
    });

    this.observe('event', (entries) => {
      const longest = Math.max(...entries.map((entry) => entry.duration).filter(Number.isFinite));
      if (Number.isFinite(longest)) this.recordWebVital('INP', longest, 'navigate');
    });
  }

  private observe(type: string, callback: (entries: PerformanceEntry[]) => void): void {
    const supported = PerformanceObserver.supportedEntryTypes ?? [];
    if (!supported.includes(type)) return;

    try {
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
      observer.observe({ type, buffered: true });
      this.observers.push(observer);
    } catch {
      // Unsupported observer options should not affect the user experience.
    }
  }

  private recordNavigationTiming(): void {
    const [navigation] = performance.getEntriesByType?.('navigation') ?? [];
    if (!navigation) return;

    const timing = navigation as PerformanceNavigationTiming;
    const requestStart = timing.requestStart || timing.startTime || 0;
    const responseStart = timing.responseStart || 0;
    const ttfb = Math.max(0, responseStart - requestStart);
    this.recordWebVital('TTFB', ttfb, 'navigate');
  }

  private recordWebVital(name: WebVitalName, value: number, navigationType: string): void {
    this.handleMetric({
      name,
      value,
      rating: rateMetric(name, value),
      delta: value,
      id: `${this.sessionId}_${name}_${Date.now()}`,
      navigationType,
    });
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
    if (!WEB_VITAL_NAMES.has(metric.name)) return;

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
      rating: rateMetric(`custom_${name}`, value),
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

  public disconnect(): void {
    for (const observer of this.observers) {
      observer.disconnect();
    }
    this.observers = [];
  }
}

let performanceMonitor: PerformanceMonitor | null = null;

export function initializePerformanceMonitoring(config?: PerformanceConfig): PerformanceMonitor {
  if (performanceMonitor) return performanceMonitor;
  performanceMonitor = new PerformanceMonitor(config);
  return performanceMonitor;
}

export function getPerformanceMonitor(): PerformanceMonitor | null {
  return performanceMonitor;
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
