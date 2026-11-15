/** A trade or club id from the address bar: decoded, bounded, and only the characters ids use. */
export function parseTradeRouteId(value: string): string | null {
  let id: string;
  try {
    id = decodeURIComponent(value).trim();
  } catch {
    return null;
  }
  if (id.length === 0 || id.length > 200) return null;
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(id) ? id : null;
}
