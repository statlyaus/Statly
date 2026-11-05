import { describe, expect, it } from 'vitest';

import {
  buildContentSecurityPolicy,
  buildContentSecurityPolicyReportOnlyHeaders,
} from '../../config/contentSecurityPolicy.mjs';

function directives(policy: string) {
  return new Map(
    policy.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources] as const;
    })
  );
}

const productionEnv = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'statly-prod.firebaseapp.com',
  NEXT_PUBLIC_SOCKET_URL: 'https://realtime.statly.example',
  NEXT_PUBLIC_API_BASE_URL: 'https://api.statly.example/v1',
  NEXT_PUBLIC_SENTRY_DSN: 'https://publickey@o123.ingest.us.sentry.io/456',
};

describe('buildContentSecurityPolicy', () => {
  it('locks down the directives that default-src does not cover', () => {
    const policy = directives(buildContentSecurityPolicy(productionEnv));

    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('allows the realtime server over both https and wss', () => {
    const connect = directives(buildContentSecurityPolicy(productionEnv)).get('connect-src');

    expect(connect).toContain('https://realtime.statly.example');
    expect(connect).toContain('wss://realtime.statly.example');
    expect(connect).toContain('https://api.statly.example');
    expect(connect).toContain('https://o123.ingest.us.sentry.io');
  });

  it('allows the Firebase sign-in popup frame', () => {
    const frame = directives(buildContentSecurityPolicy(productionEnv)).get('frame-src');

    expect(frame).toContain('https://statly-prod.firebaseapp.com');
  });

  it('sends violation reports to the Sentry security endpoint', () => {
    const policy = directives(buildContentSecurityPolicy(productionEnv));

    expect(policy.get('report-uri')).toEqual([
      'https://o123.ingest.us.sentry.io/api/456/security/?sentry_key=publickey',
    ]);
  });

  it('allows eval only in development, for React refresh', () => {
    const production = directives(buildContentSecurityPolicy(productionEnv)).get('script-src');
    const development = directives(
      buildContentSecurityPolicy({ ...productionEnv, NODE_ENV: 'development' })
    ).get('script-src');

    expect(production).not.toContain("'unsafe-eval'");
    expect(development).toContain("'unsafe-eval'");
  });

  it('sends report-only headers with both report-uri and report-to', () => {
    const headers = buildContentSecurityPolicyReportOnlyHeaders(productionEnv);
    const endpoint = 'https://o123.ingest.us.sentry.io/api/456/security/?sentry_key=publickey';

    expect(headers).toEqual([
      { key: 'Reporting-Endpoints', value: `csp-endpoint="${endpoint}"` },
      {
        key: 'Content-Security-Policy-Report-Only',
        value: expect.stringMatching(/; report-uri \S+; report-to csp-endpoint$/),
      },
    ]);
  });

  it('sends no report-only policy when there is nowhere to report', () => {
    expect(buildContentSecurityPolicyReportOnlyHeaders({ NODE_ENV: 'production' })).toEqual([]);
  });

  it('omits optional origins and reporting when they are not configured', () => {
    const policy = buildContentSecurityPolicy({ NODE_ENV: 'production' });

    expect(policy).not.toContain('undefined');
    expect(policy).not.toContain('report-uri');
    expect(directives(policy).get('connect-src')).toContain('http://localhost:3002');
  });
});
