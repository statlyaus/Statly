#!/usr/bin/env tsx

import { pathToFileURL } from 'node:url';

type FetchLike = (
  input: URL,
  init: { method: 'GET'; redirect: 'manual' }
) => Promise<{ status: number; statusText: string; url?: string }>;

export interface GoLivePreflightConfig {
  runtimeEnv?: string;
  bypassAuth?: string;
  nextPublicBypassAuth?: string;
  hasAdminApiToken: boolean;
  hasCronSecret: boolean;
  hasEtlImportToken: boolean;
  hasFirebaseAdminCredentials: boolean;
  baseUrl?: string;
  smokeAccountEmail?: string;
  smokeLeagueId?: string;
  smokeDraftId?: string;
  allowedMutations?: string;
  cleanupPolicy?: string;
  monitoringUrl?: string;
  buildId?: string;
  browserMatrix: string[];
  allowInsecure: boolean;
  allowLocal: boolean;
}

export interface GoLiveRouteCheck {
  label: string;
  path: string;
  status: number | null;
  ok: boolean;
  error?: string;
}

export interface GoLivePreflightResult {
  ok: boolean;
  blockers: string[];
  routeChecks: GoLiveRouteCheck[];
  evidence: {
    baseUrl: string | null;
    smokeAccountEmail: string | null;
    smokeLeagueId: string | null;
    smokeDraftId: string | null;
    buildId: string | null;
    browserMatrix: string[];
  };
}

const REQUIRED_BROWSERS = ['chrome', 'safari', 'firefox', 'mobile-safari', 'chrome-android'];
type EnvLike = Record<string, string | undefined>;

const readArgValue = (argv: string[], name: string): string | undefined => {
  const equalsValue = argv.find((arg) => arg.startsWith(`${name}=`))?.split('=').slice(1).join('=');
  if (equalsValue != null) return equalsValue;

  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const readFirst = (argv: string[], env: EnvLike, names: string[]): string | undefined => {
  for (const name of names) {
    if (name.startsWith('--')) {
      const value = readArgValue(argv, name);
      if (value?.trim()) return value.trim();
    } else {
      const value = env[name];
      if (value?.trim()) return value.trim();
    }
  }

  return undefined;
};

const splitList = (value: string | undefined): string[] =>
  value
    ?.split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean) ?? [];

export function buildPreflightConfig(
  argv: string[],
  env: EnvLike = process.env
): GoLivePreflightConfig {
  const firebaseAdminCredentialParts = [
    env.FIREBASE_PROJECT_ID,
    env.FIREBASE_CLIENT_EMAIL,
    env.FIREBASE_PRIVATE_KEY,
  ];

  return {
    runtimeEnv: readFirst(argv, env, ['--runtime-env', 'STATLY_RUNTIME_ENV', 'VERCEL_ENV']),
    bypassAuth: readFirst(argv, env, ['BYPASS_AUTH']),
    nextPublicBypassAuth: readFirst(argv, env, ['NEXT_PUBLIC_BYPASS_AUTH']),
    hasAdminApiToken: Boolean(env.ADMIN_API_TOKEN?.trim()),
    hasCronSecret: Boolean(env.CRON_SECRET?.trim()),
    hasEtlImportToken: Boolean(env.ETL_IMPORT_TOKEN?.trim()),
    hasFirebaseAdminCredentials:
      Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim()) ||
      firebaseAdminCredentialParts.every((value) => Boolean(value?.trim())),
    baseUrl: readFirst(argv, env, ['--base-url', 'GO_LIVE_BASE_URL', 'STAGING_BASE_URL']),
    smokeAccountEmail: readFirst(argv, env, [
      '--smoke-account',
      'GO_LIVE_SMOKE_ACCOUNT_EMAIL',
      'STAGING_SMOKE_ACCOUNT_EMAIL',
    ]),
    smokeLeagueId: readFirst(argv, env, [
      '--league-id',
      'GO_LIVE_SMOKE_LEAGUE_ID',
      'STAGING_SMOKE_LEAGUE_ID',
    ]),
    smokeDraftId: readFirst(argv, env, [
      '--draft-id',
      'GO_LIVE_SMOKE_DRAFT_ID',
      'STAGING_SMOKE_DRAFT_ID',
    ]),
    allowedMutations:
      readFirst(argv, env, ['--allowed-mutations', 'GO_LIVE_ALLOWED_MUTATIONS']) ?? 'read-only',
    cleanupPolicy: readFirst(argv, env, ['--cleanup-policy', 'GO_LIVE_CLEANUP_POLICY']),
    monitoringUrl: readFirst(argv, env, ['--monitoring-url', 'GO_LIVE_MONITORING_URL']),
    buildId: readFirst(argv, env, [
      '--build-id',
      'GO_LIVE_BUILD_ID',
      'RELEASE_ID',
      'VERCEL_GIT_COMMIT_SHA',
    ]),
    browserMatrix: splitList(
      readFirst(argv, env, ['--browser-matrix', 'GO_LIVE_BROWSER_MATRIX', 'STAGING_BROWSER_MATRIX'])
    ),
    allowInsecure:
      argv.includes('--allow-insecure') || env.GO_LIVE_ALLOW_INSECURE_PREFLIGHT === 'true',
    allowLocal: argv.includes('--allow-local') || env.GO_LIVE_ALLOW_LOCAL_PREFLIGHT === 'true',
  };
}

