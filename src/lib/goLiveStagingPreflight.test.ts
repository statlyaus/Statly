import { describe, expect, it, vi } from 'vitest';

import {
  buildPreflightConfig,
  runGoLiveStagingPreflight,
  validatePreflightConfig,
} from '../../Scripts/go-live-staging-preflight';

const completeEnv = {
  STATLY_RUNTIME_ENV: 'staging',
  BYPASS_AUTH: 'false',
  NEXT_PUBLIC_BYPASS_AUTH: 'false',
  ADMIN_API_TOKEN: 'admin-token',
  CRON_SECRET: 'cron-secret',
  ETL_IMPORT_TOKEN: 'etl-import-token',
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: 'firebase-service-account',
  GO_LIVE_BASE_URL: 'https://staging.statly.test',
  GO_LIVE_SMOKE_ACCOUNT_EMAIL: 'smoke@statly.test',
  GO_LIVE_SMOKE_LEAGUE_ID: 'league_123',
  GO_LIVE_SMOKE_DRAFT_ID: 'draft_123',
  GO_LIVE_ALLOWED_MUTATIONS: 'read-only',
  GO_LIVE_CLEANUP_POLICY: 'read-only smoke; no cleanup required',
  GO_LIVE_MONITORING_URL: 'https://monitoring.statly.test/dashboard',
  GO_LIVE_BUILD_ID: 'build_123',
  GO_LIVE_BROWSER_MATRIX: 'chrome,safari,firefox,mobile-safari,chrome-android',
};

describe('go-live staging preflight', () => {
  it('fails closed when staging evidence inputs are missing', () => {
    const config = buildPreflightConfig([], {});

    expect(validatePreflightConfig(config)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/GO_LIVE_BASE_URL/),
        expect.stringMatching(/GO_LIVE_SMOKE_ACCOUNT_EMAIL/),
        expect.stringMatching(/GO_LIVE_SMOKE_LEAGUE_ID/),
        expect.stringMatching(/GO_LIVE_SMOKE_DRAFT_ID/),
      ])
    );
  });

  it('rejects staging smoke mutation modes other than read-only', () => {
    const config = buildPreflightConfig([], {
      ...completeEnv,
      GO_LIVE_ALLOWED_MUTATIONS: 'league-create,trade-accept',
    });

    expect(validatePreflightConfig(config)).toEqual(
      expect.arrayContaining([expect.stringMatching(/read-only/)])
    );
  });

  it('rejects local or bypass-auth runtime settings for staging preflight', () => {
    const config = buildPreflightConfig([], {
      ...completeEnv,
      STATLY_RUNTIME_ENV: 'local',
      BYPASS_AUTH: 'true',
      NEXT_PUBLIC_BYPASS_AUTH: 'true',
    });

    expect(validatePreflightConfig(config)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/STATLY_RUNTIME_ENV/),
        expect.stringMatching(/BYPASS_AUTH/),
        expect.stringMatching(/NEXT_PUBLIC_BYPASS_AUTH/),
      ])
    );
  });

  it('requires staging operational secrets without reporting their values', async () => {
    const config = buildPreflightConfig([], {
      ...completeEnv,
      ADMIN_API_TOKEN: '',
      CRON_SECRET: '',
      ETL_IMPORT_TOKEN: '',
      FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: '',
    });

    const result = await runGoLiveStagingPreflight(config, vi.fn());

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/ADMIN_API_TOKEN/),
        expect.stringMatching(/CRON_SECRET/),
        expect.stringMatching(/ETL_IMPORT_TOKEN/),
        expect.stringMatching(/Firebase admin credentials/),
      ])
    );
    expect(JSON.stringify(result)).not.toContain('admin-token');
    expect(JSON.stringify(result)).not.toContain('cron-secret');
  });

  it('checks only safe GET routes when required staging evidence is present', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      url: 'https://staging.statly.test/',
    });
    const config = buildPreflightConfig([], completeEnv);

    const result = await runGoLiveStagingPreflight(config, fetchImpl);

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), {
      method: 'GET',
      redirect: 'manual',
    });
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(result.routeChecks.map((check) => check.path)).toEqual(
      expect.arrayContaining(['/login', '/leagues/league_123', '/drafts/draft_123'])
    );
  });

  it('reports server errors from staging route probes as blockers', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: URL) =>
      Promise.resolve({
        status: url.pathname === '/players' ? 503 : 200,
        statusText: url.pathname === '/players' ? 'Service Unavailable' : 'OK',
        url: url.toString(),
      })
    );
    const config = buildPreflightConfig([], completeEnv);

    const result = await runGoLiveStagingPreflight(config, fetchImpl);

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/\/players/)]));
  });
});
