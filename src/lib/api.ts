// src/lib/api.ts

export async function fetchFromAPI<T>(
  path: string,
  options: RequestInit & { cache?: RequestCache } = {}
): Promise<T> {
  const baseUrls: string[] = [];
  const envBase = process.env.NEXT_PUBLIC_API_URL;

  if (envBase) {
    baseUrls.push(envBase);
  }

  // Try relative path and localhost as fallbacks
  baseUrls.push('');
  baseUrls.push(`http://localhost:${process.env.PORT ?? 3000}`);

  const { cache, ...rest } = options;

  for (const rawBase of baseUrls) {
    const base = rawBase.replace(/\/$/, '');
    const url = `${base}${path}`;

    let res: Response;
    try {
      res = await fetch(url, { cache, ...rest });
    } catch {
      continue; // try next base URL
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error (${res.status}): ${text}`);
    }

    return res.json();
  }

  throw new Error(
    'API base URL is missing or unreachable. Please set NEXT_PUBLIC_API_URL or ensure the API server is running.'
  );
}

export function buildQuery(params: Record<string, string>) {
  return '?' + new URLSearchParams(params).toString();
}
