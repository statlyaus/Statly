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
  /handlePickCommand/,
  /requireLeagueSocialAccess/,
  // Operator and scheduler credentials.
  /isAdminRequest/,
  /ADMIN_SECRET/,
  /CRON_SECRET/,
  /isCronRequestAuthorized/,
  /INTERNAL_TASK_SECRET/,
  /METRICS_API_KEY/,
  /METRICS_BEARER_TOKEN/,
  // Local development tooling.
  /isDevelopmentToolsEnabled/,
];

const HANDLER_START = /^export (?:async )?(?:function|const) (GET|POST|PUT|PATCH|DELETE)\b/gm;
const LOCAL_FUNCTION_START = /^(?:async )?function (\w+)|^const (\w+) = (?:async )?\(/gm;

/** Split a source file at each match of `start`, returning the name and text of every section. */
function sections(source: string, start: RegExp): { name: string; body: string }[] {
  const matches = [...source.matchAll(start)];
  return matches.map((match, index) => ({
    name: match[1] ?? match[2] ?? '',
    body: source.slice(match.index, matches[index + 1]?.index ?? source.length),
  }));
}

/**
 * Exported state-changing or reading handlers that resolve no caller. A handler counts as guarded
 * when its own body matches an authorization pattern or calls a module-level function that does,
 * so one guarded handler cannot hide an unguarded sibling in the same file.
 */
function unguardedHandlers(source: string): string[] {
  const isGuarded = (text: string) => AUTHORIZATION_PATTERNS.some((pattern) => pattern.test(text));
  const guardHelpers = sections(source, LOCAL_FUNCTION_START)
    .filter((helper) => helper.name && isGuarded(helper.body))
    .map((helper) => new RegExp(`\\b${helper.name}\\(`));

  const handlers = sections(source, HANDLER_START);
  const callsGuard = (body: string) => guardHelpers.some((call) => call.test(body));
  const guardedHandlers = handlers
    .filter((handler) => isGuarded(handler.body) || callsGuard(handler.body))
    .map((handler) => new RegExp(`\\b${handler.name}\\(`));

  // A handler that delegates to a guarded sibling, such as POST returning GET(request), is guarded.
  return handlers
    .filter(
      (handler) =>
        !isGuarded(handler.body) &&
        !callsGuard(handler.body) &&
        !guardedHandlers.some((call) => call.test(handler.body))
    )
    .map((handler) => handler.name);
}

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
      .filter((file) => !allowlisted.has(toRoutePath(file)))
      .flatMap((file) =>
        unguardedHandlers(readFileSync(file, 'utf8')).map(
          (method) => `${method} ${toRoutePath(file)}`
        )
      )
      .filter((handler) => !allowlisted.has(handler))
      .sort();

    expect(unguarded).toEqual([]);
  });

  it('keeps every recorded public route tied to a route that still exists', () => {
    const known = new Set(
      routeFiles.flatMap((file) => {
        const route = toRoutePath(file);
        const methods = sections(readFileSync(file, 'utf8'), HANDLER_START).map(
          (handler) => `${handler.name} ${route}`
        );
        return [route, ...methods];
      })
    );
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
