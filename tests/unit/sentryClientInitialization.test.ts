import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Sentry client initialization', () => {
  it('is owned by the Next.js client instrumentation entry', () => {
    const instrumentationSource = readFileSync(
      join(process.cwd(), 'src/instrumentation-client.ts'),
      'utf8'
    );
    const wrapperSource = readFileSync(
      join(process.cwd(), 'src/components/ClientSentryWrapper.tsx'),
      'utf8'
    );

    expect(instrumentationSource).toContain("import * as Sentry from '@sentry/nextjs'");
    expect(instrumentationSource).toContain('Sentry.init({');
    expect(instrumentationSource).not.toContain('Sentry.replayIntegration');
    expect(instrumentationSource).not.toContain('sendDefaultPii: true');
    expect(instrumentationSource).toContain(
      'export const onRouterTransitionStart = Sentry.captureRouterTransitionStart'
    );
    expect(instrumentationSource).not.toContain('export async function register');

    expect(wrapperSource).not.toContain('sentry-init');
    expect(wrapperSource).not.toContain('Sentry.init(');
    expect(existsSync(join(process.cwd(), 'src/lib/sentry-init.ts'))).toBe(false);
  });

  it('loads deployment routing and sampling from environment variables', () => {
    const clientSource = readFileSync(join(process.cwd(), 'src/instrumentation-client.ts'), 'utf8');
    const serverSource = readFileSync(join(process.cwd(), 'src/instrumentation.ts'), 'utf8');
    const environmentExample = readFileSync(join(process.cwd(), 'ENV.EXAMPLE'), 'utf8');

    expect(serverSource).toContain('process.env.SENTRY_DSN');
    expect(serverSource).toContain('process.env.SENTRY_TRACES_SAMPLE_RATE');
    expect(serverSource).toContain('enabled: Boolean(dsn)');
    expect(serverSource).toContain('debug: false');

    expect(clientSource).toContain('process.env.NEXT_PUBLIC_SENTRY_DSN');
    expect(clientSource).toContain('process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE');
    expect(clientSource).toContain("NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII === 'true'");
    expect(clientSource).toContain('!isProduction &&');
    expect(clientSource).toContain('enabled: Boolean(sentryDsn)');

    expect(`${serverSource}\n${clientSource}`).not.toMatch(/https:\/\/[^\s'"]+\.sentry\.io/);
    expect(environmentExample).toContain('SENTRY_DSN=');
    expect(environmentExample).toContain('NEXT_PUBLIC_SENTRY_DSN=');
    expect(environmentExample).toContain('NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII=false');
  });
});
