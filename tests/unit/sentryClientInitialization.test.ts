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
    expect(instrumentationSource).toContain(
      'export const onRouterTransitionStart = Sentry.captureRouterTransitionStart'
    );
    expect(instrumentationSource).not.toContain('export async function register');

    expect(wrapperSource).not.toContain('sentry-init');
    expect(wrapperSource).not.toContain('Sentry.init(');
    expect(existsSync(join(process.cwd(), 'src/lib/sentry-init.ts'))).toBe(false);
  });
});
