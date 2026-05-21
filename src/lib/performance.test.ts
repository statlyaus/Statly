import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ObserveOptions = {
  type?: string;
  entryTypes?: string[];
  buffered?: boolean;
};

type MockEntry = {
  name?: string;
  startTime?: number;
  duration?: number;
  hadRecentInput?: boolean;
  value?: number;
  processingStart?: number;
};

describe('performance monitor', () => {
  const observers: Array<{ callback: PerformanceObserverCallback; observed: ObserveOptions[] }> =
    [];

  beforeEach(() => {
    vi.resetModules();
    observers.length = 0;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(Date, 'now').mockReturnValue(1779270000000);

    class MockPerformanceObserver {
      static supportedEntryTypes = [
        'paint',
        'largest-contentful-paint',
        'layout-shift',
        'first-input',
        'event',
      ];

      private readonly callback: PerformanceObserverCallback;

      constructor(callback: PerformanceObserverCallback) {
        this.callback = callback;
        observers.push({ callback, observed: [] });
      }

      observe(options: ObserveOptions) {
        observers[observers.length - 1]?.observed.push(options);
      }

      disconnect() {}
      takeRecords() {
        return [];
      }
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    vi.stubGlobal('performance', {
      now: vi.fn(() => 250),
      getEntriesByType: vi.fn((type: string) =>
        type === 'navigation'
          ? [
              {
                responseStart: 120,
                requestStart: 20,
                startTime: 0,
              },
            ]
          : []
      ),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('initializes an active singleton and records initial TTFB', async () => {
    const { getPerformanceMonitor, initializePerformanceMonitoring } = await import('./performance');

    const monitor = initializePerformanceMonitoring({
      enableAnalytics: true,
      enableLocalStorage: true,
      sampleRate: 1,
    });

    expect(getPerformanceMonitor()).toBe(monitor);
    expect(monitor.getMetricsSummary()).toMatchObject({
      TTFB: { value: 100, rating: 'good' },
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/analytics/performance',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(Storage.prototype.setItem).toHaveBeenCalled();
  });

  it('records browser performance observer entries as Web Vitals', async () => {
    const { initializePerformanceMonitoring } = await import('./performance');

    const monitor = initializePerformanceMonitoring({ sampleRate: 1 });
    const lcpObserver = observers.find((observer) =>
      observer.observed.some((options) => options.type === 'largest-contentful-paint')
    );

    lcpObserver?.callback(
      {
        getEntries: () => [{ startTime: 2400 } as PerformanceEntry],
      } as PerformanceObserverEntryList,
      {} as PerformanceObserver
    );

    expect(monitor.getMetricsSummary()).toMatchObject({
      LCP: { value: 2400, rating: 'good' },
    });
  });

  it('keeps custom metrics local instead of posting them to the Web Vitals endpoint', async () => {
    const { initializePerformanceMonitoring } = await import('./performance');

    const monitor = initializePerformanceMonitoring({ enableAnalytics: true, sampleRate: 1 });
    vi.mocked(fetch).mockClear();

    monitor.measureCustomMetric('team_roster_render', 100, 260);

    expect(monitor.getMetricsSummary()).toMatchObject({
      custom_team_roster_render: { value: 160, rating: 'needs-improvement' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
