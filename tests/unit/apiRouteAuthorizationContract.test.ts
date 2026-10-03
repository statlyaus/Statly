import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PUBLIC_API_ROUTES } from './apiRouteAuthorizationAllowlist';

const apiRoot = join(process.cwd(), 'src/app/api');

/**
 * Mechanisms that resolve a caller's authority before a handler reads or mutates protected state.
 *
 * The list is deliberately broad. Authorization may live in the route, in a shared handler the route
 * delegates to, or in an operator credential. What is not acceptable is authorization happening
 * nowhere: an endpoint that reads or writes protected state has to prove who is calling.
 */
const AUTHORIZATION_PATTERNS: readonly RegExp[] = [
  // Verified identity.
  /getAuthenticatedUserId/,
  /getUserIdFromRequest/,
  /resolveAuthenticatedUserId/,
  /resolveExplicitAuthenticatedUserId/,
  /validateAuthToken/,
  /verifyIdToken/,
  /verifySessionCookie/,
  /adminAuth/,
  // League, season, and draft scope.
  /verifyLeagueMembership/,
  /getLeagueMembershipAccess/,
  /canManageLeague/,
  /authorizeLeagueTradeAccess/,
  /withLeagueSocialRoute/,
  /requireLeagueSocialAccess/,
  // Operator and scheduler credentials.
  /isAdminRequest/,
  /ADMIN_SECRET/,
  /CRON_SECRET/,
  /INTERNAL_TASK_SECRET/,
  /METRICS_API_KEY/,
  /METRICS_BEARER_TOKEN/,
  // Local development tooling.
  /isDevelopmentToolsEnabled/,
];

function findRouteFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findRouteFiles(fullPath));
    } else if (entry.name === 'route.ts') {
      found.push(fullPath);
    }
  }

  return found;
}

/** Convert a route file path into the URL path it serves. */
function toRoutePath(file: string): string {
  return `/${file.slice(apiRoot.length + 1).replace(/\/route\.ts$/, '')}`;
}

describe('API route authorization contract', () => {
  const routeFiles = findRouteFiles(apiRoot);
  const allowlisted = new Set(PUBLIC_API_ROUTES.map((entry) => entry.route));

  it('finds the route handlers', () => {
    expect(routeFiles.length).toBeGreaterThan(50);
  });

  it('resolves a caller for every route that is not recorded as intentionally public', () => {
    const unguarded = routeFiles
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return !AUTHORIZATION_PATTERNS.some((pattern) => pattern.test(source));
      })
      .map(toRoutePath)
      .filter((route) => !allowlisted.has(route))
      .sort();

    expect(unguarded).toEqual([]);
  });

  it('keeps every recorded public route tied to a route that still exists', () => {
    const known = new Set(routeFiles.map(toRoutePath));
    const stale = PUBLIC_API_ROUTES.map((entry) => entry.route)
      .filter((route) => !known.has(route))
      .sort();

    expect(stale).toEqual([]);
  });

  it('requires a stated reason for every recorded public route', () => {
    const unexplained = PUBLIC_API_ROUTES.filter((entry) => entry.reason.trim().length < 10).map(
      (entry) => entry.route
    );

    expect(unexplained).toEqual([]);
  });
});
