/**
 * Common API route parameter types for Next.js 15+
 */

/**
 * Generic helper for route params
 */
export type ParamsOf<T extends Record<string, string>> = { params: T };

/**
 * Standard params shape for league ID-based routes
 */
export type LeagueParams = ParamsOf<{ id: string }>;

/**
 * Standard params shape for draft ID-based routes
 */
export type DraftParams = ParamsOf<{ id: string }>;

/**
 * Standard params shape for any route that takes an ID parameter
 */
export type IdParams = ParamsOf<{ id: string }>;

/**
 * Standard params shape for routes with userId parameter
 */
export type UserIdParams = ParamsOf<{ userId: string }>;

/**
 * Standard params shape for routes with multiple ID parameters
 */
export type MultiIdParams = ParamsOf<{ id: string; userId: string }>;

/**
 * Standard params shape for routes with three ID parameters
 */
export type TripleIdParams = ParamsOf<{ id: string; id2: string; userId: string }>;

