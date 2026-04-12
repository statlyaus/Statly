/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

// Allow optional extra origins via env (space or comma separated)
function splitEnvList(v) {
  return (v || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Build the full connect-src list once (deduped)
function buildConnectSrc() {
  const connect = new Set([
    "'self'",
    // Firebase Web SDK endpoints
    'https://*.firebaseio.com',
    'https://firestore.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://identitytoolkit.googleapis.com',
    'https://firebaseinstallations.googleapis.com',
    'https://*.googleapis.com',
    'https://*.gstatic.com',
    // Socket.IO + SSE/WebSocket
    'wss:',
    'ws:',
  ]);

  // Optional Socket base URL (when running a separate socket process)
  const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (socketUrl) {
    try {
      const u = new URL(socketUrl);
      // Allow HTTP(S) for long-polling and WS(S) for upgrades on the same host
      connect.add(`${u.protocol}//${u.host}`);
      const wsScheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
      connect.add(`${wsScheme}//${u.host}`);
    } catch {}
  }

  // Optional custom API base (client fetch wrapper)
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (apiBase) {
    try {
      const u = new URL(apiBase);
      connect.add(`${u.protocol}//${u.host}`);
    } catch {}
  }

  // Emulators for local dev
  if (!isProd && useEmulators) {
    connect.add('http://127.0.0.1:8080');
    connect.add('http://127.0.0.1:9099');
  }

  // Optional extra connect-src (e.g., analytics, staging backends)
  splitEnvList(process.env.NEXT_PUBLIC_EXTRA_CONNECT_SRC).forEach((v) => connect.add(v));

  return Array.from(connect).join(' ');
}

// Content Security Policy string
function makeCsp() {
  const connectSrc = buildConnectSrc();

  const csp = [
    "default-src 'self'",
    // Note: 'unsafe-inline' / 'unsafe-eval' are common during dev (Next/React refresh).
    // Tighten these in production if your bundle allows.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    // Images from app, data/blob, Firebase Storage, Google user avatars
    "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  return csp;
}

const REPORT_ENDPOINT = '/api/csp-report';
const REPORTING_GROUP = 'csp-endpoint';

// Build Reporting-Endpoints / Report-To headers (send both for coverage)
function reportingHeaders(originHint = '') {
  // If deploying behind a proxy / custom domain, supply absolute origin via NEXT_PUBLIC_APP_ORIGIN
  const endpoint = originHint ? `${originHint}${REPORT_ENDPOINT}` : REPORT_ENDPOINT;

  const reportTo = JSON.stringify({
    group: REPORTING_GROUP,
    max_age: 86400, // 1 day
    endpoints: [{ url: endpoint }],
    include_subdomains: false,
  });

  return [
    { key: 'Report-To', value: reportTo },
    { key: 'Reporting-Endpoints', value: `${REPORTING_GROUP}="${endpoint}"` },
  ];
}

const nextConfig = {
  reactStrictMode: true,

  // CI/build stability: don't fail the build on lint issues; do fail on TS errors
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },

  // Ensure Turbopack uses the project root even when standalone output exists
  turbopack: {
    root: new URL('.', import.meta.url).pathname,
  },

  async headers() {
    const csp = makeCsp();
    const originHint = process.env.NEXT_PUBLIC_APP_ORIGIN || '';

    return [
      {
        source: '/(.*)',
        headers: [
          // Process coordination: keep if you need popup windows to interact
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },

          // Security headers (baseline)
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },

          // Reporting headers (send both for wider browser support)
          ...reportingHeaders(originHint),

          // In dev/staging, run CSP in Report-Only; in prod, enforce it.
          isProd
            ? { key: 'Content-Security-Policy', value: csp }
            : { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
    ];
  },

  // Image optimization: allow common Firebase/Google avatar hosts
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },

  // Production optimizations
  output: isProd ? 'standalone' : undefined,
  poweredByHeader: false,
  generateEtags: false,
};

export default nextConfig;
