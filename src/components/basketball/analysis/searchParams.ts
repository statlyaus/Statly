/**
 * URL search-param helpers: the analysis pages keep their view state (week, drop, punts, filters,
 * sort) in the URL so they render on the server and can be shared.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export function firstParam(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** A comma-separated id list, de-duplicated, empty entries dropped. */
export function listParam(params: SearchParams, key: string): string[] {
  const value = firstParam(params, key);
  return value ? [...new Set(value.split(',').filter(Boolean))] : [];
}

/** `path` with the current params plus `updates` (null removes a key). */
export function hrefWith(
  path: string,
  params: SearchParams,
  updates: Record<string, string | null>
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && !(key in updates)) next.set(key, first);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value !== null) next.set(key, value);
  }
  const query = next.toString();
  return query ? `${path}?${query}` : path;
}