export function validatePreflightConfig(config: GoLivePreflightConfig): string[] {
  const blockers: string[] = [];

  if (config.runtimeEnv === 'local') {
    blockers.push('STATLY_RUNTIME_ENV must not be local for staging preflight.');
  }

  if (config.bypassAuth === 'true') {
    blockers.push('BYPASS_AUTH must be false or unset for staging preflight.');
  }

  if (config.nextPublicBypassAuth === 'true') {
    blockers.push('NEXT_PUBLIC_BYPASS_AUTH must be false or unset for staging preflight.');
  }

  if (!config.hasAdminApiToken) {
    blockers.push('ADMIN_API_TOKEN is required for production-like staging policy.');
  }

  if (!config.hasCronSecret) {
    blockers.push('CRON_SECRET is required for production-like staging policy.');
  }

  if (!config.hasEtlImportToken) {
    blockers.push('ETL_IMPORT_TOKEN is required for production-like staging policy.');
  }

  if (!config.hasFirebaseAdminCredentials) {
    blockers.push(
      'Firebase admin credentials are required via FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.'
    );
  }

  if (!config.baseUrl) {
    blockers.push('GO_LIVE_BASE_URL or STAGING_BASE_URL is required.');
  } else {
    try {
      const url = new URL(config.baseUrl);
      const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

      if (url.protocol !== 'https:' && !config.allowInsecure) {
        blockers.push('GO_LIVE_BASE_URL must use HTTPS unless --allow-insecure is set.');
      }

      if (isLocalHost && !config.allowLocal) {
        blockers.push('GO_LIVE_BASE_URL must not be localhost unless --allow-local is set.');
      }
    } catch {
      blockers.push('GO_LIVE_BASE_URL must be a valid absolute URL.');
    }
  }

  if (!config.smokeAccountEmail) {
    blockers.push('GO_LIVE_SMOKE_ACCOUNT_EMAIL is required.');
  }

  if (!config.smokeLeagueId) {
    blockers.push('GO_LIVE_SMOKE_LEAGUE_ID is required.');
  }

  if (!config.smokeDraftId) {
    blockers.push('GO_LIVE_SMOKE_DRAFT_ID is required.');
  }

  if (!config.cleanupPolicy) {
    blockers.push('GO_LIVE_CLEANUP_POLICY is required.');
  }

  if (!config.monitoringUrl) {
    blockers.push('GO_LIVE_MONITORING_URL is required.');
  }

  if (!config.buildId) {
    blockers.push('GO_LIVE_BUILD_ID, RELEASE_ID, or VERCEL_GIT_COMMIT_SHA is required.');
  }

  if ((config.allowedMutations ?? '').toLowerCase() !== 'read-only') {
    blockers.push('GO_LIVE_ALLOWED_MUTATIONS must be read-only for this preflight.');
  }

  const declaredBrowsers = new Set(config.browserMatrix);
  const missingBrowsers = REQUIRED_BROWSERS.filter((browser) => !declaredBrowsers.has(browser));
  if (missingBrowsers.length > 0) {
    blockers.push(`GO_LIVE_BROWSER_MATRIX is missing: ${missingBrowsers.join(', ')}.`);
  }

  return blockers;
}

function buildRoutes(config: GoLivePreflightConfig): Array<{ label: string; path: string }> {
  return [
    { label: 'public home', path: '/' },
    { label: 'auth entry', path: '/login' },
    { label: 'player directory', path: '/players' },
    { label: 'rankings', path: '/rankings' },
    { label: 'league fixture', path: `/leagues/${config.smokeLeagueId}` },
    { label: 'draft fixture', path: `/drafts/${config.smokeDraftId}` },
    { label: 'anonymous admin denial', path: '/admin/workers' },
  ];
}

const isRouteStatusAcceptable = (status: number): boolean => status >= 200 && status < 500;

export async function runGoLiveStagingPreflight(
  config: GoLivePreflightConfig,
  fetchImpl: FetchLike = fetch
): Promise<GoLivePreflightResult> {
  const blockers = validatePreflightConfig(config);
  const routeChecks: GoLiveRouteCheck[] = [];

  if (blockers.length === 0 && config.baseUrl) {
    for (const route of buildRoutes(config)) {
      const url = new URL(route.path, config.baseUrl);

      try {
        const response = await fetchImpl(url, { method: 'GET', redirect: 'manual' });
        const ok = isRouteStatusAcceptable(response.status);
        routeChecks.push({
          label: route.label,
          path: route.path,
          status: response.status,
          ok,
        });

        if (!ok) {
          blockers.push(`${route.path} returned ${response.status} ${response.statusText}.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        routeChecks.push({
          label: route.label,
          path: route.path,
          status: null,
          ok: false,
          error: message,
        });
        blockers.push(`${route.path} failed read-only fetch: ${message}.`);
      }
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    routeChecks,
    evidence: {
      baseUrl: config.baseUrl ?? null,
      smokeAccountEmail: config.smokeAccountEmail ?? null,
      smokeLeagueId: config.smokeLeagueId ?? null,
      smokeDraftId: config.smokeDraftId ?? null,
      buildId: config.buildId ?? null,
      browserMatrix: config.browserMatrix,
    },
  };
}

async function main() {
  const config = buildPreflightConfig(process.argv.slice(2));
  const result = await runGoLiveStagingPreflight(config);

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          blockers: [error instanceof Error ? error.message : String(error)],
        },
        null,
        2
      )
    );
    process.exit(1);
  });
}
