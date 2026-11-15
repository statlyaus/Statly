import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { shouldSendPerformanceAnalytics } from '@/components/PerformanceMonitor';

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

  it('loads no Firebase Analytics: the privacy policy names no analytics provider', () => {
    expect(rootLayoutSource).not.toContain('FirebaseAnalytics');
    expect(performanceMonitorSource).not.toContain('firebase/analytics');
    expect(existsSync(join(process.cwd(), 'src/lib/firebase/clientAnalytics.ts'))).toBe(false);
  });
});
