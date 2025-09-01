/**
 * Common API route parameter types for Next.js 15+
 */

/**
 * Standard params shape for league ID-based routes (Promise-based in Next.js 15+)
 */
export type LeagueParams = { params: Promise<{ id: string }> };

/**
 * Standard params shape for draft ID-based routes
 */
export type DraftParams = { params: { id: string } };

/**
 * Standard params shape for any route that takes an ID parameter (Promise-based in Next.js 15+)
 */
export type IdParams = { params: Promise<{ id: string }> };

/**
 * Standard params shape for routes with userId parameter (Promise-based in Next.js 15+)
 */
export type UserIdParams = { params: Promise<{ userId: string }> };

/**
 * Standard params shape for routes with multiple ID parameters (Promise-based in Next.js 15+)
 */
export type MultiIdParams = { params: Promise<{ id: string; userId: string }> };

/**
 * Standard params shape for routes with three ID parameters (Promise-based in Next.js 15+)
 */
export type TripleIdParams = { params: Promise<{ id: string; id2: string; userId: string }> };
