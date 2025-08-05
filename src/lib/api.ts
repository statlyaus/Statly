// src/lib/api.ts

export async function fetchFromAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const rawBaseUrl = process.env.NEXT_PUBLIC_API_URL;

  if (!rawBaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_API_URL in environment variables. Please create a .env.local file and add NEXT_PUBLIC_API_URL=http://localhost:3000');
  }

  const baseUrl = rawBaseUrl.replace(/\/$/, '');
  const url = `${baseUrl}${path}`;

  const res = await fetch(url, options);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error (${res.status}): ${text}`);
  }

  return res.json();
}

export function buildQuery(params: Record<string, string>) {
  return '?' + new URLSearchParams(params).toString();
}
