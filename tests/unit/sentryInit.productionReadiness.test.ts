import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Sentry browser initialization', () => {
  it('does not run browser SDK initialization during SSR module evaluation', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/sentry-init.ts'), 'utf8');
    const browserGuardIndex = source.indexOf("if (typeof window !== 'undefined' && sentryDsn)");
    const initIndex = source.indexOf('Sentry.init({');

    expect(browserGuardIndex).toBeGreaterThanOrEqual(0);
    expect(initIndex).toBeGreaterThan(browserGuardIndex);
    expect(source).toContain('process.env.NEXT_PUBLIC_SENTRY_DSN');
    expect(source).not.toContain('ingest.us.sentry.io');
  });

  it('keeps every Sentry DSN configured through environment variables', () => {
    const sentrySources = [
      'src/lib/sentry-init.ts',
      'src/instrumentation.ts',
      'src/instrumentation-client.ts',
    ].map((filePath) => readFileSync(join(process.cwd(), filePath), 'utf8'));

    expect(sentrySources.join('\n')).not.toContain('ingest.us.sentry.io');
    expect(sentrySources[0]).toContain('process.env.NEXT_PUBLIC_SENTRY_DSN');
    expect(sentrySources[1]).toContain('process.env.SENTRY_DSN');
    expect(sentrySources[2]).toContain('process.env.NEXT_PUBLIC_SENTRY_DSN');
  });
});
