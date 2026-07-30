import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { shouldSendPerformanceAnalytics } from '@/components/PerformanceMonitor';

const firebaseAnalyticsInitializerSource = readFileSync(
  join(process.cwd(), 'src/components/FirebaseAnalyticsInitializer.tsx'),
  'utf8'
);
const performanceMonitorSource = readFileSync(
  join(process.cwd(), 'src/components/PerformanceMonitor.tsx'),
  'utf8'
);
const rootLayoutSource = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');

describe('performance monitoring environment boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not send analytics beacons during ordinary development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS', 'false');
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEVELOPMENT_PERFORMANCE_ANALYTICS', 'false');

    expect(shouldSendPerformanceAnalytics()).toBe(false);
  });

  it('allows an explicit development trace session to send analytics beacons', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS', 'false');
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEVELOPMENT_PERFORMANCE_ANALYTICS', 'true');

    expect(shouldSendPerformanceAnalytics()).toBe(true);
  });

  it('keeps production analytics enabled unless the kill switch is active', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS', 'false');

    expect(shouldSendPerformanceAnalytics()).toBe(true);

    vi.stubEnv('NEXT_PUBLIC_DISABLE_PERFORMANCE_ANALYTICS', 'true');
    expect(shouldSendPerformanceAnalytics()).toBe(false);
  });

  it('owns Firebase Analytics globally behind an environment-gated dynamic boundary', () => {
    expect(rootLayoutSource).toContain(
      "import FirebaseAnalyticsInitializer from '@/components/FirebaseAnalyticsInitializer'"
    );
    expect(rootLayoutSource).toContain('<FirebaseAnalyticsInitializer />');
    expect(firebaseAnalyticsInitializerSource).toContain("process.env.NODE_ENV === 'production'");
    expect(firebaseAnalyticsInitializerSource).toContain(
      "process.env.NEXT_PUBLIC_ENABLE_DEVELOPMENT_PERFORMANCE_ANALYTICS === 'true'"
    );
    expect(firebaseAnalyticsInitializerSource).toContain('if (!shouldInitialize) return;');
    expect(firebaseAnalyticsInitializerSource).toContain(
      "import('@/lib/firebase/clientAnalytics')"
    );
    expect(firebaseAnalyticsInitializerSource).not.toMatch(
      /import\s+\{[^}]*initializeFirebaseAnalytics[^}]*\}\s+from/
    );
    expect(performanceMonitorSource).not.toContain('@/lib/firebase/clientAnalytics');
  });
});
