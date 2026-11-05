// Content-Security-Policy for every response, built from the public env at build/start.
// Sent as Report-Only until the Sentry reports are clean; see next.config.mjs.

const FIREBASE_AND_GOOGLE = [
  'https://*.googleapis.com',
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://www.googletagmanager.com',
];
const GIPHY_CONNECT = ['https://api.giphy.com', 'https://pingback.giphy.com'];

/** @param {string | undefined} value */
function originOf(value) {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/** Origins for a Socket.IO server: its http(s) origin plus the matching ws(s) origin. */
function socketOrigins(/** @type {string} */ origin) {
  return [origin, origin.replace(/^http/, 'ws')];
}

/** Sentry DSN `https://KEY@HOST/PROJECT` → ingest origin and CSP security report URL. */
function sentryEndpoints(/** @type {string | undefined} */ dsn) {
  if (!dsn) return {};
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\//, '');
    if (!url.username || !project) return {};
    return {
      origin: url.origin,
      reportUri: `${url.origin}/api/${project}/security/?sentry_key=${url.username}`,
    };
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function buildContentSecurityPolicy(env) {
  const isDevelopment = env.NODE_ENV !== 'production';
  const socketOrigin = originOf(env.NEXT_PUBLIC_SOCKET_URL) ?? 'http://localhost:3002';
  const apiOrigin = originOf(env.NEXT_PUBLIC_API_BASE_URL);
  const authDomain = env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const sentry = sentryEndpoints(env.NEXT_PUBLIC_SENTRY_DSN);

  const directives = {
    'default-src': ["'self'"],
    // Next.js inlines bootstrap scripts; a nonce would force dynamic rendering app-wide.
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
      'https://apis.google.com',
      'https://www.googletagmanager.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    // Team logos and avatars are user-supplied https URLs.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      ...FIREBASE_AND_GOOGLE,
      ...GIPHY_CONNECT,
      ...socketOrigins(socketOrigin),
      ...(apiOrigin ? [apiOrigin] : []),
      ...(sentry.origin ? [sentry.origin] : []),
    ],
    'frame-src': [
      "'self'",
      'https://accounts.google.com',
      ...(authDomain ? [`https://${authDomain}`] : []),
    ],
    // Sentry Session Replay compresses in a blob: worker.
    'worker-src': ["'self'", 'blob:'],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'frame-ancestors': ["'none'"],
    ...(sentry.reportUri ? { 'report-uri': [sentry.reportUri] } : {}),
  };

  return Object.entries(directives)
    .map(([name, sources]) => [name, ...new Set(sources)].join(' '))
    .join('; ');
}

const REPORT_ENDPOINT_NAME = 'csp-endpoint';

/**
 * Report-Only headers, or none: a report-only policy with nowhere to report has no effect, and
 * WebKit logs a console error for it.
 * @param {Record<string, string | undefined>} env
 * @returns {Array<{ key: string; value: string }>}
 */
export function buildContentSecurityPolicyReportOnlyHeaders(env) {
  const { reportUri } = sentryEndpoints(env.NEXT_PUBLIC_SENTRY_DSN);
  if (!reportUri) return [];

  return [
    { key: 'Reporting-Endpoints', value: `${REPORT_ENDPOINT_NAME}="${reportUri}"` },
    {
      key: 'Content-Security-Policy-Report-Only',
      value: `${buildContentSecurityPolicy(env)}; report-to ${REPORT_ENDPOINT_NAME}`,
    },
  ];
}
