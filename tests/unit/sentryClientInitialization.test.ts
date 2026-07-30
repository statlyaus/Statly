import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Sentry client initialization', () => {
  it('uses a compile-time adapter while keeping the Next client entry synchronous', () => {
    const instrumentationSource = readFileSync(
      join(process.cwd(), 'src/instrumentation-client.ts'),
      'utf8'
    );
    const productionAdapterSource = readFileSync(
      join(process.cwd(), 'src/lib/sentry/clientInstrumentation.ts'),
      'utf8'
    );
    const developmentAdapterSource = readFileSync(
      join(process.cwd(), 'src/lib/sentry/clientInstrumentation.dev.ts'),
      'utf8'
    );
    const nextConfigSource = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8');

    expect(instrumentationSource).toContain("from '@/lib/sentry/clientInstrumentation'");
    expect(instrumentationSource).toContain('initializeSentryClient({');
    expect(instrumentationSource).toContain(
      'export { captureRouterTransitionStart as onRouterTransitionStart }'
    );
    expect(instrumentationSource).not.toContain("import('@sentry/nextjs')");
    expect(instrumentationSource).not.toContain("from '@sentry/nextjs'");
    expect(instrumentationSource).not.toContain('Sentry.replayIntegration');
    expect(instrumentationSource).not.toContain('sendDefaultPii: true');
    expect(instrumentationSource).not.toContain('export async function register');

    expect(productionAdapterSource).toContain("import * as Sentry from '@sentry/nextjs'");
    expect(productionAdapterSource).toContain('Sentry.init(options)');
    expect(productionAdapterSource).not.toMatch(/=\s*import\('@sentry\/nextjs'\)/);

    expect(developmentAdapterSource).toContain("import('@sentry/nextjs')");
    expect(developmentAdapterSource).toContain('NEXT_PUBLIC_ENABLE_DEVELOPMENT_SENTRY');
    expect(developmentAdapterSource).toContain('.catch((error: unknown) =>');
    expect(developmentAdapterSource).not.toContain("import * as Sentry from '@sentry/nextjs'");

    expect(nextConfigSource).toContain('turbopack:');
    expect(nextConfigSource).toContain('resolveAlias:');
    expect(nextConfigSource).toContain('clientInstrumentation.dev.ts');
    expect(nextConfigSource).toContain('clientInstrumentation.ts');

    expect(existsSync(join(process.cwd(), 'src/components/ClientSentryWrapper.tsx'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'src/lib/sentry-init.ts'))).toBe(false);
  });

  it('loads deployment routing and sampling from environment variables', () => {
    const clientSource = readFileSync(join(process.cwd(), 'src/instrumentation-client.ts'), 'utf8');
    const runtimeSource = readFileSync(join(process.cwd(), 'src/instrumentation.ts'), 'utf8');
    const serverSource = readFileSync(join(process.cwd(), 'src/sentry.server.config.ts'), 'utf8');
    const edgeSource = readFileSync(join(process.cwd(), 'src/sentry.edge.config.ts'), 'utf8');
    const nextConfigSource = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8');

    expect(runtimeSource).toContain("import('./sentry.server.config')");
    expect(runtimeSource).toContain("import('./sentry.edge.config')");
    expect(runtimeSource).toContain('Sentry.captureRequestError');
    expect(serverSource).toContain('process.env.SENTRY_DSN');
    expect(serverSource).toContain('process.env.SENTRY_TRACES_SAMPLE_RATE');
    expect(serverSource).toContain('enabled: Boolean(dsn)');
    expect(serverSource).toContain('debug: false');
    expect(edgeSource).toContain("import * as Sentry from '@sentry/nextjs'");
    expect(edgeSource).toContain('process.env.SENTRY_TRACES_SAMPLE_RATE');

    expect(clientSource).toContain('process.env.NEXT_PUBLIC_SENTRY_DSN');
    expect(clientSource).toContain('process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE');
    expect(clientSource).toContain("NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII === 'true'");
    expect(clientSource).toContain('!isProduction &&');
    expect(clientSource).toContain('enabled: true');
    expect(nextConfigSource).toContain('org: process.env.SENTRY_ORG');
    expect(nextConfigSource).toContain('project: process.env.SENTRY_PROJECT');
    expect(nextConfigSource).toContain('authToken: process.env.SENTRY_AUTH_TOKEN');
    expect(nextConfigSource).not.toContain('your-org');
    expect(nextConfigSource).not.toContain('your-project');

    expect(`${serverSource}\n${edgeSource}\n${clientSource}`).not.toMatch(
      /https:\/\/[^\s'"]+\.sentry\.io/
    );
  });
});
