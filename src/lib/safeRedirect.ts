const BASE = 'http://statly.invalid';

// Resolve like the browser will, so `/\host` and tab tricks that browsers read as `//host` are rejected.
export function toSafeRedirect(url?: string): string | undefined {
  if (!url?.startsWith('/')) return undefined;
  try {
    const parsed = new URL(url, BASE);
    return parsed.origin === BASE ? parsed.pathname + parsed.search + parsed.hash : undefined;
  } catch {
    return undefined;
  }
}
